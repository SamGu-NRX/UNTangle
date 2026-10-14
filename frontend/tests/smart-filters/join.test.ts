import { describe, expect, test } from "bun:test";
import { candidatesFromHistory, joinSectionToHistory, MIN_GRADED_SECTIONS } from "@/lib/smart-filters/join";
import { courseHistory, historySection, historyTerm, identity, section } from "./helpers";

const jane = identity("Jane", "Smith");
const bob = identity("Bob", "Lee");

// Jane's four graded rows in one course: A 6, B 6, C 3, D 1 over 16 enrollments,
// so the aggregate GPA is 49/16 = 3.0625, which gradeGpa rounds to 3.06, and the
// A-or-B share is 12/16 = 0.75.
const janeRows = [
  historySection("1001", jane, { A: 3, B: 1 }),
  historySection("1002", jane, { B: 2, C: 2 }),
  historySection("1003", jane, { A: 1, B: 1, C: 1, D: 1 }),
  historySection("1004", jane, { A: 2, B: 2 }),
];
// Bob's three graded rows: A 2, B 2 over 4 enrollments, GPA 3.5, A-or-B share 1.
const bobRows = [historySection("1005", bob, { A: 1, B: 1 }), historySection("1006", bob, { A: 1 }), historySection("1007", bob, { B: 1 })];
const full = courseHistory("TEST 101", [historyTerm("2025", "spring", [...janeRows, ...bobRows])]);

describe("joinSectionToHistory", () => {
  test("joins a section to its instructor's figures in the same course", () => {
    const result = joinSectionToHistory({ instructor: section().instructor }, full);
    expect(result).toEqual({
      kind: "matched",
      instructorId: jane.id,
      gradedSections: 4,
      gradedEnrollments: 16,
      avgGpa: 3.06,
      abShare: 0.75,
    });
  });

  test("the matcher picks the right instructor when the course has several", () => {
    const result = joinSectionToHistory({ instructor: { display: "Bob Lee", raw: "Bob Lee" } }, full);
    expect(result).toEqual({
      kind: "matched",
      instructorId: bob.id,
      gradedSections: 3,
      gradedEnrollments: 4,
      avgGpa: 3.5,
      abShare: 1,
    });
  });

  test("figures wait for MIN_GRADED_SECTIONS graded sections", () => {
    const twoRows = courseHistory("TEST 101", [
      historyTerm("2025", "spring", [historySection("1001", jane, { A: 1, B: 1 }), historySection("1002", jane, { A: 1 })]),
    ]);
    const result = joinSectionToHistory({ instructor: section().instructor }, twoRows);
    expect(result).toEqual({ kind: "insufficient-data", instructorId: jane.id, gradedSections: 2, gradedEnrollments: 3 });
  });

  test("exactly MIN_GRADED_SECTIONS graded sections show figures", () => {
    const threeRows = courseHistory("TEST 101", [historyTerm("2025", "spring", bobRows)]);
    const result = joinSectionToHistory({ instructor: { display: "Bob Lee", raw: "Bob Lee" } }, threeRows);
    expect(result).toMatchObject({ kind: "matched", gradedSections: MIN_GRADED_SECTIONS });
  });

  test("withdrawn-only sections do not count toward the threshold", () => {
    const twoGraded = courseHistory("TEST 101", [
      historyTerm("2025", "spring", [historySection("1001", jane, { A: 1 }), historySection("1002", jane, { B: 1 }), historySection("1003", jane, { W: 30 })]),
    ]);
    const result = joinSectionToHistory({ instructor: section().instructor }, twoGraded);
    expect(result).toEqual({ kind: "insufficient-data", instructorId: jane.id, gradedSections: 2, gradedEnrollments: 2 });
  });

  test("an abstained match exposes no GPA or A/B figures", () => {
    // Surname only: the matcher abstains on insufficient first-name evidence.
    const result = joinSectionToHistory({ instructor: { display: null, raw: "Smith" } }, full);
    expect(result.kind).toBe("no-history");
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
    expect("avgGpa" in result).toBe(false);
    expect("abShare" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("avgGpa");
    expect(result).toMatchObject({ reason: "section surname matches but first-name evidence is insufficient" });
  });

  test("a staff-listed section has no grade facts", () => {
    const result = joinSectionToHistory({ instructor: { display: null, raw: "Staff" } }, full);
    expect(result.kind).toBe("no-history");
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
  });

  test("an ambiguous field abstains between same-surname candidates", () => {
    const candidates = courseHistory("TEST 101", [
      historyTerm("2025", "spring", [historySection("1001", identity("John", "Smith"), { A: 1 }), historySection("1002", identity("Judy", "Smith"), { A: 1 })]),
    ]);
    const result = joinSectionToHistory({ instructor: { display: "J. Smith", raw: "J. Smith" } }, candidates);
    expect(result.kind).toBe("no-history");
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
  });

  test("a damaged raw field abstains even when the display name is clean", () => {
    const john = identity("John", "Smith");
    const johnRows = [
      historySection("1008", john, { A: 3, B: 1 }),
      historySection("1009", john, { A: 2, B: 2 }),
      historySection("1010", john, { A: 1, B: 1 }),
    ];
    const johnHistory = courseHistory("TEST 101", [historyTerm("2025", "spring", johnRows)]);
    // The raw field carries damaged separators, so the matcher must abstain on
    // it; the clean display name must never resurrect the match or its figures.
    const result = joinSectionToHistory({ instructor: { display: "John Smith", raw: "Smith,,John" } }, johnHistory);
    expect(result.kind).toBe("no-history");
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
    expect("avgGpa" in result).toBe(false);
    expect("abShare" in result).toBe(false);
    expect(result).toMatchObject({ reason: "section instructor field is unparseable" });
  });

  test("a team-taught field with several qualifying instructors abstains", () => {
    const result = joinSectionToHistory({ instructor: { display: "Jane Smith; Bob Lee", raw: "Jane Smith; Bob Lee" } }, full);
    expect(result.kind).toBe("no-history");
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
  });

  test("no history means no figures", () => {
    expect(joinSectionToHistory({ instructor: section().instructor }, null)).toEqual({
      kind: "no-history",
      reason: "the course has no grade history",
    });
  });

  test("figures come only from the matched instructor's own rows in the passed history", () => {
    // The same instructor may teach more sections elsewhere; the join sees
    // only this course's history, so two rows here stay insufficient.
    const partial = courseHistory("TEST 101", [historyTerm("2025", "spring", janeRows.slice(0, 2))]);
    const result = joinSectionToHistory({ instructor: section().instructor }, partial);
    expect(result).toEqual({ kind: "insufficient-data", instructorId: jane.id, gradedSections: 2, gradedEnrollments: 8 });
  });
});

describe("candidatesFromHistory", () => {
  test("lists each identity the course's history names, once each", () => {
    const candidates = candidatesFromHistory(full);
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual([bob.id, jane.id].sort());
  });

  test("a history with no rows yields no candidates", () => {
    expect(candidatesFromHistory(courseHistory("TEST 101", []))).toEqual([]);
  });
});
