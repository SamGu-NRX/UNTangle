/**
 * The accepted-evidence join: a section's instructor matches grade history
 * on the raw field, and the mean comes from that instructor's own past
 * sections of the course, whole hundredths, at least three graded sections.
 * Every weak case is unknown (edge PRs #78 and #83 on alpha's raw-field contract).
 */

import { describe, expect, test } from "bun:test";
import type { GradeData } from "@/lib/grades";
import type { CourseHistory, HistoryTerm } from "@/lib/grades-history/types";
import {
  MIN_GRADED_SECTIONS,
  courseEvidenceHundredths,
  instructorEvidence,
  instructorMeanHundredths,
} from "@/lib/sections/instructor-evidence";
import type { Section } from "@/lib/sections/model";

/** A course history with two instructors: Jane Doe teaches 3 graded sections, Ray Khan only 2. */
const DOE_COUNTS = { A: 30, B: 10, C: 5, D: 3, F: 2 }; // mean (30*4+10*3+5*2+3*1)/50 = 3.26
const KHAN_COUNTS = { A: 10, B: 10, C: 10, D: 10, F: 10 }; // mean 2.0
const MIXED_COUNTS = { A: 20, B: 20, C: 15, D: 15, F: 5 }; // mean 2.4666… → 247

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
function pastSection(id: string, instructorId: string, firstName: string, lastName: string, counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const grades = gradeData(counts);
  return { sectionNumber: id, instructor: { id: instructorId, firstName, lastName, name: `${firstName} ${lastName}` }, counts, total, grades };
}

const HISTORY: CourseHistory = {
  course: { subject: "CSCE", number: "1045", title: "Introduction to Computing" },
  terms: [
    { year: "2024", term: "Fall", counts: DOE_COUNTS, total: 50, grades: gradeData(DOE_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", DOE_COUNTS)] },
    { year: "2025", term: "Fall", counts: KHAN_COUNTS, total: 50, grades: gradeData(KHAN_COUNTS), sections: [pastSection("001", "r-khan", "Ray", "Khan", KHAN_COUNTS)] },
    { year: "2026", term: "Spring", counts: MIXED_COUNTS, total: 75, grades: gradeData(MIXED_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", MIXED_COUNTS), pastSection("002", "r-khan", "Ray", "Khan", MIXED_COUNTS)] },
    { year: "2026", term: "Fall", counts: DOE_COUNTS, total: 50, grades: gradeData(DOE_COUNTS), sections: [pastSection("001", "j-doe", "Jane", "Doe", DOE_COUNTS)] },
  ] as HistoryTerm[],
  sectionCount: 5,
  counts: { ...DOE_COUNTS, ...KHAN_COUNTS, ...MIXED_COUNTS },
  total: 50 + 50 + 75 + 50,
  grades: gradeData({ A: 30 + 10 + 20 + 20, B: 10 + 10 + 20 + 20, C: 5 + 10 + 15 + 15, D: 3 + 10 + 15 + 15, F: 2 + 10 + 5 + 5 }),
  gpa: 2.86,
};

function section(raw: string, display: string | null, courseCode = "CSCE 1045", id = "csce-1045-001"): Section {
  return {
    id,
    term: "spring-2027",
    courseCode,
    sectionCode: "001",
    classNumbers: ["12345"],
    option: "1",
    instructor: { display, raw },
    seats: { open: 25, total: 40 },
    status: "open",
    rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } },
    components: [],
    meetings: [],
    online: false,
    async: false,
    tba: false,
  };
}

describe("instructorEvidence", () => {
  test("matches the raw instructor field and reports the instructor's own mean in hundredths", () => {
    // The raw field "Doe,Jane" is the evidence; the display text "Jane Doe" is derived, not evidence.
    const evidence = instructorEvidence(section("Doe,Jane", "Jane Doe"), HISTORY);
    // Doe's own three graded sections pooled (edge join.ts sumCounts semantics):
    // A 80, B 40, C 25, D 21, F 9 → (80*4+40*3+25*2+21)/175 = 511/175 = 2.92 → 292.
    expect(evidence).toEqual({ kind: "known", meanGradePointsHundredths: 292 });
  });

  test("an instructor with fewer than three graded sections of the course is unknown", () => {
    const evidence = instructorEvidence(section("Khan,Ray", "Ray Khan"), HISTORY);
    expect(evidence).toEqual({ kind: "unknown" });
    expect(MIN_GRADED_SECTIONS).toBe(3);
  });

  test("no history at all is unknown, never weak grades", () => {
    expect(instructorEvidence(section("Doe,Jane", "Jane Doe"), null)).toEqual({ kind: "unknown" });
  });

  test("a name the source mangled so matching abstains is unknown", () => {
    // "Doe,Jan" parses to first token "Jan": not "Jane", not an initial — the matcher abstains.
    expect(instructorEvidence(section("Doe,Jan", "Jane Doe"), HISTORY)).toEqual({ kind: "unknown" });
  });
});

describe("instructorMeanHundredths", () => {
  test("uses only the matched instructor's sections, not the course's", () => {
    expect(instructorMeanHundredths(HISTORY, "j-doe")).toBe(292);
  });

  test("rounds to whole hundredths", () => {
    // MIXED pooled over three sections: 555/225 = 2.4666… → 247.
    const single: CourseHistory = {
      ...HISTORY,
      terms: [{
        year: "2026", term: "Spring", counts: MIXED_COUNTS, total: 225, grades: gradeData(MIXED_COUNTS),
        sections: [pastSection("001", "x-1", "Ada", "Lovelace", MIXED_COUNTS), pastSection("002", "x-1", "Ada", "Lovelace", MIXED_COUNTS), pastSection("003", "x-1", "Ada", "Lovelace", MIXED_COUNTS)],
      }],
    };
    expect(instructorMeanHundredths(single, "x-1")).toBe(247);
  });

  test("returns null when no section of the instructor's has A through F grades", () => {
    const withdrawOnly: CourseHistory = {
      ...HISTORY,
      terms: [
        {
          year: "2026", term: "Spring", counts: {}, total: 0,
          grades: gradeData({}),
          sections: [pastSection("001", "w-1", "Nobody", "Graded", {})],
        },
      ],
    };
    expect(instructorMeanHundredths(withdrawOnly, "w-1")).toBeNull();
  });
});

describe("courseEvidenceHundredths", () => {
  test("maps every section to its hundredths, null when unknown", () => {
    const result = courseEvidenceHundredths([section("Doe,Jane", "Jane Doe", "CSCE 1045", "csce-1045-001"), section("Khan,Ray", "Ray Khan", "CSCE 1045", "csce-1045-002")], { status: "ok", source: "untgrades.app", data: HISTORY });
    expect(result).toEqual({ "csce-1045-001": 292, "csce-1045-002": null });
  });

  test("an unavailable result leaves every option unknown", () => {
    const result = courseEvidenceHundredths([section("Doe,Jane", "Jane Doe")], {
      status: "unavailable", source: "untgrades.app", data: null, error: { reason: "throttled", message: "slow down" },
    });
    expect(result).toEqual({ "csce-1045-001": null });
  });
});
