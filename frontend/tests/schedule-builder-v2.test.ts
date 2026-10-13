/**
 * The Week view's rules that have one right answer: the PR #32 review
 * findings (Sol 1-10, Astra 7) and the campus walking provider. Each
 * describe names the finding it pins.
 */
import { plannerTravelTime } from "@/lib/planner-walking";
import { describe, expect, test } from "bun:test";
import {
  applyChoice,
  choicesFromWeights,
  maxCreditOptions,
  parseBlockDraft,
  timeToMinutes,
  uniqueBlockId,
} from "@/components/schedule/constraint-logic";
import {
  initialPreferences,
  preferencesKey,
  readOrCreateGuestId,
  readStoredPreferences,
  withGoalWeights,
  writeStoredPreferences,
} from "@/components/schedule/preferences-store";
import {
  canApply,
  differsInOneCourse,
  IDLE,
  isStale,
  locksKey,
  requestKey,
  resultStanding,
  runReducer,
  sectionsKey,
  undoAvailable,
  type RunState,
} from "@/components/schedule/run-state";
import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS } from "@/lib/optimizer/presets";
import type { OptimizeResult, RankedSchedule } from "@/lib/optimizer/types";
import { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState, parseSchedulePreferences } from "@/lib/planner";
import type { PlannerState, SchedulePreferences } from "@/lib/types";

const FIVE = ["ANTH 1010", "BIOL 1710", "ENGL 1310", "MATH 1710", "PSYC 1630"];

function planWith(courseCodes: string[], extra: Partial<PlannerState> = {}): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(courseCodes.map((code) => [code, "inProgress" as const])) },
    selectedSections: {},
    ...extra,
  };
}

/** In-memory Storage; `failWrites` makes setItem throw like a full or denied store. */
function memoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    failWrites: false,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.failWrites) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    map,
  };
  return storage;
}

const schedule = (byCourse: Record<string, string>): RankedSchedule => ({
  byCourse,
  cost: 0,
  proven: true,
  breakdown: { daysOnCampus: 0, gapMinutes: 0, walkSeconds: 0, unknownWalks: 0, earliestStart: null, latestEnd: null, credits: 0, averageRating: null },
});

const stats = { nodes: 1, elapsedMs: 1, candidates: {}, minDifferentCourses: 2 };
const feasible = (schedules: RankedSchedule[]): OptimizeResult => ({ status: "feasible", schedules, stats });
const optimal = (schedules: RankedSchedule[]): OptimizeResult => ({ status: "optimal", schedules, stats });

describe("Sol 7: a chip changes only its own weights", () => {
  const tuned = { fewerDays: 3, compact: 2, mornings: 1, evenings: 0, walking: 0, rating: 2 };

  test("Short walks leaves fine-tuned compactness, days, leans and rating alone", () => {
    expect(applyChoice(tuned, { walks: true })).toEqual({ ...tuned, walking: 4 });
    expect(applyChoice({ ...tuned, walking: 4 }, { walks: false })).toEqual(tuned);
  });

  test("each control owns exactly its terms", () => {
    expect(applyChoice(tuned, { profs: false })).toEqual({ ...tuned, rating: 0 });
    expect(applyChoice(tuned, { lean: "later" })).toEqual({ ...tuned, mornings: 0, evenings: 4 });
    expect(applyChoice(tuned, { lean: "any" })).toEqual({ ...tuned, mornings: 0, evenings: 0 });
    expect(applyChoice(tuned, { compact: true })).toEqual({ ...tuned, compact: 4, fewerDays: 2 });
    expect(applyChoice(tuned, { compact: false })).toEqual({ ...tuned, compact: 1, fewerDays: 0 });
  });

  test("turning a chip on then off from a preset returns to that preset", () => {
    const start = GOAL_WEIGHTS.maximizeProfessor;
    expect(applyChoice(applyChoice(start, { walks: true }), { walks: false })).toEqual(start);
    expect(choicesFromWeights(start)).toEqual({ lean: "any", compact: false, walks: false, profs: true });
  });
});

