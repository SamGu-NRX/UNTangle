import { describe, expect, test } from "bun:test";
import type { CourseGradeDetail } from "@/lib/backend-api";
import { buildCourseDetailModel } from "@/lib/course-detail";
import { resolveCourseLocator } from "@/lib/course-catalog";
import { courses } from "@/lib/seed-data";
import type { Course } from "@/lib/types";
import type { GradeData } from "@/lib/grades";

/**
 * Milestone 1 witnesses — course journey, deep links + catalog fields.
 *
 * These pin the contract the course/detail route must satisfy before the
 * journey is usable at real catalog size (656 courses):
 *
 * 1. Broken catalog deep links: an unknown or removed course code must be
 *    classified against the bundled catalog (the authority) and render an
 *    explicit not-found state — never a fabricated course, never a bare 404
 *    with no way back.
 * 2. Missing catalog fields: the detail view must show the catalog's own
 *    description, credit hours, and prerequisites, kept visibly separate
 *    from grade records and external instructor ratings.
 */

const csce3444 = courses.find((course) => course.code === "CSCE 3444") as Course;
const biol2302 = courses.find((course) => course.code === "BIOL 2302") as Course;

const fixtureGrades: GradeData = {
  gradeA: 120,
  gradeB: 90,
  gradeC: 40,
  gradeD: 12,
  gradeF: 8,
  gradeP: 2,
  gradeNP: 1,
  gradeW: 6,
  gradeWF: 2,
  gradeI: 0,
  gradePR: 0,
  gradeNPR: 0,
  gradeZ: 0,
  gradeSuppressed: 3,
  totalEnroll: 284,
};

/** Fake instructor-rating response shaped like the backend's course payload. */
function fixtureGradeDetail(overrides: Partial<CourseGradeDetail> = {}): CourseGradeDetail {
  return {
    aggregate: { gpa: 2.98, grades: fixtureGrades },
    course: {
      id: 1,
      subject: "CSCE",
      number: "3444",
      title: "Software Engineering",
      credits: 3,
      description: "Backend copy of the description.",
    },
    instructors: [
      {
        id: 7,
        firstName: "Alex",
        lastName: "Roe",
        name: "Alex Roe",
        rmpDepartment: "Computer Science and Engineering",
        rmpDifficulty: 3.1,
        rmpNumRatings: 55,
        rmpProfileUrl: "https://www.ratemyprofessors.com/example",
        rmpRating: 4.2,
        rmpSource: "rmp",
        rmpTags: [{ tagCount: 4, tagName: "tough grader" }],
        rmpUpdatedAt: "2026-01-01",
        rmpWouldTakeAgain: 78,
        gpa: 3.02,
        sectionCount: 5,
        totalEnroll: 284,
      },
    ],
    sections: [
      {
        id: 11,
        course: { id: 1, subject: "CSCE", number: "3444", title: "Software Engineering" },
        gpa: 3.1,
        grades: fixtureGrades,
        otherGrades: {},
        instructor: {
          id: 7,
          firstName: "Alex",
          lastName: "Roe",
          name: "Alex Roe",
          rmpDepartment: null,
          rmpDifficulty: null,
          rmpNumRatings: null,
          rmpProfileUrl: null,
          rmpRating: 4.2,
          rmpSource: "rmp",
          rmpTags: [],
          rmpUpdatedAt: null,
          rmpWouldTakeAgain: null,
        },
        sectionNumber: "001",
        term: "2024 Fall",
        title: "Software Engineering",
      },
    ],
    terms: ["2024 Fall", "2024 Spring"],
    ...overrides,
  } as unknown as CourseGradeDetail;
}

describe("course deep links (witness)", () => {
  test("normalizes a subject/number deep link to the catalog code", () => {
    const locator = resolveCourseLocator("csce", "3444");
    expect(locator.kind).toBe("found");
    if (locator.kind === "found") {
      expect(locator.course.code).toBe("CSCE 3444");
    }
  });

  test("classifies an unknown course code as unresolved, never a fabricated course", () => {
    const locator = resolveCourseLocator("CSCE", "9999");
    expect(locator.kind).toBe("unknown-code");
    if (locator.kind === "unknown-code") {
      expect(locator.code).toBe("CSCE 9999");
    }
  });

  test("round-trips every catalog course deep link back to its catalog entry", () => {
    for (const course of courses) {
      const [subject, number] = course.code.split(/\s+/);
      const locator = resolveCourseLocator(subject, number);
      expect(locator.kind).toBe("found");
      if (locator.kind === "found") {
        expect(locator.course.code).toBe(course.code);
      }
    }
  });
});

describe("course detail catalog fields (witness)", () => {
  test("keeps catalog fields present when the grade service is unreachable", () => {
    const model = buildCourseDetailModel({ catalogCourse: csce3444, gradeDetail: null });
    expect(model.availability).toBe("catalog-only");
    expect(model.catalog.title).toBe("Software Engineering");
    expect(model.catalog.creditHours).toBe(3);
    expect(model.catalog.description.length).toBeGreaterThan(0);
    expect(model.grades.availability).toBe("unavailable");
    expect(model.ratings.availability).toBe("unavailable");
  });

  test("separates catalog facts from grade records and external ratings", () => {
    const model = buildCourseDetailModel({
      catalogCourse: csce3444,
      gradeDetail: fixtureGradeDetail(),
    });
    // Catalog facts survive a grade-service response untouched.
    expect(model.catalog.title).toBe(csce3444.title);
    expect(model.catalog.creditHours).toBe(3);
    // Grade data is attributed to the records service, not the catalog.
    expect(model.grades.availability).toBe("available");
    // External instructor ratings are labeled as external.
    expect(model.ratings.source).toBe("external");
  });

  test("carries the full external-rating payload an instructor cache holds", () => {
    const model = buildCourseDetailModel({
      catalogCourse: csce3444,
      gradeDetail: fixtureGradeDetail(),
    });
    const [instructor] = model.ratings.instructors;
    expect(instructor.rmpDifficulty).toBe(3.1);
    expect(instructor.rmpNumRatings).toBe(55);
    expect(instructor.rmpWouldTakeAgain).toBe(78);
    expect(instructor.rmpTags).toEqual([{ tagCount: 4, tagName: "tough grader" }]);
    expect(instructor.rmpUpdatedAt).toBe("2026-01-01");
    expect(instructor.rmpProfileUrl).toBe("https://www.ratemyprofessors.com/example");
  });

  test("survives instructors whose tag list is absent from the grade payload", () => {
    const fixture = fixtureGradeDetail();
    // The grades route can omit the tags array entirely for cache misses.
    const [instructor] = fixture.instructors;
    instructor.rmpTags = undefined as unknown as Array<{ tagCount: number; tagName: string }>;
    const model = buildCourseDetailModel({
      catalogCourse: csce3444,
      gradeDetail: fixture,
    });
    expect(model.ratings.instructors[0].rmpTags).toEqual([]);
  });

  test("marks unresolvable prerequisites as unresolved guidance, not links", () => {
    // BIOL 2302 declares prerequisites BIOL 2311/2312 that no catalog row satisfies.
    const model = buildCourseDetailModel({ catalogCourse: biol2302, gradeDetail: null });
    const unresolved = model.catalog.prerequisites.filter((p) => !p.resolved);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((p) => p.title === null)).toBe(true);
  });
});
