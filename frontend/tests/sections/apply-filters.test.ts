/**
 * Applying section filters as the sections route serves them: loud parsing,
 * core's three-valued judge, and a grade threshold that keeps a section only
 * when its instructor has accepted evidence at or above the value — unknown
 * evidence never satisfies a filter, and the summary counts what was hidden.
 */

import { describe, expect, test } from "bun:test";
import type { GradeData } from "@/lib/grades";
import type { CourseHistory, HistoryTerm, HistoryResult } from "@/lib/grades-history/types";
import { applySectionFilters, parseSectionFilterParams } from "@/lib/sections/apply-filters";
import type { CourseSections, Meeting, Section } from "@/lib/sections/model";

const params = (query: string) => parseSectionFilterParams(new URL(`http://x/${query}`).searchParams);

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
/** Letter counts to the full GradeData shape: pass/fail/withdraw columns sit at zero here. */
function gradeData(counts: Record<string, number>): GradeData {
  return {
    gradeA: counts.A ?? 0,
    gradeB: counts.B ?? 0,
    gradeC: counts.C ?? 0,
    gradeD: counts.D ?? 0,
    gradeF: counts.F ?? 0,
    gradeP: 0,
    gradeNP: 0,
    gradeW: 0,
    gradeWF: 0,
    gradeI: 0,
    gradePR: 0,
    gradeNPR: 0,
    gradeZ: 0,
    gradeSuppressed: 0,
    totalEnroll: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

function pastSection(instructorId: string, counts: Record<string, number>) {
  const grades = gradeData(counts);
  return { sectionNumber: "001", instructor: { id: instructorId, firstName: "Jane", lastName: "Doe", name: "Jane Doe" }, counts, total: 50, grades };
}
/** Doe teaches three graded past sections (mean 3.26 → 326); the open section is Doe's. */
const HISTORY: CourseHistory = {
  course: { subject: "CSCE", number: "1045", title: "Introduction to Computing" },
  terms: [1, 2, 3].map((n): HistoryTerm => ({ year: `202${n}`, term: "Fall", counts: DOE_COUNTS, total: 50, grades: gradeData(DOE_COUNTS), sections: [pastSection("j-doe", DOE_COUNTS)] })),
  sectionCount: 3,
  counts: DOE_COUNTS, total: 150, grades: gradeData(DOE_COUNTS), gpa: 3.26,
};
const historyOk: HistoryResult<CourseHistory> = { status: "ok", source: "untgrades.app", data: HISTORY };
const historyThrottled: HistoryResult<CourseHistory> = { status: "unavailable", source: "untgrades.app", data: null, error: { reason: "throttled", message: "slow down" } };

describe("parseSectionFilterParams", () => {
  test("no parameters is no filters and no threshold", () => {
    expect(params("?")).toEqual({ filters: [], minInstructorGpaHundredths: null });
    expect(params("?filters=")).toEqual({ filters: [], minInstructorGpaHundredths: null });
  });

  test("a validated filter list parses", () => {
    const raw = encodeURIComponent(JSON.stringify([{ kind: "open-seats", minimum: 5 }, { kind: "days", allowed: ["Mon", "Wed"] }]));
    expect(params(`?filters=${raw}`)).toEqual({ filters: [{ kind: "open-seats", minimum: 5 }, { kind: "days", allowed: ["Mon", "Wed"] }], minInstructorGpaHundredths: null });
  });

  test("a filter kind twice, an unknown kind, and malformed JSON are errors, not guesses", () => {
    const twice = encodeURIComponent(JSON.stringify([{ kind: "open-seats", minimum: 5 }, { kind: "open-seats", minimum: 1 }]));
    expect(params(`?filters=${twice}`)).toHaveProperty("error");
    const unknown = encodeURIComponent(JSON.stringify([{ kind: "cheap-instructors" }]));
    expect(params(`?filters=${unknown}`)).toHaveProperty("error");
    expect(params("?filters=%5Bnot-json")).toHaveProperty("error");
  });

  test("minInstructorGpa becomes whole hundredths", () => {
    expect(params("?minInstructorGpa=3.5")).toEqual({ filters: [], minInstructorGpaHundredths: 350 });
    expect(params("?minInstructorGpa=4")).toEqual({ filters: [], minInstructorGpaHundredths: 400 });
  });

  test("thresholds outside 0 to 4, or with three decimals, are errors", () => {
    expect(params("?minInstructorGpa=4.01")).toHaveProperty("error");
    expect(params("?minInstructorGpa=3.505")).toHaveProperty("error");
    expect(params("?minInstructorGpa=abc")).toHaveProperty("error");
  });
});

describe("applySectionFilters", () => {
  test("no filters and no threshold returns the course unchanged", () => {
    const { course: kept, summary } = applySectionFilters(course, [], null, null);
    expect(kept.sections.map((s) => s.id)).toEqual(["csce-1045-001", "csce-1045-002", "csce-1045-003"]);
    expect(summary.hidden).toEqual({ total: 0, unknown: 0 });
    expect(summary.gradeHistory).toEqual({ status: "no-history" });
  });

  test("a failing filter drops, an unjudgeable section is counted as unknown and hidden", () => {
    const { course: kept, summary } = applySectionFilters(course, [{ kind: "open-seats", minimum: 10 }], null, null);
    expect(kept.sections.map((s) => s.id)).toEqual(["csce-1045-001"]);
    expect(summary.hidden).toEqual({ total: 2, unknown: 1 });
  });

  test("a grade threshold keeps only accepted evidence at or above it", () => {
    const { course: kept, summary } = applySectionFilters(course, [], 320, historyOk);
    expect(kept.sections.map((s) => s.id)).toEqual(["csce-1045-001"]);
    expect(summary.minInstructorGpaHundredths).toBe(320);
    expect(summary.hidden).toEqual({ total: 2, unknown: 2 });
  });

  test("a threshold above every known mean hides everything", () => {
    const { course: kept, summary } = applySectionFilters(course, [], 400, historyOk);
    expect(kept.sections).toEqual([]);
    expect(summary.hidden.unknown).toBe(3);
  });

  test("an unavailable history leaves every option unknown — a throttle never reads as weak grades", () => {
    const { summary } = applySectionFilters(course, [], 300, historyThrottled);
    expect(summary.gradeHistory).toEqual({ status: "unavailable", reason: "throttled" });
    expect(summary.hidden).toEqual({ total: 3, unknown: 3 });
  });

  test("combined filters and a threshold both apply", () => {
    const { course: kept } = applySectionFilters(course, [{ kind: "open-seats", minimum: 10 }], 320, historyOk);
    expect(kept.sections.map((s) => s.id)).toEqual(["csce-1045-001"]);
  });
});