describe("Sol 8: a blocked time needs both times", () => {
  test("a cleared time is missing, never midnight", () => {
    expect(timeToMinutes("")).toBeNull();
    expect(parseBlockDraft({ label: "Work", day: "Tue", start: "", end: "17:00" }, "b")).toEqual({
      ok: false,
      field: "start",
      reason: "Enter when the blocked time starts.",
    });
    expect(parseBlockDraft({ label: "Work", day: "Tue", start: "13:00", end: "" }, "b")).toEqual({
      ok: false,
      field: "end",
      reason: "Enter when the blocked time ends.",
    });
  });

  test("valid drafts parse to minutes, with or without seconds", () => {
    expect(parseBlockDraft({ label: " Work ", day: "Tue", start: "13:00", end: "17:00:00" }, "b")).toEqual({
      ok: true,
      block: { id: "b", label: "Work", day: "Tue", start: 780, end: 1020 },
    });
  });

  test("an empty name or an end not after the start is refused", () => {
    expect(parseBlockDraft({ label: "  ", day: "Mon", start: "09:00", end: "10:00" }, "b").ok).toBe(false);
    expect(parseBlockDraft({ label: "Gym", day: "Mon", start: "10:00", end: "10:00" }, "b")).toEqual({
      ok: false,
      field: "end",
      reason: "The end must be after the start.",
    });
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9:00")).toBeNull();
  });

  test("two blocks added in the same millisecond get different ids", () => {
    const existing = [{ id: "block-x", label: "A", day: "Mon" as const, start: 60, end: 120 }];
    expect(uniqueBlockId(existing, "block-x")).toBe("block-x-2");
    expect(uniqueBlockId([...existing, { ...existing[0], id: "block-x-2" }], "block-x")).toBe("block-x-3");
    expect(uniqueBlockId(existing, "block-y")).toBe("block-y");
  });
});

describe("Sol 10: the max-credit selector lists the active value", () => {
  test("a relaxation to 24 credits shows 24", () => {
    const options = maxCreditOptions(24);
    expect(options).toContain(24);
    expect(options[options.length - 1]).toBe(24);
    expect(options.slice(0, 3)).toEqual([3, 4, 5]);
  });
  test("in-range and absent values do not add entries", () => {
    expect(maxCreditOptions(15)).toHaveLength(19);
    expect(maxCreditOptions(null)).toHaveLength(19);
    expect(maxCreditOptions(1)[0]).toBe(1);
  });
});

describe("Sol 4: duplicate blocked-time ids are rejected at parse", () => {
  const valid = defaultSchedulePreferences("compact");
  const block = { id: "b1", label: "Work", day: "Tue", start: 780, end: 1020 };
  test("one id twice makes the whole stored value invalid", () => {
    expect(parseSchedulePreferences({ ...valid, constraints: { ...valid.constraints, blocked: [block] } })).not.toBeNull();
    expect(parseSchedulePreferences({ ...valid, constraints: { ...valid.constraints, blocked: [block, { ...block, day: "Wed" }] } })).toBeNull();
  });
  test("so the optimizer, which throws on duplicates, never sees them", () => {
    const parsed = parseSchedulePreferences({ ...valid, constraints: { ...valid.constraints, blocked: [block, { ...block, id: "b2" }] } });
    expect(parsed).not.toBeNull();
    expect(() => optimize(buildOptimizeRequest(planWith(FIVE), parsed!))).not.toThrow();
  });
});

describe("Sol 2: preferences follow the plan's goal", () => {
  test("a plan saved with the nights goal and no stored preferences starts with the nights weights", () => {
    const prefs = initialPreferences({ kind: "absent" }, "clusterNight");
    expect(prefs.weights).toEqual(GOAL_WEIGHTS.clusterNight);
    expect(prefs.weights.mornings).toBe(0);
    expect(initialPreferences({ kind: "invalid" }, "compact").weights).toEqual(GOAL_WEIGHTS.compact);
  });
  test("stored preferences win over the goal", () => {
    const stored = defaultSchedulePreferences("maximizeProfessor");
    expect(initialPreferences({ kind: "ok", revision: 3, preferences: stored }, "clusterNight")).toBe(stored);
  });
  test("a restored goal sets its preset weights and keeps every constraint", () => {
    const base = defaultSchedulePreferences("clusterMorning");
    const constrained: SchedulePreferences = { ...base, constraints: { ...base.constraints, daysOff: ["Fri"], maxCredits: 12 } };
    const next = withGoalWeights(constrained, "clusterNight");
    expect(next.weights).toEqual(GOAL_WEIGHTS.clusterNight);
    expect(next.constraints).toBe(constrained.constraints);
    next.weights.evenings = 0;
    expect(GOAL_WEIGHTS.clusterNight.evenings).toBe(4);
  });
});

