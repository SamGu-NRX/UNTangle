/**
 * The page header's one number, "54 of 120 credits": credit the student has,
 * is taking, or has planned for the term. Covered courses add no credit
 * (they are proven by a later course, not taken).
 */
import type { TranscriptCourseRecord } from "@/lib/types";
import type { SchoolProfile } from "../school";
import type { CourseModel } from "./course-model";

/**
 * UNT's minimum for a bachelor's degree. Starting value: some majors need
 * more, and the major list does not carry its own total yet.
 */
export const DEGREE_CREDITS = 120;

/** "1 credit", "3 credits", "0 credits". */
export const creditsLabel = (count: number) => `${count} credit${count === 1 ? "" : "s"}`;

export function creditProgress(
  model: CourseModel,
  transcript: readonly TranscriptCourseRecord[],
  profile: Pick<SchoolProfile, "normalizeId" | "adapter">,
): number {
  let credits = 0;
  for (const row of model.rows.values()) {
    if (row.status === "done" || row.status === "taking" || row.inPlan) credits += row.credits;
  }
  // Passed courses the catalog does not carry still count, once each.
  const counted = new Set<string>();
  for (const record of transcript) {
    const id = profile.normalizeId(record.code);
    // Rows waiting for the student's review count for nothing yet, as in the transcript evidence.
    if (!id || model.rows.has(id) || counted.has(id) || record.duplicateExcluded || record.reviewRequired) continue;
    const passed = record.appliedStatus === "completed" && profile.adapter.isPassingGrade(record.grade) === true;
    if (!passed && record.appliedStatus !== "inProgress") continue;
    counted.add(id);
    credits += record.credits ?? 0;
  }
  return credits;
}
