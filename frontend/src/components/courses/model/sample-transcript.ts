/**
 * A made-up first-year Computer Science transcript, for trying Auto without a
 * real PDF. Every row is marked as a sample in its rationale. It is chosen to
 * show each inferred state: CSCE 1040 is passed but CSCE 1030 is not on the
 * transcript, so CSCE 1030 is covered through CSCE 1040's prerequisite.
 */
import type { TranscriptCourseRecord } from "@/lib/types";

const row = (
  code: string,
  title: string,
  term: string,
  grade: string,
  appliedStatus: "completed" | "inProgress",
): TranscriptCourseRecord => ({
  id: `sample-${code.replace(" ", "-").toLowerCase()}-${term.replace(" ", "-").toLowerCase()}`,
  code,
  title,
  term,
  grade,
  credits: 3,
  sourceKind: appliedStatus === "inProgress" ? "current" : "unt",
  confidence: 1,
  rationale: "Sample transcript row; not a real student record.",
  duplicateExcluded: false,
  appliedStatus,
  prerequisiteSatisfied: true,
  reviewRequired: false,
});

export const SAMPLE_TRANSCRIPT_LABEL = "Sample transcript";

export const sampleTranscript: TranscriptCourseRecord[] = [
  row("MATH 1710", "Calculus I", "Fall 2025", "B", "completed"),
  row("ENGL 1310", "College Writing I", "Fall 2025", "A", "completed"),
  row("CSCE 1040", "Computer Science II", "Spring 2026", "A", "completed"),
  row("ENGL 1320", "College Writing II", "Fall 2026", "IP", "inProgress"),
];
