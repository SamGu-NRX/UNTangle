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

function scenarioRequest(id: string, change: (scenario: StudentScenario) => StudentScenario = (scenario) => scenario) {
  const scenario = change(scenarios.find((s) => s.id === id)!);
  const catalog = scenarioCatalog();
  const state = buildState(scenario, catalog);
  return { scenario, state, catalog, request: buildOptimizeRequest(state, scenario.preferences, { catalog }) };
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
    expect(requestFailures(async.scenario, async.state, async.request, async.catalog)).toEqual([]);
    expect(requestFailures(async.scenario, async.state, { ...async.request, fixedCredits: 0 }, async.catalog)).toEqual([
      "fixedCredits is 0, but CSCE 3550 outside the search carry 3",
    ]);

    const locked = scenarioRequest("cs-senior-capstone-locks");
    expect(requestFailures(locked.scenario, locked.state, { ...locked.request, locks: {} }, locked.catalog)).toHaveLength(1);

    const heavy = scenarioRequest("cs-maxcredits-infeasible");
    const unlimited = { ...heavy.request, constraints: { ...heavy.request.constraints, maxCredits: null } };
    expect(requestFailures(heavy.scenario, heavy.state, unlimited, heavy.catalog)).toEqual(["maxCredits is null, not the scenario's 13"]);
  });

  test("requestFailures catches a searchable course moved into fixedCredits", () => {
    const plain = scenarioRequest("cs-sophomore-no-friday");
    const dropped = plain.request.courses.find((course) => course.code === "MATH 2700")!;
    const moved = {
      ...plain.request,
      courses: plain.request.courses.filter((course) => course !== dropped),
      fixedCredits: (plain.request.fixedCredits ?? 0) + dropped.credits,
    };
    expect(requestFailures(plain.scenario, plain.state, moved, plain.catalog).join(" ")).toContain("request leaves MATH 2700 out of the search");
  });

  test("requestFailures catches a lock on a pick the optimizer could move", () => {
    // The excluded-one-section scenario without its lock: CSCE 3444 001 is picked and offered, so it stays free.
    const unpinned = scenarioRequest("cs-excluded-one-section", (scenario) => ({ ...scenario, locks: {} }));
    expect(requestFailures(unpinned.scenario, unpinned.state, unpinned.request, unpinned.catalog)).toEqual([]);
    const pick = unpinned.state.selectedSections["CSCE 3444"]!;
    const pinned = { ...unpinned.request, locks: { ...unpinned.request.locks, "CSCE 3444": pick } };
    expect(requestFailures(unpinned.scenario, unpinned.state, pinned, unpinned.catalog)).toEqual([
      `request locks CSCE 3444 to ${pick}, which the scenario doesn't lock and the planner needn't hold`,
    ]);
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
