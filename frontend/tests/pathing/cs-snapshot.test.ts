import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { buildCsScenario } from "./cs-report";

test("Computer Science, BS pathing report matches the committed snapshot", () => {
  const { report, unparseableRows, prereqCoverage, analysis, recommendations } = buildCsScenario();
  // Nothing in the catalog is silently skipped: every hour cell yields a leading integer.
  expect(unparseableRows).toEqual([]);
  // Parse fidelity is reported, not implied: 226 of 656 rows keep unparsed clauses
  // (advisor checks, equivalents, standing rules) instead of dropping them.
  expect(prereqCoverage).toEqual({ full: 430, partial: 168, unknown: 58 });
  expect(report).toBe(readFileSync(new URL("./cs-report.fixture.txt", import.meta.url), "utf8"));
  // Grounded data checks on the real catalog: the capstone chain never shows up as
  // takeable. CSCE 4901 is locked behind senior-standing hours and unmet CSCE 3444,
  // and CSCE 4902 adds an advisor-checked immediate-enrollment clause.
  expect(recommendations.some((rec) => rec.courseId === "CSCE 4901")).toBe(false);
  expect(recommendations.some((rec) => rec.courseId === "CSCE 4902")).toBe(false);
  // CSCE 2110's corequisite clause "This course can be taken concurrently with
  // CSCE 2100" parses to an advisor-check requirement, so it is never available.
  expect(analysis.courses.get("CSCE 2110")?.status).toBe("unknown");
  expect(analysis.courses.get("CSCE 2110")?.available).toBe(false);
  // The greedy plan respects the credit target.
  expect(recommendations.reduce((total, rec) => total + rec.credits, 0)).toBeLessThanOrEqual(15);
});
