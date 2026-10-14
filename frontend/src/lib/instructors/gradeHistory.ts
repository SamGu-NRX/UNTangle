/**
 * The minimal join from grade history to the optimizer's instructor
 * evidence: the mean grade points (0 to 4) of a section instructor's past
 * students in this course, or null when the evidence is too thin to say.
 * Pure and network-free: type-only imports, no fetching. The planner seam
 * that supplies `courseHistories` per section (the smart-filters join)
 * lands separately; nothing in production calls this yet.
 */

import { matchInstructor, type Candidate } from "./match";
import type { CourseHistory } from "@/lib/grades-history/types";
import type { GradeData } from "@/lib/grades";

/**
 * Mirrors MIN_GRADED_SECTIONS in lib/reasons/scheduleReasons.ts; the two
 * must stay in step. A starting value with no evidence behind it: below
 * this many past sections graded A through F, a mean says more about
 * sample noise than about the instructor.
 */
const MIN_GRADED_SECTIONS = 3;

const aThroughF = (g: GradeData) => g.gradeA + g.gradeB + g.gradeC + g.gradeD + g.gradeF;

/**
 * The matched instructor's mean grade points in this course, or null. Null
 * on an abstain (no candidates, or an ambiguous field), when no history
 * belongs to the matched instructor, when that history reports no gpa, or
 * when fewer than MIN_GRADED_SECTIONS past sections carry A through F
 * grades. A null return means "no confident evidence", never a bad
 * instructor: the optimizer treats it as neutral, not as a penalty.
 */
export function instructorGpaFor(sectionInstructor: string, courseHistories: readonly CourseHistory[]): number | null {
  // The histories carry instructor identities on their sections, so the
  // candidates are the distinct identities they mention, deduped by id.
  const identities = new Map<string, Candidate>();
  for (const history of courseHistories) {
    for (const identity of history.terms.flatMap((term) => term.sections).map((past) => past.instructor)) {
      if (!identities.has(identity.id)) {
        identities.set(identity.id, { id: identity.id, name: identity.name, firstName: identity.firstName, lastName: identity.lastName });
      }
    }
  }
  const match = matchInstructor(sectionInstructor, [...identities.values()]);
  if (match.candidateId === null) return null;
  // A history belongs to the matched instructor when all of its sections
  // carry that identity. A record pooling several instructors' sections
  // cannot attribute its gpa to one of them, so it is no evidence at all.
  const history = courseHistories.find(
    (entry) =>
      entry.terms.length > 0 &&
      entry.terms.every((term) => term.sections.every((past) => past.instructor.id === match.candidateId)),
  );
  if (!history || history.gpa === null) return null;
  const graded = history.terms
    .flatMap((term) => term.sections)
    .filter((past) => aThroughF(past.grades) > 0).length;
  if (graded < MIN_GRADED_SECTIONS) return null;
  return history.gpa;
}
