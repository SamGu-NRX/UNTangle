/**
 * The Preferences popover's model (r3 mockup, preferences.html): hard limits
 * painted on a small week, and leanings that each set one optimizer weight.
 * Everything here reads and writes `SchedulePreferences`, the same object
 * Auto's optimizer receives, so the popover cannot promise something Auto
 * doesn't do.
 */
import type { BlockedTime, PreferenceWeights, SchedulePreferences, WeekDay } from "@/lib/types";
import { isLunch, WEEKDAYS } from "./preferences";
import { andList, clockWithSuffix, shortDate } from "./week";

export { shortDate };

/** The painted grid's hours: 8 AM to 10 PM in half hours, as the mockup draws them. */
export const GRID_START = 480;
export const GRID_END = 1320;
export const STEP = 30;

let busyIds = 0;
/** A fresh id for a busy time. */
export const newBusyId = () => `busy-${Date.now().toString(36)}-${(busyIds += 1)}`;

/** The label a painted block gets until the student names it. */
export const UNNAMED = "Busy";

/* ───────── Painting busy times ───────── */

/**
 * A busy time that holds every week. One made from a calendar event holds
 * on its dates only; the painted grid draws a typical week, so it neither
 * shows nor paints those, and the ledger lists them by date.
 */
export const isWeekly = (b: BlockedTime) => !b.dates || b.dates.length === 0;


/** The busy minutes on `day`, merged, sorted, as [start, end) runs. */
function runsOn(blocked: readonly BlockedTime[], day: WeekDay): Array<{ start: number; end: number; label: string }> {
  return blocked
    .filter((b) => b.day === day && isWeekly(b))
    .map((b) => ({ start: b.start, end: b.end, label: b.label }))
    .sort((a, b) => a.start - b.start);
}

/** True when the half hour starting at `start` on `day` is busy. */
export function isBusy(p: SchedulePreferences, day: WeekDay, start: number): boolean {
  return p.constraints.blocked.some((b) => isWeekly(b) && b.day === day && b.start < start + STEP && b.end > start);
}

/**
 * Paints a rectangle of the week: every day in `days`, from `start` to `end`.
 * `busy` adds the time, joining the unnamed busy time it touches and the
 * blocks of one name, which keep that name. It never joins Lunch, which the
 * Lunch switch adds and removes whole, or a second name. `free` removes the
 * time, splitting a block it cuts through.
 */
export function paint(p: SchedulePreferences, days: readonly WeekDay[], start: number, end: number, mode: "busy" | "free", newId: () => string): SchedulePreferences {
  if (end <= start || days.length === 0) return p;
  const dated = p.constraints.blocked.filter((b) => !isWeekly(b));
  let blocked = p.constraints.blocked.filter(isWeekly);
  for (const day of days) {
    const others = blocked.filter((b) => b.day !== day);
    const today = blocked.filter((b) => b.day === day);
    if (mode === "busy") {
      const joinable = today.filter((b) => b.start <= end && b.end >= start && !isLunch(b));
      const label = joinable.find((b) => b.label !== UNNAMED)?.label ?? UNNAMED;
      const touching = joinable.filter((b) => b.label === UNNAMED || b.label === label);
      const keep = today.filter((b) => !touching.includes(b));
      const merged: BlockedTime = {
        id: touching[0]?.id ?? newId(),
        label,
        day,
        start: Math.min(start, ...touching.map((b) => b.start)),
        end: Math.max(end, ...touching.map((b) => b.end)),
      };
      blocked = [...others, ...keep, merged];
    } else {
      const next: BlockedTime[] = [];
      for (const b of today) {
        if (b.end <= start || b.start >= end) next.push(b);
        else {
          if (b.start < start) next.push({ ...b, end: start });
          if (b.end > end) next.push({ ...b, id: b.start < start ? newId() : b.id, start: end });
        }
      }
      blocked = [...others, ...next];
    }
  }
  return { ...p, constraints: { ...p.constraints, blocked: [...blocked, ...dated] } };
}