describe("Sol 9: browser-local preferences, per identity, never silently overwritten", () => {
  const a = defaultSchedulePreferences("compact");
  const key = preferencesKey({ kind: "user", id: "u1" });

  test("keys never collide across accounts or between an account and a guest", () => {
    const keys = [
      preferencesKey({ kind: "user", id: "u1" }),
      preferencesKey({ kind: "user", id: "u2" }),
      preferencesKey({ kind: "guest", id: "u1" }),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  test("a guest id is created once per browser and then reused", () => {
    const storage = memoryStorage();
    let made = 0;
    const make = () => `guest-${(made += 1)}-abcdef`;
    const first = readOrCreateGuestId(storage, make);
    expect(first).toBe("guest-1-abcdef");
    expect(readOrCreateGuestId(storage, make)).toBe(first);
    expect(made).toBe(1);
    const broken = { getItem: () => null, setItem: () => { throw new Error("denied"); } };
    expect(readOrCreateGuestId(broken, make)).toBeNull();
  });

  test("write then read round-trips with a revision", () => {
    const storage = memoryStorage();
    const out = writeStoredPreferences(storage, key, 0, a, (p) => ({ ...p, constraints: { ...p.constraints, maxCredits: 12 } }));
    expect(out.kind).toBe("stored");
    expect(out.revision).toBe(1);
    const read = readStoredPreferences(storage, key);
    expect(read).toEqual({ kind: "ok", revision: 1, preferences: out.preferences });
  });

  test("a write after another tab wrote applies on top of that tab's version", () => {
    const storage = memoryStorage();
    // Tab 1 reads at revision 1.
    const t1 = writeStoredPreferences(storage, key, 0, a, (p) => p);
    // Tab 2 adds a day off and writes revision 2.
    writeStoredPreferences(storage, key, t1.revision, t1.preferences, (p) => ({ ...p, constraints: { ...p.constraints, daysOff: ["Fri"] } }));
    // Tab 1, still at revision 1, sets max credits.
    const late = writeStoredPreferences(storage, key, t1.revision, t1.preferences, (p) => ({
      ...p,
      constraints: { ...p.constraints, maxCredits: 15 },
    }));
    expect(late.kind).toBe("rebased");
    expect(late.revision).toBe(3);
    expect(late.preferences.constraints.daysOff).toEqual(["Fri"]);
    expect(late.preferences.constraints.maxCredits).toBe(15);
    expect(readStoredPreferences(storage, key)).toEqual({ kind: "ok", revision: 3, preferences: late.preferences });
  });

  test("a failed write says not stored and keeps the change in memory", () => {
    const storage = memoryStorage();
    storage.failWrites = true;
    const out = writeStoredPreferences(storage, key, 0, a, (p) => ({ ...p, constraints: { ...p.constraints, maxCredits: 9 } }));
    expect(out.kind).toBe("not-stored");
    expect(out.revision).toBe(0);
    expect(out.preferences.constraints.maxCredits).toBe(9);
    expect(readStoredPreferences(storage, key)).toEqual({ kind: "absent" });
  });

  test("garbage, a bad revision or a broken store read as such, not as preferences", () => {
    const storage = memoryStorage();
    storage.map.set(key, "{not json");
    expect(readStoredPreferences(storage, key)).toEqual({ kind: "invalid" });
    storage.map.set(key, JSON.stringify({ revision: 0, preferences: a }));
    expect(readStoredPreferences(storage, key)).toEqual({ kind: "invalid" });
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} };
    expect(readStoredPreferences(throwing, key)).toEqual({ kind: "unavailable" });
  });
});

describe("Sol 1: a stale result cannot be applied", () => {
  const prefs = defaultSchedulePreferences("compact");
  const keyBefore = requestKey(buildOptimizeRequest(planWith(FIVE), prefs));
  const locked = { "ANTH 1010": "anth-1010-003" };
  const keyAfterLock = requestKey(buildOptimizeRequest(planWith(FIVE, { selectedSections: locked, lockedSections: locked }), prefs));
  const shown: RunState = runReducer(runReducer(IDLE, { type: "start", id: 1, inputKey: keyBefore }), {
    type: "reply",
    reply: { id: 1, phase: "first", result: optimal([schedule({ "ANTH 1010": "anth-1010-001" })]), settled: true },
  });

  test("locking a section after a run makes its result stale", () => {
    expect(keyAfterLock).not.toBe(keyBefore);
    expect(isStale(shown, keyBefore)).toBe(false);
    expect(isStale(shown, keyAfterLock)).toBe(true);
  });

  test("applying is refused when stale, and when an option would move a lock", () => {
    const option = shown.result!.schedules[0];
    expect(canApply(shown, keyBefore, option, {})).toEqual({ ok: true });
    expect(canApply(shown, keyAfterLock, option, locked).ok).toBe(false);
    // Even with a matching key, an option that moves a locked course is refused.
    const moved = canApply(shown, keyBefore, option, locked);
    expect(moved).toEqual({ ok: false, reason: "This option moves your locked ANTH 1010. Optimize again to keep it." });
    expect(canApply(shown, keyBefore, schedule({ "ANTH 1010": "anth-1010-003" }), locked)).toEqual({ ok: true });
  });

  test("the input key ignores lock order and changes with any preference", () => {
    const request = buildOptimizeRequest(planWith(FIVE), prefs);
    expect(requestKey({ ...request, locks: { A: "1", B: "2" } })).toBe(requestKey({ ...request, locks: { B: "2", A: "1" } }));
    expect(requestKey(buildOptimizeRequest(planWith(FIVE), { ...prefs, weights: { ...prefs.weights, walking: 1 } }))).not.toBe(keyBefore);
    expect(requestKey(buildOptimizeRequest(planWith(FIVE.slice(1)), prefs))).not.toBe(keyBefore);
  });
});

describe("Worker run state: phases, stale replies, failures", () => {
  const first = feasible([schedule({ A: "a1" })]);
  const final = optimal([schedule({ A: "a2" })]);

  test("the first answer shows while refining, then the final one replaces it", () => {
    let s = runReducer(IDLE, { type: "start", id: 7, inputKey: "k" });
    expect(s.status).toBe("running");
    s = runReducer(s, { type: "reply", reply: { id: 7, phase: "first", result: first, settled: false } });
    expect(s).toMatchObject({ status: "refining", result: first, resultKey: "k" });
    expect(resultStanding(s)).toBe("Best so far. Still searching for better ones.");
    s = runReducer(s, { type: "reply", reply: { id: 7, phase: "final", result: final, settled: true } });
    expect(s).toMatchObject({ status: "done", result: final });
  });

  test("replies to an older run, or after Close, are ignored", () => {
    let s = runReducer(IDLE, { type: "start", id: 1, inputKey: "old" });
    s = runReducer(s, { type: "start", id: 2, inputKey: "new" });
    const after = runReducer(s, { type: "reply", reply: { id: 1, phase: "first", result: first, settled: true } });
    expect(after).toBe(s);
    const closed = runReducer(s, { type: "close" });
    expect(runReducer(closed, { type: "reply", reply: { id: 2, phase: "final", result: final, settled: true } })).toBe(closed);
  });

  test("a failure ends the running state and keeps any answer already shown", () => {
    let s = runReducer(IDLE, { type: "start", id: 3, inputKey: "k" });
    s = runReducer(s, { type: "reply", reply: { id: 3, phase: "error", message: "boom" } });
    expect(s).toMatchObject({ status: "error", error: "boom", result: null });
    let t = runReducer(runReducer(IDLE, { type: "start", id: 4, inputKey: "k" }), {
      type: "reply",
      reply: { id: 4, phase: "first", result: first, settled: false },
    });
    t = runReducer(t, { type: "reply", reply: { id: 4, phase: "error", message: "late" } });
    expect(t).toMatchObject({ status: "error", result: first, error: "late" });
  });

  test("unproven results always say so: best so far, then best within the limit", () => {
    const done = { ...IDLE, status: "done" as const, result: first };
    expect(resultStanding(done)).toBe("Best found within the time limit; a better one may exist.");
    const timeout: OptimizeResult = { status: "timeout", schedules: [], stats };
    expect(resultStanding({ ...IDLE, status: "refining", result: timeout })).toBe("Nothing found yet. Still searching.");
    expect(resultStanding({ ...IDLE, status: "done", result: timeout })).toMatch(/^No schedule turned up within the time limit/);
  });
});

describe("Sol 3: Undo restores what the pick changed, and only while the plan is the same", () => {
  // Before the pick A was a1; option B moved it to a2.
  const after = sectionsKey({ A: "a2", C: "c1" });
  const snapshot = { sections: { A: "a1", C: "c1" }, goal: "clusterNight" as const, letter: "B", epoch: 4, locks: locksKey({}), after };
  test("available until the plan is replaced or a lock changes", () => {
    expect(undoAvailable(snapshot, 4, locksKey({}), after)).toBe(true);
    expect(undoAvailable(snapshot, 5, locksKey({}), after)).toBe(false);
    expect(undoAvailable(snapshot, 4, locksKey({ A: "a2" }), after)).toBe(false);
    expect(undoAvailable(null, 4, locksKey({}), after)).toBe(false);
  });
  // https://github.com/SamGu-NRX/UNTangle/pull/32#discussion_r4263013467
  test("a hand pick after the option withdraws Undo, so restoring cannot drop it", () => {
    expect(undoAvailable(snapshot, 4, locksKey({}), sectionsKey({ A: "a2", C: "c2" }))).toBe(false);
  });
  test("key order of the section map does not matter", () => {
    expect(undoAvailable(snapshot, 4, locksKey({}), sectionsKey({ C: "c1", A: "a2" }))).toBe(true);
  });
});

describe("Astra 7: the one-course fallback is disclosed", () => {
  test("with every course but one locked, alternatives may differ in one course and the page says so", () => {
    const base = planWith(FIVE);
    const first = optimize(buildOptimizeRequest(base, defaultSchedulePreferences("compact")));
    expect(first.schedules.length).toBeGreaterThan(0);
    const picks = first.schedules[0].byCourse;
    const lockedPlan = planWith(FIVE, {
      selectedSections: picks,
      lockedSections: Object.fromEntries(FIVE.filter((code) => code !== "MATH 1710").map((code) => [code, picks[code]])),
    });
    const result = optimize(buildOptimizeRequest(lockedPlan, defaultSchedulePreferences("compact")));
    expect(result.stats.minDifferentCourses).toBe(1);
    expect(result.schedules.length).toBeGreaterThanOrEqual(2);
    expect(differsInOneCourse(result, FIVE.length)).toBe(true);
    expect(differsInOneCourse(result, 1)).toBe(false);
    expect(differsInOneCourse(first, FIVE.length)).toBe(false);
  });
});

describe("Walking: the optimizer request uses the campus walkway matrix", () => {
  test("the walkway matrix (plus the Discovery Park shuttle) is the default provider, fractional seconds included", () => {
    const request = buildOptimizeRequest(planWith(FIVE), defaultSchedulePreferences("minimizeDistance"));
    expect(request.walkingTime).toBe(plannerTravelTime);
    expect(request.walkingTime("gab", "blb")).toEqual(getWalkingSeconds("gab", "blb"));
    const leg = getWalkingSeconds("gab", "blb");
    expect(leg.source).toBe("campus-network");
    const fractional = ["life", "aud", "gab", "chem", "blb", "lang", "wh"]
      .flatMap((a) => ["art", "musi", "env", "matt"].map((b) => getWalkingSeconds(a, b)))
      .some((l) => l.seconds !== null && !Number.isInteger(l.seconds));
    expect(fractional).toBe(true);
    const result = optimize(request);
    expect(result.status).toBe("optimal");
    for (const s of result.schedules) expect(Number.isInteger(s.breakdown.walkSeconds)).toBe(true);
  });

  test("an off-campus building has no walking time, never zero", () => {
    expect(getWalkingSeconds("ntdp", "gab")).toEqual({ seconds: null, source: "unknown" });
  });
});
