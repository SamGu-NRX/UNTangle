/**
 * Accepted instructor evidence for one enrollment option: does the section's
 * instructor match a grade-history identity confidently, and did that
 * instructor teach enough past graded sections of this course for their mean
 * to stand for anything?
 *
 * The join matches on the section's raw instructor field only
 * (frontend/src/lib/instructors/match.ts), never the cleaned display string:
 * a name the source mangled ("Smith,,John" shown as "Smith John") must
 * abstain, because the display text is an interpretation, not evidence. The
 * mean is the A-F weighted mean grade points of the matched instructor's own
 * past sections of the course, in whole hundredths (3.27 is 327) — the shape
 * core's instructor tie-break compares (docs/architecture/README.md). Grade
 * history describes past grades and never predicts one.
 *
 * Pure and network-free: history arrives as a value; callers decide which
 * requests read it.
 */

import type { InstructorEvidence } from "@untangle/core/instructor-tiebreak";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import { matchInstructor, type Candidate } from "@/lib/instructors/match";
import type { Section } from "./model";

/**
 * Grade history needs at least this many of the instructor's past sections
 * of the course with A through F grades. The same bar the schedule reasons
 * quote, so a mean that decides a tie is one the reasons can show.
 */
export const MIN_GRADED_SECTIONS = 3;

/** The grade-history identities one course's history names, deduplicated. */
export function historyCandidates(history: CourseHistory): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const past of history.terms.flatMap((term) => term.sections)) {
    const { id, firstName, lastName, name } = past.instructor;
    if (!byId.has(id)) byId.set(id, { id, firstName, lastName, name });
  }
  return [...byId.values()];
}

const aThroughF = (g: CourseHistory["grades"]) => g.gradeA + g.gradeB + g.gradeC + g.gradeD + g.gradeF;

/**
 * Mean grade points of one instructor's own past graded sections of the
 * course, in hundredths, or null below `MIN_GRADED_SECTIONS` (or when no
 * section has A-F grades). The instructor's own sections, not the course's:
 * a co-teacher's record says nothing about the other. The letter counts pool
 * across their sections (edge smart-filters join.ts sumCounts semantics), so
 * a large section counts for more than a small one.
 */
export function instructorMeanHundredths(history: CourseHistory, instructorId: string): number | null {
  const graded = history.terms
    .flatMap((term) => term.sections)
    .filter((past) => past.instructor.id === instructorId && aThroughF(past.grades) > 0);
  if (graded.length < MIN_GRADED_SECTIONS) return null;
  // The raw letter counts pool across sections (edge join.ts sumCounts
  // semantics) and the mean rounds once at the end: rounding each section's
  // own GPA to hundredths first would fold every section's rounding error
  // into the pooled mean.
  let points = 0;
  let students = 0;
  for (const past of graded) {
    points += 4 * past.grades.gradeA + 3 * past.grades.gradeB + 2 * past.grades.gradeC + past.grades.gradeD;
    students += aThroughF(past.grades);
  }
  if (students === 0) return null;
  return Math.round((points / students) * 100);
}

/**
 * The option's accepted evidence: known only when the raw instructor field
 * matches one grade-history identity confidently and that instructor's own
 * past sections clear `MIN_GRADED_SECTIONS`. Every other case is unknown,
 * and unknown evidence never satisfies a filter or a tie-break.
 */
export function instructorEvidence(section: Pick<Section, "instructor">, history: CourseHistory | null): InstructorEvidence {
  if (history === null) return { kind: "unknown" };
  const candidates = historyCandidates(history);
  if (candidates.length === 0) return { kind: "unknown" };
  const match = matchInstructor(section.instructor.raw, candidates);
  if (match.candidateId === null) return { kind: "unknown" };
  const mean = instructorMeanHundredths(history, match.candidateId);
  if (mean === null) return { kind: "unknown" };
  return { kind: "known", meanGradePointsHundredths: mean };
}

/**
 * One course's options mapped to their accepted evidence in hundredths (null
 * when unknown), from one history result: the record the shared
 * grades-history service returned for this course. A result that is not ok
 * carries no history, so every option is unknown — a throttle never reads as
 * weak grades.
 */
export function courseEvidenceHundredths(
  sections: readonly Pick<Section, "id" | "instructor">[],
  result: HistoryResult<CourseHistory>,
): Record<string, number | null> {
  const history = result.status === "ok" ? result.data : null;
  return Object.fromEntries(sections.map((section) => {
    const evidence = instructorEvidence(section, history);
    return [section.id, evidence.kind === "known" ? evidence.meanGradePointsHundredths : null];
  }));
}
