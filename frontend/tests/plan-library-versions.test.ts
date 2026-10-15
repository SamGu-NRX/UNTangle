import { describe, expect, test } from "bun:test";
import { beforeAuto, replaceWith, undoReplace } from "@/lib/plan-library/versions";
import { getInitialPlannerState, normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

const base = getInitialPlannerState();
/** A plan where Auto planned two courses, with MATH 2700 already planned by hand before it. */
function afterAuto(): PlannerState {
  return normalizePlannerState({
    ...base,
    selectedMajor: "cs",
    courseStatuses: { ...base.courseStatuses, "CSCE 2110": "inProgress", "CSCE 2610": "inProgress", "MATH 2700": "inProgress" },
    coursePlan: {
      manualCredit: [],
      autoPlanned: ["CSCE 2110", "CSCE 2610"],
      lastAuto: {
        id: "auto-1",
        at: "2026-10-13T15:41:00.000Z",
        major: "cs",
        changes: [
          { code: "CSCE 2110", from: "notTaken", to: "inProgress" },
          { code: "CSCE 2610", from: "notTaken", to: "inProgress" },
        ],
        autoPlannedBefore: [],
        summary: "Planned 2 courses.",
        needsCheck: [],
      },
    },
  });
}

describe("Before Auto", () => {
  test("is the plan with Auto's changes put back, from the run's own record", () => {
    const version = beforeAuto(afterAuto());
    expect(version?.at).toBe("2026-10-13T15:41:00.000Z");
    expect(version?.state.courseStatuses["CSCE 2110"]).toBe("notTaken");
    expect(version?.state.courseStatuses["CSCE 2610"]).toBe("notTaken");
    // A course planned by hand before the run stays planned.
    expect(version?.state.courseStatuses["MATH 2700"]).toBe("inProgress");
    expect(version?.state.coursePlan).toEqual({ manualCredit: [], autoPlanned: [], lastAuto: null });
  });

  test("does not exist without an Auto run", () => {
    expect(beforeAuto(base)).toBeNull();
  });

  test("is gone once putting it back would undo the student's own edits", () => {
    const plan = afterAuto();
    const edited = { ...plan, coursePlan: { ...plan.coursePlan!, lastAuto: { ...plan.coursePlan!.lastAuto!, invalidatedBy: "CSCE 2610" } } };
    expect(beforeAuto(edited)).toBeNull();
    expect(beforeAuto({ ...plan, courseStatuses: { ...plan.courseStatuses, "CSCE 2110": "completed" } })).toBeNull();
    expect(beforeAuto({ ...plan, selectedMajor: "math" })).toBeNull();
  });
});

describe("replacing the plan, and undoing it", () => {
  test("a replacement returns the plan it replaced", () => {
    const plan = afterAuto();
    const run = replaceWith((current) => beforeAuto(current)?.state ?? null)(plan);
    expect(run.result.status).toBe("replaced");
    expect(run.next?.courseStatuses["CSCE 2110"]).toBe("notTaken");
    if (run.result.status === "replaced") expect(run.result.previous).toBe(plan);
  });

  test("a version that no longer exists changes nothing", () => {
    expect(replaceWith(() => null)(base)).toEqual({ result: { status: "gone" } });
  });

  test("undo puts the old plan back while nothing has changed since", () => {
    const plan = afterAuto();
    const run = replaceWith((current) => beforeAuto(current)?.state ?? null)(plan);
    if (run.result.status !== "replaced") throw new Error("expected a replacement");
    const undo = undoReplace(run.result);
    // What the reducer commits: the new plan with a fresh timestamp, normalized again on the next read.
    const committed = normalizePlannerState({ ...run.next!, updatedAt: "2026-10-13T16:00:00.000Z" });
    expect(undo(committed)).toEqual({ next: plan, result: true });
  });

  test("undo refuses once the plan has been edited since, so that edit is kept", () => {
    const plan = afterAuto();
    const run = replaceWith((current) => beforeAuto(current)?.state ?? null)(plan);
    if (run.result.status !== "replaced") throw new Error("expected a replacement");
    const edited = { ...run.next!, courseStatuses: { ...run.next!.courseStatuses, "CSCE 1030": "completed" as const } };
    expect(undoReplace(run.result)(normalizePlannerState(edited))).toEqual({ result: false });
  });
});
