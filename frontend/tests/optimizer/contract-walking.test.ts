import { describe, expect, it } from "bun:test";
import { computeBreakdown } from "../../src/lib/optimizer/scorer";
import { benchWalkingTime, BENCH_UNKNOWN_BUILDING_IDS } from "../../src/lib/optimizer/bench/generator";
import type { OptimizeRequest, OptimizerSection, WalkingTimeFn } from "../../src/lib/optimizer/types";

describe("benchmark walking functions", () => {
  it("same building is 0 seconds on the campus network, unknown ids are null — never free", () => {
    expect(benchWalkingTime("bench-sci", "bench-sci")).toEqual({ seconds: 0, source: "campus-network" });
    for (const ghost of BENCH_UNKNOWN_BUILDING_IDS) {
      const result = benchWalkingTime("bench-sci", ghost);
      expect(result.seconds).toBeNull();
      expect(result.source).toBe("unknown");
    }
    const known = benchWalkingTime("bench-sci", "bench-eng");
    expect(known.seconds).not.toBeNull();
    // The bench network labels every known pair as campus-network.
    expect(known.source).toBe("campus-network");
  });
});

describe("the never-free rule for unknown walking", () => {
  it("flipping a known pair to unknown raises unknownWalkingPairs by 1 and cost by exactly perUnknownWalking", () => {
    const sections: OptimizerSection[] = [
      { id: "a1", courseCode: "A 1", credits: 3, meetings: [{ day: "Mon", start: 540, end: 600, buildingId: "bench-sci" }] },
      { id: "b1", courseCode: "B 2", credits: 3, meetings: [{ day: "Mon", start: 600, end: 660, buildingId: "bench-eng" }] },
    ];
    const base = (walkingTime: WalkingTimeFn): OptimizeRequest => ({
      sections,
      requestedCourseCodes: ["A 1", "B 2"],
      lockedSectionIds: [],
      excludedSectionIds: [],
      hardConstraints: {},
      softWeights: {
        perGapMinute: 0, perWalkingSecond: 0, perEarlyStartMinute: 0, perLateEndMinute: 0,
        perDayOnCampus: 0, perRatingPoint: 0, perGpaPoint: 0, perUnknownWalking: 25,
      },
      k: 3,
      timeBudgetMs: 1000,
      walkingTime,
    });

    const known = base(benchWalkingTime);
    const knownBreakdown = computeBreakdown(known, sections);
    expect(knownBreakdown.unknownWalkingPairs).toBe(0);
    expect(knownBreakdown.walkingSeconds).toBe(benchWalkingTime("bench-sci", "bench-eng").seconds!);
    expect(knownBreakdown.cost).toBe(0); // perWalkingSecond is 0: known walking is priced, unknown is penalized

    const unknown = base((from, to) => {
      if (from === to) return { seconds: 0, source: "campus-network" };
      return { seconds: null, source: "unknown" };
    });
    const unknownBreakdown = computeBreakdown(unknown, sections);
    expect(unknownBreakdown.unknownWalkingPairs).toBe(1);
    expect(unknownBreakdown.walkingSeconds).toBe(0);
    expect(unknownBreakdown.cost).toBe(25);
    expect(unknownBreakdown.cost - knownBreakdown.cost).toBe(25);
  });
});
