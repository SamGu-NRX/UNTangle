/**
 * Checks shared by the optimizer tests and the mutation tests. Each takes the
 * optimize function under test and returns a list of failures (empty = pass),
 * so a mutation test can assert that a planted bug makes a check fail.
 */

import type { OptDateRange, OptDay, OptimizeRequest, OptimizeResult, OptMeeting } from "@/lib/optimizer/types";
import { FIRST_HALF, FULL_TERM, generateInstance, SECOND_HALF, syntheticWalkingTime, type InstanceShape } from "./generator";
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

/** Small instances with Spring 2027 half-term dates and weekend meetings (see `terms` in generator.ts). */
export const TERM_SHAPES: InstanceShape[] = [
  { courses: 3, sectionsPerCourse: [3, 7], style: "irregular", constraintDensity: 0.4, terms: true },
  { courses: 4, sectionsPerCourse: [2, 5], style: "irregular", constraintDensity: 0.5, walking: "non-metric", terms: true },
  { courses: 5, sectionsPerCourse: [2, 5], style: "realistic", constraintDensity: 0.4, terms: true },
  { courses: 4, sectionsPerCourse: [3, 6], style: "realistic", constraintDensity: 0.3, walking: "non-metric", terms: true },
];

/**
 * A dated instance with the walking check forced on (the generated buffer,
 * else 0) or off. Off also zeroes the walking weight, so buildings matter
 * to nothing and the time-only twin rule is the one in play.
 */
export function termInstance(seed: number, walking: boolean): OptimizeRequest {
  const request = generateInstance(seed, TERM_SHAPES[seed % TERM_SHAPES.length]);
  return walking
    ? { ...request, constraints: { ...request.constraints, walking: request.constraints.walking ?? { bufferMinutes: 0 } } }
    : { ...request, constraints: { ...request.constraints, walking: null }, weights: { ...request.weights, walking: 0 } };
}