/* ───────── The ledger under the grid: one fact per row ───────── */

export type LedgerRow =
  | { kind: "start"; title: string }
  | { kind: "end"; title: string }
  | { kind: "off"; title: string }
  /** `dated`: made from one calendar event, so it holds on its date only. */
  | { kind: "busy"; title: string; detail: string; label: string; ids: string[]; unnamed: boolean; dated?: boolean };

const PLURAL: Record<WeekDay, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays" };

/** "3–5 PM", or "11 AM–1 PM" across noon. */
export function hourSpan(start: number, end: number): string {
  const bare = (m: number) => {
    const h = Math.floor(m / 60) % 12 || 12;
    return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : String(h);
  };
  return (start >= 720) === (end >= 720) ? `${bare(start)}–${clockWithSuffix(end)}` : `${clockWithSuffix(start)}–${clockWithSuffix(end)}`;
}

/** Busy time grouped by name and hours across its days, in the order the week reads. */
export function ledger(p: SchedulePreferences): LedgerRow[] {
  const c = p.constraints;
  const rows: LedgerRow[] = [];
  if (c.earliestStart !== null && c.earliestStart > GRID_START) rows.push({ kind: "start", title: `No class before ${clockWithSuffix(c.earliestStart)}` });
  if (c.latestEnd !== null && c.latestEnd < GRID_END) rows.push({ kind: "end", title: `Done by ${clockWithSuffix(c.latestEnd)}` });
  const off = WEEKDAYS.filter((d) => c.daysOff.includes(d));
  if (off.length > 0) rows.push({ kind: "off", title: `${andList(off.map((d) => PLURAL[d]))} off` });
  const groups = new Map<string, { label: string; start: number; end: number; days: WeekDay[]; ids: string[] }>();
  for (const day of WEEKDAYS) {
    for (const run of runsOn(c.blocked, day)) {
      const key = `${run.label}|${run.start}|${run.end}`;
      const g = groups.get(key) ?? { label: run.label, start: run.start, end: run.end, days: [], ids: [] };
      g.days.push(day);
      groups.set(key, g);
    }
  }
  for (const b of c.blocked.filter(isWeekly)) groups.get(`${b.label}|${b.start}|${b.end}`)?.ids.push(b.id);
  const sorted = [...groups.values()].sort((a, b) => a.start - b.start || WEEKDAYS.indexOf(a.days[0]) - WEEKDAYS.indexOf(b.days[0]));
  for (const g of sorted) {
    const days = g.days.length === 5 ? "Every weekday" : andList(g.days);
    rows.push({ kind: "busy", title: g.label, detail: `${days}, ${hourSpan(g.start, g.end)}`, label: g.label, ids: g.ids, unnamed: g.label === UNNAMED });
  }
  // A busy time made from one calendar event: its own row, said by date.
  const dated = c.blocked.filter((b) => !isWeekly(b)).sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || a.start - b.start);
  for (const b of dated) {
    const dates = b.dates ?? [];
    const when = dates.length === 1 && dates[0].start === dates[0].end ? shortDate(dates[0].start) : `From ${shortDate(dates[0].start)}`;
    rows.push({ kind: "busy", title: b.label, detail: `${when}, ${hourSpan(b.start, b.end)}`, label: b.label, ids: [b.id], unnamed: b.label === UNNAMED, dated: true });
  }
  return rows;
}

const firstDate = (b: BlockedTime) => b.dates?.[0]?.start ?? "";

export function renameBusy(p: SchedulePreferences, ids: readonly string[], label: string): SchedulePreferences {
  const name = label.trim() || UNNAMED;
  return { ...p, constraints: { ...p.constraints, blocked: p.constraints.blocked.map((b) => (ids.includes(b.id) ? { ...b, label: name } : b)) } };
}

