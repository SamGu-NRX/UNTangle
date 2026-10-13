/**
 * Checks shared by the optimizer tests and the mutation tests. Each takes the
 * optimize function under test and returns a list of failures (empty = pass),
 * so a mutation test can assert that a planted bug makes a check fail.
 */

import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import { generateInstance, type InstanceShape } from "./generator";
import {
  combinationCount,
  referenceFeasible,
  referenceRestrict,
  referenceTopK,
  violations,
} from "./reference";

export type OptimizeFn = (request: OptimizeRequest) => OptimizeResult;

/** Small enough for the brute-force reference (at most a few thousand combinations). */
export const SMALL_SHAPES: InstanceShape[] = [
  { courses: 3, sectionsPerCourse: [2, 6], style: "irregular", constraintDensity: 0.5 },
  { courses: 4, sectionsPerCourse: [2, 5], style: "irregular", constraintDensity: 0.6, walking: "non-metric" },
  { courses: 5, sectionsPerCourse: [2, 4], style: "realistic", constraintDensity: 0.5 },
  { courses: 2, sectionsPerCourse: [3, 8], style: "realistic", constraintDensity: 0.8 },
  { courses: 4, sectionsPerCourse: [3, 6], style: "realistic", constraintDensity: 0.3, walking: "non-metric" },
];

export function smallInstance(seed: number): OptimizeRequest {
  return generateInstance(seed, SMALL_SHAPES[seed % SMALL_SHAPES.length]);
}

function sectionsOf(request: OptimizeRequest, byCourse: Record<string, string>) {
  const all = request.courses.flatMap((course) => course.sections);
  return Object.values(byCourse).map((id) => all.find((section) => section.id === id)!);
}

/**
 * On enumerable instances: same status, same schedules in the same order,
 * same costs and breakdowns as the reference, zero hard-constraint
 * violations, and the same diversity threshold.
 */
export function checkAgainstReference(optimize: OptimizeFn, seeds: number[]): string[] {
  const failures: string[] = [];
  for (const seed of seeds) {
    const request = smallInstance(seed);
    if (combinationCount(request) > 20_000) continue;
    const reference = referenceTopK(request);
    const result = optimize(request);
    const fail = (message: string) => failures.push(`seed ${seed}: ${message}`);
    if (reference.schedules.length === 0) {
      if (result.status !== "infeasible") fail(`expected infeasible, got ${result.status}`);
      continue;
    }
    if (result.status !== "optimal") {
      fail(`expected optimal, got ${result.status}`);
      continue;
    }
    if (result.stats.minDifferentCourses !== reference.minDifferent) {
      fail(`diversity threshold ${result.stats.minDifferentCourses}, reference ${reference.minDifferent}`);
    }
    if (result.schedules.length !== reference.schedules.length) {
      fail(`${result.schedules.length} schedules, reference ${reference.schedules.length}`);
    }
    result.schedules.forEach((schedule, rank) => {
      const problems = violations(request, sectionsOf(request, schedule.byCourse));
      if (problems.length > 0) fail(`rank ${rank} breaks ${problems.join(", ")}`);
      if (!schedule.proven) fail(`rank ${rank} not proven in an optimal result`);
      const expected = reference.schedules[rank];
      if (!expected) return;
      if (JSON.stringify(schedule.byCourse) !== JSON.stringify(expected.byCourse) || schedule.cost !== expected.cost) {
        fail(`rank ${rank}: ${JSON.stringify(schedule.byCourse)} cost ${schedule.cost}, reference ${JSON.stringify(expected.byCourse)} cost ${expected.cost}`);
      }
      const b = schedule.breakdown;
      const e = expected.breakdown;
      for (const key of Object.keys(e) as Array<keyof typeof e>) {
        if (b[key] !== e[key]) fail(`rank ${rank} breakdown ${key} ${b[key]}, reference ${e[key]}`);
      }
    });
  }
  return failures;
}

/**
 * On infeasible enumerable instances: the explanation's set is infeasible on
 * its own, dropping any one member makes it feasible (checked by the
 * reference), and the result says it is minimal.
 */
