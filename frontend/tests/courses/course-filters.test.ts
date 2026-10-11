import { describe, expect, test } from "bun:test";
import {
  activeFilterCount,
  applyCourseFilters,
  computeFacetCounts,
  courseFiltersToParams,
  COURSE_FILTER_DEFAULTS,
  courseMeetingDays,
  courseTimeWindows,
  gpaFor,
  parseCourseFilters,
  sampleRatingFor,
  type CourseFilterState,
} from "@/lib/course-filters";
import { courses, sections as bundledSections } from "@/lib/seed-data";

const NO_PLANNER = { courseStatuses: {}, isLocked: () => false };

function withFilters(patch: Partial<CourseFilterState>): CourseFilterState {
  return { ...COURSE_FILTER_DEFAULTS, ...patch };
}

describe("course filter URL round-trip", () => {
  test("serialize then parse preserves a fully-set state", () => {
    const state = withFilters({
      query: "linear algebra",
      departments: ["MATH", "CSCE"],
      levels: ["2000", "3000"],
      credits: ["3", "4"],
      days: ["Mon", "Wed"],
      timeWindows: ["morning"],
      gpaBand: "3.5",
      sampleRatingBand: "4.0",
      plannerStatus: "completed",
      sort: "gpa-desc",
    });
    const params = courseFiltersToParams(state);
    expect(parseCourseFilters(params)).toEqual(state);
  });

  test("defaults serialize to an empty shareable URL", () => {
    expect(courseFiltersToParams(COURSE_FILTER_DEFAULTS).toString()).toBe("");
    expect(parseCourseFilters(new URLSearchParams(""))).toEqual(COURSE_FILTER_DEFAULTS);
  });

  test("invalid values are dropped so shared URLs never crash", () => {
    const parsed = parseCourseFilters(
      new URLSearchParams(
        "level=9999&day=Sun&gpa=1.0&rating=9.9&status=dropped&sort=bogus&cr=9",
      ),
    );
    expect(parsed.levels).toEqual([]);
    expect(parsed.days).toEqual([]);
    expect(parsed.gpaBand).toBeNull();
    expect(parsed.sampleRatingBand).toBeNull();
    expect(parsed.plannerStatus).toBeNull();
    expect(parsed.sort).toBe("code");
    expect(parsed.credits).toEqual([]);
  });

  test("level=3000&gpa=3.5 deep link filters to 3000-level courses with GPA 3.5+", () => {
    const filters = parseCourseFilters(new URLSearchParams("level=3000&gpa=3.5"));
    const result = applyCourseFilters(courses, filters, NO_PLANNER);
    expect(result.length).toBeGreaterThan(0);
    for (const course of result) {
      expect(course.code.split(/\s+/)[1]?.startsWith("3")).toBe(true);
      expect(gpaFor(course.code)).toBeGreaterThanOrEqual(3.5);
    }
  });
});

