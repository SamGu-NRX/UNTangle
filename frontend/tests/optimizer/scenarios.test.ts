/**
 * The scenario suite: every real-student scenario runs through the real
 * optimizer path and must agree with the independent reference solver. See
 * tests/optimizer/scenarios/ for the fixture provenance and the runner that
 * writes REPORT.md.
 */

import { describe, expect, test } from "bun:test";
import { evaluateScenario } from "./scenarios/evaluate";
import { scenarios } from "./scenarios/students";

describe("optimizer auto-evaluation: real-student scenarios", () => {
  test("scenario set is non-trivial", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(25);
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
