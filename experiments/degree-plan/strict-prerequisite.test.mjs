import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog, majorUniverse } from "./lib/catalog.mjs";
import { buildProblem, enumerate } from "./lib/degree-plan.mjs";
import { validatePlan } from "./lib/checker.mjs";
import { STATUS } from "./lib/semantics.mjs";

function reproducedProblem() {
  const catalog = loadCatalog();
  const { core, universe } = majorUniverse(catalog, "cs");
  const courseStatuses = Object.fromEntries(universe.map(course => [course.code, STATUS.REMAINING]));
  courseStatuses["CSCE 1030"] = STATUS.DONE;
  courseStatuses["MATH 1710"] = STATUS.DONE;
  const problem = buildProblem({
    universe,
    courseStatuses,
    termCap: 15,
    horizon: 6,
    anchor: { year: 2026, kind: "F" },
    equivalence: "strict",
  });
  problem.coreCodes = new Set(core);
  return problem;
}

test("strict mode makes dependents of an unplannable prerequisite infeasible", () => {
  const problem = reproducedProblem();
  const result = enumerate(problem, { mode: "exhaustive", nodeBudget: 5_000_000 });

  assert.equal(result.feasible, false);
  assert.equal(result.exhaustiveComplete, true);
  assert.equal(problem.remaining.some(course => course.code === "CSCE 1040"), false);
  assert.ok(result.witness.blockers.some(blocker => blocker.code === "CSCE 1040"));
});

test("strict checker rejects an omitted prerequisite instead of treating it as pinned", () => {
  const problem = reproducedProblem();
  const csce1040 = problem.universe.find(course => course.code === "CSCE 1040");
  assert.ok(csce1040);
  const checkerProblem = { ...problem, remaining: [csce1040] };
  const result = validatePlan(checkerProblem, { "CSCE 1040": 1 });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("CSCE 1040") && error.includes("MATH 1650")));
});
