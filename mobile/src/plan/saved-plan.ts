import type { Hue } from "@/lib/course-colors";
import { planningTerm } from "@/lib/planner-sections";

import { colorsFor, courseByCode, samplePicks, sectionsOf, type Picks } from "./guest-plan";
import { leaningOrder, leanings as leaningScales, samplePreferences, type Preferences } from "./preferences";

/**
 * The guest's plan as this device keeps it: the picked sections, the week
 * preferences and each course's hue, so a reload or a restart brings back
 * the same week in the same colors. It is one JSON record in plan-storage;
 * with nothing saved yet, the app starts on the sample student's plan.
 *
 * The phone's eventual store is SQLite with an outbox
 * (docs/architecture/README.md, "Mobile"). Until sync exists, this record
 * is the only copy of a guest's changes.
 */
export type GuestPlan = {
  picks: Picks;
  prefs: Preferences;
  colors: ReadonlyMap<string, Hue>;
};

export function samplePlan(): GuestPlan {
  const picks = samplePicks();
  return { picks, prefs: samplePreferences, colors: colorsFor(picks, new Map()) };
}

/** The plan with new picks: courses still planned keep their hue, new ones get the next by the web Week's rule. */
export function withPicks(plan: GuestPlan, picks: Picks): GuestPlan {
  return { ...plan, picks, colors: colorsFor(picks, plan.colors) };
}

/** Where the record lives: a file on iOS and Android (plan-storage.ts), localStorage on web (plan-storage.web.ts). */
export type PlanStorage = {
  /** The saved text, or null when nothing has been saved. */
  read(): string | null;
  write(text: string): void;
};

const VERSION = 1;

type SavedRecord = {
  version: typeof VERSION;
  /** The planning term the picks belong to; a plan saved for another term is not loaded. */
  term: string;
  picks: Record<string, string>;
  prefs: Preferences;
  colors: Record<string, Hue>;
};

export function encodePlan(plan: GuestPlan): string {
  const record: SavedRecord = {
    version: VERSION,
    term: planningTerm.id,
    picks: { ...plan.picks },
    prefs: plan.prefs,
    colors: Object.fromEntries(plan.colors),
  };
  return JSON.stringify(record);
}

export type Decoded =
  /** `dropped`: saved courses left out because their section is no longer in the catalog. */
  | { ok: true; plan: GuestPlan; dropped: string[] }
  | { ok: false; reason: string };

/** The credit limit's range, as the Preferences stepper bounds it (app/preferences.tsx). */
const CREDITS = { min: 3, max: 21 };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isObject(value) && Object.values(value).every((entry) => typeof entry === "string");

const isWholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Why a saved preferences object can't be used, or null when it can. */
function prefsProblem(value: unknown): string | null {
  if (!isObject(value)) return "prefs is not an object";
  if (!isStringRecord(value.busy)) return "prefs.busy is not a map of hour cells to labels";
  if (value.startAfter !== null && !isWholeIn(value.startAfter, 0, 24 * 60)) return "prefs.startAfter is neither a minute of the day nor null";
  if (!isObject(value.leanings)) return "prefs.leanings is not an object";
  const leanings = value.leanings;
  // Preferences draws each leaning as one of its steps, so a value off the scale can't be shown.
  const bad = leaningOrder.find((key) => !isWholeIn(leanings[key], leaningScales[key].min, leaningScales[key].max));
  if (bad) return `prefs.leanings.${bad} is not a whole step from ${leaningScales[bad].min} to ${leaningScales[bad].max}`;
  if (!isWholeIn(value.maxCredits, CREDITS.min, CREDITS.max)) return `prefs.maxCredits is not a whole number from ${CREDITS.min} to ${CREDITS.max}`;
  if (!Array.isArray(value.kept) || !value.kept.every((code) => typeof code === "string")) return "prefs.kept is not a list of course codes";
  return null;
}

const isHue = (value: unknown): value is Hue => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;

/**
 * Reads a saved record strictly: any field of the wrong shape rejects the
 * whole record with the field named. A course whose saved section the
 * catalog no longer has is left out and listed, so one stale section can't
 * cost the student the rest of the plan.
 */
export function decodePlan(text: string): Decoded {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "it is not JSON" };
  }
  if (!isObject(value)) return { ok: false, reason: "it is not an object" };
  if (value.version !== VERSION) return { ok: false, reason: `version ${String(value.version)} is not ${VERSION}` };
  if (value.term !== planningTerm.id) return { ok: false, reason: `it is for term ${String(value.term)}, not ${planningTerm.id}` };
  if (!isStringRecord(value.picks)) return { ok: false, reason: "picks is not a map of course codes to section ids" };
  const problem = prefsProblem(value.prefs);
  if (problem) return { ok: false, reason: problem };
  if (!isObject(value.colors) || !Object.values(value.colors).every(isHue)) return { ok: false, reason: "colors is not a map of course codes to hues 1 to 6" };

  const picks: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [code, id] of Object.entries(value.picks)) {
    if (courseByCode(code) && sectionsOf(code).some((section) => section.id === id)) picks[code] = id;
    else dropped.push(code);
  }
  const colors = new Map(Object.entries(value.colors as Record<string, Hue>));
  return {
    ok: true,
    plan: { picks, prefs: value.prefs as Preferences, colors: colorsFor(picks, colors) },
    dropped,
  };
}

export type Loaded = {
  plan: GuestPlan;
  /** What went wrong reading the saved plan, for the console; null when nothing did. */
  problem: string | null;
};

/** The saved plan, or the sample plan when nothing is saved or the saved one can't be read. */
export function loadPlan(storage: PlanStorage): Loaded {
  let text: string | null;
  try {
    text = storage.read();
  } catch (error) {
    return { plan: samplePlan(), problem: `Reading the saved plan failed (${error instanceof Error ? error.message : String(error)}); showing the sample plan.` };
  }
  if (text === null) return { plan: samplePlan(), problem: null };
  const decoded = decodePlan(text);
  if (!decoded.ok) return { plan: samplePlan(), problem: `The saved plan was not loaded because ${decoded.reason}; showing the sample plan.` };
  const problem = decoded.dropped.length
    ? `Left ${decoded.dropped.join(", ")} out of the saved plan: the saved section is no longer in the catalog.`
    : null;
  return { plan: decoded.plan, problem };
}

export function savePlan(storage: PlanStorage, plan: GuestPlan): void {
  storage.write(encodePlan(plan));
}
