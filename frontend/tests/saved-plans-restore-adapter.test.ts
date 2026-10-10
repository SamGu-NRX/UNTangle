import { describe, expect, it } from "bun:test";
import {
  describeRestoreSteps,
  dispatchRestore,
  simulateRestoredState,
  workingStateFingerprint,
} from "@/lib/saved-plans/restore-adapter";
import type { RestorePlannerApi } from "@/lib/saved-plans/restore-adapter";
import { buildSavedPlanSnapshot, resolveSectionReferences } from "@/lib/plan-library/snapshot";
import { normalizePlannerState } from "@/lib/planner";
import { defaultPlannerState } from "@/lib/seed-data";
import type {
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  TranscriptCourseRecord,
  WeekDay,
} from "@/lib/types";
import validFixture from "./fixtures/plan-library/saved-plan-valid.json";
import missingSectionFixture from "./fixtures/plan-library/saved-plan-missing-section.json";

const capturedAt = "2026-10-10T12:00:00.000Z";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: {
    ...defaultPlannerState.courseStatuses,
    "ANTH 1010": "inProgress",
    "ANTH 1150": "completed",
  },
  selectedSections: { "ANTH 1010": "anth-1010-001" },
  transcriptRecords: [],
  updatedAt: capturedAt,
  ...overrides,
});

const snapshotFrom = (rawState: unknown, name: string) =>
  buildSavedPlanSnapshot({
    state: rawState as PlannerState,
    name,
    source: { kind: "workingState", detail: "" },
    now: new Date(capturedAt),
  });

// M1's resolver takes the planner state; tests name it from the snapshot.
const resolveSavedPlanReferences = (snapshot: ReturnType<typeof buildSavedPlanSnapshot>) =>
  resolveSectionReferences(snapshot.state);

class RecorderPlanner {
  calls: Array<{ action: string; args: unknown[] }> = [];
  plannerState: PlannerState = normalizePlannerState(defaultPlannerState);

  private record(action: string, args: unknown[]) {
    this.calls.push({ action, args });
  }

  resetPlanner() {
    this.record("resetPlanner", []);
  }
  setSelectedMajor(id: MajorId | null) {
    this.record("setSelectedMajor", [id]);
  }
  setOptimization(optimization: OptimizationKey) {
    this.record("setOptimization", [optimization]);
  }
  setActiveDay(day: WeekDay) {
    this.record("setActiveDay", [day]);
  }
  applyTranscriptRecords(records: TranscriptCourseRecord[]) {
    this.record("applyTranscriptRecords", [records]);
  }
  setCourseStatus(courseCode: string, status: CourseStatus) {
    this.record("setCourseStatus", [courseCode, status]);
  }
  setSection(courseCode: string, sectionId: string) {
    this.record("setSection", [courseCode, sectionId]);
  }
  actionNames(): string[] {
    return this.calls.map((call) => call.action);
  }
}

