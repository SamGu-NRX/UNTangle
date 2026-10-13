import { describe, expect, it } from "bun:test";
import { runChecker } from "../../src/lib/optimizer/checker";
import { optimize } from "../../src/lib/optimizer/lns/lns-optimizer";
import type { OptimizeRequest, SoftWeights, WalkingTimeFn } from "../../src/lib/optimizer/types";

const walking: WalkingTimeFn = (from, to) =>
  from === to ? { seconds: 0, source: "campus-network" } : { seconds: 300, source: "straight-line" };

const weights: SoftWeights = {
  perGapMinute: 1,
  perWalkingSecond: 1,
  perEarlyStartMinute: 1,
  perLateEndMinute: 1,
  perDayOnCampus: 10,
  perRatingPoint: 2,
  perGpaPoint: 1,
  perUnknownWalking: 50,
};

function request(overrides: Partial<OptimizeRequest>): OptimizeRequest {
  return {
    sections: [],
    requestedCourseCodes: [],
    lockedSectionIds: [],
    excludedSectionIds: [],
    hardConstraints: {},
    softWeights: weights,
    k: 3,
    timeBudgetMs: 500,
    walkingTime: walking,
    ...overrides,
  };
}

describe("lns edge cases", () => {
  it("empty requestedCourseCodes -> optimal, one empty schedule, cost 0", async () => {
    const req = request({});
    const result = await optimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules.length).toBe(1);
    expect(result.schedules[0].sectionIds).toEqual([]);
    expect(result.schedules[0].breakdown.cost).toBe(0);
    expect(runChecker(req, result)).toEqual([]);
  });

  it("k=0 on the empty request -> empty schedules list", async () => {
    const result = await optimize(request({ k: 0 }));
    expect(result.schedules).toEqual([]);
  });

  it("locked==excluded on a requested pool section -> infeasible with checker-clean IIS", async () => {
    const req = request({
      sections: [
        { id: "x-1", courseCode: "X", credits: 3, meetings: [{ day: "Mon", start: 540, end: 600, buildingId: "art" }] },
        { id: "y-1", courseCode: "Y", credits: 3, meetings: [{ day: "Tue", start: 540, end: 600, buildingId: "blb" }] },
      ],
      requestedCourseCodes: ["X", "Y"],
      lockedSectionIds: ["x-1"],
      excludedSectionIds: ["x-1"],
    });
    const result = await optimize(req);
    expect(result.status).toBe("infeasible");
    expect(runChecker(req, result)).toEqual([]);
  });

  it("zero-candidate requested course -> infeasible with checker-clean IIS", async () => {
    const req = request({
      sections: [
        { id: "x-1", courseCode: "X", credits: 3, meetings: [{ day: "Mon", start: 540, end: 600, buildingId: "art" }] },
      ],
      requestedCourseCodes: ["X", "GHOST"],
    });
    const result = await optimize(req);
    expect(result.status).toBe("infeasible");
    expect(runChecker(req, result)).toEqual([]);
  });

  it("exact cost tie -> lexicographically smaller sorted-id join wins", async () => {
    const req = request({
      sections: [
        { id: "a-2", courseCode: "A", credits: 3, meetings: [{ day: "Mon", start: 540, end: 620, buildingId: "art" }] },
        { id: "a-1", courseCode: "A", credits: 3, meetings: [{ day: "Mon", start: 540, end: 620, buildingId: "art" }] },
        { id: "b-1", courseCode: "B", credits: 3, meetings: [{ day: "Tue", start: 540, end: 620, buildingId: "blb" }] },
      ],
      requestedCourseCodes: ["A", "B"],
      k: 2,
    });
    const result = await optimize(req);
    // One flexible course -> the full space is enumerated -> optimal with proof.
    expect(result.status).toBe("optimal");
    expect(result.schedules.length).toBe(2);
    expect(result.schedules[0].sectionIds).toEqual(["a-1", "b-1"]);
    expect(result.schedules[1].sectionIds).toEqual(["a-2", "b-1"]);
    expect(result.schedules[1].breakdown.cost).toBe(result.schedules[0].breakdown.cost);
    expect(runChecker(req, result)).toEqual([]);
  });
});
