import type { CourseGradeDetail } from "@/lib/backend-api";
import { courses as bundledCourses } from "@/lib/seed-data";
import type { Course } from "@/lib/types";

/**
 * Presenter for the course detail view.
 *
 * Keeps three data layers visibly separate:
 * - catalog facts (bundled `Course` rows — always available),
 * - grade records (backend grade service — may be unreachable),
 * - external instructor ratings (RateMyProfessors, attributed per instructor).
 *
 * Prerequisite codes the catalog cannot resolve are surfaced as unresolved
 * guidance (`resolved: false`, `title: null`) — never as links, never
 * fabricated into courses.
 */

export type PrerequisiteRef = {
  code: string;
  /** True when the prerequisite code matches a catalog row. */
  resolved: boolean;
  /** Catalog title when resolved, null when the code is unresolvable. */
  title: string | null;
};

export type CourseDetailModel = {
  /** "catalog-only" when the grade service responded with nothing. */
  availability: "full" | "catalog-only";
  catalog: {
    code: string;
    title: string;
    department: string;
    creditHours: number;
    description: string;
    prerequisites: PrerequisiteRef[];
  };
  grades:
    | { availability: "unavailable" }
    | {
        availability: "available";
        gpa: number | null;
        sectionCount: number;
        totalEnroll: number | null;
        terms: string[];
      };
  ratings: {
    /** Ratings come from RateMyProfessors via the grade service — external data. */
    source: "external";
    availability: "available" | "unavailable";
    instructors: Array<{
      id: number;
      name: string;
      gpa: number | null;
      rmpRating: number | null;
      rmpDifficulty: number | null;
      rmpNumRatings: number | null;
      rmpProfileUrl: string | null;
      rmpTags: Array<{ tagCount: number; tagName: string }>;
      rmpUpdatedAt: string | null;
      rmpWouldTakeAgain: number | null;
      sectionCount: number;
      totalEnroll: number;
    }>;
  };
};

function buildCatalogIndex(catalog: Course[]): Map<string, Course> {
  return new Map(catalog.map((course) => [course.code, course]));
}

export function buildCourseDetailModel({
  catalogCourse,
  gradeDetail,
  catalog = bundledCourses,
}: {
  catalogCourse: Course;
  gradeDetail: CourseGradeDetail | null;
  catalog?: Course[];
}): CourseDetailModel {
  const index = buildCatalogIndex(catalog);
  const prerequisites: PrerequisiteRef[] = catalogCourse.prerequisites.map((code) => {
    const prerequisite = index.get(code);
    return {
      code,
      resolved: Boolean(prerequisite),
      title: prerequisite ? prerequisite.title : null,
    };
  });

  const instructors = gradeDetail
    ? gradeDetail.instructors.map((instructor) => ({
        id: instructor.id,
        name: instructor.name,
        gpa: instructor.gpa,
        rmpRating: instructor.rmpRating,
        rmpDifficulty: instructor.rmpDifficulty,
        rmpNumRatings: instructor.rmpNumRatings,
        rmpProfileUrl: instructor.rmpProfileUrl,
        rmpTags: instructor.rmpTags ?? [],
        rmpUpdatedAt: instructor.rmpUpdatedAt,
        rmpWouldTakeAgain: instructor.rmpWouldTakeAgain,
        sectionCount: instructor.sectionCount,
        totalEnroll: instructor.totalEnroll,
      }))
    : [];

  return {
    availability: gradeDetail ? "full" : "catalog-only",
    catalog: {
      code: catalogCourse.code,
      title: catalogCourse.title,
      department: catalogCourse.department,
      creditHours: catalogCourse.creditHours,
      description: catalogCourse.description,
      prerequisites,
    },
    grades: gradeDetail
      ? {
          availability: "available",
          gpa: gradeDetail.aggregate.gpa,
          sectionCount: gradeDetail.sections.length,
          totalEnroll: gradeDetail.aggregate.grades.totalEnroll,
          terms: gradeDetail.terms,
        }
      : { availability: "unavailable" },
    ratings: {
      source: "external",
      availability: gradeDetail ? "available" : "unavailable",
      instructors,
    },
  };
}
