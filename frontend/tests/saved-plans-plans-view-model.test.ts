import { describe, expect, it } from "bun:test";
import {
  assessRestoreDrift,
  comparePlan,
  exportFileName,
  statusLabel,
} from "@/components/saved-plans/plans-view-model";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import { defaultPlannerState } from "@/lib/seed-data";
import { normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";
import validFixture from "./fixtures/plan-library/saved-plan-valid.json";

const capturedAt = "2026-10-10T12:00:00.000Z";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...normalizePlannerState(defaultPlannerState),
  ...overrides,
});

const snapshotOf = (state: PlannerState, name = "Fall plan") =>
  buildSavedPlanSnapshot({
    state,
    name,
    source: { kind: "workingState", detail: "" },
    now: new Date(capturedAt),
  });

describe("plans view model", () => {
  it("reports no drift when the working schedule still matches the saved capture", () => {
    const state = stateWith({});
    const plan = snapshotOf(state);
    const drift = assessRestoreDrift(plan, state);
    expect(drift.drifted).toBe(false);
    expect(drift.message).toBeNull();
  });

  it("flags drift when the working schedule changed after the save, ignoring timestamps", () => {
    const saved = stateWith({ optimization: "compact" });
    const plan = snapshotOf(saved);
    const drifted = assessRestoreDrift(plan, stateWith({ optimization: "clusterNight" }));
    expect(drifted.drifted).toBe(true);
    expect(drifted.message).toContain("changed since this plan was saved");

    // A pure timestamp touch is not drift.
    const touched = { ...saved, updatedAt: "2020-01-01T00:00:00.000Z" };
    expect(assessRestoreDrift(plan, touched).drifted).toBe(false);
  });

  it("compares a saved plan against the working schedule with field-level accounting", () => {
    const plan = snapshotOf(validFixture.state as unknown as PlannerState);
    // The working schedule moved on: different section for ANTH 1010 and a
    // different optimization preference.
    const working = stateWith({
      selectedSections: { "ANTH 1010": "anth-1010-002" },
      optimization: "clusterNight",
    });
    const diff = comparePlan(plan, working);
    expect(diff.comparedFieldCount).toBeGreaterThan(0);
    expect(diff.sectionChanges.length + diff.statusChanges.length).toBeGreaterThan(0);
    expect(diff.optimizationChanged).toBe(true);
    expect(diff.preservedFieldCount + diff.changedFieldCount).toBe(diff.comparedFieldCount);
  });

  it("builds download filenames from the plan name and save date", () => {
    const plan = snapshotOf(stateWith({}), "Fall 2026 Finals!");
    expect(exportFileName(plan)).toBe("untangle-fall-2026-finals-2026-10-10.json");

    const symbolOnly = snapshotOf(stateWith({}), "!!!");
    expect(exportFileName(symbolOnly)).toBe("untangle-plan-2026-10-10.json");
  });

  it("labels statuses for people", () => {
    expect(statusLabel("inProgress")).toBe("in progress");
    expect(statusLabel("completed")).toBe("completed");
    expect(statusLabel("notTaken")).toBe("not taken");
    expect(statusLabel("somethingElse")).toBe("not taken");
  });
});
