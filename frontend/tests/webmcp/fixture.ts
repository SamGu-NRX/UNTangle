/**
 * A fixture plan and a PlannerPort whose actions do what planner-provider's
 * do to plain state (including takeFromAutoRun), recording which ran.
 */
import { optimize } from "@/lib/optimizer/optimize";
import { defaultSchedulePreferences, getInitialPlannerState, normalizePlannerState, takeFromAutoRun } from "@/lib/planner";
import {
  plannerBox,
  reducePlannerBox,
  TransactionRequest,
  type PlannerAction,
  type PlanStamp,
  type PlanTransaction,
  type TransactionOutcome,
} from "@/lib/planner-transaction";
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
 * A port over plain state run through planner-provider's own reducer
 * (lib/planner-transaction.ts), so stamps, replacements and the Auto-fill
 * edit count behave as in the page. `student` makes the edits the pages
 * make, including takeFromAutoRun on a section pick.
 */
export function fixturePort(start: PlannerState = fixturePlan(), selected: Record<string, string> = {}) {
  let box = plannerBox(normalizePlannerState({ ...start, selectedSections: { ...start.selectedSections, ...selected } }));
  let preferences: SchedulePreferences = defaultSchedulePreferences(box.plan.optimization);
  let identity = "guest";
  let lastId = 0;
  const writes: string[] = [];
  let lastSeq = 0;
  const dispatch = (action: PlannerAction) => (box = reducePlannerBox(box, { seq: ++lastSeq, action }, identity));
  const port: PlannerPort = {
    plan: () => normalizePlannerState(box.plan),
    preferences: () => preferences,
    stamp: () => ({ identity, epoch: box.epoch }),
    // A node budget instead of the clock, so every run gives the same answer.
    optimize: async (request) => optimize({ ...request, timeBudgetMs: Number.POSITIVE_INFINITY, maxNodes: 200_000 }),
    transact: async <R,>(fn: (plan: PlannerState, meta: { runEdits: number }) => PlanTransaction<R>, stamp: PlanStamp) => {
      const before = box.plan;
      dispatch(new TransactionRequest(++lastId, stamp, fn, "2026-10-13T00:00:00.000Z", new Set()));
      if (box.plan !== before) writes.push("commit");
      // The receipt holds fn's result as unknown; fn is the one that returns R.
      return box.receipts.at(-1)!.outcome as TransactionOutcome<R>;
    },
    setSchedulePreferences: (update) => {
      writes.push("preferences");
      preferences = update(preferences);
    },
  };
  const student = {
    setSection: (code: string, sectionId: string) =>
      dispatch((plan) => ({
        ...plan,
        selectedSections: { ...plan.selectedSections, [code]: sectionId },
        coursePlan: plan.coursePlan ? takeFromAutoRun(plan.coursePlan, [code]) : plan.coursePlan,
      })),
    setPreferences: (update: (current: SchedulePreferences) => SchedulePreferences) => (preferences = update(preferences)),
    /** Loads, resets or adopts a whole plan, as the provider does. */
    replacePlan: () => dispatch(structuredClone(box.plan)),
    signInAs: (next: string) => (identity = next),
  };
  // Every committed write stamps updatedAt, so a snapshot compares everything but it.
  const snapshot = () => {
    const { updatedAt, ...plan } = normalizePlannerState(box.plan);
    void updatedAt;
    return structuredClone({ plan, preferences });
  };
  return { port, writes, student, snapshot };
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
