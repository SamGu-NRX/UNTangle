import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptimizeRequest, type OptMeeting } from "@/lib/optimizer/types";
import { createHash } from "node:crypto";
import { checkRegressions, regressionCases, smallInstance } from "./checks";
import { FIRST_HALF, FULL_TERM, SECOND_HALF } from "./generator";
import { fromPlainRequest, toPlainRequest } from "@/lib/optimizer/worker/protocol";
import { referenceTopK } from "./reference";

describe("meeting dates and weekend days", () => {
  const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };
  const request = (meetings: OptMeeting[][], overrides: Partial<OptimizeRequest> = {}): OptimizeRequest => ({
    term: FULL_TERM,
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

  test("dated meetings require an explicit term, including excluded sections", () => {
    for (const excluded of [[], ["s0"]]) {
      expect(() => optimize(request([slot(FIRST_HALF)], { term: undefined, excluded })))
        .toThrow("optimizer: term is required when any meeting has dates");
    }
    expect(optimize(request([slot(null)], { term: undefined })).status).toBe("optimal");
  });

  test("term dates reject malformed, impossible and reversed ranges like meeting dates", () => {
    for (const term of [
      { start: "2027-1-11", end: "2027-05-07" },
      { start: "2027-02-30", end: "2027-05-07" },
      { start: "2027-05-07", end: "2027-01-11" },
      null,
    ]) {
      expect(() => optimize(request([slot(null)], { term: term as OptimizeRequest["term"] }))).toThrow(OptimizerInputError);
    }
  });

  test("a dated meeting outside the term is not clipped, but undated meetings stop at the term", () => {
    const outside = { start: "2027-05-11", end: "2027-05-11" };
    const undatedAndOutside = request([[...slot(null), ...slot(outside)]]);
    expect(optimize(undatedAndOutside).status).toBe("optimal");
    expect(optimize(request([[...slot(outside), ...slot(outside)]])).status).toBe("infeasible");
    // Tuesday Jan 12 is outside this Monday-only term, so the undated
    // Tuesday occurrence cannot create an overlap with the dated one.
    expect(optimize(request([[...slot(null), ...slot({ start: "2027-01-12", end: "2027-01-12" })]],
      { term: { start: "2027-01-11", end: "2027-01-11" } })).status).toBe("optimal");
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

  const disjoint = () => request(Array.from({ length: 10_000 }, (_, i) => {
    const date = new Date(Date.UTC(2027, 0, 12 + i * 7)).toISOString().slice(0, 10);
    return slot({ start: date, end: date });
  }), { timeBudgetMs: 60_000 });

  test("10,000 disjoint ranges stop at the 33rd distinct activity pattern", () => {
    expect(() => optimize(disjoint())).toThrow(/33 distinct stretches/);
  });

  test("10,000 disjoint ranges respect the preparation deadline before rejecting the segment cap", () => {
    let tick = 0;
    const result = optimize({ ...disjoint(), timeBudgetMs: 5, now: () => ++tick });
    expect(result.status).toBe("timeout");
    expect(result.stats.nodes).toBe(0);
    expect(tick).toBeLessThan(10);
  });

  test("dates that need more than 32 week segments throw OptimizerInputError", () => {
    // 40 disjoint ranges, each containing a Tuesday. The explicit term does
    // not clip the dated ranges that continue beyond it.
    const ranges = Array.from({ length: 40 }, (_, i) => {
      const day = (n: number) => new Date(Date.UTC(2027, 0, 11 + n)).toISOString().slice(0, 10);
      return { start: day(i * 7), end: day(i * 7 + 2) };
    });
    expect(() => optimize(request([...ranges.map(slot), slot(null)]))).toThrow(/at most 32/);
    expect(optimize(request(ranges.slice(0, 15).map(slot))).status).toBe("optimal");
  });
});

describe("calendar review regressions", () => {
  for (const repro of regressionCases().filter((c) => /bridge|sharing only Sunday/.test(c.name))) {
    test(repro.name, () => {
      const result = optimize(repro.request);
      expect(repro.verify(result)).toBeNull();
      const reference = referenceTopK(repro.request);
      expect(reference.schedules.map((s) => [s.byCourse, s.cost, s.breakdown.gapMinutes]))
        .toEqual(result.schedules.map((s) => [s.byCourse, s.cost, s.breakdown.gapMinutes]));
    });
  }
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

  test("same-ID legs preserve the provider's unknown result", () => {
    const asked: string[] = [];
    const r = request();
    const plain = toPlainRequest({ ...r, walkingTime: (a, b) => (asked.push(`${a}${b}`), a === b ? { seconds: null, source: "unknown" } : r.walkingTime(a, b)) });
    expect(asked).toContain("XX");
    expect(fromPlainRequest(plain, 60_000).walkingTime("X", "X")).toEqual({ seconds: null, source: "unknown" });
  });
});

describe("credits of courses outside the request (Astra blocker 2)", () => {
  // Six planned 3-credit courses, one of them an online section with no set time, under a 15-credit limit.
  // The caller leaves the online one out of the search; its credits must still count.
  const fiveTimed = (fixedCredits: number | undefined, maxCredits: number): OptimizeRequest => ({
    courses: [0, 1, 2, 3, 4].map((i) => ({
      code: `C${i}`,
      credits: 3,
      sections: [{ id: `c${i}`, courseCode: `C${i}`, rating: null, meetings: [{ day: "Mon", start: 480 + i * 60, end: 530 + i * 60, buildingId: null }] }],
    })),
    locks: {},
    excluded: [],
    constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits, walking: null },
    weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
    walkingTime: () => ({ seconds: null, source: "unknown" }),
    fixedCredits,
  });

  test("the limit counts them: 15 + 3 is over 15, and the suggestion raises it to the true total", () => {
    // Without fixedCredits this was "optimal" with 15 credits while the plan kept 18.
    expect(optimize(fiveTimed(undefined, 15)).status).toBe("optimal");
    const over = optimize(fiveTimed(3, 15));
    expect(over.status).toBe("infeasible");
    if (over.status !== "infeasible") return;
    expect(over.explanation.sentence).toContain("your other 3 credits add up to 18 credits, over your 15-credit limit.");
    expect(over.explanation.suggestions.map((s) => s.relaxation)).toContainEqual({ kind: "maxCredits", to: 18 });
    expect(referenceTopK(fiveTimed(3, 15)).schedules).toEqual([]);
  });

  test("the reported credits include them", () => {
    const fits = optimize(fiveTimed(3, 18));
    expect(fits.status).toBe("optimal");
    expect(fits.schedules[0].breakdown.credits).toBe(18);
    expect(referenceTopK(fiveTimed(3, 18)).schedules[0].breakdown.credits).toBe(18);
  });

  test("a negative or non-finite fixedCredits is a caller bug", () => {
    expect(() => optimize(fiveTimed(-1, 15))).toThrow(OptimizerInputError);
    expect(() => optimize(fiveTimed(Number.NaN, 15))).toThrow(OptimizerInputError);
  });
});

describe("explanations name dates when the sessions differ", () => {
  const TERM = { start: "2027-01-11", end: "2027-05-07" };
  const overlap = (a: OptMeeting["dates"], b: OptMeeting["dates"]) => {
    const course = (code: string, dates: OptMeeting["dates"]) => ({
      code,
      credits: 3,
      sections: [{ id: code, courseCode: code, rating: null, meetings: (["Tue", "Thu"] as const).map((day) => ({ day, start: 930, end: 1100, buildingId: null, dates })) }],
    });
    const result = optimize({
      courses: [course("SPAN 2040", a), course("SPAN 2050", b)],
      term: TERM,
      locks: {},
      excluded: [],
      constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null },
      weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
      walkingTime: () => ({ seconds: null, source: "unknown" }),
    });
    if (result.status !== "infeasible") throw new Error(`expected infeasible, got ${result.status}`);
    return result.explanation.sentence;
  };

  test("both full term: no dates", () => {
    expect(overlap(null, TERM)).toBe("SPAN 2040 and SPAN 2050 overlap (TTh 3:30 PM and TTh 3:30 PM).");
  });

  test("one partial: its range and full term", () => {
    expect(overlap({ start: "2027-01-11", end: "2027-03-05" }, null)).toBe(
      "SPAN 2040 and SPAN 2050 overlap: TTh 3:30 PM (Jan 11–Mar 5) and TTh 3:30 PM (full term).",
    );
  });

  test("both partial with different ranges: each range", () => {
    expect(overlap({ start: "2027-01-11", end: "2027-03-05" }, { start: "2027-02-01", end: "2027-04-30" })).toBe(
      "SPAN 2040 and SPAN 2050 overlap: TTh 3:30 PM (Jan 11–Mar 5) and TTh 3:30 PM (Feb 1–Apr 30).",
    );
  });

  test("a single-day session: one date", () => {
    expect(overlap({ start: "2027-01-12", end: "2027-01-12" }, TERM)).toBe(
      "SPAN 2040 and SPAN 2050 overlap: TTh 3:30 PM (Jan 12) and TTh 3:30 PM (full term).",
    );
  });

  test("two locked sections that clash are each named once, with their pattern", () => {
    // A second section at another time makes each lock part of the conflict.
    const section = (code: string, id: string, start: number) => ({
      id,
      courseCode: code,
      rating: null,
      meetings: (["Mon", "Wed"] as const).map((day) => ({ day, start, end: start + 50, buildingId: null })),
    });
    const course = (code: string) => ({ code, credits: 3, sections: [section(code, code, 540), section(code, `${code}-late`, 840)] });
    const lockedPair = (locks: Record<string, string>) => {
      const result = optimize({
        courses: [course("CSCE 2110"), course("MATH 2700")],
        term: TERM,
        locks,
        excluded: [],
        constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null },
        weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
        walkingTime: () => ({ seconds: null, source: "unknown" }),
      });
      if (result.status !== "infeasible") throw new Error(`expected infeasible, got ${result.status}`);
      return result.explanation.sentence;
    };
    expect(lockedPair({ "CSCE 2110": "CSCE 2110", "MATH 2700": "MATH 2700" })).toBe(
      "Your locked CSCE 2110 section (MW 9 AM) and your locked MATH 2700 section (MW 9 AM) overlap.",
    );
  });

  test("the 400 undated seeds' explanations are unchanged", () => {
    const sentences = Array.from({ length: 400 }, (_, i) => i + 1).map((seed) => {
      const result = optimize(smallInstance(seed));
      return result.status === "infeasible" ? result.explanation.sentence : "";
    });
    // Recorded from the engine before explanations named dates (4691089) as
    // 9f704e6a…f533, then changed on purpose when two locked sections clash:
    // seeds 57, 195 and 232 dropped a trailing "(MWF 8 AM and MWF 8 AM)" that
    // repeated the patterns their "your locked … section (…)" already named.
    // The other 267 infeasible sentences are byte-identical.
    expect(createHash("sha256").update(JSON.stringify(sentences)).digest("hex")).toBe("f6e26ab58f4c1de7c15d632f6c622b43bb2f85aa40981c8ebc048089be5d4e22");
  });
});


