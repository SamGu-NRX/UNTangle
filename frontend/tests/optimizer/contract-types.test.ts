import { describe, expect, it } from "bun:test";
import {
  DEFAULT_EARLY_START_ANCHOR_MINUTES,
  DEFAULT_LATE_END_ANCHOR_MINUTES,
  type Optimize,
  type OptimizeRequest,
  type WalkingTimeFn,
} from "../../src/lib/optimizer/types";
import { computeBreakdown } from "../../src/lib/optimizer/scorer";

/** Deterministic local walking stub for the type-level smoke. */
const stubWalkingTime: WalkingTimeFn = (from, to) =>
  from === to ? { seconds: 0, source: "campus-network" } : { seconds: 300, source: "straight-line" };

/** A minimal well-formed request; the object literal is the type-level smoke. */
const sampleRequest: OptimizeRequest = {
  sections: [
    {
      id: "anth-a",
      courseCode: "ANTH 1010",
      credits: 3,
      meetings: [
        { day: "Mon", start: 540, end: 600, buildingId: "life" },
        { day: "Wed", start: 630, end: 690, buildingId: "chem" },
      ],
      instructorRating: 4.5,
      historicalGpa: 3.6,
    },
    {
      id: "anth-b",
      courseCode: "ANTH 1010",
      credits: 3,
      meetings: [{ day: "Mon", start: 570, end: 630, buildingId: "life" }],
    },
    {
      id: "math-a",
      courseCode: "MATH 2010",
      credits: 4,
      meetings: [{ day: "Tue", start: 660, end: 720, buildingId: "matt" }],
      instructorRating: 4.0,
      historicalGpa: 3.2,
    },
  ],
  requestedCourseCodes: ["ANTH 1010", "MATH 2010"],
  lockedSectionIds: [],
  excludedSectionIds: [],
  hardConstraints: {},
  softWeights: {
    perGapMinute: 0,
    perWalkingSecond: 0,
    perEarlyStartMinute: 1,
    perLateEndMinute: 1,
    perDayOnCampus: 0,
    perRatingPoint: 0,
    perGpaPoint: 0,
    perUnknownWalking: 0,
  },
  k: 3,
  timeBudgetMs: 1000,
  walkingTime: stubWalkingTime,
};

describe("anchor defaults", () => {
  it("uses 540 / 960 when anchors are omitted", () => {
    expect(DEFAULT_EARLY_START_ANCHOR_MINUTES).toBe(540);
    expect(DEFAULT_LATE_END_ANCHOR_MINUTES).toBe(960);
    const chosen = sampleRequest.sections.filter((s) => s.id !== "anth-b");
    const d = computeBreakdown(sampleRequest, chosen);
    // Every meeting starts at/after 9:00 and ends at/before 16:00.
    expect(d.earlyStartMinutes).toBe(0);
    expect(d.lateEndMinutes).toBe(0);
    expect(d.cost).toBe(0);
  });

  it("a custom early anchor moves the early-start term", () => {
    const chosen = sampleRequest.sections.filter((s) => s.id !== "anth-b");
    const d = computeBreakdown({ ...sampleRequest, earlyStartAnchorMinutes: 600 }, chosen);
    // max(0,600-540) + max(0,600-630)=0 + max(0,600-660)=0
    expect(d.earlyStartMinutes).toBe(60);
    expect(d.cost).toBe(60);
  });

  it("a custom late anchor moves the late-end term", () => {
    const chosen = sampleRequest.sections.filter((s) => s.id !== "anth-b");
    const d = computeBreakdown({ ...sampleRequest, lateEndAnchorMinutes: 630 }, chosen);
    // max(0,600-630)=0 + max(0,690-630)=60 + max(0,720-630)=90
    expect(d.lateEndMinutes).toBe(150);
    expect(d.cost).toBe(150);
  });
});

describe("empty request edge case", () => {
  it("scores the empty schedule at all-zero cost 0", () => {
    const d = computeBreakdown(sampleRequest, []);
    expect(d).toEqual({
      gapMinutes: 0,
      walkingSeconds: 0,
      earlyStartMinutes: 0,
      lateEndMinutes: 0,
      daysOnCampus: 0,
      ratingSum: 0,
      gpaSum: 0,
      unknownWalkingPairs: 0,
      cost: 0,
    });
  });
});

describe("missing-value semantics", () => {
  it("missing rating and GPA contribute zero to their sums and the cost", () => {
    const weights = {
      perGapMinute: 0,
      perWalkingSecond: 0,
      perEarlyStartMinute: 0,
      perLateEndMinute: 0,
      perDayOnCampus: 0,
      perRatingPoint: 1,
      perGpaPoint: 1,
      perUnknownWalking: 0,
    };
    const chosen = sampleRequest.sections.filter((s) => s.id !== "anth-a");
    const d = computeBreakdown({ ...sampleRequest, softWeights: weights }, chosen);
    // anth-b has no rating/GPA -> skipped; math-a contributes 4.0 and 3.2.
    expect(d.ratingSum).toBe(4.0);
    expect(d.gpaSum).toBeCloseTo(3.2, 9);
    expect(d.cost).toBeCloseTo(-7.2, 9);
  });

  it("known rating and GPA enter the cost with a MINUS sign", () => {
    const weights = {
      ...sampleRequest.softWeights,
      perRatingPoint: 2,
      perGpaPoint: 1,
    };
    const chosen = [sampleRequest.sections[2]];
    const d = computeBreakdown({ ...sampleRequest, softWeights: weights }, chosen);
    expect(d.ratingSum).toBe(4.0);
    expect(d.gpaSum).toBe(3.2);
    // anchors contribute 0 for this single Tuesday 11:00-12:00 meeting.
    expect(d.cost).toBeCloseTo(-(2 * 4.0 + 1 * 3.2), 9);
  });
});

describe("type-level smoke", () => {
  it("a request object literal and an Optimize stub typecheck against the contract", async () => {
    const optimize: Optimize = async (req) => ({
      status: "optimal",
      schedules: [
        {
          sectionIds: [],
          byCourse: {},
          breakdown: computeBreakdown(req, []),
        },
      ],
      diversity: 0,
      initMs: 0,
      searchMs: 0,
    });
    const result = await optimize(sampleRequest);
    expect(result.status).toBe("optimal");
    expect(result.schedules.length).toBe(1);
  });
});
