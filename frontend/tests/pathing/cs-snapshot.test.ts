import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { buildCsScenario } from "./cs-report";

test("Computer Science, BS pathing report matches the committed snapshot", () => {
  const { report, unparseableRows, prereqCoverage, result, analysis, recommendations } = buildCsScenario();
  expect(unparseableRows).toEqual([]);
  expect(prereqCoverage).toEqual({ full: 441, partial: 170, unknown: 58 });
  expect(report).toBe(readFileSync(new URL("./cs-report.fixture.txt", import.meta.url), "utf8"));

  // 2110, 3444, 4901, 4902 (and ENGL 1310, TECM 2700, 4901, 4902) is the longest chain.
  expect(analysis.remainingCriticalPath).toBe(4);
  expect(recommendations.map((rec) => rec.courseId)).toEqual(["ENGL 1310", "CSCE 3550", "MATH 2700", "MATH 1780", "BIOL 1132"]);
  expect(recommendations.reduce((total, rec) => total + rec.credits, 0)).toBe(15);
  // The transcript's finished courses, and the CSCE 1035 and MATH 1100 behind
  // them, are off the remaining path, so none is ever recommended.
  for (const id of ["CSCE 1010", "CSCE 1030", "CSCE 1035", "MATH 1100"]) {
    expect(analysis.courses.get(id)!.onRemainingPath).toBe(false);
  }

  // CSCE 2110 would lead the term, but the parser reads its corequisite note
  // ("can be taken concurrently with CSCE 2100") as an advisor check, so the
  // engine reports it unknown and it is never presented as available.
  expect(result.statuses.get("CSCE 2110")!.status).toBe("unknown");
  expect(analysis.courses.get("CSCE 2110")!.available).toBe(false);
  expect(analysis.courses.get("CSCE 2110")!.unlocksTransitive).toHaveLength(10);
  expect(analysis.advisorChecks).toEqual(["CSCE 2110", "CSCE 2610", "EENG 2710"]);
});
