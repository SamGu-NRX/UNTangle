/**
 * The scenario suite: every real-student scenario runs through the real
 * optimizer path and must agree with the independent reference solver. See
 * tests/optimizer/scenarios/ for the fixture provenance and the runner that
 * writes REPORT.md.
 */

import { describe, expect, test } from "bun:test";
import { buildState, evaluateScenario } from "./scenarios/evaluate";
import { scenarioCatalog } from "./scenarios/catalog";
import { scenarios, type StudentScenario } from "./scenarios/students";

describe("optimizer auto-evaluation: real-student scenarios", () => {
  test("scenario set is non-trivial", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(25);
  });

  test("every scenario takes four to six next-term courses", () => {
    for (const scenario of scenarios) {
      expect(scenario.nextTerm.length).toBeGreaterThanOrEqual(4);
      expect(scenario.nextTerm.length).toBeLessThanOrEqual(6);
    }
  });

  test("buildState refuses a course that is both completed and next-term", () => {
    const base = scenarios[0];
    const overlapping: StudentScenario = {
      ...base,
      id: "test-overlap",
      completed: [...base.completed, { code: base.nextTerm[0]!, grade: "A" }],
    };
    expect(() => buildState(overlapping, scenarioCatalog())).toThrow(/both completed and next-term/);
  });

  for (const scenario of scenarios) {
    test(`scenario ${scenario.id}`, () => {
      const evaluation = evaluateScenario(scenario);
      if (!evaluation.ok) {
        throw new Error(`${scenario.id}: ${evaluation.failures.join(" | ")}`);
      }
      expect(evaluation.ok).toBe(true);
    });
  }
});
