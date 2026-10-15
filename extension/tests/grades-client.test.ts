import { describe, expect, test } from "bun:test";
import { GradesClient, historyForCourse } from "../src/lib/grades-client";
import type { Candidate, CourseHistory, GradeData, InstructorHistory } from "../src/shared/api-types";
import { fakeFetch, jsonResponse, MemoryCache } from "./helpers";

const gradeData: GradeData = {
  gradeA: 58,
  gradeB: 22,
  gradeC: 10,
  gradeD: 4,
  gradeF: 3,
  gradeP: 0,
  gradeNP: 0,
  gradeW: 3,
  gradeWF: 0,
  gradeI: 0,
  gradePR: 0,
  gradeNPR: 0,
  gradeZ: 0,
  gradeSuppressed: 0,
  totalEnroll: 100,
};

const smith: Candidate = { id: JSON.stringify(["John", "Smith"]), firstName: "John", lastName: "Smith", name: "John Smith" };

function historyBody(courseCount = 1): InstructorHistory {
  const course: CourseHistory = {
    counts: { A: 58, B: 22, C: 10, D: 4, F: 3, W: 3 },
    total: 24,
    grades: gradeData,
    course: { subject: "CSCE", number: "1030", title: "Computer Science I" },
    terms: [],
    sectionCount: 1,
    gpa: 3.4,
  };
  return {
    counts: { A: 140, B: 60, C: 25, D: 8, F: 5, W: 2 },
    total: 240,
    grades: gradeData,
    instructor: smith,
    courses: courseCount === 0 ? [] : [course],
    gpa: 3.35,
  };
}

describe("GradesClient.historyForInstructor", () => {
  test("matches the instructor and renders this course's history", async () => {
    // URL-based, not call-index-based: a cached second row still hits the
    // search route first, so the handler answers per route, not per order.
    const { fetchImpl, requests } = fakeFetch((_index, request) =>
      request.url.includes("/api/grades/search")
        ? jsonResponse({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smith] } })
        : jsonResponse({ status: "ok", source: "untgrades.app", data: historyBody() }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());

    const verdict = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");

    expect(verdict).toEqual({
      kind: "history",
      instructorName: "John Smith",
      courseCode: "CSCE 1030",
      gpa: 3.4,
      total: 24,
      counts: { A: 58, B: 22, C: 10, D: 4, F: 3, W: 3 },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain(`/api/grades/instructors/${encodeURIComponent(smith.id)}`);

    // The second identical row re-runs the cheap search but is served its
    // history from the session cache: the history route ran exactly once.
    const cached = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");
    expect(cached.kind).toBe("history");
    expect(requests.filter(request => request.url.includes("/api/grades/search"))).toHaveLength(2);
    expect(requests.filter(request => request.url.includes("/api/grades/instructors/"))).toHaveLength(1);
  });

  test("abstains on an ambiguous instructor name without fetching history", async () => {
    const clone: Candidate = { id: JSON.stringify(["John", "Smith", "2"]), firstName: "John", lastName: "Smith", name: "John Smith" };
    const { fetchImpl, requests } = fakeFetch(() =>
      jsonResponse({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smith, clone] } }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());

    const verdict = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");

    expect(verdict).toEqual({ kind: "no-match", reason: "ambiguous: several candidates match the section name" });
    expect(requests).toHaveLength(1);
  });

  test("renders the no-history envelope honestly", async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ status: "no-history", source: "untgrades.app", data: null }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    expect(await client.historyForInstructor("Nobody, Ada", "CSCE", "1030")).toEqual({
      kind: "no-history",
      detail: "no-instructor-history",
    });
  });

  test("renders the unavailable envelope with its Retry-After", async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({
        status: "unavailable",
        source: "untgrades.app",
        data: null,
        error: { reason: "throttled", message: "Too many requests", retryAfterSeconds: 7 },
      }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    const verdict = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");
    expect(verdict).toEqual({
      kind: "unavailable",
      message: "Too many requests",
      retryAfterSeconds: 7,
    });
  });

  test("honors a Retry-After header when the body is not JSON", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("gateway timeout", { status: 502, headers: { "Retry-After": "10" } }));
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    const verdict = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");
    expect(verdict).toEqual({
      kind: "unavailable",
      message: "The grade history service answered HTTP 502.",
      retryAfterSeconds: 10,
    });
  });

  test("a match without this course's history says so", async () => {
    const { fetchImpl } = fakeFetch(index =>
      index === 0
        ? jsonResponse({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smith] } })
        : jsonResponse({ status: "ok", source: "untgrades.app", data: historyBody(0) }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    expect(await client.historyForInstructor("Smith, John R.", "CSCE", "1030")).toEqual({
      kind: "no-history",
      detail: "no-course-history",
    });
  });

  test("a row with no instructor never asks the grades routes", () => {
    // Covered at the worker level; asserted here on the pure reducer instead.
    const verdict = historyForCourse(historyBody(), "CSCE", "2100");
    expect(verdict).toEqual({ kind: "no-history", detail: "no-course-history" });
  });

  test("keeps the history route's unavailable state instead of claiming no history", async () => {
    const { fetchImpl } = fakeFetch((_index, request) =>
      request.url.includes("/api/grades/search")
        ? jsonResponse({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smith] } })
        : jsonResponse({
            status: "unavailable",
            source: "untgrades.app",
            data: null,
            error: { reason: "throttled", message: "Too many requests", retryAfterSeconds: 5 },
          }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    expect(await client.historyForInstructor("Smith, John R.", "CSCE", "1030")).toEqual({
      kind: "unavailable",
      message: "Too many requests",
      retryAfterSeconds: 5,
    });
  });

  test("a failed history request reads as unavailable, not as missing history", async () => {
    const { fetchImpl } = fakeFetch((_index, request) =>
      request.url.includes("/api/grades/search")
        ? jsonResponse({ status: "ok", source: "untgrades.app", data: { courses: [], instructors: [smith] } })
        : new Response("down", { status: 503 }),
    );
    const client = new GradesClient(fetchImpl, "http://127.0.0.1:3217", new MemoryCache());
    const verdict = await client.historyForInstructor("Smith, John R.", "CSCE", "1030");
    expect(verdict.kind).toBe("unavailable");
  });
});
