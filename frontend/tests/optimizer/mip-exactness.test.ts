import { describe, expect, test } from "bun:test";
import { optimize as bruteForceOptimize } from "../../src/lib/optimizer/brute-force";
import { optimize as mipOptimize } from "../../src/lib/optimizer/mip/mip-optimizer";
import { evaluateModelObjective } from "../../src/lib/optimizer/mip/model";
import { runChecker } from "../../src/lib/optimizer/checker";
import { scheduleKey } from "../../src/lib/optimizer/scorer";
import type { OptimizerSection, SoftWeights, WalkingTimeFn } from "../../src/lib/optimizer/types";
import type { WeekDay } from "@/lib/types";

const weights: SoftWeights = {
  perGapMinute: 2,
  perWalkingSecond: 0.01,
  perEarlyStartMinute: 0,
  perLateEndMinute: 0,
  perDayOnCampus: 25,
  perRatingPoint: 0,
  perGpaPoint: 0,
  perUnknownWalking: 0,
};

// Deterministic known walk times; same building returns 0 seconds.
const walking: WalkingTimeFn = (from: string, to: string) => ({
  seconds: from === to ? 0 : 120,
  source: "campus-network",
});

function section(
  id: string,
  courseCode: string,
  meetings: Array<{ day: WeekDay; start: number; end: number }>,
  buildingId = "life",
): OptimizerSection {
  return {
    id,
    courseCode,
    credits: 3,
    meetings: meetings.map((meeting) => ({ ...meeting, buildingId })),
  };
}

function pick(req: { sections: OptimizerSection[] }, ids: string[]): OptimizerSection[] {
  return ids.map((id) => {
    const section = req.sections.find((candidate) => candidate.id === id);
    if (!section) throw new Error(`missing section ${id}`);
    return section;
  });
}

describe("mip model exactness on crafted instances", () => {
  test("consecutive-pair costs ignore pairs with an intervening meeting (naive z would overcharge)", async () => {
    // All-Mon chain A1+B1+C1: two consecutive 10-minute gaps on one day:
    // cost = 2*20 + 25 (one day) = 65. The naive z encoding
    // (z >= x_i + x_j - 1 with no between subtraction) would additionally
    // charge the NON-consecutive (A1, C1) pair its 50-minute gap (100 more),
    // making the chain's model cost 165 and flipping the winner to the
    // split-week schedule (cost 75). Brute force is the arbiter.
    const req = {
      sections: [
        section("A1", "A", [{ day: "Mon" as WeekDay, start: 540, end: 570 }]),
        section("A2", "A", [{ day: "Tue" as WeekDay, start: 540, end: 570 }]),
        section("B1", "B", [{ day: "Mon" as WeekDay, start: 580, end: 610 }]),
        section("B2", "B", [{ day: "Tue" as WeekDay, start: 580, end: 610 }]),
        section("C1", "C", [{ day: "Mon" as WeekDay, start: 620, end: 650 }]),
        section("C2", "C", [{ day: "Wed" as WeekDay, start: 540, end: 570 }]),
      ],
      requestedCourseCodes: ["A", "B", "C"],
      lockedSectionIds: [],
      excludedSectionIds: [],
      hardConstraints: {},
      softWeights: weights,
      k: 1,
      timeBudgetMs: 5000,
      walkingTime: walking,
    };
    const brute = await bruteForceOptimize(req);
    expect(brute.status).toBe("optimal");
    expect(brute.schedules[0]?.sectionIds).toEqual(["A1", "B1", "C1"]);
    expect(brute.schedules[0]?.breakdown.cost).toBeCloseTo(65, 9);

    const result = await mipOptimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules[0]?.sectionIds).toEqual(["A1", "B1", "C1"]);
    expect(result.schedules[0]?.breakdown.cost).toBeCloseTo(65, 9);
    expect(runChecker(req, result)).toEqual([]);
    expect(evaluateModelObjective(req, pick(req, ["A1", "B1", "C1"]))).toBeCloseTo(65, 6);
  });

  test("hard transfer rows stay exact when an intervening meeting makes the violating pair non-consecutive", async () => {
    // minTransferMinutes = 30. A1 [540,570] (life) and B1 [575,600] (chem)
    // have a 5-minute gap in different buildings — a violating pair IF
    // consecutive. C1 [570,575] (life) fits between them: with A1+B1+C1
    // chosen the consecutive pairs are (A1,C1) and (C1,B1), so the
    // (A1,B1) row must relax via its between-set. The full top-k order
    // must match brute force exactly.
    const req = {
      sections: [
        section("A1", "A", [{ day: "Mon" as WeekDay, start: 540, end: 570 }], "life"),
        section("B1", "B", [{ day: "Mon" as WeekDay, start: 575, end: 600 }], "chem"),
        section("C1", "C", [{ day: "Mon" as WeekDay, start: 570, end: 575 }], "life"),
        section("A2", "A", [{ day: "Tue" as WeekDay, start: 540, end: 570 }], "life"),
        section("B2", "B", [{ day: "Tue" as WeekDay, start: 575, end: 600 }], "chem"),
        section("C2", "C", [{ day: "Tue" as WeekDay, start: 570, end: 575 }], "life"),
      ],
      requestedCourseCodes: ["A", "B", "C"],
      lockedSectionIds: [],
      excludedSectionIds: [],
      hardConstraints: { minTransferMinutes: 30 },
      softWeights: weights,
      k: 6,
      timeBudgetMs: 5000,
      walkingTime: walking,
    };
    const brute = await bruteForceOptimize(req);
    const result = await mipOptimize(req);
    expect(result.status).toBe(brute.status);
    expect(result.schedules.map((schedule) => schedule.sectionIds)).toEqual(
      brute.schedules.map((schedule) => schedule.sectionIds),
    );
    for (let i = 0; i < brute.schedules.length; i++) {
      const actualCost = result.schedules[i]?.breakdown.cost;
      const expectedCost = brute.schedules[i]?.breakdown.cost;
      expect(actualCost).toBeCloseTo(expectedCost ?? Number.NaN, 9);
    }
    expect(runChecker(req, result)).toEqual([]);
  });

  test("exact cost ties return the lexicographically smallest sorted-id join first", async () => {
    // A1/A2 and B1/B2 are cost-identical clones, so all four combinations
    // tie and the contract tie-break (joined sorted section ids) decides.
    const req = {
      sections: [
        section("A1", "A", [{ day: "Mon" as WeekDay, start: 540, end: 570 }]),
        section("A2", "A", [{ day: "Mon" as WeekDay, start: 540, end: 570 }]),
        section("B1", "B", [{ day: "Tue" as WeekDay, start: 540, end: 570 }]),
        section("B2", "B", [{ day: "Tue" as WeekDay, start: 540, end: 570 }]),
      ],
      requestedCourseCodes: ["A", "B"],
      lockedSectionIds: [],
      excludedSectionIds: [],
      hardConstraints: {},
      softWeights: weights,
      k: 4,
      timeBudgetMs: 5000,
      walkingTime: walking,
    };
    const brute = await bruteForceOptimize(req);
    const result = await mipOptimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules.map((schedule) => scheduleKey(schedule.sectionIds))).toEqual(
      brute.schedules.map((schedule) => scheduleKey(schedule.sectionIds)),
    );
    // The lexicographically smallest join comes first.
    expect(result.schedules[0]?.sectionIds).toEqual(["A1", "B1"]);
    expect(runChecker(req, result)).toEqual([]);
  });
});
