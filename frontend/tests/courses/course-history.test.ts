import { afterEach, describe, expect, test } from "bun:test";
import {
  gpaFromGrades,
  httpGradeHistorySource,
  toCourseGradeView,
  type CourseHistory,
  type HistoryResult,
  type HistorySection,
} from "@/lib/course-history";
import { historyFromBackendDetail } from "@/lib/course-history-backend";
import type { CourseGradeDetail, GradeInstructor } from "@/lib/backend-api";
import type { GradeData } from "@/lib/grades";

const grades = (a: number, b: number, c: number, d = 0, f = 0, w = 0): GradeData => ({
  gradeA: a, gradeB: b, gradeC: c, gradeD: d, gradeF: f, gradeP: 0, gradeNP: 0, gradeW: w, gradeWF: 0,
  gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: a + b + c + d + f + w,
});
const section = (number: string, first: string, last: string, data: GradeData): HistorySection => ({
  sectionNumber: number,
  instructor: { id: `${last},${first}`, firstName: first, lastName: last, name: `${first} ${last}` },
  counts: {},
  total: data.totalEnroll,
  grades: data,
});

const history: CourseHistory = {
  course: { subject: "CSCE", number: "1030", title: "Computer Science I" },
  terms: [
    { term: "Fall", year: "2024", counts: {}, total: 0, grades: grades(0, 0, 0), sections: [section("001", "Beilei", "Jiang", grades(10, 5, 5))] },
    { term: "Spring", year: "2024", counts: {}, total: 0, grades: grades(0, 0, 0), sections: [section("002", "Beilei", "Jiang", grades(10, 0, 0)), section("003", "Haili", "Wang", grades(2, 2, 2, 2, 2))] },
  ],
  sectionCount: 3,
  gpa: 3.2,
  counts: {},
  total: 40,
  grades: grades(22, 7, 7, 2, 2),
};

describe("toCourseGradeView", () => {
  test("sums each instructor's sections and keeps the course-level figures", () => {
    const view = toCourseGradeView({ status: "ok", source: "untgrades.app", data: history });
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.sourceUrl).toBe("https://www.untgrades.app/");
    expect(view.terms).toEqual(["Spring 2024", "Fall 2024"]);
    expect(view.overall).toMatchObject({ total: 40, gpa: 3.2, sectionCount: 3 });
    expect(view.instructors.map((slice) => [slice.instructor.name, slice.total, slice.sectionCount, slice.gpa])).toEqual([
      ["Beilei Jiang", 30, 2, 3.5],
      ["Haili Wang", 10, 1, 2],
    ]);
  });

  test("no-history and empty totals both read as no history; unavailable keeps its message", () => {
    expect(toCourseGradeView({ status: "no-history", source: "untgrades.app", data: null }).status).toBe("no-history");
    expect(toCourseGradeView({ status: "ok", source: "untgrades.app", data: { ...history, total: 0 } }).status).toBe("no-history");
    const down: HistoryResult<CourseHistory> = { status: "unavailable", source: "untgrades.app", data: null, error: { reason: "throttled", message: "Slow down." } };
    expect(toCourseGradeView(down)).toEqual({ status: "unavailable", source: "untgrades.app", sourceUrl: "https://www.untgrades.app/", message: "Slow down." });
  });

  test("GPA uses letter grades only", () => {
    expect(gpaFromGrades(grades(1, 1, 0, 0, 0, 5))).toBe(3.5);
    expect(gpaFromGrades(grades(0, 0, 0, 0, 0, 3))).toBeNull();
  });
});

describe("backend route mapping", () => {
  const instructor = (id: number, name: string): GradeInstructor => ({
    id, name, firstName: name.split(" ")[0], lastName: name.split(" ")[1], rmpDepartment: null, rmpDifficulty: null,
    rmpNumRatings: null, rmpProfileUrl: null, rmpRating: null, rmpSource: null, rmpTags: [], rmpUpdatedAt: null, rmpWouldTakeAgain: null,
  });

  test("a backend that did not answer is unavailable, not empty", () => {
    expect(historyFromBackendDetail(null)).toMatchObject({ status: "unavailable", error: { reason: "upstream" } });
  });

  test("sections group into terms in the adapter's shape", () => {
    const detail: CourseGradeDetail = {
      aggregate: { gpa: 3, grades: grades(3, 1, 0) },
      course: { credits: 3, description: null, id: 1, number: "1030", subject: "CSCE", title: "Computer Science I" },
      instructors: [],
      sections: [
        { course: { id: 1, number: "1030", subject: "CSCE", title: "" }, gpa: 3, grades: grades(2, 1, 0), id: 1, instructor: instructor(7, "Beilei Jiang"), otherGrades: {}, sectionNumber: "001", term: "Fall 2023", title: "" },
        { course: { id: 1, number: "1030", subject: "CSCE", title: "" }, gpa: 4, grades: grades(1, 0, 0), id: 2, instructor: instructor(8, "Haili Wang"), otherGrades: {}, sectionNumber: "002", term: "Fall 2023", title: "" },
      ],
      terms: ["Fall 2023"],
    };
    const result = historyFromBackendDetail(detail);
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.data.terms).toHaveLength(1);
    expect(result.data.terms[0]).toMatchObject({ term: "Fall", year: "2023", total: 4 });
    const view = toCourseGradeView(result);
    expect(view.status === "ok" && view.instructors.map((slice) => slice.instructor.id)).toEqual(["7", "8"]);
    expect(view.sourceUrl).toBeNull();
  });
});

describe("httpGradeHistorySource", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("an error status or a network failure becomes unavailable", async () => {
    const source = httpGradeHistorySource((s, n) => `/x/${s}/${n}`, "untgrades.app");
    globalThis.fetch = (async () => new Response("nope", { status: 502 })) as unknown as typeof fetch;
    expect((await source.loadCourse("CSCE", "1030")).status).toBe("unavailable");
    globalThis.fetch = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect((await source.loadCourse("CSCE", "1030")).status).toBe("unavailable");
  });

  test("requests the encoded course path", async () => {
    let requested = "";
    const source = httpGradeHistorySource((s, n) => `/api/grades/courses/${s}/${n}`, "untgrades.app");
    globalThis.fetch = (async (url: string) => {
      requested = url;
      return Response.json({ status: "no-history", source: "untgrades.app", data: null });
    }) as unknown as typeof fetch;
    expect((await source.loadCourse("CSCE", "1030")).status).toBe("no-history");
    expect(requested).toBe("/api/grades/courses/CSCE/1030");
  });
});
