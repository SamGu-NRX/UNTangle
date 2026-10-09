import { describe, expect, test } from "bun:test";
import {
  buildLocalFallbackPayload,
  compareAcademicTerms,
  reconcileTranscriptCourses,
} from "@/lib/transcript-import";

// Realistic UNT unofficial-transcript snippets; parsed locally, no network.
const seasonFirstSnippet = `University of North Texas Unofficial Transcript
Fall 2025
CSCE 1030 Computer Science I 3.000 3.000 A 3.000`;

const yearFirstSnippet = `University of North Texas Unofficial Transcript
2025 Fall
CSCE 1030 Computer Science I 3.000 3.000 A 3.000`;

const mixedDirectionSnippet = `University of North Texas Unofficial Transcript
2024 Fall
MATH 1650 Precalculus 3.000 3.000 A 3.000
Fall 2025
CSCE 1030 Computer Science I 3.000 3.000 A 3.000
2026 Spring
CSCE 1040 Computer Science II 3.000 3.000 B 3.000`;

describe("term parsing via local transcript parser", () => {
  test("parses season-first term headers", () => {
    const payload = buildLocalFallbackPayload(seasonFirstSnippet);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].code).toBe("CSCE 1030");
    expect(payload.records[0].term).toBe("Fall 2025");
    expect(payload.records[0].sourceKind).toBe("unt");
    expect(payload.records[0].rationale).toBe("Parsed from transcript table text without AI.");
  });

  test("still parses year-first term headers", () => {
    const payload = buildLocalFallbackPayload(yearFirstSnippet);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].term).toBe("2025 Fall");
  });

  test("parses every season in season-first form", () => {
    for (const season of ["Spring", "Summer", "Fall", "Winter"]) {
      const payload = buildLocalFallbackPayload(
        `${season} 2025\nCSCE 1030 Computer Science I 3.000 3.000 A 3.000`,
      );
      expect(payload.records).toHaveLength(1);
      expect(payload.records[0].term).toBe(`${season} 2025`);
    }
  });

  test("attributes each row to its nearest preceding header in mixed transcripts", () => {
    const payload = buildLocalFallbackPayload(mixedDirectionSnippet);
    expect(payload.records.map((record) => record.term)).toEqual([
      "2024 Fall",
      "Fall 2025",
      "2026 Spring",
    ]);
    expect(payload.records.map((record) => record.code)).toEqual([
      "MATH 1650",
      "CSCE 1030",
      "CSCE 1040",
    ]);
  });

  test("keeps the Unknown term sentinel when no header precedes a row", () => {
    const payload = buildLocalFallbackPayload(
      "CSCE 1030 Computer Science I 3.000 3.000 A 3.000",
    );
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].term).toBe("Unknown term");
  });
});

describe("compareAcademicTerms", () => {
  test("orders terms chronologically across both label directions", () => {
    // December intersession: within a labeled year, Winter follows Fall.
    const chronological = ["Fall 2025", "Winter 2025", "Spring 2026", "Summer 2026"];
    for (let i = 0; i < chronological.length - 1; i++) {
      expect(compareAcademicTerms(chronological[i], chronological[i + 1])).toBeLessThan(0);
      expect(compareAcademicTerms(chronological[i + 1], chronological[i])).toBeGreaterThan(0);
    }
  });

  test("treats year-first and season-first labels as equivalent", () => {
    expect(compareAcademicTerms("2025 Fall", "Fall 2025")).toBe(0);
    expect(compareAcademicTerms("2026 Spring", "Spring 2026")).toBe(0);
    expect(compareAcademicTerms("2025 Winter", "Winter 2025")).toBe(0);
    expect(compareAcademicTerms("2026 Summer", "Summer 2026")).toBe(0);
  });

  test("places the December intersession between Fall and the next Spring", () => {
    expect(compareAcademicTerms("Winter 2025", "Spring 2026")).toBeLessThan(0);
    expect(compareAcademicTerms("Fall 2025", "Winter 2025")).toBeLessThan(0);
  });

  test("sorts unknown and unparseable terms after known terms", () => {
    expect(compareAcademicTerms("Fall 2025", "Unknown term")).toBeLessThan(0);
    expect(compareAcademicTerms("Needs review", "Spring 2026")).toBeGreaterThan(0);
    expect(compareAcademicTerms("Fall 2025", "Unparseable gibberish")).toBeLessThan(0);
  });

  test("treats two unparseable terms as equal", () => {
    expect(compareAcademicTerms("Needs review", "Unknown term")).toBe(0);
    expect(compareAcademicTerms("Unknown term", "Unknown term")).toBe(0);
  });
});

describe("reconcileTranscriptCourses term ordering", () => {
  test("orders records chronologically with unknown terms last, preserving labels", () => {
    const result = reconcileTranscriptCourses({
      payload: {
        records: [
          { code: "CSCE 1040", term: "Spring 2026", grade: "A" },
          { code: "CSCE 1030", term: "Fall 2025", grade: "B" },
          { code: "CSCE 2050", term: "Summer 2026", grade: "A" },
          { code: "MATH 1650", term: "Winter 2025", grade: "C" },
          { code: "HIST 2610", term: "Needs review", grade: "A" },
          { code: "ENGL 1310", term: "Unknown term", grade: "B" },
          { code: "PSCI 1040", term: "2025 Fall", grade: "A" },
          { code: "BIOL 1710", term: "Unparseable gibberish", grade: "C" },
        ],
      },
      modelUsed: "test",
      extractionMode: "local",
      catalog: [],
    });

    // Fall 2025 and 2025 Fall are the same chronological slot, so they tie and
    // fall back to the existing code tiebreak. Unparseable terms keep their
    // relative code ordering after all known terms.
    expect(result.records.map((record) => `${record.code} ${record.term}`)).toEqual([
      "CSCE 1030 Fall 2025",
      "PSCI 1040 2025 Fall",
      "MATH 1650 Winter 2025",
      "CSCE 1040 Spring 2026",
      "CSCE 2050 Summer 2026",
      "BIOL 1710 Unparseable gibberish",
      "ENGL 1310 Unknown term",
      "HIST 2610 Needs review",
    ]);
  });

  test("orders locally parsed rows from a mixed-direction transcript chronologically", () => {
    const result = reconcileTranscriptCourses({
      payload: buildLocalFallbackPayload(mixedDirectionSnippet),
      modelUsed: "test",
      extractionMode: "local",
      catalog: [],
    });

    expect(result.records.map((record) => record.term)).toEqual([
      "2024 Fall",
      "Fall 2025",
      "2026 Spring",
    ]);
  });
});