test("unroutable same-ID meetings fail a hard walking constraint in direct and worker searches", () => {
  const request: OptimizeRequest = {
    courses: [
      { code: "A", credits: 3, sections: [{ id: "a", courseCode: "A", rating: null, meetings: [{ day: "Mon", start: 540, end: 590, buildingId: "ntdp" }] }] },
      { code: "B", credits: 3, sections: [{ id: "b", courseCode: "B", rating: null, meetings: [{ day: "Mon", start: 590, end: 640, buildingId: "ntdp" }] }] },
    ],
    locks: {}, excluded: [],
    constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: { bufferMinutes: 0 } },
    weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
    walkingTime: () => ({ seconds: null, source: "unknown" }),
  };
  expect(optimize(request).status).toBe("infeasible");
  expect(referenceTopK(request).schedules).toEqual([]);
  expect(optimize(fromPlainRequest(toPlainRequest(request), 60_000)).status).toBe("infeasible");
  const scored = { ...request, constraints: { ...request.constraints, walking: null }, weights: { ...request.weights, walking: 1 } };
  expect(optimize(scored).schedules[0]).toMatchObject({ cost: 600, breakdown: { unknownWalks: 1, walkSeconds: 0 } });
  expect(referenceTopK(scored).schedules[0]).toMatchObject({ cost: 600, breakdown: { unknownWalks: 1, walkSeconds: 0 } });
  expect(optimize({ ...request, walkingTime: () => ({ seconds: 0, source: "campus-network" }) }).status).toBe("optimal");
});

describe("a course with zero options", () => {
  const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
  const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };

  test("stays an unsatisfiable request instead of throwing", () => {
    const result = optimize({
      term: FULL_TERM,
      courses: [{ code: "MATH 2700", credits: 3, sections: [] }],
      locks: {},
      excluded: [],
      constraints: none,
      weights: zero,
      walkingTime: () => ({ seconds: 60, source: "campus-network" }),
    });
    expect(result.schedules).toEqual([]);
  });
});