export function checkExplanations(optimize: OptimizeFn, seeds: number[]): { failures: string[]; checked: number } {
  const failures: string[] = [];
  let checked = 0;
  for (const seed of seeds) {
    const request = smallInstance(seed);
    if (combinationCount(request) > 20_000) continue;
    const result = optimize(request);
    if (result.status !== "infeasible") continue;
    checked += 1;
    const { members, minimal } = result.explanation;
    const fail = (message: string) => failures.push(`seed ${seed}: ${message}`);
    if (!minimal) fail("explanation not marked minimal with an unlimited budget");
    if (referenceFeasible(referenceRestrict(request, members))) fail(`set ${JSON.stringify(members)} is feasible on its own`);
    members.forEach((member, index) => {
      const without = members.filter((_, i) => i !== index);
      if (!referenceFeasible(referenceRestrict(request, without))) fail(`dropping ${JSON.stringify(member)} leaves it infeasible`);
    });
    for (const suggestion of result.explanation.suggestions) {
      if (suggestion.resolves === null) fail(`suggestion ${suggestion.label} unchecked with an unlimited budget`);
    }
  }
  return { failures, checked };
}

/** Large instances: whatever comes back breaks no hard constraint. */
export function checkLargeInstancesValid(optimize: OptimizeFn, seeds: number[]): string[] {
  const failures: string[] = [];
  for (const seed of seeds) {
    const request = generateInstance(seed, { courses: 6, sectionsPerCourse: 25, style: "realistic", constraintDensity: 0.5 });
    const result = optimize({ ...request, timeBudgetMs: 300 });
    for (const [rank, schedule] of result.schedules.entries()) {
      const problems = violations(request, sectionsOf(request, schedule.byCourse));
      if (problems.length > 0) failures.push(`seed ${seed} rank ${rank}: ${problems.join(", ")}`);
    }
  }
  return failures;
}

/** A fake clock that advances 1 ms per reading: budgets run out after a known amount of work. */
export function steppingClock(): () => number {
  let t = 0;
  return () => (t += 1);
}

/**
 * Budgets are honored and reported honestly: a search stopped early never
 * claims `optimal`, every schedule it returns is valid, and a schedule is
 * only `proven` when its search finished.
 */
export function checkBudgets(optimize: OptimizeFn): string[] {
  const failures: string[] = [];
  // Instances whose full search needs far more work than the limits below,
  // so a run under those limits really is cut off.
  const hard: OptimizeRequest[] = [];
  for (let seed = 11; hard.length < 3 && seed < 60; seed += 1) {
    const request = generateInstance(seed, { courses: 8, sectionsPerCourse: 40, style: "realistic", constraintDensity: 0 });
    // Cut off after 5000 nodes with a schedule in hand: proving even the best
    // schedule takes more than that, so every limit below cuts it off.
    const probe = optimize({ ...request, k: 1, maxNodes: 5_000, timeBudgetMs: 30_000 });
    if (probe.status === "feasible") hard.push(request);
  }
  if (hard.length < 3) failures.push(`only ${hard.length} instances need more than 5000 nodes`);
  for (const [index, request] of hard.entries()) {
    for (const limit of [{ maxNodes: 200 }, { timeBudgetMs: 60, now: steppingClock() }]) {
      const result = optimize({ ...request, ...limit });
      const label = `instance ${index} ${JSON.stringify(Object.keys(limit))}`;
      if (result.status === "optimal") failures.push(`${label}: claimed optimal after a cut-off search (${result.stats.nodes} nodes)`);
      if (result.status === "infeasible") failures.push(`${label}: claimed infeasible after a cut-off search`);
      if (result.schedules[0]?.proven) failures.push(`${label}: best schedule marked proven after a cut-off search`);
      if (limit.maxNodes !== undefined && result.stats.nodes > limit.maxNodes + 1) failures.push(`${label}: ran ${result.stats.nodes} nodes`);
      for (const schedule of result.schedules) {
        const problems = violations(request, sectionsOf(request, schedule.byCourse));
        if (problems.length > 0) failures.push(`${label}: ${problems.join(", ")}`);
      }
    }
    const started = performance.now();
    optimize({ ...request, timeBudgetMs: 20 });
    const elapsed = performance.now() - started;
    // Preparation runs before the clock is first read; 150 ms leaves room for it.
    if (elapsed > 150) failures.push(`instance ${index}: 20 ms budget took ${elapsed.toFixed(0)} ms`);
  }
  return failures;
}
