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
  // The requirement-scoped universe is the five seed-data core courses (all
  // completed on the sample transcript) plus the prerequisites they name.
  expect(analysis.universe).toHaveLength(10);
  for (const id of ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"]) {
    const course = analysis.courses.get(id);
    expect(course?.group).toBe("required");
    expect(course?.status).toBe("done");
    expect(course?.remainingChain).toBe(0);
  }
  // Every required course is done, so nothing remains on the critical path and
  // the only recommendation is the one eligible closure course.
  expect(analysis.remainingCriticalPath).toBe(0);
  expect(recommendations.map((rec) => rec.courseId)).toEqual(["CSCE 1010"]);
  expect(recommendations.reduce((total, rec) => total + rec.credits, 0)).toBeLessThanOrEqual(15);
  // Advisor-check requirements in the closure (CSCE 1035, MATH 1100, MATH 1650)
  // are unknown, never presented as takeable.
  for (const id of ["CSCE 1035", "MATH 1100", "MATH 1650"]) {
    const course = analysis.courses.get(id);
    expect(course?.status).toBe("unknown");
    expect(course?.available).toBe(false);
  }
});
