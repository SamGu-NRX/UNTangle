/**
 * Provider-level regressions from the Sol re-review of PR #32 (1fe70ec).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "./planner/test-dom";
import { GOAL_WEIGHTS } from "@/lib/optimizer/presets";

const mounted: Array<() => Promise<void>> = [];

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
});

describe("applySchedule and Auto-fill Undo", () => {
  test("an option that moves only ANTH 1010 keeps Undo for an Auto-planned MATH 1720 whose section normalization filled in", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    // Auto plans MATH 1720; its section exists only after normalization (raw selections lack it).
    await planner.run((p) =>
      p.updateCoursePlan(({ courseStatuses, coursePlan }) => ({
        courseStatuses: { ...courseStatuses, "MATH 1720": "inProgress", "ANTH 1010": "inProgress" },
        coursePlan: {
          ...coursePlan,
          autoPlanned: ["MATH 1720"],
          lastAuto: {
            id: "auto-1",
            at: new Date().toISOString(),
            major: null,
            changes: [{ code: "MATH 1720", from: "notTaken", to: "inProgress" }],
            autoPlannedBefore: [],
            summary: "Planned MATH 1720.",
            needsCheck: [],
          },
        },
      })),
    );
    await waitFor(() => Boolean(planner.get().plannerState.selectedSections["MATH 1720"]), "MATH 1720 shown with a section");
    const shown = planner.get().plannerState.selectedSections;
    const otherAnth = ["anth-1010-001", "anth-1010-002"].find((id) => id !== shown["ANTH 1010"])!;

    // An optimizer option lists every course; only ANTH 1010 differs from what the page shows.
    await planner.run((p) => p.applySchedule({ "MATH 1720": shown["MATH 1720"], "ANTH 1010": otherAnth }));
    await waitFor(() => planner.get().plannerState.selectedSections["ANTH 1010"] === otherAnth, "option applied");

    expect(planner.get().plannerState.coursePlan?.lastAuto?.invalidatedBy).toBeUndefined();
  });
});

describe("goal weights follow restores", () => {
  test("resetting the plan (the first step of every restore) brings back the default goal's weights", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    await planner.run((p) => p.setOptimization("clusterNight"));
    await waitFor(() => planner.get().schedulePreferences.weights.evenings === GOAL_WEIGHTS.clusterNight.evenings, "night weights");

    // Restoring a clusterMorning plan: reset, and no setOptimization because it is the default goal.
    await planner.run((p) => p.resetPlanner());
    await waitFor(() => planner.get().plannerState.optimization === "clusterMorning", "default goal");
    const weights = planner.get().schedulePreferences.weights;
    expect(weights.mornings).toBe(GOAL_WEIGHTS.clusterMorning.mornings);
    expect(weights.evenings).toBe(GOAL_WEIGHTS.clusterMorning.evenings);
  });
});
