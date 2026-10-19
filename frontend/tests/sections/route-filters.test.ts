/**
 * GET /api/sections/[term]/[subject]/[number] with filter parameters: a loud
 * 400 from the shared contracts schema, the plain proxy response when no
 * filter is supplied, and a filtered response whose summary counts unknowns
 * separately from what was hidden. The sections proxy and the grade-history
 * service are mocked; every other layer is the route's real one.
 */

import { afterAll, expect, mock, test } from "bun:test";
import type { CourseHistory, HistoryTerm, HistoryResult } from "@/lib/grades-history/types";
import type { GradeData } from "@/lib/grades";
import type { CourseSections, Meeting, Section } from "@/lib/sections/model";

mock.module("server-only", () => ({}));

// mock.restore() leaves module mocks in place, and later test files in the
// same run (even with --isolate) would get this file's partial sections proxy,
// whose missing respondClassNumber breaks the class-number route test. So the
// real modules are copied before mocking and put back in afterAll.
const realSectionsServer = { ...(await import("@/lib/sections/server")) };
const realGradesHistory = { ...(await import("@/lib/grades-history")) };

const respondCalls: Array<[string, string, string]> = [];
const getCourseSectionsCalls: string[] = [];

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    room: "204", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: false,
    day: "Mon", startMinutes: 600, endMinutes: 660, dates: { start: null, end: null, raw: "" },
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, async: false, tba: false, ...overrides,
  };
}

function section(id: string, overrides: Partial<Section> = {}, meetings: Meeting[] = [meeting()]): Section {
  return {
    id, term: "spring-2027", courseCode: "CSCE 1045", sectionCode: "001", classNumbers: ["12345"], option: "1",
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, seats: { open: 25, total: 40 }, status: "open", rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } }, components: [], meetings,
    online: false, async: false, tba: false, ...overrides,
  };
}

const open = section("csce-1045-001");
const closed = section("csce-1045-002", { seats: { open: 0, total: 40 }, status: "closed", instructor: { display: "Ray Khan", raw: "Khan,Ray" } });
const mystery = section("csce-1045-003", { seats: { open: null, total: null }, status: "unknown", instructor: { display: "Who Knows", raw: "Knows,Who" } });

const course: CourseSections = {
  status: "ok", availability: "sections", term: "spring-2027", courseCode: "CSCE 1045", diagnostic: null,
  provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T00:00:00Z", note: "" }, checkedAt: "2026-10-15T00:00:00Z",
  sections: [open, closed, mystery],
};

const DOE_COUNTS = { A: 30, B: 10, C: 5, D: 3, F: 2 };
function gradeData(counts: Record<string, number>): GradeData {
  return {
    gradeA: counts.A ?? 0, gradeB: counts.B ?? 0, gradeC: counts.C ?? 0, gradeD: counts.D ?? 0, gradeF: counts.F ?? 0,
    gradeP: 0, gradeNP: 0, gradeW: 0, gradeWF: 0, gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0,
    totalEnroll: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}
function pastSection(instructor: { id: string; name: string }, counts: Record<string, number>) {
  const grades = gradeData(counts);
  return { sectionNumber: "001", instructor: { id: instructor.id, firstName: instructor.name.split(" ")[0], lastName: instructor.name.split(" ")[1], name: instructor.name }, counts, total: 50, grades };
}
/** Doe's past students averaged 3.26; Khan's 2.00. Both teach graded past sections. */
const DOE = { id: "j-doe", name: "Jane Doe" };
const KHAN = { id: "r-khan", name: "Ray Khan" };
const KHAN_COUNTS = { A: 5, B: 10, C: 20, D: 10, F: 5 };
const HISTORY: CourseHistory = {
  course: { subject: "CSCE", number: "1045", title: "Introduction to Computing" },
  terms: [1, 2, 3].map((n): HistoryTerm => ({
    year: `202${n}`, term: "Fall", counts: DOE_COUNTS, total: 50, grades: gradeData(DOE_COUNTS),
    sections: [pastSection(DOE, DOE_COUNTS), pastSection(KHAN, KHAN_COUNTS)],
  })),
  sectionCount: 6,
  counts: DOE_COUNTS, total: 150, grades: gradeData(DOE_COUNTS), gpa: 3.26,
};
const historyOk: HistoryResult<CourseHistory> = { status: "ok", source: "untgrades.app", data: HISTORY };

mock.module("@/lib/sections/server", () => ({
  sectionsProxy: {
    respond: async (term: string, subject: string, number: string) => {
      respondCalls.push([term, subject, number]);
      return Response.json({ passthrough: true });
    },
    getCourseSections: async (term: string, code: string) => {
      getCourseSectionsCalls.push(`${term} ${code}`);
      return course;
    },
  },
}));
mock.module("@/lib/grades-history", () => ({
  gradesHistory: { getCourseHistory: async () => historyOk },
}));
afterAll(() => {
  mock.module("@/lib/sections/server", () => realSectionsServer);
  mock.module("@/lib/grades-history", () => realGradesHistory);
  mock.restore();
});

const { GET } = await import("@/app/api/sections/[term]/[subject]/[number]/route");

// A distinct caller IP so the limiter never sees this file's budget.
const get = (query: string) =>
  GET(new Request(`http://localhost/api/sections/spring-2027/CSCE/1045${query}`, { headers: { "x-real-ip": "192.0.2.131" } }), {
    params: Promise.resolve({ term: "spring-2027", subject: "CSCE", number: "1045" }),
  });

test("a malformed filter list is a loud 400 from the shared contracts schema", async () => {
  const filters = [{ kind: "days", allowed: ["Mon"] }, { kind: "days", allowed: ["Tue"] }];
  const response = await get(`?filters=${encodeURIComponent(JSON.stringify(filters))}`);
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain("filters rejected");
});

test("no filter parameters passes the proxy response through", async () => {
  const response = await get("");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ passthrough: true });
  expect(respondCalls.at(-1)).toEqual(["spring-2027", "CSCE", "1045"]);
});

test("filters shape the response, and the summary separates unknowns from what was hidden", async () => {
  const filters = [{ kind: "open-seats", minimum: 1 }];
  const response = await get(`?filters=${encodeURIComponent(JSON.stringify(filters))}&minInstructorGpa=3.0`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { sections: Section[]; filterSummary: { hidden: { total: number; unknown: number }; gradeHistory: { status: string }; minInstructorGpaHundredths: number | null; applied: Section[] } };
  // The open section passes: its instructor has accepted evidence at 3.26.
  // The closed section's instructor is known at 2.00 — a definite fail that
  // hides without counting as unknown. The unknown-seats section has no
  // accepted evidence at all — unknown, not a definite fail.
  expect(body.sections.map((section) => section.id)).toEqual(["csce-1045-001"]);
  expect(body.filterSummary.minInstructorGpaHundredths).toBe(300);
  expect(body.filterSummary.gradeHistory).toEqual({ status: "ok" });
  expect(body.filterSummary.hidden).toEqual({ total: 2, unknown: 1 });
});
