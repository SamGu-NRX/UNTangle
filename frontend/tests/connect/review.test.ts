import { describe, expect, test } from "bun:test";
import { checkReason, creditLine, decisionOf, importSaveOutcome, importSelection, missingApprovedRecords, saveOutcome, reviewGroups, rowFact, termLabel } from "../../src/lib/connect/review";
import type { TranscriptCourseRecord } from "../../src/lib/types";

function record(code: string, term: string, extra: Partial<TranscriptCourseRecord> = {}): TranscriptCourseRecord {
  return {
    id: `${code}-${term}`,
    code,
    title: code,
    term,
    grade: "A",
    credits: 3,
    sourceKind: "unt",
    confidence: 0.9,
    rationale: "Letter grade or credit marker satisfies completed credit.",
    duplicateExcluded: false,
    appliedStatus: "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
    ...extra,
  };
}

const unknown = record("SPAN 1010", "2025 Fall", {
  appliedStatus: "needsReview",
  reviewRequired: true,
  rationale: "Not in the planner catalog.",
});
const withdrawn = record("HIST 2610", "2026 Spring", {
  grade: "W",
  appliedStatus: "ignored",
  reviewRequired: true,
  rationale: "Grade does not indicate completed credit.",
});
const records = [
  record("CSCE 1030", "2025 Fall"),
  unknown,
  record("MATH 1710", "2025 Fall", { grade: "B", credits: 4 }),
  record("MATH 1720", "2026 Spring", { grade: "B", credits: 4 }),
  withdrawn,
  record("CSCE 2100", "2026 Fall", { grade: "EN", appliedStatus: "inProgress", rationale: "Transcript indicates the course is currently enrolled or in progress." }),
];

describe("review groups", () => {
  test("rows to check come first; every other row sits under its term, in transcript order", () => {
    const { toCheck, terms } = reviewGroups(records);
    expect(toCheck.map((r) => r.code)).toEqual(["SPAN 1010", "HIST 2610"]);
    expect(terms.map((t) => [t.term, t.records.map((r) => r.code)])).toEqual([
      ["2025 Fall", ["CSCE 1030", "MATH 1710"]],
      ["2026 Spring", ["MATH 1720"]],
      ["2026 Fall", ["CSCE 2100"]],
    ]);
  });

  test("a term whose only rows need checking gets no heading of its own", () => {
    const { terms } = reviewGroups([unknown]);
    expect(terms).toEqual([]);
  });
});

describe("what Looks right saves", () => {
  test("every settled row, and no row still to check", () => {
    expect(importSelection(records, {}).map((r) => r.code)).toEqual(["CSCE 1030", "MATH 1710", "MATH 1720", "CSCE 2100"]);
  });

  test("a checked row counted as Done or Taking is saved with that status; Skip saves nothing", () => {
    const chosen = importSelection(records, { [unknown.id]: "completed", [withdrawn.id]: "ignored" });
    const span = chosen.find((r) => r.code === "SPAN 1010");
    expect(span?.appliedStatus).toBe("completed");
    expect(chosen.some((r) => r.code === "HIST 2610")).toBe(false);
    expect(importSelection(records, { [withdrawn.id]: "inProgress" }).find((r) => r.code === "HIST 2610")?.appliedStatus).toBe("inProgress");
  });

  test("a row to check that the student counts is saved as settled, even when its status already matched", () => {
    // A D grade reads as completed but is flagged; choosing Done must clear the flag.
    const dGrade = record("MATH 1710", "2025 Fall", {
      grade: "D",
      appliedStatus: "completed",
      reviewRequired: true,
      rationale: "D can count as completed credit, but may not satisfy C-or-better prerequisites.",
    });
    const [saved] = importSelection([dGrade], { [dGrade.id]: "completed" });
    expect(saved).toMatchObject({ appliedStatus: "completed", reviewRequired: false });
    const [taking] = importSelection([unknown], { [unknown.id]: "inProgress" });
    expect(taking).toMatchObject({ appliedStatus: "inProgress", reviewRequired: false });
  });

  test("a settled row can be corrected: skipped, or saved with another status", () => {
    const settled = records[0];
    expect(importSelection([settled], { [settled.id]: "ignored" })).toEqual([]);
    expect(importSelection([settled], { [settled.id]: "inProgress" })[0].appliedStatus).toBe("inProgress");
    expect(importSelection([settled], {})).toEqual([settled]);
  });
});