/** The same request with every meeting's dates removed. */
export function withoutDates(request: OptimizeRequest): OptimizeRequest {
  return {
    ...request,
    courses: request.courses.map((course) => ({
      ...course,
      sections: course.sections.map((section) => ({
        ...section,
        meetings: section.meetings.map((m) => ({ day: m.day, start: m.start, end: m.end, buildingId: m.buildingId })),
      })),
    })),
  };
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
export function checkAgainstReference(
  optimize: OptimizeFn,
  seeds: number[],
  instance: (seed: number) => OptimizeRequest = smallInstance,
): string[] {
  const failures: string[] = [];
  for (const seed of seeds) {
    const request = instance(seed);
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
export function checkExplanations(
  optimize: OptimizeFn,
  seeds: number[],
  // Seeds above 400 use a dense profile, where several independent conflicts are common.
  instance: (seed: number) => OptimizeRequest = (seed) =>
    seed > 400
      ? generateInstance(seed, { courses: 4, sectionsPerCourse: [2, 4], style: "irregular", constraintDensity: 0.95, walking: "non-metric" })
      : smallInstance(seed),
): { failures: string[]; checked: number } {
  const failures: string[] = [];
  let checked = 0;
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

type RegressionCase = { name: string; request: OptimizeRequest; verify: (result: OptimizeResult) => string | null };

/** Review regressions (PR #32, Astra) and the meeting-dates cases, each a fixed instance with a known answer. */
export function regressionCases(): RegressionCase[] {
  const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
  const base = { term: FULL_TERM, locks: {}, excluded: [], walkingTime: syntheticWalkingTime, timeBudgetMs: 60_000, explainBudgetMs: 60_000 };
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
  const at = (day: OptDay, start: number, end: number, buildingId: string, dates?: OptDateRange) => ({ day, start, end, buildingId, dates });
  const one = (code: string, id: string, meetings: OptMeeting[]) => ({ id, courseCode: code, rating: null, meetings });
  // X -> Y 5 minutes, X -> Z and Y -> Z 15 minutes, LANG <-> GAB 15 minutes.
  const campus: OptimizeRequest["walkingTime"] = (from, to) => {
    if (from === to) return { seconds: 0, source: "campus-network" };
    return { seconds: [from, to].sort().join("") === "XY" ? 300 : 900, source: "campus-network" };
  };
  const walkingOn = { ...none, walking: { bufferMinutes: 0 } };
  const spanish = [
    // SPAN 2040-051 and 2050-051: TR 3:30-6:20 PM, first and second eight weeks.
    { code: "SPAN 2040", credits: 3, sections: [one("SPAN 2040", "span2040-051", [at("Tue", 930, 1100, "LANG", FIRST_HALF), at("Thu", 930, 1100, "LANG", FIRST_HALF)])] },
    { code: "SPAN 2050", credits: 3, sections: [one("SPAN 2050", "span2050-051", [at("Tue", 930, 1100, "GAB", SECOND_HALF), at("Thu", 930, 1100, "GAB", SECOND_HALF)])] },
  ];
  const fullAndFirstHalf = (full: OptDateRange | undefined) => [
    { code: "A", credits: 3, sections: [one("A", "a0", [at("Tue", 930, 1100, "X", full)])] },
    { code: "B", credits: 3, sections: [one("B", "b0", [at("Tue", 960, 1010, "X", FIRST_HALF)])] },
  ];
  // A full-term class in X ends 9:50; at 10:00 a first-half class in Y (5 min away)
  // and a second-half class in Z (15 min away) both follow it.
  const fork = (secondHalfLater: boolean) => [
    { code: "A", credits: 3, sections: [one("A", "a0", [at("Mon", 540, 590, "X")])] },
    { code: "B", credits: 3, sections: [one("B", "b0", [at("Mon", 600, 650, "Y", FIRST_HALF)])] },
    {
      code: "C",
      credits: 3,
      sections: [
        one("C", "c0", [at("Mon", 600, 650, "Z", SECOND_HALF)]),
        ...(secondHalfLater ? [one("C", "c1", [at("Mon", 660, 710, "Z", SECOND_HALF)])] : []),
      ],
    },
  ];
  const weekend = [
    { code: "A", credits: 3, sections: [one("A", "a0", [at("Mon", 540, 590, "X"), at("Sat", 540, 650, "X")])] },
    {
      code: "B",
      credits: 3,
      sections: [one("B", "b0", [at("Sat", 600, 700, "X")]), one("B", "b1", [at("Sat", 660, 710, "X")]), one("B", "b2", [at("Sun", 540, 590, "X")])],
    },
  ];
  const picked = (r: OptimizeResult) => `${r.status} ${JSON.stringify(r.schedules.map((s) => [s.byCourse, s.cost, s.breakdown]))}`;
  // Meeting dates and weekend days (UNT Spring 2027 sections).
  const bridge = [
    { code: "A", credits: 3, sections: [one("A", "a", [at("Mon", 540, 600, "X")])] },
    { code: "B", credits: 3, sections: [one("B", "b-mon", [at("Mon", 610, 660, "Y", FULL_TERM)]), one("B", "b-tue", [at("Tue", 610, 660, "Y", FULL_TERM)])] },
    { code: "C", credits: 3, sections: [one("C", "c", [at("Mon", 670, 720, "Z")])] },
  ];
  const sundayTouch = [
    { code: "A", credits: 3, sections: [one("A", "a", [at("Mon", 540, 590, "X", { start: "2027-01-11", end: "2027-01-17" })])] },
    { code: "B", credits: 3, sections: [one("B", "b", [at("Mon", 540, 590, "Y", { start: "2027-01-17", end: "2027-01-24" })])] },
  ];
  const dated: RegressionCase[] = [
    {
      name: "full-term Monday bridge leaves 20 idle minutes, not an outside-term pair",
      request: { ...base, courses: bridge, constraints: none, weights: { ...zero, compact: 1 }, k: 1 },
      verify: (r) => r.status === "optimal" && r.schedules[0].byCourse.B === "b-mon" && r.schedules[0].cost === 1200 && r.schedules[0].breakdown.gapMinutes === 20 ? null : picked(r),
    },
    {
      name: "an outside-term A-to-C walk cannot make the Monday bridge infeasible",
      request: { ...base, courses: bridge, locks: { B: "b-mon" }, constraints: walkingOn, weights: zero, k: 1,
        walkingTime: (from, to) => ({ seconds: from === "X" && to === "Z" ? 5000 : 300, source: "campus-network" }) },
      verify: (r) => r.status === "optimal" && r.schedules[0].breakdown.gapMinutes === 20 ? null : picked(r),
    },
    {
      name: "Monday ranges sharing only Sunday have no conflicting occurrence",
      request: { ...base, courses: sundayTouch, constraints: none, weights: zero, k: 1 },
      verify: (r) => r.status === "optimal" ? null : picked(r),
    },
    {
      name: "Monday ranges sharing only Sunday have no back-to-back walk or gap",
      request: { ...base, courses: sundayTouch.map((c, i) => ({ ...c, sections: c.sections.map((s) => ({ ...s, meetings: s.meetings.map((m) => ({ ...m, start: m.start + 60 * i, end: m.end + 60 * i })) })) })), constraints: walkingOn, weights: { ...zero, compact: 1, walking: 1 }, walkingTime: campus, k: 1 },
      verify: (r) => r.status === "optimal" && r.schedules[0].cost === 0 && r.schedules[0].breakdown.gapMinutes === 0 && r.schedules[0].breakdown.walkSeconds === 0 ? null : picked(r),
    },
    {
      name: "SPAN 2040 and 2050 share a slot in different halves: both fit, never back to back",
      request: { ...base, walkingTime: campus, courses: spanish, constraints: walkingOn, weights: { ...zero, walking: 1, compact: 1 }, k: 3 },
      verify: (r) =>
        r.status === "optimal" &&
        r.schedules.length === 1 &&
        r.schedules[0].byCourse["SPAN 2040"] === "span2040-051" &&
        r.schedules[0].byCourse["SPAN 2050"] === "span2050-051" &&
        r.schedules[0].cost === 0 &&
        r.schedules[0].breakdown.daysOnCampus === 2
          ? null
          : picked(r),
    },
    {
      name: "an undated class and a first-half class in the same slot conflict",
      request: { ...base, courses: fullAndFirstHalf(undefined), constraints: none, weights: zero, k: 1 },
      verify: (r) => (r.status === "infeasible" ? null : picked(r)),
    },
    {
      name: "a full-term dated class and a first-half class in the same slot conflict",
      request: { ...base, courses: fullAndFirstHalf(FULL_TERM), constraints: none, weights: zero, k: 1 },
      verify: (r) => (r.status === "infeasible" ? null : picked(r)),
    },
    {
      name: "a class followed by different classes in each half: both walks are checked",
      request: { ...base, walkingTime: campus, courses: fork(false), constraints: walkingOn, weights: zero, k: 1 },
      verify: (r) => (r.status === "infeasible" ? null : picked(r)),
    },
    {
      name: "a class followed by different classes in each half: the later second-half class fits, both pairs count",
      request: { ...base, walkingTime: campus, courses: fork(true), constraints: walkingOn, weights: { ...zero, walking: 1, compact: 1 }, k: 1 },
      // Pairs: a0 -> b0 (10 idle minutes, 300 s) and a0 -> c1 (70 minutes, 900 s). b0 -> c1 never share a week.
      verify: (r) =>
        r.status === "optimal" &&
        r.schedules[0].byCourse.C === "c1" &&
        r.schedules[0].breakdown.gapMinutes === 80 &&
        r.schedules[0].breakdown.walkSeconds === 1200 &&
        r.schedules[0].cost === 80 * 60 + 1200
          ? null
          : picked(r),
    },
    {
      name: "Saturday classes conflict with each other, and Saturday and Sunday count as days on campus",
      request: { ...base, courses: weekend, constraints: none, weights: { ...zero, fewerDays: 1 }, k: 3 },
      verify: (r) => {
        const days = r.schedules.map((s) => [s.byCourse.B, s.breakdown.daysOnCampus]);
        return r.status === "optimal" && JSON.stringify(days) === JSON.stringify([["b1", 2], ["b2", 3]]) ? null : picked(r);
      },
    },
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
    ...dated,
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
