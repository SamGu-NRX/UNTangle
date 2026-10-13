/**
 * Checks shared by the optimizer tests and the mutation tests. Each takes the
 * optimize function under test and returns a list of failures (empty = pass),
 * so a mutation test can assert that a planted bug makes a check fail.
 */

import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import { generateInstance, syntheticWalkingTime, type InstanceShape } from "./generator";
import {
  combinationCount,
  referenceRelax,
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
  // Seeds above 400 use a dense profile, where several independent conflicts are common.
  const instance = (seed: number) =>
    seed > 400
      ? generateInstance(seed, { courses: 4, sectionsPerCourse: [2, 4], style: "irregular", constraintDensity: 0.95, walking: "non-metric" })
      : smallInstance(seed);
  for (const seed of seeds) {
    const request = instance(seed);
    if (combinationCount(request) > 20_000) continue;
    const result = optimize(request);
    if (result.status !== "infeasible") continue;
    checked += 1;
    const { members, minimal, sentence } = result.explanation;
    const fail = (message: string) => failures.push(`seed ${seed}: ${message}`);
    if (referenceFeasible(referenceRestrict(request, members))) fail(`set ${JSON.stringify(members)} is feasible on its own`);
    // Each constraint the explanation names is needed by the full request:
    // with every course kept, relaxing just that one makes the rest fit.
    const allCourses = request.courses.map((course) => ({ kind: "course" as const, courseCode: course.code }));
    const named = members.filter((m) => m.kind !== "course");
    if (minimal) {
      named.forEach((member, index) => {
        const others = named.filter((_, i) => i !== index);
        if (!referenceFeasible(referenceRestrict(request, [...allCourses, ...others]))) {
          fail(`${JSON.stringify(member)} is blamed but not needed by the full request`);
        }
      });
      members.forEach((member, index) => {
        const without = members.filter((_, i) => i !== index);
        if (!referenceFeasible(referenceRestrict(request, without))) fail(`marked minimal, but dropping ${JSON.stringify(member)} leaves it infeasible`);
      });
    } else if (!sentence.startsWith("These can't all hold together")) {
      fail(`not minimal, yet worded as a precise cause: ${sentence}`);
    } else if (!members.some((m) => m.kind === "walking")) {
      // With an unlimited budget only the walking check may leave a set unreduced.
      fail(`not minimal without the walking check: ${JSON.stringify(members)}`);
    }
    for (const suggestion of result.explanation.suggestions) {
      const truth = referenceFeasible(referenceRelax(request, suggestion.relaxation));
      if (suggestion.resolves !== truth) fail(`suggestion "${suggestion.label}" says resolves=${suggestion.resolves}, reference says ${truth}`);
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

const X = "b-arts";
const meet = (day: "Mon" | "Tue", start: number, end: number, buildingId: string | null = X) => ({ day, start, end, buildingId });

/** Review regressions (PR #32, Astra), each a fixed instance with a known answer. */
export function regressionCases(): Array<{ name: string; request: OptimizeRequest; verify: (result: OptimizeResult) => string | null }> {
  const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
  const base = { locks: {}, excluded: [], walkingTime: syntheticWalkingTime, timeBudgetMs: 60_000, explainBudgetMs: 60_000 };
  // One section can fill a break with two meetings; crediting only its
  // longest meeting overestimated the bound and proved a worse schedule.
  const fillCourses = [
    { code: "A", credits: 3, sections: [
      { id: "a0", courseCode: "A", rating: null, meetings: [meet("Mon", 540, 550), meet("Mon", 650, 660)] },
      { id: "a1", courseCode: "A", rating: null, meetings: [meet("Mon", 740, 750), meet("Mon", 770, 780)] },
    ] },
    { code: "B", credits: 3, sections: [
      { id: "b0", courseCode: "B", rating: null, meetings: [meet("Mon", 550, 600), meet("Mon", 600, 650)] },
      { id: "b1", courseCode: "B", rating: null, meetings: [meet("Mon", 750, 755), meet("Mon", 760, 770)] },
      { id: "b2", courseCode: "B", rating: null, meetings: [meet("Tue", 540, 600)] },
    ] },
  ];
  // 600.5 s between two buildings 10 minutes apart: rounds to 601 s, so it doesn't fit.
  const fractional: OptimizeRequest["walkingTime"] = (from, to) =>
    from === to ? { seconds: 0, source: "campus-network" } : { seconds: 600.5, source: "campus-network" };
  const walkCourses = [
    { code: "P", credits: 3, sections: [{ id: "p0", courseCode: "P", rating: null, meetings: [meet("Mon", 540, 590, "b-arts")] }] },
    { code: "Q", credits: 3, sections: [
      { id: "q0", courseCode: "Q", rating: null, meetings: [meet("Mon", 600, 650, "b-sci")] },
      { id: "q1", courseCode: "Q", rating: null, meetings: [meet("Mon", 601, 651, "b-sci")] },
    ] },
  ];
  return [
    {
      name: "fill bound, k=1",
      request: { ...base, courses: fillCourses, constraints: none, weights: { ...zero, compact: 1 }, k: 1 },
      verify: (r) => (r.status === "optimal" && r.schedules[0].cost === 0 && r.schedules[0].byCourse.A === "a0" && r.schedules[0].byCourse.B === "b0" ? null : `got ${r.status} ${JSON.stringify(r.schedules.map((s) => [s.byCourse, s.cost]))}`),
    },
    {
      name: "fill bound, k=3 ascending",
      request: { ...base, courses: fillCourses, constraints: none, weights: { ...zero, compact: 1 }, k: 3 },
      verify: (r) => {
        const costs = r.schedules.map((s) => s.cost);
        return costs[0] === 0 && costs.every((c, i) => i === 0 || costs[i - 1] <= c) ? null : `costs ${costs.join(",")}`;
      },
    },
    {
      name: "fractional walking seconds",
      request: { ...base, walkingTime: fractional, courses: walkCourses, constraints: { ...none, walking: { bufferMinutes: 0 } }, weights: { ...zero, walking: 1 }, k: 3 },
      verify: (r) => (r.status === "optimal" && r.schedules.length === 1 && r.schedules[0].byCourse.Q === "q1" && r.schedules[0].breakdown.walkSeconds === 601 ? null : `got ${r.status} ${JSON.stringify(r.schedules.map((s) => [s.byCourse, s.breakdown.walkSeconds]))}`),
    },
  ];
}

export function checkRegressions(optimize: OptimizeFn): string[] {
  const failures: string[] = [];
  for (const { name, request, verify } of regressionCases()) {
    let message: string | null;
    try {
      message = verify(optimize(request));
    } catch (error) {
      message = String(error);
    }
    if (message) failures.push(`${name}: ${message}`);
    const reference = referenceTopK(request);
    if (reference.schedules[0] && message === null) {
      const result = optimize(request);
      if (result.schedules[0]?.cost !== reference.schedules[0].cost) failures.push(`${name}: disagrees with the reference`);
    }
  }
  return failures;
}
