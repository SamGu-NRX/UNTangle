import { expect, test } from "bun:test";
import { adaptUntCatalog, evidenceFromUntTranscript, inferStatuses, untAdapter } from "../../src/lib/prereq";
import type { TranscriptCourseRecord } from "../../src/lib/types";

const record = (code: string, changes: Partial<TranscriptCourseRecord> = {}): TranscriptCourseRecord => ({
  id: code, code, title: "Course", term: "Fall 2025", grade: "B", credits: 3, sourceKind: "unt", confidence: 1,
  rationale: "Verified transcript", duplicateExcluded: false, appliedStatus: "completed", prerequisiteSatisfied: true, reviewRequired: false, ...changes,
});

test("transcript importer output supplies accepted credit, enrollment, and review separately", () => {
  const evidence = evidenceFromUntTranscript([
    record("CSCE1030"),
    record("CSCE1040", { appliedStatus: "inProgress", grade: "IP", prerequisiteSatisfied: false }),
    record("MATH1710", { duplicateExcluded: true }),
    record("MATH1720", { reviewRequired: true, appliedStatus: "needsReview" }),
    record("MATH2700", { appliedStatus: "ignored", grade: "F", prerequisiteSatisfied: false }),
    record("MATH1650", { appliedStatus: "completed", grade: "P", reviewRequired: true }),
  ]);
  expect(evidence.transcript).toEqual([{ courseId: "CSCE 1030", grade: "B", source: "CSCE1030", credits: 3 }]);
  expect(evidence.inProgress).toEqual(["CSCE 1040"]);
  expect(evidence.needsReview).toEqual(["MATH 1720", "MATH 1650"]);
});

test("UNT grade policy separates passing credit from minimum-letter evidence", () => {
  expect(untAdapter.isPassingGrade("D")).toBe(true);
  expect(untAdapter.meetsMinimumGrade("D", "C")).toBe(false);
  expect(untAdapter.isPassingGrade("CR")).toBe(true);
  expect(untAdapter.meetsMinimumGrade("CR", "C")).toBeUndefined();
  expect(untAdapter.isPassingGrade("Q")).toBeUndefined();
});

test("credit ranges require an explicit value; flattened course codes cannot replace text", () => {
  const entry = { course_number: "CSCE1040", number_of_hours: "1–3 hours", prerequisites: "CSCE 1030 or CSCE 1035", prerequisites_course_codes: ["CSCE 1030", "CSCE 1035"] };
  expect(() => adaptUntCatalog([entry])).toThrow("Supply credit hours for CSCE 1040");
  const catalog = adaptUntCatalog([entry], new Map([["CSCE 1040", 2]]));
  expect(catalog[0].credits).toBe(2);
  expect(inferStatuses(catalog, { transcript: [{ courseId: "CSCE 1035", grade: "A" }] }, untAdapter).statuses.get("CSCE 1040")?.status).toBe("eligible");
});

test("plain numeric credit values are accepted and invalid overrides are rejected", () => {
  const entry = { course_number: "CSCE1030", number_of_hours: "3 hours", prerequisites: "", prerequisites_course_codes: [] };
  expect(adaptUntCatalog([entry])[0].credits).toBe(3);
  expect(() => adaptUntCatalog([entry], new Map([["CSCE 1030", -1]]))).toThrow("Supply credit hours");
});
