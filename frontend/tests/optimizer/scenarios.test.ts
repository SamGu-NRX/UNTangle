/**
 * The scenario suite: every real-student scenario runs through the real
 * optimizer path and must agree with the independent reference solver. See
 * tests/optimizer/scenarios/ for the fixture provenance and the runner that
 * writes REPORT.md.
 */

import { describe, expect, test } from "bun:test";
import { buildOptimizeRequest } from "@/lib/planner";
import { optimize } from "@/lib/optimizer/optimize";
import { explanationFailures } from "./checks";
import { buildState, evaluateScenario, requestFailures } from "./scenarios/evaluate";
import { scenarioCatalog } from "./scenarios/catalog";
import { scenarios, type StudentScenario } from "./scenarios/students";

function scenarioRequest(id: string) {
  const scenario = scenarios.find((s) => s.id === id)!;
  const state = buildState(scenario, scenarioCatalog());
  return { scenario, state, request: buildOptimizeRequest(state, scenario.preferences, { catalog: scenarioCatalog() }) };
}

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

  test("requestFailures catches a request that dropped credits, a lock or maxCredits", () => {
    const async = scenarioRequest("cs-locked-async-rides-along");
    expect(requestFailures(async.scenario, async.state, async.request)).toEqual([]);
    expect(requestFailures(async.scenario, async.state, { ...async.request, fixedCredits: 0 })).toEqual([
      "fixedCredits is 0, but CSCE 3550 outside the search carry 3",
    ]);

    const locked = scenarioRequest("cs-senior-capstone-locks");
    expect(requestFailures(locked.scenario, locked.state, { ...locked.request, locks: {} })).toHaveLength(1);

    const heavy = scenarioRequest("cs-maxcredits-infeasible");
    const unlimited = { ...heavy.request, constraints: { ...heavy.request.constraints, maxCredits: null } };
    expect(requestFailures(heavy.scenario, heavy.state, unlimited)).toEqual(["maxCredits is null, not the scenario's 13"]);
  });

  test("explanationFailures rejects a set that fits, or one marked minimal with a spare member", () => {
    const { request } = scenarioRequest("cs-clash-infeasible");
    const result = optimize(request);
    if (result.status !== "infeasible") throw new Error(`expected infeasible, got ${result.status}`);
    const { explanation } = result;
    expect(explanationFailures(request, explanation)).toEqual([]);

    const one = { ...explanation, members: [{ kind: "course" as const, courseCode: "CSCE 4220" }] };
    expect(explanationFailures(request, one).join(" ")).toContain("is feasible on its own");

    const spare = { ...explanation, members: [...explanation.members, { kind: "course" as const, courseCode: "CSCE 4901" }] };
    expect(explanationFailures(request, spare).join(" ")).toContain("dropping");
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
