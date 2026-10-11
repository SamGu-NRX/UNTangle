import { describe, expect, test } from "bun:test";
import { buildCourseDetailModel } from "@/lib/course-detail";
import {
  courseDetailsHref,
  normalizeCourseCode,
  resolveCourseLocator,
} from "@/lib/course-catalog";
import { courses, prerequisiteEdges, sections } from "@/lib/seed-data";

/**
 * Route-level checks for the course journey (milestone 2):
 * deep-link resolution against the bundled catalog, plus catalog-reference
 * checks that keep every rendered link and field backed by a real catalog row.
 */

describe("deep-link resolution", () => {
  test("normalizes case and stray whitespace in URL params", () => {
    expect(normalizeCourseCode(" csce ", " 3444 ")).toBe("CSCE 3444");
    expect(normalizeCourseCode("biol", "2302")).toBe("BIOL 2302");
  });

  test("resolves lowercase deep links to the catalog entry", () => {
    const locator = resolveCourseLocator("csce", "3444");
    expect(locator.kind).toBe("found");
  });

  test("classifies unknown and removed codes as unknown-code", () => {
    expect(resolveCourseLocator("CSCE", "9999").kind).toBe("unknown-code");
    expect(resolveCourseLocator("NOTA", "0000").kind).toBe("unknown-code");
  });

  test("round-trips every catalog course deep link", () => {
    for (const course of courses) {
      const [subject, number] = course.code.split(/\s+/);
      const locator = resolveCourseLocator(subject, number, courses);
      expect(locator.kind).toBe("found");
      if (locator.kind === "found") {
        expect(locator.course.code).toBe(course.code);
      }
    }
  });

  test("builds stable detail hrefs from catalog codes", () => {
    expect(courseDetailsHref("CSCE 3444")).toBe("/courses/CSCE/3444");
    expect(courseDetailsHref("BIOL 2302")).toBe("/courses/BIOL/2302");
  });
});

describe("catalog reference checks", () => {
  test("every catalog code is DEPT NNNN so deep links stay parseable", () => {
    const malformed = courses.filter((course) => !/^[A-Z]{2,5} \d{4}$/.test(course.code));
    expect(malformed.map((course) => course.code)).toEqual([]);
  });

  test("every bundled section references a catalog course", () => {
    const codes = new Set(courses.map((course) => course.code));
    const dangling = sections.filter((section) => !codes.has(section.courseCode));
    expect(dangling.map((section) => section.id)).toEqual([]);
  });

  test("every prerequisite edge renders resolved or as explicit unresolved guidance", () => {
    const codes = new Set(courses.map((course) => course.code));
    // Edges the catalog itself cannot resolve must never be presented as links.
    for (const course of courses) {
      const model = buildCourseDetailModel({ catalogCourse: course, gradeDetail: null });
      for (const prerequisite of model.catalog.prerequisites) {
        expect(prerequisite.resolved).toBe(codes.has(prerequisite.code));
        if (!prerequisite.resolved) {
          expect(prerequisite.title).toBeNull();
        }
      }
    }
  });

  test("prerequisiteEdges stay consistent with course.prerequisites", () => {
    const edges = new Set(
      prerequisiteEdges.map((edge) => `${edge.courseCode}|${edge.prerequisiteCode}`),
    );
    for (const course of courses) {
      for (const prerequisiteCode of course.prerequisites) {
        expect(edges.has(`${course.code}|${prerequisiteCode}`)).toBe(true);
      }
    }
  });
});

describe("detail model availability states", () => {
  const course = courses.find((c) => c.code === "CSCE 3444")!;

  test("catalog-only when the grade service is unreachable", () => {
    const model = buildCourseDetailModel({ catalogCourse: course, gradeDetail: null });
    expect(model.availability).toBe("catalog-only");
    expect(model.grades.availability).toBe("unavailable");
    expect(model.ratings.availability).toBe("unavailable");
  });

  test("does not fabricate a credit-hour value for a zero-credit catalog row", () => {
    // MEEN 4920 ships with creditHours: 0 in the generated catalog.
    const meen = courses.find((c) => c.code === "MEEN 4920")!;
    const model = buildCourseDetailModel({ catalogCourse: meen, gradeDetail: null });
    expect(model.catalog.creditHours).toBe(meen.creditHours);
  });
});
