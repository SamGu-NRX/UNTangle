import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { checkAgainstReference, checkBudgets, checkExplanations, checkLargeInstancesValid, smallInstance } from "./checks";
import { referenceTopK } from "./reference";

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

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
    const { failures, checked } = checkExplanations(optimize, SEEDS);
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(20);
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
