/**
 * Every Courses-view change to the plan, as an update for the provider's
 * `updateCoursePlan`. The view and the tests run the same functions against
 * the planner's current state, so Auto ownership and Undo cannot drift
 * between what is shown and what is tested.
 */
import { takeFromAutoRun } from "@/lib/planner";
import type { AutoTransaction, CoursePlan, CourseStatus, MajorId } from "@/lib/types";
import { undoBlocker, undoStatuses, type AutoOutcome } from "./auto";

export type PlanParts = { courseStatuses: Record<string, CourseStatus>; coursePlan: CoursePlan };
export type PlanUpdate = (current: PlanParts) => Partial<PlanParts>;

/**
 * The student's own edit. Any course in `touched` that the pending Auto run
 * changed now belongs to the student, so Undo is refused from here on:
 * restoring the run's old values would overwrite their choice even when the
 * value happens to match again (remove MATH 1720, then add it back by hand).
 */
export function manualEdit(
  statuses: Record<string, CourseStatus>,
  plan: (current: CoursePlan) => Partial<CoursePlan> = () => ({}),
  alsoTouched: readonly string[] = [],
): PlanUpdate {
  return (current) => {
    const next = takeFromAutoRun({ ...current.coursePlan, ...plan(current.coursePlan) }, [...Object.keys(statuses), ...alsoTouched]);
    return { courseStatuses: { ...current.courseStatuses, ...statuses }, coursePlan: next };
  };
}

/** One Auto run: its status changes, the courses it now owns, and the record Undo needs. */
export function applyAuto(outcome: AutoOutcome, run: Omit<AutoTransaction, "autoPlannedBefore">): PlanUpdate {
  const unplanned = new Set(outcome.unplanned);
  return (current) => ({
    courseStatuses: {
      ...current.courseStatuses,
      ...Object.fromEntries(outcome.changes.map((change) => [change.code, change.to])),
    },
    coursePlan: {
      ...current.coursePlan,
      autoPlanned: [...current.coursePlan.autoPlanned.filter((id) => !unplanned.has(id)), ...outcome.planned],
      lastAuto: { ...run, autoPlannedBefore: current.coursePlan.autoPlanned },
    },
  });
}

/** Undo the pending run, or change nothing when undoBlocker refuses. */
export function undoAuto(major: MajorId | null): PlanUpdate {
  return (current) => {
    const run = current.coursePlan.lastAuto;
    if (!run || undoBlocker(run, current.courseStatuses, major)) return {};
    return {
      courseStatuses: undoStatuses(run, current.courseStatuses),
      coursePlan: { ...current.coursePlan, autoPlanned: run.autoPlannedBefore, lastAuto: null },
    };
  };
}
