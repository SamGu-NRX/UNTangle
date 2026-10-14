import { describe, expect, test } from "bun:test";
import { conflictsWithScheduled, extractScheduled, type ScheduledMeeting, type SectionListSource } from "../src/lib/conflicts";
import { rowFixture } from "./helpers";

const seededMain: ScheduledMeeting[] = [
  { courseCode: "CSCE 1040", day: "Mon", startMinutes: 570, endMinutes: 620, dates: { start: "2027-01-19", end: "2027-05-07" } },
  { courseCode: "CSCE 1040", day: "Wed", startMinutes: 570, endMinutes: 620, dates: { start: "2027-01-19", end: "2027-05-07" } },
  { courseCode: "CSCE 1040", day: "Fri", startMinutes: 570, endMinutes: 620, dates: { start: "2027-01-19", end: "2027-05-07" } },
];

describe("conflictsWithScheduled", () => {
  test("flags the overlapping weekly slot", () => {
    const verdict = conflictsWithScheduled(rowFixture(), seededMain);
    expect(verdict.kind).toBe("conflict");
    if (verdict.kind === "conflict") {
      expect(verdict.hits).toHaveLength(3);
      expect(verdict.hits[0]).toMatchObject({ courseCode: "CSCE 1040", day: "Mon", startMinutes: 570, endMinutes: 620 });
    }
  });

  test("clears a genuinely free weekly slot", () => {
    const verdict = conflictsWithScheduled(
      rowFixture({ meetings: [{ day: "Mon", startMinutes: 780, endMinutes: 830 }, { day: "Wed", startMinutes: 780, endMinutes: 830 }, { day: "Fri", startMinutes: 780, endMinutes: 830 }] }),
      seededMain,
    );
    expect(verdict).toEqual({ kind: "clear" });
  });

  test("adjacent slots do not conflict (open boundary)", () => {
    // Row ends at 570 exactly where Main starts: touching, not overlapping.
    const verdict = conflictsWithScheduled(
      rowFixture({ meetings: [{ day: "Mon", startMinutes: 540, endMinutes: 570 }] }),
      seededMain,
    );
    expect(verdict).toEqual({ kind: "clear" });
  });

  test("TBA and async rows are never a clean bill", () => {
    expect(conflictsWithScheduled(rowFixture({ isTba: true, meetings: [] }), seededMain)).toEqual({
      kind: "unknown",
      reason: "row-time-missing",
    });
    expect(conflictsWithScheduled(rowFixture({ isAsync: true, meetings: [] }), seededMain)).toEqual({
      kind: "unknown",
      reason: "row-time-missing",
    });
    expect(conflictsWithScheduled(rowFixture({ meetings: [] }), seededMain)).toEqual({
      kind: "unknown",
      reason: "row-time-missing",
    });
  });

  test("an empty Main schedule clears the row", () => {
    expect(conflictsWithScheduled(rowFixture(), [])).toEqual({ kind: "clear" });
  });

  test("disjoint date ranges exclude an otherwise-overlapping slot", () => {
    const otherHalf: ScheduledMeeting[] = [
      { courseCode: "MATH 1650", day: "Mon", startMinutes: 570, endMinutes: 620, dates: { start: "2027-08-23", end: "2027-12-10" } },
    ];
    expect(conflictsWithScheduled(rowFixture(), otherHalf)).toEqual({ kind: "clear" });
  });

  test("undecidable scheduled dates stay in the comparison", () => {
    const undated: ScheduledMeeting[] = [
      { courseCode: "MATH 1650", day: "Mon", startMinutes: 570, endMinutes: 620, dates: { start: null, end: null } },
    ];
    const verdict = conflictsWithScheduled(rowFixture(), undated);
    expect(verdict.kind).toBe("conflict");
  });
});

describe("extractScheduled", () => {
  const source: SectionListSource = {
    courseCode: "CSCE 1040",
    sections: [
      {
        id: "vsb:spring-2027:CSCE 1040:10001",
        meetings: [
          { day: "Mon", startMinutes: 570, endMinutes: 620, dates: { start: "2027-01-19", end: "2027-05-07" } },
          { day: "Wed", startMinutes: 570, endMinutes: 620, dates: { start: "2027-01-19", end: "2027-05-07" } },
        ],
      },
      {
        id: "vsb:spring-2027:CSCE 1040:10002",
        meetings: [{ day: null, startMinutes: null, endMinutes: null, dates: { start: null, end: null } }],
      },
    ],
  };

  test("extracts the selected section's concrete meetings", () => {
    const extracted = extractScheduled(source, "vsb:spring-2027:CSCE 1040:10001");
    expect(extracted).not.toBeNull();
    expect(extracted?.complete).toBe(true);
    expect(extracted?.meetings).toHaveLength(2);
  });

  test("a section with TBA meetings is incomplete", () => {
    const extracted = extractScheduled(source, "vsb:spring-2027:CSCE 1040:10002");
    expect(extracted?.complete).toBe(false);
    expect(extracted?.meetings).toEqual([]);
  });

  test("an unknown section id resolves to null", () => {
    expect(extractScheduled(source, "vsb:spring-2027:CSCE 1040:99999")).toBeNull();
  });
});