describe("course filter application", () => {
  test("query matches code, title, and department", () => {
    const result = applyCourseFilters(courses, withFilters({ query: "CSCE 2100" }), NO_PLANNER);
    expect(result.some((c) => c.code === "CSCE 2100")).toBe(true);
    expect(result.every((c) => `${c.code} ${c.title} ${c.department}`.toLowerCase().includes("csce 2100"))).toBe(true);
  });

  test("credits and level compose", () => {
    const result = applyCourseFilters(
      courses,
      withFilters({ levels: ["2000"], credits: ["3"] }),
      NO_PLANNER,
    );
    for (const course of result) {
      expect(course.creditHours).toBe(3);
      expect(course.code.split(/\s+/)[1]?.startsWith("2")).toBe(true);
    }
  });

  test("prereq facet follows the planner lock policy", () => {
    const statuses: Record<string, string> = { "CSCE 2100": "completed" };
    const planner = {
      courseStatuses: statuses as never,
      isLocked: (code: string) => code !== "CSCE 2100",
    };
    const met = applyCourseFilters(courses, withFilters({ prereqs: "met" }), planner);
    expect(met).toHaveLength(1);
    expect(met[0]?.code).toBe("CSCE 2100");
    const outstanding = applyCourseFilters(courses, withFilters({ prereqs: "outstanding" }), planner);
    expect(outstanding.some((c) => c.code === "CSCE 2100")).toBe(false);
    expect(outstanding.length).toBe(courses.length - 1);
  });

  test("prereq facet round-trips through the URL", () => {
    const state = withFilters({ prereqs: "met" });
    expect(parseCourseFilters(courseFiltersToParams(state))).toEqual(state);
    expect(parseCourseFilters(new URLSearchParams("prereq=bogus")).prereqs).toBeNull();
  });

  test("prereq facet counts partition the catalog", () => {
    const counts = computeFacetCounts(courses, COURSE_FILTER_DEFAULTS, {
      courseStatuses: {},
      isLocked: (code) => code.startsWith("MATH"),
    });
    const sum = Object.values(counts.prereqs).reduce((a, b) => a + b, 0);
    expect(sum).toBe(courses.length);
  });

  test("planner status filter uses course statuses, defaulting to notTaken", () => {
    const statuses: Record<string, string> = { "CSCE 2100": "completed" };
    const result = applyCourseFilters(
      courses,
      withFilters({ plannerStatus: "completed" }),
      { courseStatuses: statuses as never, isLocked: () => false },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe("CSCE 2100");
  });

  test("day and time-window filters derive from bundled sample sections", () => {
    const course = courses.find((c) => (bundledSections.some((s) => s.courseCode === c.code)))!;
    const days = courseMeetingDays(course.code);
    expect(days.length).toBeGreaterThan(0);
    const windows = courseTimeWindows(course.code);
    for (const window of windows) {
      expect(["morning", "afternoon", "evening"]).toContain(window);
    }
    const dayResult = applyCourseFilters(courses, withFilters({ days: ["Mon"] }), NO_PLANNER);
    for (const c of dayResult) {
      expect(courseMeetingDays(c.code)).toContain("Mon");
    }
  });
});

describe("facet counts", () => {
  test("with no active filters every level facet shows full totals", () => {
    const counts = computeFacetCounts(courses, COURSE_FILTER_DEFAULTS, NO_PLANNER);
    const total2000 = courses.filter((c) => c.code.split(/\s+/)[1]?.startsWith("2")).length;
    expect(counts.levels["2000"]).toBe(total2000);
    const sum = Object.values(counts.levels).reduce((a, b) => a + b, 0);
    expect(sum).toBe(courses.length);
  });

  test("counts for non-active facets reflect the narrowed set", () => {
    const filters = withFilters({ levels: ["2000"] });
    const narrowed = applyCourseFilters(courses, filters, NO_PLANNER);
    const counts = computeFacetCounts(courses, filters, NO_PLANNER);
    const creditSum = Object.values(counts.credits).reduce((a, b) => a + b, 0);
    expect(creditSum).toBe(narrowed.length);
    // the active facet itself still shows totals for every level
    const baseline = computeFacetCounts(courses, COURSE_FILTER_DEFAULTS, NO_PLANNER);
    expect(counts.levels).toEqual(baseline.levels);
  });
});

describe("sorting", () => {
  test("gpa-desc orders by historical GPA with unknowns last", () => {
    const result = applyCourseFilters(courses, withFilters({ sort: "gpa-desc" }), NO_PLANNER);
    const gpas = result.map((c) => gpaFor(c.code));
    const known = gpas.filter((g) => g !== null) as number[];
    for (let i = 1; i < known.length; i += 1) {
      expect(known[i - 1]).toBeGreaterThanOrEqual(known[i]);
    }
    expect(gpas[gpas.length - 1]).toBeNull();
  });

  test("gpa-asc orders known GPAs upward with unknowns last", () => {
    const result = applyCourseFilters(courses, withFilters({ sort: "gpa-asc" }), NO_PLANNER);
    const gpas = result.map((c) => gpaFor(c.code));
    const knownCount = gpas.filter((g) => g !== null).length;
    expect(gpas.slice(knownCount).every((g) => g === null)).toBe(true);
    const known = gpas.slice(0, knownCount) as number[];
    for (let i = 1; i < known.length; i += 1) {
      expect(known[i - 1]).toBeLessThanOrEqual(known[i]);
    }
  });
});

describe("generated grade index", () => {
  test("CSCE 2100 pins the committed backend data", () => {
    expect(gpaFor("CSCE 2100")).toBe(2.14);
  });

  test("unknown courses return null for both facts", () => {
    expect(gpaFor("NOPE 9999")).toBeNull();
    expect(sampleRatingFor("NOPE 9999")).toBeNull();
  });

  test("sampleRatingFor is the mean of bundled section ratings", () => {
    const code = "CSCE 2100";
    const ratings = bundledSections
      .filter((s) => s.courseCode === code)
      .map((s) => s.rating)
      .filter((r) => Number.isFinite(r) && r > 0);
    if (ratings.length === 0) return; // sample data may omit ratings entirely
    const expected = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
    expect(sampleRatingFor(code)).toBe(expected);
  });
});

describe("active filter count", () => {
  test("counts each active dimension including sort", () => {
    expect(activeFilterCount(COURSE_FILTER_DEFAULTS)).toBe(0);
    expect(activeFilterCount(withFilters({ query: "x", levels: ["3000"], sort: "gpa-desc" }))).toBe(3);
    expect(activeFilterCount(withFilters({ gpaBand: "3.5" }))).toBe(1);
  });
});
