/**
 * "Use in Main" and its Undo through the real PlannerProvider: Undo puts back
 * the plan and the student's own Week weights, and refuses once Main changed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeDocumentServer, installDom, mountPlanner, removeDom, setSession, waitFor } from "./planner/test-dom";

let server: FakeDocumentServer;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

async function guestPlanner() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

describe("Use in Main, then Undo", () => {
  beforeAll(() => installDom());
  afterAll(() => removeDom());
  beforeEach(() => {
    window.localStorage.clear();
    server = new FakeDocumentServer();
    previousFetch = globalThis.fetch;
    globalThis.fetch = server.fetch as typeof fetch;
    setSession(null);
  });
  afterEach(async () => {
    while (mounted.length) await mounted.pop()!();
    globalThis.fetch = previousFetch;
  });

  async function setUp() {
    const { buildSavedPlanSnapshot } = await import("@/lib/plan-library/snapshot");
    const planner = await guestPlanner();
    // The copy: a night-focused plan with one course.
    await planner.run((p) => p.setOptimization("clusterNight"));
    await planner.run((p) => p.setCourseStatus("ANTH 1010", "inProgress"));
    const copy = buildSavedPlanSnapshot({ state: planner.get().plannerState, name: "Nights", source: { kind: "workingState", detail: "test" } });
    // Main: back to the defaults, with weights the student tuned by hand.
    await planner.run((p) => p.resetPlanner());
    await planner.run((p) => p.setCourseStatus("BIOL 1112", "inProgress"));
    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, weights: { ...current.weights, walking: 9, mornings: 1 } })));
    return { planner, copy };
  }

  test("Undo puts Main and the student's own weights back", async () => {
    const { adoptCopy, noteLanded, undoAdoption } = await import("@/components/schedules-library/adopt");
    const { workingStateFingerprint } = await import("@/lib/saved-plans/restore-adapter");
    const { planner, copy } = await setUp();
    const mainBefore = workingStateFingerprint(planner.get().plannerState);
    const tuned = planner.get().schedulePreferences.weights;

    let adoption: ReturnType<typeof adoptCopy> | null = null;
    await planner.run((p) => (adoption = adoptCopy(p, copy)));
    noteLanded(adoption!, planner.get());
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(planner.get().schedulePreferences.weights).not.toEqual(tuned);

    let undone = false;
    await planner.run((p) => (undone = undoAdoption(p, adoption!)));
    expect(undone).toBe(true);
    expect(workingStateFingerprint(planner.get().plannerState)).toBe(mainBefore);
    expect(planner.get().schedulePreferences.weights).toEqual(tuned);
  });

  test("Undo is refused once Main has changed since, and keeps that change", async () => {
    const { adoptCopy, noteLanded, undoAdoption } = await import("@/components/schedules-library/adopt");
    const { planner, copy } = await setUp();
    let adoption: ReturnType<typeof adoptCopy> | null = null;
    await planner.run((p) => (adoption = adoptCopy(p, copy)));
    noteLanded(adoption!, planner.get());
    await planner.run((p) => p.setCourseStatus("CHEM 1410", "inProgress"));

    let undone = true;
    await planner.run((p) => (undone = undoAdoption(p, adoption!)));
    expect(undone).toBe(false);
    expect(planner.get().plannerState.courseStatuses["CHEM 1410"]).toBe("inProgress");
  });

  test("Undo is refused before the restore has been seen to land", async () => {
    const { adoptCopy, undoAdoption } = await import("@/components/schedules-library/adopt");
    const { planner, copy } = await setUp();
    let adoption: ReturnType<typeof adoptCopy> | null = null;
    await planner.run((p) => (adoption = adoptCopy(p, copy)));
    let undone = true;
    await planner.run((p) => (undone = undoAdoption(p, adoption!)));
    expect(undone).toBe(false);
  });
});

describe("Use these preferences, then Undo", () => {
  beforeAll(() => installDom());
  afterAll(() => removeDom());
  beforeEach(() => {
    window.localStorage.clear();
    server = new FakeDocumentServer();
    previousFetch = globalThis.fetch;
    globalThis.fetch = server.fetch as typeof fetch;
    setSession(null);
  });
  afterEach(async () => {
    while (mounted.length) await mounted.pop()!();
    globalThis.fetch = previousFetch;
  });

  async function setUp() {
    const { buildSavedPlanSnapshot } = await import("@/lib/plan-library/snapshot");
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const planner = await guestPlanner();
    await planner.run((p) => p.setCourseStatus("BIOL 1112", "inProgress"));
    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, weights: { ...current.weights, walking: 4, mornings: 1 } })));
    const nights = defaultSchedulePreferences("clusterNight");
    // The copy's preferences: nights, Fridays off, and weights of their own.
    const copy = buildSavedPlanSnapshot({
      state: planner.get().plannerState,
      name: "From this browser, Oct 22",
      source: { kind: "workingState", detail: "test" },
      preferences: { goal: "clusterNight", constraints: { ...nights.constraints, daysOff: ["Fri"] }, weights: { ...nights.weights, rating: 0 } },
    });
    return { planner, copy };
  }

  test("replaces the goal and preferences, leaves the plan, and Undo puts the student's own back", async () => {
    const { applyCopyPreferences, undoCopyPreferences } = await import("@/components/schedules-library/adopt");
    const { planner, copy } = await setUp();
    const before = { goal: planner.get().plannerState.optimization, ...planner.get().schedulePreferences };
    const plan = planner.get().plannerState.courseStatuses;

    let used: ReturnType<typeof applyCopyPreferences> | null = null;
    await planner.run((p) => (used = applyCopyPreferences(p, copy.preferences!)));
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(planner.get().schedulePreferences.constraints.daysOff).toEqual(["Fri"]);
    expect(planner.get().schedulePreferences.weights).toEqual(copy.preferences!.weights);
    expect(planner.get().plannerState.courseStatuses).toEqual(plan);

    let undone = false;
    await planner.run((p) => (undone = undoCopyPreferences(p, used!)));
    expect(undone).toBe(true);
    expect({ goal: planner.get().plannerState.optimization, ...planner.get().schedulePreferences }).toEqual(before);
  });

  test("Undo is refused once the preferences changed since, and keeps that change", async () => {
    const { applyCopyPreferences, undoCopyPreferences } = await import("@/components/schedules-library/adopt");
    const { planner, copy } = await setUp();
    let used: ReturnType<typeof applyCopyPreferences> | null = null;
    await planner.run((p) => (used = applyCopyPreferences(p, copy.preferences!)));
    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, maxCredits: 12 } })));

    let undone = true;
    await planner.run((p) => (undone = undoCopyPreferences(p, used!)));
    expect(undone).toBe(false);
    expect(planner.get().schedulePreferences.constraints.maxCredits).toBe(12);
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
  });
});

describe("the Use in Main announcement", () => {
  test("is said once stored, waits while saving, and is dropped when the save fails or conflicts", async () => {
    const { announcementStep } = await import("@/components/schedules-library/adopt");
    expect(announcementStep("saved")).toBe("announce");
    expect(announcementStep("waiting")).toBe("wait");
    expect(announcementStep("unsaved")).toBe("drop");
    expect(announcementStep("conflict")).toBe("drop");
  });
});
