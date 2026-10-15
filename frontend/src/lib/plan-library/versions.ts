import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import { normalizePlannerState } from "@/lib/planner";
import type { PlanTransaction } from "@/lib/planner-transaction";
import type { PlannerState } from "@/lib/types";

/**
 * The working schedule's history (DESIGN.md §4.5): what it is now, and how
 * it was before the last Auto run. Auto keeps a record of every status it
 * changed and the value it replaced (`coursePlan.lastAuto`), so "Before
 * Auto" costs nothing to keep: it is the plan with those changes put back.
 * Nothing else is stored, so the history holds no more than that.
 */

export type Version = { at: string; state: PlannerState };

/**
 * The plan as it was before the last Auto run, or null when there is none
 * or putting it back would undo the student's own later edits: a course
 * Auto changed was edited by hand, its status moved again, or the major
 * changed. These are the conditions under which Courses refuses Undo.
 */
export function beforeAuto(state: PlannerState): Version | null {
  const run = state.coursePlan?.lastAuto;
  if (!run || run.invalidatedBy || run.major !== state.selectedMajor) return null;
  const statusOf = (code: string) => state.courseStatuses[code] ?? "notTaken";
  if (run.changes.some((change) => statusOf(change.code) !== change.to)) return null;
  const courseStatuses = { ...state.courseStatuses };
  for (const change of run.changes) courseStatuses[change.code] = change.from;
  return {
    at: run.at,
    state: {
      ...state,
      courseStatuses,
      coursePlan: { ...state.coursePlan!, autoPlanned: run.autoPlannedBefore, lastAuto: null },
    },
  };
}

/** What a replacement hands back, so it can be undone. */
export type Replaced = { status: "replaced"; previous: PlannerState; next: PlannerState } | { status: "gone" };

/**
 * One whole-plan replacement as a `transact` function: `pick` chooses the
 * new plan from the plan as it is when the transaction runs (null when the
 * version no longer exists). The plan it replaced comes back in the result,
 * for Undo.
 */
export function replaceWith(pick: (current: PlannerState) => PlannerState | null) {
  return (current: PlannerState): PlanTransaction<Replaced> => {
    const next = pick(current);
    if (!next) return { result: { status: "gone" } };
    return { next, result: { status: "replaced", previous: current, next } };
  };
}

/**
 * Undo of a replacement as a `transact` function: puts `previous` back only
 * while the plan is still exactly what the replacement left, so an edit
 * made since is never thrown away.
 */
export function undoReplace(replaced: Extract<Replaced, { status: "replaced" }>) {
  const expected = workingStateFingerprint(normalizePlannerState(replaced.next));
  return (current: PlannerState): PlanTransaction<boolean> =>
    workingStateFingerprint(current) === expected ? { next: replaced.previous, result: true } : { result: false };
}
