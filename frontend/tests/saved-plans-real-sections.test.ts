/**
 * Saved plans against real options: a saved id that still names a current
 * option resolves; one that does not is kept and flagged, never swapped; a
 * plan from before real sections keeps its synthetic samples, labeled.
 */
import { describe, expect, test } from "bun:test";
import { diffSavedPlanAgainstWorking } from "@/lib/plan-library/diff";
import { buildSavedPlanSnapshot, resolveSectionReferences } from "@/lib/plan-library/snapshot";
import { getInitialPlannerState, normalizePlannerState, resolveSectionPlan } from "@/lib/planner";
import { dispatchRestore, describeSkippedReferences, type RestorePlannerApi } from "@/lib/saved-plans/restore-adapter";
import type { PlannerState } from "@/lib/types";
import { fixtureCatalog, fixtureInput, optionsOf, renumber, courseAs } from "./sections/real-term";

const MATH_ID = "vsb:spring-2027:MATH 1680:6862+6863";
/** The same course after vsb renumbered the option: the saved class numbers no longer exist. */
const GONE_ID = "vsb:spring-2027:MATH 1680:9998+9999";

function savedState(selectedSections: Record<string, string>): PlannerState {
  const base = getInitialPlannerState();
  const codes = Object.keys(selectedSections);
  return normalizePlannerState({
    ...base,
    courseStatuses: { ...base.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) },
    selectedSections,
  });
}

function recordingPlanner(): RestorePlannerApi & { sections: Record<string, string> } {
  const sections: Record<string, string> = {};
  const noop = () => {};
  return {
    sections,
    resetPlanner: noop,
    setSelectedMajor: noop,
    setOptimization: noop,
    setActiveDay: noop,
    applyTranscriptRecords: noop,
    setCourseStatus: noop,
    setSection: (code, id) => {
      sections[code] = id;
    },
    setSectionLock: noop,
    setCoursePlan: noop,
    plannerState: getInitialPlannerState(),
  };
}

describe("working plan resolution", () => {
  test("a saved real id that names a current option resolves to it", () => {
    const plan = resolveSectionPlan(savedState({ "MATH 1680": MATH_ID }), fixtureCatalog());
    expect(plan.courses).toMatchObject([{ code: "MATH 1680", state: "chosen", savedId: MATH_ID }]);
    expect(plan.courses[0].section?.classNumbers).toEqual(["6862", "6863"]);
  });

  test("a saved real id that no longer resolves needs review and is not replaced", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "MATH 1680", (row) => renumber(row, ["7000", "7001"]));
    const catalog = fixtureCatalog(input);
    expect(optionsOf(catalog, "MATH 1680").map((option) => option.id)).toEqual(["vsb:spring-2027:MATH 1680:7000+7001"]);
    const plan = resolveSectionPlan(savedState({ "MATH 1680": MATH_ID }), catalog);
    expect(plan.courses).toMatchObject([{ state: "needs-review", section: null, savedId: MATH_ID }]);
    expect(plan.selections).toEqual({ "MATH 1680": MATH_ID });
  });

  test("an old plan's synthetic pick stays a labeled sample beside real options", () => {
    const plan = resolveSectionPlan(savedState({ "MATH 1680": "math-1680-002" }), fixtureCatalog());
    const [course] = plan.courses;
    expect(course.state).toBe("sample-pick");
    expect(course.section?.id).toBe("math-1680-002");
    expect(course.section?.term).toBeNull();
    expect(course.result?.provenance.kind).toBe("real");
    expect(plan.selections).toEqual({ "MATH 1680": "math-1680-002" });
  });

  test("while options load, a saved pick is kept as is", () => {
    const plan = resolveSectionPlan(savedState({ "MATH 1680": MATH_ID }), fixtureCatalog(fixtureInput(), ["MATH 1680"]));
    expect(plan.courses).toMatchObject([{ state: "loading", savedId: MATH_ID }]);
    expect(plan.selections).toEqual({ "MATH 1680": MATH_ID });
  });
});

describe("restoring a saved plan", () => {
  const snapshot = (selectedSections: Record<string, string>) =>
    buildSavedPlanSnapshot({ state: savedState(selectedSections), name: "Spring", source: { kind: "workingState", detail: "test" } });

  test("resolved, needs review, unchecked and sample references", () => {
    const plan = snapshot({ "MATH 1680": GONE_ID, "MATH 1710": "math-1710-002", "SPAN 2040": MATH_ID.replace("MATH 1680", "SPAN 2040") });
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "SPAN 2040");
    const report = resolveSectionReferences(plan.state, fixtureCatalog(input));
    expect(Object.fromEntries(report.findings.map((finding) => [finding.courseCode, finding.status]))).toEqual({
      "MATH 1680": "needsReview",
      "MATH 1710": "preserved", // a bundled sample, shown labeled
      "SPAN 2040": "preserved",
    });
    expect(describeSkippedReferences(report)).toEqual([]);

    const unchecked = resolveSectionReferences(plan.state, fixtureCatalog(input, ["MATH 1680"]));
    expect(unchecked.unchecked.map((finding) => finding.courseCode)).toEqual(["MATH 1680"]);
  });

  test("restore keeps a real reference that needs review instead of skipping it", () => {
    const plan = snapshot({ "MATH 1680": GONE_ID });
    const report = resolveSectionReferences(plan.state, fixtureCatalog());
    const planner = recordingPlanner();
    const outcome = dispatchRestore(planner, plan, report);
    expect(planner.sections).toEqual({ "MATH 1680": GONE_ID });
    expect(outcome.appliedSectionCount).toBe(1);
    expect(outcome.staleSkipped).toEqual([]);
  });

  test("compare does not call a real reference unknown before its options load", () => {
    const plan = snapshot({ "MATH 1680": MATH_ID });
    const working = savedState({});
    const loading = diffSavedPlanAgainstWorking(plan, working, fixtureCatalog(fixtureInput(), ["MATH 1680"]));
    expect(loading.unknownReferences).toEqual([]);
    const gone = diffSavedPlanAgainstWorking(snapshot({ "MATH 1680": GONE_ID }), working, fixtureCatalog());
    expect(gone.unknownReferences).toEqual([{ courseCode: "MATH 1680", sectionId: GONE_ID, side: "savedPlan" }]);
  });
});
