import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptimizeRequest, type OptMeeting } from "@/lib/optimizer/types";
import { checkRegressions, regressionCases } from "./checks";
import { FIRST_HALF, SECOND_HALF } from "./generator";
import { fromPlainRequest, toPlainRequest } from "@/lib/optimizer/worker/protocol";

describe("meeting dates and weekend days", () => {
  const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
  const request = (meetings: OptMeeting[][], overrides: Partial<OptimizeRequest> = {}): OptimizeRequest => ({
    courses: [
      {
        code: "SPAN 2040",
        credits: 3,
        sections: meetings.map((m, i) => ({ id: `s${i}`, courseCode: "SPAN 2040", rating: 4, meetings: m })),
      },
    ],
    locks: {},
    excluded: [],
    constraints: none,
    weights: zero,
    walkingTime: () => ({ seconds: 60, source: "campus-network" }),
    ...overrides,
  });
  const slot = (dates: OptMeeting["dates"]): OptMeeting[] => [{ day: "Tue", start: 930, end: 1100, buildingId: "LANG", dates }];

  test("two sections identical except their dates are not twins, and differ for the diversity rule", () => {
    for (const walking of [null, { bufferMinutes: 0 }]) {
      const result = optimize(request([slot(FIRST_HALF), slot(SECOND_HALF)], { constraints: { ...none, walking } }));
      expect(result.stats.candidates["SPAN 2040"]).toBe(2);
      expect(result.schedules.map((s) => s.byCourse["SPAN 2040"])).toEqual(["s0", "s1"]);
    }
    // Same dates: twins, so only the first is kept.
    const twins = optimize(request([slot(FIRST_HALF), slot({ ...FIRST_HALF })]));
    expect(twins.stats.candidates["SPAN 2040"]).toBe(1);
  });

  test("a Saturday day off rules out Saturday sections and is offered as a relaxation", () => {
    const result = optimize(request([[{ day: "Sat", start: 540, end: 650, buildingId: null }]], { constraints: { ...none, daysOff: ["Sat"] } }));
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(result.explanation.suggestions.map((s) => s.label)).toContain("Allow classes on Saturdays");
  });

  test("malformed, impossible or reversed dates throw OptimizerInputError", () => {
    for (const dates of [
      { start: "2027-1-11", end: "2027-03-05" },
      { start: "2027-02-30", end: "2027-03-05" },
      { start: "2027-01-11", end: "March 5" },
      { start: "2027-03-05", end: "2027-01-11" },
      { start: 20270111, end: "2027-03-05" },
    ]) {
      expect(() => optimize(request([slot(dates as OptMeeting["dates"])]))).toThrow(OptimizerInputError);
    }
    // One-day ranges and null are fine.
    expect(optimize(request([slot({ start: "2027-01-11", end: "2027-01-11" }), slot(null)])).status).toBe("optimal");
  });

  test("dates that need more than 32 week segments throw OptimizerInputError", () => {
    // 40 disjoint ranges, one per section, plus an undated one: 41 segments
    // (each range alone, and the weeks between them where only the undated one runs).
    const ranges = Array.from({ length: 40 }, (_, i) => {
      const day = (n: number) => new Date(Date.UTC(2027, 0, 11 + n)).toISOString().slice(0, 10);
      return { start: day(i * 7), end: day(i * 7 + 2) };
    });
    expect(() => optimize(request([...ranges.map(slot), slot(null)]))).toThrow(/at most 32/);
    expect(optimize(request(ranges.slice(0, 15).map(slot))).status).toBe("optimal");
  });
});

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
