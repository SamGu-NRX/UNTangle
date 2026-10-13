import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptimizeRequest } from "@/lib/optimizer/types";
import { checkRegressions, regressionCases } from "./checks";
import { fromPlainRequest, toPlainRequest } from "@/lib/optimizer/worker/protocol";

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

describe("budget regressions (PR #32 re-review)", () => {
  const weights = { fewerDays: 0, compact: 1, mornings: 0, evenings: 0, walking: 1, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
  const walk: OptimizeRequest["walkingTime"] = (a, b) => ({ seconds: a === b ? 0 : 120, source: "straight-line" });

  test("many distinct meeting times: preparation stops at the deadline instead of building every fill table", () => {
    // 8 x 40 sections at minute-level start times and 5 buildings, walking weighted.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const courses = Array.from({ length: 8 }, (_, c) => ({
      code: `T${c}`,
      credits: 3,
      sections: Array.from({ length: 40 }, (_, s) => {
        const start = 450 + Math.floor(rand() * 700);
        return {
          id: `t${c}-${s}`,
          courseCode: `T${c}`,
          rating: null,
          meetings: (["Mon", "Wed", "Fri"] as const).map((day, i) => ({ day, start: start + i, end: start + i + 47, buildingId: `b${(c + s) % 5}` })),
        };
      }),
    }));
    const started = performance.now();
    const result = optimize({ courses, locks: {}, excluded: [], constraints: none, weights, walkingTime: walk, timeBudgetMs: 300 });
    expect(performance.now() - started).toBeLessThan(600);
    expect(["feasible", "timeout", "optimal", "infeasible"]).toContain(result.status);
  });

  test("1,200 buildings with a 30 ms budget: walking tables are not allowed to run past it", () => {
    const courses = Array.from({ length: 4 }, (_, c) => ({
      code: `B${c}`,
      credits: 3,
      sections: Array.from({ length: 300 }, (_, s) => ({
        id: `b${c}-${s}`,
        courseCode: `B${c}`,
        rating: null,
        meetings: [{ day: "Tue" as const, start: 480 + (s % 10) * 60, end: 530 + (s % 10) * 60, buildingId: `bldg-${c * 300 + s}` }],
      })),
    }));
    const started = performance.now();
    const result = optimize({ courses, locks: {}, excluded: [], constraints: none, weights, walkingTime: walk, timeBudgetMs: 30 });
    expect(performance.now() - started).toBeLessThan(250);
    expect(result.status).toBe("timeout");
  });
});

describe("worker walking table (PR #32 re-review)", () => {
  const meet = (start: number, end: number, buildingId: string) => ({ day: "Mon" as const, start, end, buildingId });
  // A ends 9:50 in X. B's only allowed section is 9 minutes later in far-away Y; the
  // excluded b1 is in Z, a 5-minute walk. Z appears in no usable section.
  const request = (): OptimizeRequest => ({
    courses: [
      { code: "A", credits: 3, sections: [{ id: "a0", courseCode: "A", rating: null, meetings: [meet(540, 590, "X")] }] },
      {
        code: "B",
        credits: 3,
        sections: [
          { id: "b0", courseCode: "B", rating: null, meetings: [meet(599, 649, "Y")] },
          { id: "b1", courseCode: "B", rating: null, meetings: [meet(599, 649, "Z")] },
        ],
      },
    ],
    locks: {},
    excluded: ["b1"],
    constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: { bufferMinutes: 0 } },
    weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
    walkingTime: (a, b) => {
      if (a === b) return { seconds: 0, source: "campus-network" };
      const pair = [a, b].sort().join("");
      return { seconds: pair === "XZ" ? 300 : 1200, source: "campus-network" };
    },
  });

  test("a relaxation into a building no usable section uses still has its walk", () => {
    const direct = optimize(request());
    const viaTable = optimize(fromPlainRequest(toPlainRequest(request()), 60_000));
    expect(direct.status).toBe("infeasible");
    expect(viaTable.status).toBe("infeasible");
    if (direct.status !== "infeasible" || viaTable.status !== "infeasible") return;
    const include = (r: typeof direct) => r.explanation.suggestions.find((s) => s.relaxation.kind === "include");
    expect(include(direct)?.resolves).toBe(true);
    expect(include(viaTable)?.resolves).toBe(true);
    expect(toPlainRequest(request()).walking.ids).toContain("Z");
  });

  test("no walking weight or check and every section filtered out: the table is empty and the provider is never called", () => {
    let calls = 0;
    const r = request();
    const plain = toPlainRequest({
      ...r,
      constraints: { ...r.constraints, walking: null, earliestStart: 12 * 60 },
      walkingTime: (a, b) => {
        calls += 1;
        return r.walkingTime(a, b);
      },
    });
    expect(plain.walking.ids).toEqual([]);
    expect(calls).toBe(0);
  });

  test("the diagonal is never asked for", () => {
    const asked: string[] = [];
    const r = request();
    toPlainRequest({ ...r, walkingTime: (a, b) => (asked.push(`${a}${b}`), r.walkingTime(a, b)) });
    expect(asked.some((pair) => pair[0] === pair[1])).toBe(false);
  });
});