export function toggleDayOff(p: SchedulePreferences, day: WeekDay): SchedulePreferences {
  const off = p.constraints.daysOff.includes(day);
  const daysOff = off ? p.constraints.daysOff.filter((d) => d !== day) : WEEKDAYS.filter((d) => d === day || p.constraints.daysOff.includes(d));
  return { ...p, constraints: { ...p.constraints, daysOff } };
}

/**
 * Class hours from the sun and moon knobs. The grid's edges mean "no limit",
 * so a knob dragged back to the edge clears the constraint instead of
 * storing 8 AM or 10 PM. The two never cross: at least an hour stays open.
 */
export function withHours(p: SchedulePreferences, edge: "start" | "end", minutes: number): SchedulePreferences {
  const c = p.constraints;
  const snapped = Math.round(minutes / STEP) * STEP;
  if (edge === "start") {
    const ceiling = (c.latestEnd ?? GRID_END) - 60;
    const v = Math.max(GRID_START, Math.min(ceiling, snapped));
    return { ...p, constraints: { ...c, earliestStart: v <= GRID_START ? null : v } };
  }
  const floor = (c.earliestStart ?? GRID_START) + 60;
  const v = Math.min(GRID_END, Math.max(floor, snapped));
  return { ...p, constraints: { ...c, latestEnd: v >= GRID_END ? null : v } };
}

/* ───────── Leanings: one picture card per weight ───────── */

export type LeanKey = "time" | "fewerDays" | "compact" | "walking" | "rating";
export const LEAN_ORDER: readonly LeanKey[] = ["time", "fewerDays", "compact", "walking", "rating"];

const LEVEL = ["Doesn't matter", "A little", "Some", "A lot", "Most"] as const;

export type Lean = {
  title: string;
  min: number;
  max: number;
  /** The track's two ends. */
  ends: [string, string];
  /** The card's value, one per step from min. */
  values: readonly string[];
  /** What Auto does at each step, said under the slider. */
  says: readonly string[];
};

export const LEANS: Record<LeanKey, Lean> = {
  time: {
    title: "Time of day",
    min: -2,
    max: 2,
    ends: ["Earlier", "Later"],
    values: ["As early as it can", "Earlier", "Any time", "Later", "As late as it can"],
    says: [
      "Puts classes as early in the day as it can.",
      "Leans toward morning sections.",
      "No preference. Classes go wherever they fit.",
      "Leans toward afternoon sections.",
      "Puts classes as late in the day as it can.",
    ],
  },
  fewerDays: {
    title: "Fewer days on campus",
    min: 0,
    max: 4,
    ends: ["Doesn't matter", "Matters most"],
    values: LEVEL,
    says: ["Uses whichever days fit best.", "Breaks ties toward fewer days.", "Favors fewer days on campus.", "Strongly favors fewer days on campus.", "Fits classes into as few days as it can."],
  },
  compact: {
    // The words of Set up Auto's slider for this lean (SetupAuto.tsx, ShapePane), so its summary names what the student set.
    title: "Time between classes",
    min: 0,
    max: 4,
    ends: ["Doesn't matter", "Back-to-back"],
    values: LEVEL,
    says: ["Doesn't mind long gaps between classes.", "Breaks ties toward shorter gaps.", "Favors shorter gaps between classes.", "Strongly favors short gaps.", "Packs classes back-to-back wherever it can."],
  },
  walking: {
    title: "Short walks",
    min: 0,
    max: 4,
    ends: ["Doesn't matter", "Matters most"],
    values: LEVEL,
    says: ["Doesn't weigh walking distance.", "Breaks ties toward shorter walks.", "Favors nearby buildings.", "Strongly favors nearby buildings.", "Counts short walks above everything else it leans on."],
  },
  rating: {
    title: "Well-rated instructors",
    min: 0,
    max: 4,
    ends: ["Doesn't matter", "Matters most"],
    values: LEVEL,
    says: [
      "Doesn't look at instructor ratings.",
      "Breaks ties toward better-rated instructors.",
      "Favors instructors students rate highly.",
      "Strongly favors highly rated instructors.",
      "Counts instructor ratings above everything else it leans on.",
    ],
  },
};

