import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import {
  checkAgainstReference,
  checkBudgets,
  checkExplanations,
  checkLargeInstancesValid,
  smallInstance,
  termInstance,
  withoutDates,
} from "./checks";
import { referenceCost, referenceTopK } from "./reference";

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const TERM_SEEDS = Array.from({ length: 300 }, (_, i) => 7001 + i);

describe("optimizer against the brute-force reference", () => {
  test("matches status, ranked schedules, costs and breakdowns on 400 seeded instances", () => {
    expect(checkAgainstReference(optimize, SEEDS)).toEqual([]);
  });

  test("the seeded suite exercises every outcome the comparison relies on", () => {
    let infeasible = 0;
    let fewerThanK = 0;
    let threeAlternatives = 0;
    for (const seed of SEEDS) {
      const { schedules } = referenceTopK(smallInstance(seed));
      if (schedules.length === 0) infeasible += 1;
      else if (schedules.length < 3) fewerThanK += 1;
      else threeAlternatives += 1;
    }
    expect(infeasible).toBeGreaterThan(20);
    expect(fewerThanK).toBeGreaterThan(10);
    expect(threeAlternatives).toBeGreaterThan(50);
  });

  test("infeasibility explanations are minimal: the set conflicts, and dropping any member fixes it", () => {
    const { failures, checked } = checkExplanations(optimize, [...SEEDS, ...Array.from({ length: 150 }, (_, i) => 401 + i)]);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });
});

describe("optimizer against the reference with half-term dates and weekend meetings", () => {
  for (const walking of [true, false]) {
    test(`matches the reference on 300 dated instances, walking check ${walking ? "on" : "off"}`, () => {
      expect(checkAgainstReference(optimize, TERM_SEEDS, (seed) => termInstance(seed, walking))).toEqual([]);
    });
  }

  test("explanations stay minimal on dated instances", () => {
    const { failures, checked } = checkExplanations(optimize, TERM_SEEDS, (seed) => termInstance(seed, true));
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });

  // On these 300 seeds: 92 answers change when the dates are dropped, 24 best
  // schedules use date-disjoint meetings at overlapping times, 72 have idle
  // time or walking that only the dated back-to-back rule gives, and 34 meet
  // on a weekend. The floors are about half, so a generator change that stops
  // exercising dates fails here instead of passing silently.
  test("the dated suite exercises what the dates change", () => {
    let answerChanged = 0;
    let disjointOverlapUsed = 0;
    let pairsChanged = 0;
    let weekendUsed = 0;
    for (const seed of TERM_SEEDS) {
      const request = termInstance(seed, true);
      const undated = withoutDates(request);
      const dated = referenceTopK(request).schedules;
      const plain = referenceTopK(undated).schedules;
      if (JSON.stringify(dated.map((s) => [s.byCourse, s.cost])) !== JSON.stringify(plain.map((s) => [s.byCourse, s.cost]))) answerChanged += 1;
      const best = dated[0];
      if (!best) continue;
      const meetings = best.sections.flatMap((s) => s.meetings);
      if (meetings.some((m) => m.day === "Sat" || m.day === "Sun")) weekendUsed += 1;
      if (meetings.some((a, i) => meetings.some((b, j) => j > i && a.day === b.day && a.start < b.end && b.start < a.end))) disjointOverlapUsed += 1;
      // The same sections scored as if every meeting ran every week.
      const undatedBest = undated.courses.flatMap((c) => c.sections).filter((s) => best.key.includes(s.id));
      const asPlain = referenceCost(undated, undatedBest).breakdown;
      const b = best.breakdown;
      if (b.gapMinutes !== asPlain.gapMinutes || b.walkSeconds !== asPlain.walkSeconds || b.unknownWalks !== asPlain.unknownWalks) pairsChanged += 1;
    }
    expect(answerChanged).toBeGreaterThan(45);
    expect(disjointOverlapUsed).toBeGreaterThan(12);
    expect(pairsChanged).toBeGreaterThan(35);
    expect(weekendUsed).toBeGreaterThan(17);
  });
});

describe("optimizer budgets and large instances", () => {
  test("a cut-off search never claims optimal or infeasible, and returns only valid schedules", () => {
    expect(checkBudgets(optimize)).toEqual([]);
  });

  test("large instances return only schedules with zero hard-constraint violations", () => {
    expect(checkLargeInstancesValid(optimize, [1, 2, 3, 4, 5, 6])).toEqual([]);
  });

  test("the same request gives the same answer", () => {
    for (const seed of [3, 30, 300]) {
      const request = smallInstance(seed);
      expect(JSON.stringify(optimize(request).schedules)).toBe(JSON.stringify(optimize(request).schedules));
    }
  });
});
