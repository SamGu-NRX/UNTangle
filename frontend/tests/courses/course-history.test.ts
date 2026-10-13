import { afterEach, describe, expect, test } from "bun:test";
import { gpaFromGrades, httpGradeHistorySource, toCourseGradeView } from "@/lib/course-history";
import { gradeBars } from "@/components/grade-chart-canvas";
import type { CourseHistory, HistoryResult, HistorySection } from "@/lib/grades-history/types";
import type { GradeData } from "@/lib/grades";

const gradesOf = (a: number, b: number, c: number, d = 0, f = 0, w = 0): GradeData => ({
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
    { term: "Fall", year: "2024", counts: {}, total: 0, grades: gradesOf(0, 0, 0), sections: [section("001", "Beilei", "Jiang", gradesOf(10, 5, 5))] },
    { term: "Spring", year: "2024", counts: {}, total: 0, grades: gradesOf(0, 0, 0), sections: [section("002", "Beilei", "Jiang", gradesOf(10, 0, 0)), section("003", "Haili", "Wang", gradesOf(2, 2, 2, 2, 2))] },
  ],
  sectionCount: 3,
  gpa: 3.2,
  counts: {},
  total: 40,
  grades: gradesOf(22, 7, 7, 2, 2),
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
    expect(gpaFromGrades(gradesOf(1, 1, 0, 0, 0, 5))).toBe(3.5);
    expect(gpaFromGrades(gradesOf(0, 0, 0, 0, 0, 3))).toBeNull();
  });
});

describe("grade bars", () => {
  test("shares are of every enrolled student, and grades outside A to W are counted", () => {
    const grades = { ...gradesOf(50, 30, 10, 0, 0, 10), gradeP: 100, totalEnroll: 200 };
    const { bars, total, otherCount } = gradeBars(grades);
    expect(total).toBe(200);
    expect(otherCount).toBe(100);
    expect(bars.map((bar) => [bar.grade, bar.percent])).toEqual([["A", 25], ["B", 15], ["C", 5], ["D", 0], ["F", 0], ["W", 5]]);
  });

  test("with only drawn grades the shares add up to 100", () => {
    const { bars, otherCount } = gradeBars(gradesOf(1, 1, 1, 1, 0, 0));
    expect(otherCount).toBe(0);
    expect(bars.reduce((sum, bar) => sum + bar.percent, 0)).toBe(100);
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
