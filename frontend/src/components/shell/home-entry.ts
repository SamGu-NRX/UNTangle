import type { CourseStatus } from "@/lib/types";

/** The persisted parts of PlannerState that a student changes by planning. */
export type PlanProgress = {
  selectedMajor: string | null;
  transcriptRecords: readonly unknown[] | undefined;
  courseStatuses: Record<string, CourseStatus>;
  selectedSections: Record<string, string>;
  lockedSections?: Record<string, string>;
  optimization: string;
};

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/**
 * Whether the student has started a plan: anything persisted that differs
 * from the seeded starting state. That covers a chosen major, an imported
 * transcript, a changed course status, a picked or locked section, and a
 * different optimization goal. The seed itself ships a few statuses (and
 * the sections normalisation derives from them), so "anything set" would
 * wrongly count a first visit; comparing against the seed does not.
 * Pass both states through the same normalisation.
 */
export function hasStartedPlan(state: PlanProgress, defaults: Omit<PlanProgress, "selectedMajor" | "transcriptRecords">): boolean {
  if (state.selectedMajor !== null) return true;
  if ((state.transcriptRecords ?? []).length > 0) return true;
  if (state.optimization !== defaults.optimization) return true;
  if (!sameRecord(state.selectedSections, defaults.selectedSections)) return true;
  if (!sameRecord(state.lockedSections, defaults.lockedSections)) return true;
  const codes = new Set([...Object.keys(state.courseStatuses), ...Object.keys(defaults.courseStatuses)]);
  for (const code of codes) {
    if ((state.courseStatuses[code] ?? "notTaken") !== (defaults.courseStatuses[code] ?? "notTaken")) return true;
  }
  return false;
}
