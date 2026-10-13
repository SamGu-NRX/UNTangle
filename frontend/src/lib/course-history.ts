/**
 * Grade history for the course detail panel.
 *
 * The wire shape is `HistoryResult<CourseHistory>`, copied from
 * `lib/grades-history/types.ts` on untangle/grades-v1 (PR #30, the untgrades.app
 * adapter). Until that branch merges, `app/courses/[subject]/[number]/history`
 * serves the same shape from today's backend (`lib/backend-api.ts`), so moving
 * to the adapter is a URL change in `gradeHistorySources`, not a new mapper.
 * At integration, replace the copied types below with an import.
 */
import type { GradeData } from "@/lib/grades";

// ---- copied from untangle/grades-v1 lib/grades-history/types.ts ----
export type GradeCounts = Record<string, number>;
export type CourseIdentity = { subject: string; number: string; title: string };
export type InstructorIdentity = { id: string; firstName: string; lastName: string; name: string };
export type GradeTotals = { counts: GradeCounts; total: number; grades: GradeData };
export type HistorySection = GradeTotals & { sectionNumber: string; instructor: InstructorIdentity };
export type HistoryTerm = GradeTotals & { year: string; term: string; sections: HistorySection[] };
export type CourseHistory = GradeTotals & {
  course: CourseIdentity;
  terms: HistoryTerm[];
  sectionCount: number;
  gpa: number | null;
};
export type UnavailableReason = "throttled" | "upstream" | "malformed" | "storage" | "invalid-request";
/** `source` is widened from the literal "untgrades.app" so the backend route can name itself. */
export type HistoryResult<T> =
  | { status: "ok"; source: string; data: T }
  | { status: "no-history"; source: string; data: null }
  | {
      status: "unavailable";
      source: string;
      data: null;
      error: { reason: UnavailableReason; message: string; retryAfterSeconds?: number };
    };
// ---- end copy ----

/** What the panel draws: one slice for everyone, one per instructor. */
export type GradeSlice = {
  grades: GradeData;
  total: number;
  gpa: number | null;
  sectionCount: number;
};
export type InstructorSlice = GradeSlice & { instructor: InstructorIdentity };
export type CourseGradeView =
  | {
      status: "ok";
      source: string;
      sourceUrl: string | null;
      terms: string[];
      overall: GradeSlice;
      instructors: InstructorSlice[];
    }
  | { status: "no-history"; source: string; sourceUrl: string | null }
  | { status: "unavailable"; source: string; sourceUrl: string | null; message: string };

export interface GradeHistorySource {
  /** Never rejects for a backend or network failure; that is `status: "unavailable"`. */
  loadCourse(subject: string, number: string, signal?: AbortSignal): Promise<CourseGradeView>;
}

const knownSourceUrls: Record<string, string> = {
  "untgrades.app": "https://www.untgrades.app/",
};

const emptyGrades = (): GradeData => ({
  gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0, gradeP: 0, gradeNP: 0, gradeW: 0,
  gradeWF: 0, gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: 0,
});

function addGrades(into: GradeData, from: GradeData) {
  for (const key of Object.keys(into) as Array<keyof GradeData>) into[key] += from[key] ?? 0;
}

const seasons = ["spring", "summer", "fall", "winter"];
const seasonRank = (term: string) => {
  const index = seasons.findIndex((season) => term.toLowerCase().includes(season));
  return index === -1 ? seasons.length : index;
};

/** UNT's 4-point scale over letter grades only; null when no letter grades exist. */
export function gpaFromGrades(grades: GradeData): number | null {
  const graded = grades.gradeA + grades.gradeB + grades.gradeC + grades.gradeD + grades.gradeF;
  if (graded === 0) return null;
  const points = 4 * grades.gradeA + 3 * grades.gradeB + 2 * grades.gradeC + grades.gradeD;
  return Math.round((points / graded) * 100) / 100;
}

export function toCourseGradeView(result: HistoryResult<CourseHistory>): CourseGradeView {
  const sourceUrl = knownSourceUrls[result.source] ?? null;
  if (result.status === "unavailable") {
    return { status: "unavailable", source: result.source, sourceUrl, message: result.error.message };
  }
  if (result.status === "no-history" || result.data.total === 0) {
    return { status: "no-history", source: result.source, sourceUrl };
  }
  const history = result.data;
  const byInstructor = new Map<string, InstructorSlice>();
  for (const term of history.terms) {
    for (const section of term.sections) {
      const slice = byInstructor.get(section.instructor.id) ?? {
        instructor: section.instructor,
        grades: emptyGrades(),
        total: 0,
        gpa: null,
        sectionCount: 0,
      };
      addGrades(slice.grades, section.grades);
      slice.total += section.total;
      slice.sectionCount += 1;
      byInstructor.set(section.instructor.id, slice);
    }
  }
  const instructors = [...byInstructor.values()]
    .map((slice) => ({ ...slice, gpa: gpaFromGrades(slice.grades) }))
    .sort((a, b) => b.total - a.total || a.instructor.name.localeCompare(b.instructor.name));
  return {
    status: "ok",
    source: result.source,
    sourceUrl,
    terms: [...history.terms]
      .sort((a, b) => a.year.localeCompare(b.year) || seasonRank(a.term) - seasonRank(b.term))
      .map((term) => `${term.term} ${term.year}`.trim()),
    overall: {
      grades: history.grades,
      total: history.total,
      gpa: history.gpa ?? gpaFromGrades(history.grades),
      sectionCount: history.sectionCount,
    },
    instructors,
  };
}

/** Same-origin JSON endpoint returning `HistoryResult<CourseHistory>`. */
export function httpGradeHistorySource(
  path: (subject: string, number: string) => string,
  sourceName: string,
): GradeHistorySource {
  return {
    async loadCourse(subject, number, signal) {
      try {
        const response = await fetch(path(subject, number), { signal, headers: { accept: "application/json" } });
        if (!response.ok) {
          return { status: "unavailable", source: sourceName, sourceUrl: knownSourceUrls[sourceName] ?? null, message: `Grade history responded ${response.status}.` };
        }
        return toCourseGradeView((await response.json()) as HistoryResult<CourseHistory>);
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: "unavailable", source: sourceName, sourceUrl: knownSourceUrls[sourceName] ?? null, message: "Grade history could not be reached." };
      }
    },
  };
}

const segment = encodeURIComponent;

export const gradeHistorySources = {
  /** Today: the route in app/courses/[subject]/[number]/history over lib/backend-api. */
  backend: httpGradeHistorySource((s, n) => `/courses/${segment(s)}/${segment(n)}/history`, "UNTangle backend"),
  /** PR #30's adapter routes; switch to this at integration. */
  untgrades: httpGradeHistorySource((s, n) => `/api/grades/courses/${segment(s)}/${segment(n)}`, "untgrades.app"),
};
