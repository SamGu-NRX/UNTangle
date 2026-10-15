/**
 * Regressions from the second review of PR #33, each driven through the real
 * PlannerProvider with the same plan-edit functions the Courses view uses.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { FakePlannerServer, installDom, mountPlanner, removeDom, setSession, waitFor } from "../planner/test-dom";

mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

let server: FakePlannerServer;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

async function guestPlanner() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

const CS_CORE = ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"];

async function modelOf(state: import("@/lib/types").PlannerState) {
  const { untProfile } = await import("@/components/courses/school");
  const { buildCourseModel } = await import("@/components/courses/model/course-model");
  const { getPlanningTermCourseCodes } = await import("@/lib/planner");
  const coursePlan = state.coursePlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
  return buildCourseModel(untProfile(), {
    statuses: state.courseStatuses,
    transcript: state.transcriptRecords,
    planned: new Set(getPlanningTermCourseCodes(state)),
    manualCredit: new Set(coursePlan.manualCredit),
    autoPlanned: new Set(coursePlan.autoPlanned),
  });
}

describe("coursePlan through the real provider", () => {
  beforeAll(() => {
    installDom();
  });
  afterAll(() => {
    removeDom();
  });
  beforeEach(() => {
    window.localStorage.clear();
    server = new FakePlannerServer();
    previousFetch = globalThis.fetch;
    globalThis.fetch = server.fetch as typeof fetch;
    setSession(null);
  });
  afterEach(async () => {
    while (mounted.length) await mounted.pop()!();
    globalThis.fetch = previousFetch;
  });

  test("1: restoring a saved plan keeps manual credit, Auto provenance and the last run; the preview agrees", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { manualEdit } = await import("@/components/courses/model/plan-edits");
    const { buildSavedPlanSnapshot, resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const { dispatchRestore, simulateRestoredState } = await import("@/lib/saved-plans/restore-adapter");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    await planner.run((p) =>
      p.updateCoursePlan(
        manualEdit({ "ENGL 1320": "completed", "MATH 1720": "inProgress" }, (plan) => ({
          manualCredit: [...plan.manualCredit, "ENGL 1320"],
          autoPlanned: ["MATH 1720"],
        })),
      ),
    );
    const saved = planner.get().plannerState;
    expect(saved.coursePlan?.manualCredit).toEqual(["ENGL 1320"]);

    const snapshot = buildSavedPlanSnapshot({ state: saved, name: "Before", source: { kind: "workingState", detail: "test" } });
    await planner.run((p) => p.resetPlanner());
    expect(planner.get().plannerState.coursePlan?.manualCredit).toEqual([]);

    const references = resolveSectionReferences(snapshot.state);
    await planner.run((p) => dispatchRestore(p, snapshot, references));
    const restored = planner.get().plannerState;
    expect(restored.coursePlan?.manualCredit).toEqual(["ENGL 1320"]);
    expect(restored.coursePlan?.autoPlanned).toEqual(["MATH 1720"]);
    expect((await modelOf(restored)).rows.get("ENGL 1320")).toMatchObject({ status: "done", override: true });
    expect(simulateRestoredState(snapshot, references).coursePlan).toEqual(restored.coursePlan);
  });

  test("2: re-adding by hand a course Auto planned takes it from the run, so Undo cannot remove it", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { computeAuto, undoBlocker } = await import("@/components/courses/model/auto");
    const { applyAuto, manualEdit, undoAuto } = await import("@/components/courses/model/plan-edits");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    await planner.run((p) => p.setSelectedMajor("cs"));

    const before = planner.get().plannerState;
    const outcome = computeAuto(await modelOf(before), before.courseStatuses, CS_CORE, 15);
    expect(outcome.planned).toEqual(["MATH 1720", "CSCE 2100"]);
    await planner.run((p) =>
      p.updateCoursePlan(applyAuto(outcome, { id: "auto-1", at: "2026-10-13T00:00:00.000Z", major: "cs", changes: outcome.changes, summary: "", needsCheck: [] })),
    );
    // Remove it, then add it back by hand: the status matches the run again, but the course is the student's now.
    await planner.run((p) => p.updateCoursePlan(manualEdit({ "MATH 1720": "notTaken" })));
    await planner.run((p) => p.updateCoursePlan(manualEdit({ "MATH 1720": "inProgress" })));
    const state = planner.get().plannerState;
    expect(state.courseStatuses["MATH 1720"]).toBe("inProgress");
    expect(undoBlocker(state.coursePlan!.lastAuto!, state.courseStatuses, "cs")).toBe("You changed MATH 1720 after Auto-fill.");

    await planner.run((p) => p.updateCoursePlan(undoAuto("cs")));
    expect(planner.get().plannerState.courseStatuses["MATH 1720"]).toBe("inProgress");
  });

  test("2: an untouched Auto run still undoes through the provider", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { computeAuto } = await import("@/components/courses/model/auto");
    const { applyAuto, undoAuto } = await import("@/components/courses/model/plan-edits");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    const before = planner.get().plannerState;
    const outcome = computeAuto(await modelOf(before), before.courseStatuses, CS_CORE, 15);
    await planner.run((p) =>
      p.updateCoursePlan(applyAuto(outcome, { id: "auto-2", at: "2026-10-13T00:00:00.000Z", major: null, changes: outcome.changes, summary: "", needsCheck: [] })),
    );
    await planner.run((p) => p.updateCoursePlan(undoAuto(null)));
    const after = planner.get().plannerState;
    expect(after.courseStatuses["MATH 1720"]).toBe("notTaken");
    expect(after.coursePlan).toMatchObject({ autoPlanned: [], lastAuto: null });
  });

  test("3: a v1 plan's explicit manual-done annotation becomes manual credit on load", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    // v1's Done toggle: completed, with the annotation on the still in-progress row.
    await planner.run((p) => p.setCourseStatus("ENGL 1320", "completed"));
    const v1 = { ...planner.get().plannerState };
    delete v1.coursePlan;
    expect(v1.transcriptRecords.find((record) => record.code === "ENGL 1320")?.rationale).toContain("Manually marked done in course review.");

    const { normalizePlannerState } = await import("@/lib/planner");
    const loaded = normalizePlannerState(v1);
    expect(loaded.coursePlan?.manualCredit).toEqual(["ENGL 1320"]);
    expect((await modelOf(loaded)).rows.get("ENGL 1320")).toMatchObject({ status: "done", override: true });

    // Without the annotation nothing is guessed.
    const unannotated = {
      ...v1,
      transcriptRecords: v1.transcriptRecords.map((record) => ({ ...record, rationale: "Imported" })),
    };
    expect(normalizePlannerState(unannotated).coursePlan?.manualCredit).toEqual([]);
    // A plan that already has coursePlan is never re-migrated.
    expect(normalizePlannerState({ ...v1, coursePlan: { manualCredit: [], autoPlanned: [], lastAuto: null } }).coursePlan?.manualCredit).toEqual([]);
  });

  test("4: comparing plans reports manual credit and Auto provenance, not 'everything matches'", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { manualEdit } = await import("@/components/courses/model/plan-edits");
    const { buildSavedPlanSnapshot } = await import("@/lib/plan-library/snapshot");
    const { comparePlan } = await import("@/components/saved-plans/plans-view-model");
    const { describeCourseFactChanges } = await import("@/lib/plan-library/diff");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    const snapshot = buildSavedPlanSnapshot({ state: planner.get().plannerState, name: "Plain", source: { kind: "workingState", detail: "test" } });
    await planner.run((p) =>
      p.updateCoursePlan(manualEdit({}, (plan) => ({ manualCredit: [...plan.manualCredit, "ENGL 1320"], autoPlanned: ["MATH 1720"] }))),
    );
    const diff = comparePlan(snapshot, planner.get().plannerState);
    expect(diff.changedFieldCount).toBeGreaterThan(0);
    expect(describeCourseFactChanges(diff.courseFactChanges)).toEqual([
      "ENGL 1320 is marked as credit you have in the working schedule but not in the plan",
      "MATH 1720 was planned by Auto-fill in the working schedule but not in the plan",
    ]);
  });

  async function autoPlannedMath(planner: Awaited<ReturnType<typeof guestPlanner>>) {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { computeAuto } = await import("@/components/courses/model/auto");
    const { applyAuto } = await import("@/components/courses/model/plan-edits");
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    await planner.run((p) => p.setSelectedMajor("cs"));
    const before = planner.get().plannerState;
    const outcome = computeAuto(await modelOf(before), before.courseStatuses, CS_CORE, 15);
    expect(outcome.planned).toEqual(["MATH 1720", "CSCE 2100"]);
    await planner.run((p) =>
      p.updateCoursePlan(applyAuto(outcome, { id: "auto-w", at: "2026-10-13T00:00:00.000Z", major: "cs", changes: outcome.changes, summary: "", needsCheck: [] })),
    );
  }

  test("6: picking a section in Week for a course Auto planned takes it from the run", async () => {
    const { undoBlocker } = await import("@/components/courses/model/auto");
    const { undoAuto } = await import("@/components/courses/model/plan-edits");
    const planner = await guestPlanner();
    await autoPlannedMath(planner);
    // schedule-client's section picker calls the provider's public setSection.
    await planner.run((p) => p.setSection("MATH 1720", "math-1720-002"));
    const state = planner.get().plannerState;
    expect(state.coursePlan?.lastAuto?.invalidatedBy).toBe("MATH 1720");
    expect(undoBlocker(state.coursePlan!.lastAuto!, state.courseStatuses, "cs")).toBe("You changed MATH 1720 after Auto-fill.");
    await planner.run((p) => p.updateCoursePlan(undoAuto("cs")));
    expect(planner.get().plannerState.courseStatuses["MATH 1720"]).toBe("inProgress");
    expect(planner.get().plannerState.selectedSections["MATH 1720"]).toBe("math-1720-002");
  });

  test("6: restoring saved sections does not invalidate the restored Auto run", async () => {
    const { undoBlocker } = await import("@/components/courses/model/auto");
    const { buildSavedPlanSnapshot, resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const { dispatchRestore } = await import("@/lib/saved-plans/restore-adapter");
    const planner = await guestPlanner();
    await autoPlannedMath(planner);
    const saved = planner.get().plannerState;
    expect(saved.selectedSections["MATH 1720"]).toBeDefined();
    const snapshot = buildSavedPlanSnapshot({ state: saved, name: "Auto", source: { kind: "workingState", detail: "test" } });
    await planner.run((p) => p.resetPlanner());
    const references = resolveSectionReferences(snapshot.state);
    expect(references.preserved.map((finding) => finding.courseCode)).toContain("MATH 1720");
    await planner.run((p) => dispatchRestore(p, snapshot, references));
    const restored = planner.get().plannerState;
    expect(restored.coursePlan?.lastAuto?.invalidatedBy).toBeUndefined();
    expect(undoBlocker(restored.coursePlan!.lastAuto!, restored.courseStatuses, "cs")).toBeNull();
  });

  test("7: restoring a v1 snapshot migrates its manual-done annotation, in the restore and the preview", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { buildSavedPlanSnapshot, resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const { dispatchRestore, simulateRestoredState } = await import("@/lib/saved-plans/restore-adapter");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    await planner.run((p) => p.setCourseStatus("ENGL 1320", "completed"));
    const v1 = { ...planner.get().plannerState };
    delete v1.coursePlan;
    const snapshot = buildSavedPlanSnapshot({ state: v1, name: "v1", source: { kind: "workingState", detail: "test" } });
    expect(snapshot.state.coursePlan).toBeUndefined();
    await planner.run((p) => p.resetPlanner());
    const references = resolveSectionReferences(snapshot.state);
    await planner.run((p) => dispatchRestore(p, snapshot, references));
    const restored = planner.get().plannerState;
    expect(restored.coursePlan?.manualCredit).toEqual(["ENGL 1320"]);
    expect((await modelOf(restored)).rows.get("ENGL 1320")).toMatchObject({ status: "done", override: true });
    expect(simulateRestoredState(snapshot, references).coursePlan?.manualCredit).toEqual(["ENGL 1320"]);
  });

  test("8: v1 annotations on ignored and needs-review rows migrate too; completion alone never does", async () => {
    const { normalizePlannerState, getInitialPlannerState } = await import("@/lib/planner");
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const note = "Manually marked done in course review.";
    const row = sampleTranscript.find((record) => record.code === "ENGL 1320")!;
    // A v1 plan has no coursePlan field at all.
    const { coursePlan: _none, ...v1Base } = getInitialPlannerState();
    void _none;
    const state = (appliedStatus: "ignored" | "needsReview" | "inProgress", rationale: string) => ({
      ...v1Base,
      courseStatuses: { ...getInitialPlannerState().courseStatuses, "ENGL 1320": "completed" as const },
      transcriptRecords: [{ ...row, appliedStatus, reviewRequired: appliedStatus === "needsReview", rationale }],
    });
    for (const applied of ["ignored", "needsReview", "inProgress"] as const) {
      const migrated = normalizePlannerState(state(applied, `Imported. ${note}`));
      expect(migrated.coursePlan?.manualCredit).toEqual(["ENGL 1320"]);
      expect((await modelOf(migrated)).rows.get("ENGL 1320")).toMatchObject({ status: "done", override: true });
      expect(normalizePlannerState(state(applied, "Imported.")).coursePlan?.manualCredit).toEqual([]);
    }
  });

  test("5: a section of a course being taken now is classified inactive, as restore treats it", async () => {
    const { sampleTranscript } = await import("@/components/courses/model/sample-transcript");
    const { buildSavedPlanSnapshot, resolveSectionReferences } = await import("@/lib/plan-library/snapshot");
    const { dispatchRestore, describeSkippedReferences } = await import("@/lib/saved-plans/restore-adapter");
    const { sections } = await import("@/lib/seed-data");
    const planner = await guestPlanner();
    await planner.run((p) => p.applyTranscriptRecords(sampleTranscript));
    // A v1 plan scheduled ENGL 1320 even though the transcript says it is being taken now.
    const section = sections.find((entry) => entry.courseCode === "ENGL 1320")!;
    const legacy = {
      ...planner.get().plannerState,
      courseStatuses: { ...planner.get().plannerState.courseStatuses, "ENGL 1320": "inProgress" as const },
      selectedSections: { "ENGL 1320": section.id },
    };
    const snapshot = buildSavedPlanSnapshot({ state: legacy, name: "Legacy", source: { kind: "workingState", detail: "test" } });
    const references = resolveSectionReferences(snapshot.state);
    expect(references.inactive.map((finding) => finding.courseCode)).toEqual(["ENGL 1320"]);
    expect(describeSkippedReferences(references)[0].warning).toContain("ENGL 1320");

    await planner.run((p) => dispatchRestore(p, snapshot, references));
    expect(planner.get().plannerState.selectedSections["ENGL 1320"]).toBeUndefined();
  });
});
