import type { CourseGradeDetail, GradeInstructor } from "@/lib/backend-api";
import type { GradeData } from "@/lib/grades";
import type { CourseHistory, GradeCounts, HistoryResult, HistoryTerm, InstructorIdentity } from "@/lib/course-history";

export const BACKEND_SOURCE = "UNTangle backend";

function counts(grades: GradeData): GradeCounts {
  return {
    A: grades.gradeA, B: grades.gradeB, C: grades.gradeC, D: grades.gradeD, F: grades.gradeF,
    P: grades.gradeP, NP: grades.gradeNP, W: grades.gradeW, WF: grades.gradeWF, I: grades.gradeI,
    PR: grades.gradePR, NPR: grades.gradeNPR, Z: grades.gradeZ, Hidden: grades.gradeSuppressed,
  };
}

function identity(instructor: GradeInstructor): InstructorIdentity {
  return {
    id: String(instructor.id),
    firstName: instructor.firstName ?? "",
    lastName: instructor.lastName ?? "",
    name: instructor.name,
  };
}

function splitTerm(label: string): { term: string; year: string } {
  const match = label.trim().match(/^(.*?)\s*(\d{4})$/);
  return match ? { term: match[1], year: match[2] } : { term: label.trim(), year: "" };
}

/**
 * `getCourseGradeDetail` returns null both when the backend is down and when it
 * has no such course, and it does not say which. Null is therefore reported as
 * unavailable rather than guessed to be "no history".
 */
export function historyFromBackendDetail(detail: CourseGradeDetail | null): HistoryResult<CourseHistory> {
  if (!detail) {
    return {
      status: "unavailable",
      source: BACKEND_SOURCE,
      data: null,
      error: { reason: "upstream", message: "The grade backend did not answer." },
    };
  }
  if (detail.sections.length === 0 || detail.aggregate.grades.totalEnroll === 0) {
    return { status: "no-history", source: BACKEND_SOURCE, data: null };
  }
  const terms = new Map<string, HistoryTerm>();
  for (const section of detail.sections) {
    const { term, year } = splitTerm(section.term);
    const key = `${term} ${year}`;
    const entry = terms.get(key) ?? { term, year, sections: [], counts: {}, total: 0, grades: emptyGrades() };
    entry.sections.push({
      sectionNumber: section.sectionNumber,
      instructor: identity(section.instructor),
      counts: counts(section.grades),
      total: section.grades.totalEnroll,
      grades: section.grades,
    });
    entry.total += section.grades.totalEnroll;
    for (const key of Object.keys(entry.grades) as Array<keyof GradeData>) entry.grades[key] += section.grades[key];
    terms.set(key, entry);
  }
  return {
    status: "ok",
    source: BACKEND_SOURCE,
    data: {
      course: { subject: detail.course.subject, number: detail.course.number, title: detail.course.title },
      terms: [...terms.values()].map((term) => ({ ...term, counts: counts(term.grades) })),
      sectionCount: detail.sections.length,
      gpa: detail.aggregate.gpa,
      counts: counts(detail.aggregate.grades),
      total: detail.aggregate.grades.totalEnroll,
      grades: detail.aggregate.grades,
    },
  };
}

function emptyGrades(): GradeData {
  return {
    gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0, gradeP: 0, gradeNP: 0, gradeW: 0,
    gradeWF: 0, gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: 0,
  };
}
