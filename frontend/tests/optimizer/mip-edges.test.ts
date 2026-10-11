import { describe, expect, test } from "bun:test";
import { optimize as mipOptimize } from "../../src/lib/optimizer/mip/mip-optimizer";
import { runChecker } from "../../src/lib/optimizer/checker";
import { buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest, OptimizeResult, OptimizerSection, SoftWeights, WalkingTimeFn } from "../../src/lib/optimizer/types";

const zeroWeights: SoftWeights = {
  perGapMinute: 0,
  perWalkingSecond: 0,
  perEarlyStartMinute: 0,
  perLateEndMinute: 0,
  perDayOnCampus: 0,
  perRatingPoint: 0,
  perGpaPoint: 0,
  perUnknownWalking: 0,
};

const noWalking: WalkingTimeFn = () => ({ seconds: null, source: "unknown" });

function baseRequest(overrides: Partial<OptimizeRequest>): OptimizeRequest {
  return {
    sections: [],
    requestedCourseCodes: [],
    lockedSectionIds: [],
    excludedSectionIds: [],
    hardConstraints: {},
    softWeights: zeroWeights,
    k: 3,
    timeBudgetMs: 10000,
    walkingTime: noWalking,
    ...overrides,
  };
}

function poolSection(id: string, courseCode: string, day: "Mon" | "Tue", start: number, end: number): OptimizerSection {
  return { id, courseCode, credits: 3, meetings: [{ day, start, end, buildingId: "life" }] };
}

function trimTiming(result: OptimizeResult): Omit<OptimizeResult, "initMs" | "searchMs"> {
  return {
    status: result.status,
    schedules: result.schedules,
    diversity: result.diversity,
    infeasibleSubset: result.infeasibleSubset,
  };
}

describe("mip edge cases", () => {
  test("empty request: optimal, one empty schedule, cost 0", async () => {
    const result = await mipOptimize(baseRequest({}));
    expect(result.status).toBe("optimal");
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]?.sectionIds).toEqual([]);
    expect(result.schedules[0]?.breakdown.cost).toBe(0);
    expect(result.diversity).toBe(0);
    expect(runChecker(baseRequest({}), result)).toEqual([]);
  });

  test("k=0 returns an empty schedule list", async () => {
    const result = await mipOptimize(baseRequest({ k: 0 }));
    expect(result.status).toBe("optimal");
    expect(result.schedules).toEqual([]);
  });

  test("locked-and-excluded section of a requested course: infeasible with a checker-valid IIS", async () => {
    const req = baseRequest({
      sections: [poolSection("A1", "A", "Mon", 540, 570), poolSection("A2", "A", "Tue", 540, 570)],
      requestedCourseCodes: ["A"],
      lockedSectionIds: ["A1"],
      excludedSectionIds: ["A1"],
    });
    const result = await mipOptimize(req);
    expect(result.status).toBe("infeasible");
    expect(result.infeasibleSubset).toBeDefined();
    expect(runChecker(req, result)).toEqual([]);
  });

  test("locked section violating a unary constraint: infeasible with a checker-valid IIS", async () => {
    const req = baseRequest({
      sections: [poolSection("A1", "A", "Mon", 400, 470)],
      requestedCourseCodes: ["A"],
      lockedSectionIds: ["A1"],
      hardConstraints: { earliestStart: 480 },
    });
    const result = await mipOptimize(req);
    expect(result.status).toBe("infeasible");
    expect(result.infeasibleSubset).toBeDefined();
    expect(runChecker(req, result)).toEqual([]);
  });

  test("zero remaining candidates for a requested course: infeasible with a checker-valid IIS", async () => {
    const req = baseRequest({
      sections: [poolSection("A1", "A", "Mon", 540, 570), poolSection("B1", "B", "Mon", 540, 570)],
      requestedCourseCodes: ["A", "B"],
      excludedSectionIds: ["B1"],
    });
    const result = await mipOptimize(req);
    expect(result.status).toBe("infeasible");
    expect(result.infeasibleSubset).toBeDefined();
    expect(runChecker(req, result)).toEqual([]);
  });

  test("every pinned expectInfeasible instance reports infeasible with a checker-valid IIS", async () => {
    for (const instance of buildSuite().filter((i) => i.expectInfeasible === true)) {
      const result = await mipOptimize(instance.req);
      expect(result.status).toBe("infeasible");
      expect(result.infeasibleSubset).toBeDefined();
      expect(runChecker(instance.req, result)).toEqual([]);
    }
  }, 20000);

  test("same request twice yields identical results apart from timing", async () => {
    const instance = buildSuite().find((i) => i.name === "plain-s");
    if (!instance) throw new Error("plain-s missing from the pinned suite");
    const first = await mipOptimize(instance.req);
    const second = await mipOptimize(instance.req);
    expect(trimTiming(second)).toEqual(trimTiming(first));
  }, 15000);

  test("timeBudgetMs=1 on a large instance: timeout, no hang, checker-clean schedules", async () => {
    const instance = buildSuite().find((i) => i.name === "large-l");
    if (!instance) throw new Error("large-l missing from the pinned suite");
    const req = { ...instance.req, timeBudgetMs: 1 };
    const result = await mipOptimize(req);
    expect(result.status).toBe("timeout");
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);

  test("k=1 best equals k=5 best", async () => {
    const instance = buildSuite().find((i) => i.name === "plain-m");
    if (!instance) throw new Error("plain-m missing from the pinned suite");
    const one = await mipOptimize({ ...instance.req, k: 1 });
    const five = await mipOptimize({ ...instance.req, k: 5 });
    expect(one.status).toBe("optimal");
    expect(five.status).toBe("optimal");
    expect(one.schedules[0]).toEqual(five.schedules[0]);
  }, 15000);
});