describe("restore adapter", () => {
  it("dispatches only the public actions the plan needs, in the documented order", () => {
    const snapshot = snapshotFrom(validFixture.state, "Order test");
    const references = resolveSavedPlanReferences(snapshot);

    const planner = new RecorderPlanner();
    const outcome = dispatchRestore(planner as unknown as RestorePlannerApi, snapshot, references);

    // The fixture's preferences equal the planner defaults, so no preference
    // actions are dispatched. The transcript record already restores
    // ANTH 1150 to completed during apply, so the status diff dispatches
    // only the remaining inProgress status; one selection survives.
    expect(planner.actionNames()).toEqual([
      "resetPlanner",
      "applyTranscriptRecords",
      "setCourseStatus",
      "setSection",
    ]);
    expect(planner.calls[2].args).toEqual(["ANTH 1010", "inProgress"]);
    expect(planner.calls[3].args).toEqual(["ANTH 1010", "anth-1010-001"]);

    expect(outcome.appliedStatusCount).toBe(1);
    expect(outcome.appliedSectionCount).toBe(1);
    expect(outcome.mergedTranscriptRecordCount).toBe(1);
    expect(outcome.staleSkipped).toEqual([]);
    expect(outcome.inactiveSkipped).toEqual([]);
    expect(outcome.unknownSkipped).toEqual([]);
    expect(outcome.preferenceChanges).toEqual([]);
  });

  it("dispatches preference changes when the plan's preferences differ from defaults", () => {
    const snapshot = snapshotFrom(stateWith({ optimization: "clusterNight", activeDay: "Fri" }), "Prefs differ");
    const references = resolveSavedPlanReferences(snapshot);

    const planner = new RecorderPlanner();
    const outcome = dispatchRestore(planner as unknown as RestorePlannerApi, snapshot, references);

    expect(planner.actionNames()).toEqual([
      "resetPlanner",
      "setOptimization",
      "setActiveDay",
      "setCourseStatus",
      "setCourseStatus",
      "setSection",
    ]);
    expect(planner.calls[1].args).toEqual(["clusterNight"]);
    expect(planner.calls[2].args).toEqual(["Fri"]);
    expect(outcome.preferenceChanges).toEqual(["optimization", "activeDay"]);
  });

  it("skips stale references instead of dispatching them", () => {
    const snapshot = snapshotFrom(missingSectionFixture.state, "Stale");
    const references = resolveSavedPlanReferences(snapshot);
    expect(references.stale).toHaveLength(1);

    const planner = new RecorderPlanner();
    const outcome = dispatchRestore(planner as unknown as RestorePlannerApi, snapshot, references);

    expect(planner.actionNames()).not.toContain("setSection");
    expect(outcome.appliedSectionCount).toBe(0);
    expect(outcome.staleSkipped).toEqual([
      { courseCode: "ANTH 1010", sectionId: "anth-1010-999-gone" },
    ]);
  });

  it("simulates the restored state through the real normalize fixpoint", () => {
    const snapshot = snapshotFrom(validFixture.state, "Simulate");
    const references = resolveSavedPlanReferences(snapshot);

    const simulated = simulateRestoredState(snapshot, references);

    // The preserved selection survives the real normalize fixpoint exactly.
    expect(simulated.selectedSections["ANTH 1010"]).toBe("anth-1010-001");
    // Declared statuses are restored…
    expect(simulated.courseStatuses["ANTH 1010"]).toBe("inProgress");
    expect(simulated.courseStatuses["ANTH 1150"]).toBe("completed");
    // …and normalize is idempotent on the simulation (it IS the fixpoint).
    expect(normalizePlannerState(simulated)).toEqual(simulated);
  });

  it("replaces stale references with planner recommendations in simulation", () => {
    const snapshot = snapshotFrom(missingSectionFixture.state, "Stale simulate");
    const references = resolveSavedPlanReferences(snapshot);

    const simulated = simulateRestoredState(snapshot, references);
    expect(simulated.selectedSections["ANTH 1010"]).not.toBe("anth-1010-999-gone");
  });

  it("describes restore steps quoting exact saved sections", () => {
    const snapshot = snapshotFrom(validFixture.state, "Steps");
    const references = resolveSavedPlanReferences(snapshot);

    const steps = describeRestoreSteps(snapshot, references);
    expect(steps[0]).toBe("Reset the working schedule to the planner default");
    const selectionStep = steps.find((step) => step.startsWith("Select the exact saved sections:"));
    expect(selectionStep).toContain("ANTH 1010 → anth-1010-001 (");
    expect(selectionStep).toContain("Life Sciences Complex");

    const staleSnapshot = snapshotFrom(missingSectionFixture.state, "Steps stale");
    const staleSteps = describeRestoreSteps(staleSnapshot, resolveSavedPlanReferences(staleSnapshot));
    expect(staleSteps[staleSteps.length - 1]).toContain("Select no exact sections");
  });

  it("fingerprints semantic working-state fields, ignoring timestamps", () => {
    const state = stateWith({});
    const touchedTimestamp = { ...state, updatedAt: "2020-01-01T00:00:00.000Z" };
    expect(workingStateFingerprint(state)).toBe(workingStateFingerprint(touchedTimestamp));

    const differentSection = stateWith({ selectedSections: { "ANTH 1010": "anth-1010-002" } });
    expect(workingStateFingerprint(state)).not.toBe(workingStateFingerprint(differentSection));

    const differentStatus = stateWith({
      courseStatuses: { ...state.courseStatuses, "ART 1200": "inProgress" },
    });
    expect(workingStateFingerprint(state)).not.toBe(workingStateFingerprint(differentStatus));

    const differentOptimization = stateWith({ optimization: "clusterNight" });
    expect(workingStateFingerprint(state)).not.toBe(workingStateFingerprint(differentOptimization));
  });
});
