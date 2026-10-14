import { describe, expect, test } from "bun:test";
import { autoTransaction, courseEdit, undoAutoTransaction, undoCourseEdit } from "@/components/courses/model/plan-edits";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import { untProfile } from "@/components/courses/school";
import { getInitialPlannerState, getMajorById, normalizePlannerState } from "@/lib/planner";
import type { CourseStatus, PlannerState } from "@/lib/types";

const profile = untProfile();
const cs = getMajorById("cs")!;
const run = { id: "auto-t", at: "2026-10-13T00:00:00.000Z" };

/** The sample transcript applied, with Computer Science chosen. */
function samplePlan(overrides: Partial<PlannerState> = {}): PlannerState {
  const statuses: Record<string, CourseStatus> = {};
  for (const record of sampleTranscript) statuses[record.code] = record.appliedStatus === "completed" ? "completed" : "inProgress";
  const base = getInitialPlannerState();
  return normalizePlannerState({
    ...base,
    selectedMajor: "cs",
    courseStatuses: { ...base.courseStatuses, ...statuses },
    transcriptRecords: sampleTranscript,
    ...overrides,
  });
}

describe("autoTransaction", () => {
  test("plans from the plan it commits on and records the run for Undo", () => {
    const { next, result } = autoTransaction(profile, cs, run)(samplePlan());
    if (result === "major-changed") throw new Error("refused");
    expect(result.planned).toEqual(["MATH 1720"]);
    expect(next?.courseStatuses["MATH 1720"]).toBe("inProgress");
    expect(next?.coursePlan?.lastAuto).toMatchObject({ id: "auto-t", major: "cs", changes: [{ code: "MATH 1720", from: "notTaken", to: "inProgress" }] });
  });

  test("refuses, changing nothing, when the major changed while it waited", () => {
    expect(autoTransaction(profile, cs, run)(samplePlan({ selectedMajor: "math" }))).toEqual({ result: "major-changed" });
  });

  test("changes nothing when there is nothing to plan", () => {
    const planned = autoTransaction(profile, cs, run)(samplePlan()).next!;
    const again = autoTransaction(profile, cs, { ...run, id: "auto-2" })(planned);
    expect(again.next).toBeUndefined();
  });
});

describe("undoAutoTransaction", () => {
  test("puts the plan back, and refuses after a hand edit to a course the run planned", () => {
    const after = autoTransaction(profile, cs, run)(samplePlan()).next!;
    const undone = undoAutoTransaction("cs")(after);
    expect(undone.result).toBe(true);
    expect(undone.next?.courseStatuses["MATH 1720"]).toBe("notTaken");
    expect(undone.next?.coursePlan?.lastAuto).toBeNull();

    const edited = courseEdit("MATH 1720", { status: "notTaken" })(after).next!;
    expect(undoAutoTransaction("cs")(edited)).toEqual({ result: false });
  });
});

describe("courseEdit and its Undo", () => {
  test("Undo restores the course exactly, including no saved section", () => {
    const before = samplePlan();
    const { next, result } = courseEdit("CSCE 1010", { status: "inProgress", section: "sec-1" })(before);
    expect(result).toEqual({
      id: "CSCE 1010",
      before: { status: before.courseStatuses["CSCE 1010"], section: undefined, lock: undefined },
      after: { status: "inProgress", section: "sec-1" },
    });
    const undone = undoCourseEdit(result)(next!);
    expect(undone.result).toBe(true);
    expect(undone.next?.courseStatuses["CSCE 1010"]).toBe(before.courseStatuses["CSCE 1010"]);
    expect("CSCE 1010" in undone.next!.selectedSections).toBe(false);
  });

  test("a lock moves with a hand-picked section and comes back with Undo", () => {
    // Only a planned course keeps a lock through normalization.
    const plan = samplePlan();
    const locked = normalizePlannerState({
      ...plan,
      courseStatuses: { ...plan.courseStatuses, "MATH 1720": "inProgress" },
      selectedSections: { "MATH 1720": "old" },
      lockedSections: { "MATH 1720": "old" },
    });
    expect(locked.lockedSections).toEqual({ "MATH 1720": "old" });
    const { next, result } = courseEdit("MATH 1720", { section: "new" })(locked);
    expect(next?.lockedSections).toEqual({ "MATH 1720": "new" });
    const undone = undoCourseEdit(result)(next!).next!;
    expect(undone.selectedSections["MATH 1720"]).toBe("old");
    expect(undone.lockedSections).toEqual({ "MATH 1720": "old" });
  });

  test("Undo of a removal works on the normalized plan, which drops the removed course's section", () => {
    const plan = samplePlan();
    const planned = normalizePlannerState({
      ...plan,
      courseStatuses: { ...plan.courseStatuses, "MATH 1720": "inProgress" },
      selectedSections: { "MATH 1720": "sec-3" },
    });
    const { next, result } = courseEdit("MATH 1720", { status: "notTaken" })(planned);
    const seen = normalizePlannerState(next!);
    expect(seen.selectedSections["MATH 1720"]).toBeUndefined();
    const undone = undoCourseEdit(result)(seen);
    expect(undone.result).toBe(true);
    expect(undone.next?.courseStatuses["MATH 1720"]).toBe("inProgress");
    expect(undone.next?.selectedSections["MATH 1720"]).toBe("sec-3");
  });

  test("Undo refuses once the course changed again", () => {
    const { next, result } = courseEdit("CSCE 1010", { status: "inProgress" })(samplePlan());
    const later = courseEdit("CSCE 1010", { section: "sec-2" })(next!).next!;
    expect(undoCourseEdit(result)(later)).toEqual({ result: false });
  });

  test("an edit takes its course from a pending Auto run, so the run's Undo is refused", () => {
    const after = autoTransaction(profile, cs, run)(samplePlan()).next!;
    const picked = courseEdit("MATH 1720", { section: "sec-9" })(after).next!;
    expect(picked.coursePlan?.lastAuto?.invalidatedBy).toBe("MATH 1720");
  });
});