const clampWeight = (v: number) => Math.max(0, Math.min(4, Math.round(v)));

/**
 * Time of day is one control over two weights, as the planner's goal presets
 * set them: leaning earlier sets `mornings` and zeroes `evenings`. One step
 * is weight 2, two steps is 4. Both weights set at once (an older saved
 * preference) reads as whichever is stronger, and as "Any time" on a tie.
 */
export function leanOf(w: PreferenceWeights, key: LeanKey): number {
  if (key !== "time") return clampWeight(w[key]);
  const step = (x: number) => (x >= 3 ? 2 : x >= 1 ? 1 : 0);
  const m = clampWeight(w.mornings);
  const e = clampWeight(w.evenings);
  if (m === e) return 0;
  return m > e ? -step(m) : step(e);
}

export function withLean(p: SchedulePreferences, key: LeanKey, value: number): SchedulePreferences {
  const v = Math.round(value);
  if (key === "time") {
    const t = Math.max(-2, Math.min(2, v));
    const weight = [0, 2, 4][Math.abs(t)];
    return { ...p, weights: { ...p.weights, mornings: t < 0 ? weight : 0, evenings: t > 0 ? weight : 0 } };
  }
  return { ...p, weights: { ...p.weights, [key]: clampWeight(v) } };
}

/** The card's one-word value for a lean. */
export const leanValue = (key: LeanKey, value: number) => LEANS[key].values[Math.round(value) - LEANS[key].min];
export const leanSays = (key: LeanKey, value: number) => LEANS[key].says[Math.round(value) - LEANS[key].min];

/* ───────── More settings ───────── */

/** Spare minutes after each walk: the planner's four options (null turns the check off). */
export const WALK_BUFFERS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: 0, label: "Fit the break" },
  { value: 5, label: "+5 min" },
  { value: 10, label: "+10 min" },
  { value: null, label: "Don't check" },
];

export function walkSays(buffer: number | null): string {
  if (buffer === null) return "Auto doesn't check walks. A week may leave no time to get there.";
  if (buffer === 0) return "Every walk fits in the break between classes.";
  return `Every walk fits in the break with ${buffer} minutes to spare.`;
}

/** How many of More settings differ from the defaults, for its "2 changed" note. */
export function moreChanged(p: SchedulePreferences, defaults: SchedulePreferences): number {
  const c = p.constraints;
  const d = defaults.constraints;
  return [c.walkingBufferMinutes !== d.walkingBufferMinutes, c.openSeatsOnly !== d.openSeatsOnly, c.otherSites !== d.otherSites].filter(Boolean).length;
}

/** Credit limit steps, 3 to 21 or no limit, as the planner's selector allows. */
export const CREDIT_MIN = 3;
export const CREDIT_MAX = 21;
export function stepCredits(current: number | null, by: 1 | -1): number | null {
  if (current === null) return by < 0 ? CREDIT_MAX : null;
  const next = current + by;
  if (next > CREDIT_MAX) return null;
  return Math.max(CREDIT_MIN, next);
}

/**
 * How many choices differ from the defaults, shown as the count on the
 * Preferences button. Busy times count once each group, and each connected
 * calendar once.
 */
export function changedCount(p: SchedulePreferences, defaults: SchedulePreferences): number {
  const c = p.constraints;
  const d = defaults.constraints;
  let n = ledger(p).length - ledger(defaults).length;
  if (c.maxCredits !== d.maxCredits) n += 1;
  if (c.excludedSections.length > 0) n += 1;
  n += moreChanged(p, defaults);
  n += LEAN_ORDER.filter((k) => leanOf(p.weights, k) !== leanOf(defaults.weights, k)).length;
  n += p.calendars?.length ?? 0;
  return Math.max(0, n);
}

export type { BlockedTime };
export const dayList = (days: readonly WeekDay[]) => (days.length === 5 ? "Every weekday" : andList(days));
