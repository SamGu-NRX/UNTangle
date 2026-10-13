import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptimizeRequest } from "@/lib/optimizer/types";
import { checkRegressions, regressionCases } from "./checks";

describe("review regressions (PR #32)", () => {
  test("each fixed instance gives its known answer and agrees with the reference", () => {
    expect(checkRegressions(optimize)).toEqual([]);
  });

  test("a repeated exclusion is rejected instead of becoming two explanation members", () => {
    const { request } = regressionCases()[0];
    expect(() => optimize({ ...request, excluded: ["a1", "a1"] })).toThrow(OptimizerInputError);
  });

  test("preparation skips filtered sections: no walking lookups when walking is off, and it honors the budget", () => {
    let calls = 0;
    const counting: OptimizeRequest["walkingTime"] = () => {
      calls += 1;
      return { seconds: 60, source: "straight-line" };
    };
    const courses = Array.from({ length: 4 }, (_, c) => ({
      code: `C${c}`,
      credits: 3,
      sections: Array.from({ length: 400 }, (_, s) => ({
        id: `c${c}-${s}`,
        courseCode: `C${c}`,
        rating: null,
        meetings: [{ day: "Mon" as const, start: 480, end: 530, buildingId: `bldg-${c}-${s}` }],
      })),
    }));
    const none = { earliestStart: 600, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
    const weights = { fewerDays: 0, compact: 1, mornings: 0, evenings: 0, walking: 0, rating: 0 };
    const started = performance.now();
    const result = optimize({ courses, locks: {}, excluded: [], constraints: none, weights, walkingTime: counting, explainBudgetMs: 50 });
    expect(result.status).toBe("infeasible");
    expect(calls).toBe(0);
    expect(performance.now() - started).toBeLessThan(500);

    // Walking on, nothing filtered, 2 ms budget: preparation stops and reports timeout.
    const busy = optimize({
      courses,
      locks: {},
      excluded: [],
      constraints: { ...none, earliestStart: null, walking: { bufferMinutes: 0 } },
      weights,
      walkingTime: counting,
      timeBudgetMs: 2,
    });
    expect(busy.status).toBe("timeout");
  });
});
