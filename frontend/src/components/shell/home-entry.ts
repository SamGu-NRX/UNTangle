import type { CourseStatus } from "@/lib/types";

/** The parts of PlannerState that show whether a student has begun. */
export type PlanProgress = {
  selectedMajor: string | null;
  transcriptRecords: readonly unknown[] | undefined;
  courseStatuses: Record<string, CourseStatus>;
};

/**
 * Whether the student has started a plan, i.e. done anything the seeded
 * starting state did not already contain: picked a major, imported a
 * transcript, or changed a course's status. The seed itself ships a few
 * statuses, so "any status set" would wrongly count a first visit.
 */
export function hasStartedPlan(state: PlanProgress, defaults: Pick<PlanProgress, "courseStatuses">): boolean {
  if (state.selectedMajor !== null) return true;
  if ((state.transcriptRecords ?? []).length > 0) return true;
  const codes = new Set([...Object.keys(state.courseStatuses), ...Object.keys(defaults.courseStatuses)]);
  for (const code of codes) {
    if ((state.courseStatuses[code] ?? "notTaken") !== (defaults.courseStatuses[code] ?? "notTaken")) return true;
  }
  return false;
}
