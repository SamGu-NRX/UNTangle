import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCatalog, majorUniverse } from "./lib/catalog.mjs";
import { buildProblem, enumerate } from "./lib/degree-plan.mjs";
import { validatePlan } from "./lib/checker.mjs";
import { STATUS } from "./lib/semantics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog();

function majorProblem(majorId, equivalence, statuses = {}) {
  const { core, universe } = majorUniverse(catalog, majorId);
  const courseStatuses = Object.fromEntries(universe.map(course => [course.code, STATUS.REMAINING]));
  Object.assign(courseStatuses, statuses);
  const problem = buildProblem({
    universe,
    courseStatuses,
    termCap: 15,
    horizon: 6,
    anchor: { year: 2026, kind: "F" },
    equivalence,
  });
  problem.coreCodes = new Set(core);
  return problem;
}

function reproducedProblem() {
  return majorProblem("cs", "strict", {
    "CSCE 1030": STATUS.DONE,
    "MATH 1710": STATUS.DONE,
  });
}

function course(code, prereqs = [], gapPrereqRefs = []) {
  return { code, title: code, creditHours: 3, prereqRefs: prereqs, prereqs, gapPrereqRefs };
}

function syntheticProblem(universe, equivalence = "strict") {
  const problem = buildProblem({
    universe,
    courseStatuses: Object.fromEntries(universe.map(c => [c.code, STATUS.REMAINING])),
    termCap: 15,
    horizon: 6,
    anchor: { year: 2026, kind: "F" },
    equivalence,
  });
  problem.coreCodes = new Set(universe.map(c => c.code));
  return problem;
}

const entryFor = (problem, code) => problem.unplannable.find(entry => entry.code === code);

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

test("assume mode leaves every remaining course plannable", () => {
  const problem = majorProblem("cs", "assume");
  const result = enumerate(problem, { mode: "exhaustive" });

  assert.deepEqual(problem.unplannable, []);
  assert.equal(problem.remaining.length, problem.universe.length);
  assert.equal(result.feasible, true);
  assert.equal(validatePlan(problem, result.best).valid, true);
});

test("strict blocking propagates two levels and names the root gap", () => {
  // The dependent is listed before its blocked prerequisite so a single
  // in-order pass would read the prerequisite's causes before they exist.
  const problem = syntheticProblem([
    course("X 300", ["X 200"]),
    course("X 200", ["X 100"]),
    course("X 100", [], [{ code: "Z 999", kind: "uncataloged" }]),
  ]);

  assert.deepEqual(problem.remaining, []);
  assert.deepEqual(entryFor(problem, "X 200"), {
    code: "X 200",
    blockedBy: ["X 100"],
    uncatalogedPrereqs: ["Z 999"],
    selfRefs: [],
  });
  assert.deepEqual(entryFor(problem, "X 300"), {
    code: "X 300",
    blockedBy: ["X 200"],
    uncatalogedPrereqs: ["Z 999"],
    selfRefs: [],
  });

  const result = enumerate(problem, { mode: "exhaustive" });
  const blocker = result.witness.blockers.find(b => b.code === "X 300");
  assert.equal(
    blocker.detail,
    "Depends on X 200, which cannot be planned in strict mode because Z 999 is not a catalog course.",
  );
});

test("strict mode blocks a co-requisite whose partner is blocked", () => {
  // Every prerequisite of CSCE 2110 is Done; its co-requisite CSCE 2100
  // still needs MATH 1710, which strict mode cannot plan.
  const done = ["CSCE 1010", "CSCE 1030", "CSCE 1035", "CSCE 1040", "CSCE 1045", "MATH 1100", "MATH 1650"];
  const problem = majorProblem("cs", "strict", Object.fromEntries(done.map(code => [code, STATUS.DONE])));

  assert.deepEqual(entryFor(problem, "CSCE 2100").blockedBy, ["MATH 1710"]);
  assert.deepEqual(entryFor(problem, "CSCE 2110"), {
    code: "CSCE 2110",
    blockedBy: ["CSCE 2100"],
    uncatalogedPrereqs: ["MATH 1600", "MATH 1610"],
    selfRefs: [],
  });
  assert.equal(problem.remaining.some(c => c.code === "CSCE 2110"), false);

  const csce2110 = problem.universe.find(c => c.code === "CSCE 2110");
  const check = validatePlan({ ...problem, remaining: [csce2110] }, { "CSCE 2110": 1 });
  assert.equal(check.valid, false);
  assert.ok(check.errors.some(error => error.includes("CSCE 2110") && error.includes("co-requisite CSCE 2100")));
});

test("a Done co-requisite partner does not block the other member", () => {
  const done = ["CSCE 1010", "CSCE 1030", "CSCE 1035", "CSCE 1040", "CSCE 1045", "MATH 1100", "MATH 1650", "CSCE 2100"];
  const problem = majorProblem("cs", "strict", Object.fromEntries(done.map(code => [code, STATUS.DONE])));

  assert.equal(entryFor(problem, "CSCE 2110"), undefined);
  assert.ok(problem.remaining.some(c => c.code === "CSCE 2110"));
});

test("a Taking course satisfies a strict prerequisite", () => {
  const problem = majorProblem("math", "strict", {
    "MATH 1100": STATUS.DONE,
    "MATH 1650": STATUS.DONE,
    "MATH 1710": STATUS.PLANNED,
  });
  const result = enumerate(problem, { mode: "exhaustive" });

  assert.deepEqual(problem.unplannable, []);
  assert.equal(result.feasible, true);
  assert.deepEqual(result.best, { "MATH 1720": 1, "MATH 2700": 2 });
  assert.equal(validatePlan(problem, result.best).valid, true);
});

test("strict enumerate refuses a problem without coreCodes", () => {
  const problem = reproducedProblem();
  delete problem.coreCodes;
  assert.throws(() => enumerate(problem, { mode: "exhaustive" }), /problem\.coreCodes/);
});

test("replay reproduces the committed results", () => {
  const run = spawnSync(process.execPath, [path.join(here, "run.mjs"), "--replay", path.join(here, "results")], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
});
