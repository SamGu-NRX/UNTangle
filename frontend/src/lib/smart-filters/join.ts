import { gradeGpa, sumCounts } from "@/lib/grades-history/normalize";
import type { CourseHistory, GradeCounts } from "@/lib/grades-history/types";
import { matchInstructor, type Candidate } from "@/lib/instructors/match";
import type { Section } from "@/lib/sections/model";
import type { SectionGradeFacts } from "./model";

/** A GPA or A/B-share figure needs at least this many graded sections for the instructor in the course. */
export const MIN_GRADED_SECTIONS = 3;

/** A history row is graded when at least one A-F enrollment is recorded; W, P and the rest do not count. */
function gradedEnrollments(counts: GradeCounts): number {
  return (counts.A ?? 0) + (counts.B ?? 0) + (counts.C ?? 0) + (counts.D ?? 0) + (counts.F ?? 0);
}

/** The identities a course's history names, once each, as matcher candidates. */
export function candidatesFromHistory(history: CourseHistory): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const row of history.terms.flatMap((term) => term.sections)) {
    const identity = row.instructor;
    if (!byId.has(identity.id)) {
      byId.set(identity.id, { id: identity.id, name: identity.name, firstName: identity.firstName, lastName: identity.lastName });
    }
  }
  return [...byId.values()];
}

/**
 * Joins one section to its course's grade history through the abstain-first
 * matcher: the matched instructor's own sections within this course provide
 * every figure, so the result speaks only for the same instructor in the same
 * course. An abstention is a no-history state, never an inferred figure, and
 * figures wait for MIN_GRADED_SECTIONS graded sections.
 */
export function joinSectionToHistory(section: Pick<Section, "instructor">, history: CourseHistory | null): SectionGradeFacts {
  if (!history || history.sectionCount === 0) return { kind: "no-history", reason: "the course has no grade history" };
  const match = matchInstructor(section.instructor.display ?? section.instructor.raw, candidatesFromHistory(history));
  if (match.candidateId === null) return { kind: "no-history", reason: match.reason };
  const rows = history.terms.flatMap((term) => term.sections).filter((row) => row.instructor.id === match.candidateId);
  const graded = rows.filter((row) => gradedEnrollments(row.counts) > 0);
  const enrollments = graded.reduce((sum, row) => sum + gradedEnrollments(row.counts), 0);
  if (graded.length < MIN_GRADED_SECTIONS) {
    return { kind: "insufficient-data", instructorId: match.candidateId, gradedSections: graded.length, gradedEnrollments: enrollments };
  }
  const counts = sumCounts(graded.map((row) => row.counts));
  const avgGpa = gradeGpa(counts);
  // Graded rows exist here, so the aggregate carries A-F enrollments and the GPA is a number.
  if (avgGpa === null) {
    return { kind: "insufficient-data", instructorId: match.candidateId, gradedSections: graded.length, gradedEnrollments: enrollments };
  }
  return {
    kind: "matched",
    instructorId: match.candidateId,
    gradedSections: graded.length,
    gradedEnrollments: enrollments,
    avgGpa,
    abShare: (counts.A + counts.B) / enrollments,
  };
}
