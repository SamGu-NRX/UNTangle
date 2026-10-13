/**
 * A fixture plan and a PlannerPort whose actions do what planner-provider's
 * do to plain state (including takeFromAutoRun), recording which ran.
 */
import { optimize } from "@/lib/optimizer/optimize";
import { defaultSchedulePreferences, getInitialPlannerState, normalizePlannerState, takeFromAutoRun } from "@/lib/planner";
import type { CourseStatus, PlannerState, SchedulePreferences, TranscriptCourseRecord } from "@/lib/types";
import type { PlannerPort, ToolContext } from "@/lib/webmcp/tools";

export const row = (code: string, grade: string, appliedStatus: "completed" | "inProgress" = "completed"): TranscriptCourseRecord => ({
  id: `t-${code}`,
  code,
  title: code,
  term: "Fall 2025",
  grade,
  credits: 3,
  sourceKind: "unt",
  confidence: 1,
  rationale: "fixture",
  duplicateExcluded: false,
  appliedStatus,
  prerequisiteSatisfied: true,
  reviewRequired: false,
});

/** Passed MATH 1710 and CSCE 1030 (or the given grades); plans CSCE 1040, ENGL 1310 and PSYC 1630. */
export function fixturePlan(grades: Record<string, string> = { "MATH 1710": "A", "CSCE 1030": "B" }, extra: Record<string, CourseStatus> = {}): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    transcriptRecords: Object.entries(grades).map(([code, grade]) => row(code, grade)),
    courseStatuses: {
      ...initial.courseStatuses,
      ...Object.fromEntries(Object.keys(grades).map((code) => [code, "completed" as const])),
      "CSCE 1040": "inProgress",
      "ENGL 1310": "inProgress",
      "PSYC 1630": "inProgress",
      ...extra,
    },
  };
}

/**
 * A port over plain state. Plan writes go through `transact` as in
 * planner-provider (normalized input, `next` committed); `student` makes the
 * edits the pages make, including takeFromAutoRun on a section pick.
 */
export function fixturePort(start: PlannerState = fixturePlan(), selected: Record<string, string> = {}) {
  let plan = normalizePlannerState({ ...start, selectedSections: { ...start.selectedSections, ...selected } });
  let preferences: SchedulePreferences = defaultSchedulePreferences(plan.optimization);
  let epoch = 1;
  const writes: string[] = [];
  const port: PlannerPort = {
    plan: () => plan,
    preferences: () => preferences,
    epoch: () => epoch,
    // A node budget instead of the clock, so every run gives the same answer.
    optimize: async (request) => optimize({ ...request, timeBudgetMs: Number.POSITIVE_INFINITY, maxNodes: 200_000 }),
    transact: async (fn) => {
      const { next, result } = fn(normalizePlannerState(plan));
      if (next) {
        writes.push("commit");
        plan = normalizePlannerState(next);
      }
      return result;
    },
    setSchedulePreferences: (update) => {
      writes.push("preferences");
      preferences = update(preferences);
    },
  };
  const student = {
    setSection: (code: string, sectionId: string) => {
      plan = normalizePlannerState({
        ...plan,
        selectedSections: { ...plan.selectedSections, [code]: sectionId },
        coursePlan: plan.coursePlan ? takeFromAutoRun(plan.coursePlan, [code]) : plan.coursePlan,
      });
    },
    setPreferences: (update: (current: SchedulePreferences) => SchedulePreferences) => (preferences = update(preferences)),
  };
  return { port, writes, student, snapshot: () => structuredClone({ plan, preferences }), replacePlan: () => (epoch += 1) };
}

/** A tool context whose student answers `answer`, after running `meanwhile` (another tab's edit). */
export function session(port: PlannerPort, answer: boolean, meanwhile: () => void = () => {}) {
  const asked: string[] = [];
  const undos: Array<() => Promise<boolean>> = [];
  const ctx: ToolContext = {
    port,
    signal: new AbortController().signal,
    confirm: async (question) => {
      asked.push(question);
      meanwhile();
      return answer;
    },
    applied: (_message, undo) => undos.push(undo),
  };
  return { asked, undos, ctx };
}
