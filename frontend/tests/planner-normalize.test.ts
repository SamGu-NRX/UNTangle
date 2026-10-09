import { describe, expect, test } from "bun:test";
import { courses } from "@/lib/seed-data";
import {
  getInitialPlannerState,
  mergeTranscriptRecords,
  normalizePlannerState,
} from "@/lib/planner";
import { compareAcademicTerms, parseAcademicTerm } from "@/lib/term-chronology";
import type { PlannerState, TranscriptCourseRecord } from "@/lib/types";

const firstCatalogCode = courses[0].code;

function makeRecord(overrides: Partial<TranscriptCourseRecord>): TranscriptCourseRecord {
  return {
    id: "rec-1",
    code: "CSCE 1030",
    title: "Computer Science I",
    term: "Fall 2025",
    grade: "A",
    credits: 4,
    sourceKind: "unt",
    confidence: 0.95,
    rationale: "parsed from transcript",
    duplicateExcluded: false,
    appliedStatus: "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
    ...overrides,
  };
}

describe("normalizePlannerState strictness", () => {
  test("coerces an unknown optimization to the default", () => {
    const state = normalizePlannerState({
      ...getInitialPlannerState(),
      optimization: "warp-speed" as PlannerState["optimization"],
    });
    expect(state.optimization).toBe("clusterMorning");
  });

  test("coerces an unknown activeDay to the default", () => {
    const state = normalizePlannerState({
      ...getInitialPlannerState(),
      activeDay: "Someday" as PlannerState["activeDay"],
    });
    expect(state.activeDay).toBe("Mon");
  });

  test("drops courseStatuses for codes outside the catalog", () => {
    const state = normalizePlannerState({
      ...getInitialPlannerState(),
      courseStatuses: { [firstCatalogCode]: "inProgress", "FAKE 101": "inProgress" },
    });
    expect(state.courseStatuses[firstCatalogCode]).toBe("inProgress");
    expect(state.courseStatuses["FAKE 101"]).toBeUndefined();
  });

  test("drops courseStatuses with invalid values", () => {
    const state = normalizePlannerState({
      ...getInitialPlannerState(),
      courseStatuses: { [firstCatalogCode]: "banana" as PlannerState["courseStatuses"][string] },
    });
    expect(state.courseStatuses[firstCatalogCode]).toBe("notTaken");
  });

  test("keeps only well-formed transcript records", () => {
    const valid = makeRecord({});
    const state = normalizePlannerState({
      ...getInitialPlannerState(),
      transcriptRecords: [
        valid,
        null as unknown as TranscriptCourseRecord,
        "row" as unknown as TranscriptCourseRecord,
        makeRecord({ id: "rec-2", appliedStatus: "banana" as TranscriptCourseRecord["appliedStatus"] }),
        makeRecord({ id: "rec-3", sourceKind: "boss" as TranscriptCourseRecord["sourceKind"] }),
        makeRecord({ id: "rec-4", confidence: Number.NaN }),
      ],
    });
    expect(state.transcriptRecords).toHaveLength(1);
    expect(state.transcriptRecords[0].id).toBe("rec-1");
  });

  test("a valid state passes through semantically unchanged", () => {
    const state = getInitialPlannerState();
    expect(normalizePlannerState(state)).toEqual(state);
  });
});

describe("mergeTranscriptRecords ordering", () => {
  test("orders terms chronologically, not lexicographically", () => {
    const records = [
      makeRecord({ id: "a", term: "Spring 2026" }),
      makeRecord({ id: "b", term: "Fall 2025" }),
      makeRecord({ id: "c", term: "Winter 2025" }),
      makeRecord({ id: "d", term: "Summer 2026" }),
    ];
    const merged = mergeTranscriptRecords([], records);
    expect(merged.map((record) => record.id)).toEqual(["b", "c", "a", "d"]);
  });

  test("sorts unknown terms after known ones and keeps their relative order", () => {
    const records = [
      makeRecord({ id: "a", term: "Unknown term" }),
      makeRecord({ id: "b", term: "Fall 2024" }),
      makeRecord({ id: "c", term: "Needs review" }),
    ];
    const merged = mergeTranscriptRecords([], records);
    expect(merged.map((record) => record.id)).toEqual(["b", "a", "c"]);
  });

  test("treats year-first and season-first spellings as the same term", () => {
    expect(compareAcademicTerms("2025 Fall", "Fall 2025")).toBe(0);
    expect(parseAcademicTerm("Spring 2026")).toEqual({ year: 2026, seasonRank: 0 });
    expect(parseAcademicTerm("2026 Spring")).toEqual({ year: 2026, seasonRank: 0 });
    expect(parseAcademicTerm("Unknown term")).toBeNull();
  });
});

describe("compareAcademicTerms", () => {
  test("ranks seasons within a year Spring < Summer < Fall < Winter", () => {
    expect(compareAcademicTerms("Spring 2025", "Summer 2025")).toBeLessThan(0);
    expect(compareAcademicTerms("Summer 2025", "Fall 2025")).toBeLessThan(0);
    expect(compareAcademicTerms("Fall 2025", "Winter 2025")).toBeLessThan(0);
  });

  test("orders December Winter between Fall and the next Spring", () => {
    expect(compareAcademicTerms("Winter 2025", "Spring 2026")).toBeLessThan(0);
    expect(compareAcademicTerms("Fall 2025", "Winter 2025")).toBeLessThan(0);
  });
});
