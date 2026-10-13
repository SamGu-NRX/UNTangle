import { describe, expect, it } from "bun:test";
import { optimize } from "../../src/lib/optimizer/brute-force";
import { findIis, allMembers, pruneToMembers } from "../../src/lib/optimizer/iis-reference";
import { verifyIis, independentSubFeasible } from "../../src/lib/optimizer/checker";
import { buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest, OptimizerSection, WalkingTimeFn } from "../../src/lib/optimizer/types";

const walking: WalkingTimeFn = (from, to) => {
  if (from === to) return { seconds: 0, source: "campus-network" };
  return { seconds: 120, source: "straight-line" };
};

const zeroWeights = {
  perGapMinute: 0, perWalkingSecond: 0, perEarlyStartMinute: 0, perLateEndMinute: 0,
  perDayOnCampus: 0, perRatingPoint: 0, perGpaPoint: 0, perUnknownWalking: 0,
};

function section(id: string, courseCode: string, meetings: OptimizerSection["meetings"], credits = 3): OptimizerSection {
  return { id, courseCode, credits, meetings };
}

function base(overrides: Partial<OptimizeRequest>): OptimizeRequest {
  return {
    sections: [],
    requestedCourseCodes: [],
    lockedSectionIds: [],
    excludedSectionIds: [],
    hardConstraints: {},
    softWeights: zeroWeights,
    k: 3,
    timeBudgetMs: 1000,
    walkingTime: walking,
    ...overrides,
  };
}

async function expectInfeasibleWithIrreducibleIis(req: OptimizeRequest): Promise<void> {
  const result = await optimize(req);
  expect(result.status).toBe("infeasible");
  expect(result.infeasibleSubset).toBeDefined();
  const reference = findIis(req, (sub) => independentSubFeasible(pruneToMembers(sub, allMembers(sub))) === false ? false : true);
  // The checker's verdict on the reference subset and on brute force's must agree.
  const bruteVerdict = verifyIis(req, result.infeasibleSubset!);
  expect(bruteVerdict.subsetInfeasible).toBe(true);
  expect(bruteVerdict.allSingleRemovalsFeasible).toBe(true);
  const refVerdict = verifyIis(req, reference);
  expect(refVerdict.subsetInfeasible).toBe(true);
  expect(refVerdict.allSingleRemovalsFeasible).toBe(true);
}

describe("crafted IIS instances", () => {
  it("two locked sections of different courses that overlap", async () => {
    const req = base({
      sections: [
        section("a1", "A 1", [{ day: "Mon", start: 540, end: 600, buildingId: "life" }]),
        section("a2", "A 1", [{ day: "Tue", start: 540, end: 600, buildingId: "life" }]),
        section("b1", "B 2", [{ day: "Mon", start: 540, end: 600, buildingId: "matt" }]),
      ],
      requestedCourseCodes: ["A 1", "B 2"],
      lockedSectionIds: ["a1", "b1"],
    });
    await expectInfeasibleWithIrreducibleIis(req);
    // locked b1 is redundant: b1 is the only B section, so B must pick it
    // anyway — the irreducible subset drops that lock and keeps a1's.
    const result = await optimize(req);
    const kinds = result.infeasibleSubset!.members.map((m) => `${m.kind}:${m.id}`).sort();
    expect(kinds).toEqual(["course:A 1", "course:B 2", "locked:a1"]);
  });

  it("maxCredits smaller than the cheapest course set", async () => {
    const req = base({
      sections: [
        section("a1", "A 1", [{ day: "Mon", start: 540, end: 600, buildingId: "life" }]),
        section("b1", "B 2", [{ day: "Mon", start: 660, end: 720, buildingId: "matt" }]),
      ],
      requestedCourseCodes: ["A 1", "B 2"],
      hardConstraints: { maxCredits: 5 }, // 3 + 3 = 6 > 5 for every pick
    });
    await expectInfeasibleWithIrreducibleIis(req);
    const result = await optimize(req);
    const kinds = result.infeasibleSubset!.members.map((m) => `${m.kind}:${m.id}`).sort();
    expect(kinds).toEqual(["constraint:maxCredits", "course:A 1", "course:B 2"]);
  });

  it("a blocked range that kills the only section of a course", async () => {
    const req = base({
      sections: [
        section("a1", "A 1", [{ day: "Mon", start: 540, end: 600, buildingId: "life" }]),
      ],
      requestedCourseCodes: ["A 1"],
      hardConstraints: { blockedTimeRanges: [{ day: "Mon", start: 540, end: 600 }] },
    });
    await expectInfeasibleWithIrreducibleIis(req);
    const result = await optimize(req);
    const kinds = result.infeasibleSubset!.members.map((m) => `${m.kind}:${m.id}`).sort();
    expect(kinds).toEqual(["constraint:blockedTimeRanges.0", "course:A 1"]);
  });

  it("a minTransferMinutes no pair of buildings can satisfy", async () => {
    const req = base({
      sections: [
        section("a1", "A 1", [{ day: "Mon", start: 540, end: 600, buildingId: "life" }]),
        section("b1", "B 2", [{ day: "Mon", start: 600, end: 660, buildingId: "matt" }]),
        // A same-building alternative for B cannot help: the only B section
        // lands right after A in a different building, gap 0 < 60.
      ],
      requestedCourseCodes: ["A 1", "B 2"],
      hardConstraints: { minTransferMinutes: 60 },
    });
    await expectInfeasibleWithIrreducibleIis(req);
  });

  it("on every feasible enumerable suite instance brute force never returns infeasible", async () => {
    const suite = buildSuite().filter((instance) => instance.expectFeasible && instance.enumerable);
    expect(suite.length).toBeGreaterThanOrEqual(1);
    for (const instance of suite) {
      const result = await optimize(instance.req);
      expect(result.status).not.toBe("infeasible");
    }
  });

  it("on every infeasible-labeled enumerable suite instance brute force returns infeasible", async () => {
    const suite = buildSuite().filter((instance) => instance.expectInfeasible && instance.enumerable);
    expect(suite.length).toBeGreaterThanOrEqual(1);
    for (const instance of suite) {
      const result = await optimize(instance.req);
      expect(result.status).toBe("infeasible");
    }
  });
});