describe("the credit line", () => {
  test("sums done and in-progress credits of what will be saved", () => {
    // 3 + 4 + 4 done; CSCE 2100 is 3 in progress.
    expect(creditLine(importSelection(records, {}))).toBe("11 credits done and 3 in progress.");
  });

  test("counts a checked row once it is counted", () => {
    expect(creditLine(importSelection(records, { [unknown.id]: "completed" }))).toBe("14 credits done and 3 in progress.");
  });

  test("names only the side that has credits, in the singular for one", () => {
    expect(creditLine([record("CSCE 1030", "2025 Fall", { credits: 1 })])).toBe("1 credit done.");
    expect(creditLine([record("CSCE 2100", "2026 Fall", { appliedStatus: "inProgress" })])).toBe("3 credits in progress.");
  });

  test("zero-credit rows read as their status", () => {
    expect(creditLine([record("UNIV 1000", "2025 Fall", { credits: 0 })])).toBe("0 credits done.");
    expect(creditLine([record("UNIV 1000", "2025 Fall", { credits: 0 }), record("CSCE 2100", "2026 Fall", { appliedStatus: "inProgress" })])).toBe(
      "0 credits done and 3 in progress.",
    );
  });

  test("keeps a half credit", () => {
    expect(creditLine([record("MUEN 1000", "2025 Fall", { credits: 0.5 }), record("CSCE 1030", "2025 Fall")])).toBe("3.5 credits done.");
  });

  test("says nothing when a saved row has no credit figure, or nothing is saved", () => {
    expect(creditLine([record("CSCE 1030", "2025 Fall"), record("MATH 1710", "2025 Fall", { credits: null })])).toBeNull();
    expect(creditLine([])).toBeNull();
  });
});

describe("one fact per row", () => {
  test("a settled row shows its grade, or Taking, and a correction changes the fact", () => {
    expect(rowFact(records[0])).toBe("Grade A");
    expect(rowFact(records[5])).toBe("Taking");
    expect(rowFact(record("CSCE 1030", "2025 Fall", { grade: "" }))).toBe("Done");
    expect(rowFact(records[0], "ignored")).toBe("Skipped");
    expect(rowFact(records[0], "inProgress")).toBe("Taking");
  });

  test("a row's choice starts at the parser's reading, and none for a row to check", () => {
    expect(decisionOf(records[0], {})).toBe("completed");
    expect(decisionOf(records[5], {})).toBe("inProgress");
    expect(decisionOf(unknown, {})).toBeNull();
    expect(decisionOf(records[0], { [records[0].id]: "ignored" })).toBe("ignored");
  });

  test("a row to check shows its reason in a few words", () => {
    expect(checkReason(unknown)).toBe("Not in the UNT catalog");
    expect(checkReason(withdrawn)).toBe("Grade W earns no credit");
    expect(checkReason(record("X 1000", "t", { rationale: "Something new." }))).toBe("Something new.");
  });

  test("terms read the way people say them", () => {
    expect(termLabel("2025 Fall")).toBe("Fall 2025");
    expect(termLabel("2026 SPRING")).toBe("Spring 2026");
    expect(termLabel("Needs review")).toBe("Needs review");
  });
});

describe("after Looks right", () => {
  const approved = [records[0], records[2]];
  const outcome = (status: Parameters<typeof importSaveOutcome>[0]["status"], current = approved, conflict = false) =>
    importSaveOutcome({ approved, current, status, conflict });

  test("success only once the plan holds the courses and is stored", () => {
    expect(outcome("saved")).toBe("saved");
    expect(outcome("pending")).toBe("waiting");
    expect(outcome("saving")).toBe("waiting");
  });

  test("a failed, refused or signed-out save is not success", () => {
    expect(outcome("failed")).toBe("unsaved");
    expect(outcome("not-saved")).toBe("unsaved");
    expect(outcome("signed-out")).toBe("unsaved");
  });

  test("a newer version from another tab wins first as a conflict, then as dropped courses", () => {
    expect(outcome("saved", approved, true)).toBe("conflict");
    expect(outcome("saved", [records[0]])).toBe("dropped");
    // The record is there but no longer approved as it was.
    expect(outcome("saved", [records[0], { ...records[2], appliedStatus: "ignored" }])).toBe("dropped");
  });

  test("a kept record that lost the student's settled review flag still counts as dropped", () => {
    const settled = { ...records[2], reviewRequired: false };
    expect(missingApprovedRecords([settled], [{ ...settled, reviewRequired: true }]).map((r) => r.code)).toEqual(["MATH 1710"]);
  });

  test("any plan edit reports success only once stored", () => {
    expect(saveOutcome("saved", false)).toBe("saved");
    expect(saveOutcome("pending", false)).toBe("waiting");
    expect(saveOutcome("saved", true)).toBe("conflict");
    expect(saveOutcome("failed", false)).toBe("unsaved");
  });

  test("the missing records are the ones to add again", () => {
    expect(missingApprovedRecords(approved, [records[0]]).map((r) => r.code)).toEqual(["MATH 1710"]);
    expect(missingApprovedRecords(approved, approved)).toEqual([]);
  });
});
