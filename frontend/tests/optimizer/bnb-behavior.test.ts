import { describe, expect, it } from "bun:test";
import { optimize as bnbOptimize } from "../../src/lib/optimizer/bnb/bnb-optimizer";
import { runChecker } from "../../src/lib/optimizer/checker";
import { generateInstance, benchWalkingTime } from "../../src/lib/optimizer/bench/generator";
import { BASE_SEED, buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest, OptimizerSection } from "../../src/lib/optimizer/types";

const PROFILES = ["plain", "anchors", "daysOff", "blocked", "transfer", "credits", "mixed"] as const;

function smallInstance(i: number): OptimizeRequest {
  return generateInstance(BASE_SEED + i * 13, {
    courses: 2 + (i % 2),
    sectionsPerCourse: 2 + (i % 2),
    locks: i % 3 === 0 ? 1 : 0,
    exclusions: i % 4 === 0 ? 1 : 0,
    constraintDensity: 0.4,
    profile: PROFILES[i % PROFILES.length],
  });
}

describe("bnb behavior", () => {
  it("running the same request twice gives identical results (timings aside)", async () => {
    for (const i of [1, 4, 6]) {
      const req = smallInstance(i);
      const first = await bnbOptimize(req);
      const second = await bnbOptimize(req);
      expect(JSON.stringify({ ...first, initMs: 0, searchMs: 0 })).toBe(
        JSON.stringify({ ...second, initMs: 0, searchMs: 0 }),
      );
    }
  }, 15000);

  it("timeBudgetMs=1 on a large instance: honest timeout, checker-clean, no hang", async () => {
    const large = buildSuite().find((instance) => instance.name === "large-l");
    if (!large) throw new Error("pinned large-l instance missing");
    const req = { ...large.req, timeBudgetMs: 1 };
    const result = await bnbOptimize(req);
    expect(result.status).toBe("timeout");
    expect(result.initMs + result.searchMs).toBeLessThanOrEqual(req.timeBudgetMs + 50);
    for (const schedule of result.schedules) expect(schedule.breakdown).toBeDefined();
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);

  it("k=1 returns the same best schedule as k=5", async () => {
    let done = false;
    for (let i = 0; i < 8 && !done; i++) {
      const req = { ...smallInstance(i), k: 5 };
      const r5 = await bnbOptimize(req);
      if (r5.status !== "optimal") continue;
      const r1 = await bnbOptimize({ ...req, k: 1 });
      expect(r1.status).toBe("optimal");
      expect(r1.schedules).toHaveLength(1);
      expect(r1.schedules[0].sectionIds).toEqual(r5.schedules[0].sectionIds);
      expect(Math.abs(r1.schedules[0].breakdown.cost - r5.schedules[0].breakdown.cost)).toBeLessThanOrEqual(1e-9);
      done = true;
    }
    expect(done).toBe(true);
  }, 15000);

  it("empty request: optimal with one empty schedule of cost 0", async () => {
    const base = smallInstance(0);
    const req: OptimizeRequest = {
      ...base,
      requestedCourseCodes: [],
      lockedSectionIds: [],
      excludedSectionIds: [],
    };
    const result = await bnbOptimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].sectionIds).toEqual([]);
    expect(result.schedules[0].breakdown.cost).toBe(0);
    expect(result.diversity).toBe(0);
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);

  it("k=0: empty schedules list, still a status and timings", async () => {
    const req = { ...smallInstance(1), k: 0 };
    const result = await bnbOptimize(req);
    expect(result.schedules).toEqual([]);
    expect(["optimal", "infeasible", "timeout"]).toContain(result.status);
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);

  it("locked == excluded (pool section of a requested course): infeasible with verified IIS", async () => {
    const base = smallInstance(2);
    const victim = base.sections.find((s) => base.requestedCourseCodes.includes(s.courseCode));
    if (!victim) throw new Error("fixture has no pool section of a requested course");
    const req: OptimizeRequest = { ...base, lockedSectionIds: [victim.id], excludedSectionIds: [victim.id] };
    const result = await bnbOptimize(req);
    expect(result.status).toBe("infeasible");
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);

  it("a requested course with zero remaining candidates: infeasible (exclusion and window flavors)", async () => {
    const excluded = smallInstance(3);
    const code = excluded.requestedCourseCodes[0];
    if (code === undefined) throw new Error("fixture has no requested course");
    const ids = excluded.sections.filter((s) => s.courseCode === code).map((s) => s.id);
    const zeroed: OptimizeRequest = {
      ...excluded,
      excludedSectionIds: [...excluded.excludedSectionIds, ...ids],
    };
    const r1 = await bnbOptimize(zeroed);
    expect(r1.status).toBe("infeasible");
    expect(runChecker(zeroed, r1)).toEqual([]);

    const base4 = smallInstance(4);
    const windowed: OptimizeRequest = {
      ...base4,
      hardConstraints: { ...base4.hardConstraints, earliestStart: 1200 },
    };
    const r2 = await bnbOptimize(windowed);
    expect(r2.status).toBe("infeasible");
    expect(runChecker(windowed, r2)).toEqual([]);
  }, 15000);

  it("an exact cost tie is won by the lexicographically smaller sorted-id join", async () => {
    const meeting = (day: "Mon" | "Tue", buildingId: string) => ({ day, start: 540, end: 600, buildingId });
    const sections: OptimizerSection[] = [
      { id: "sec-aa", courseCode: "TIE 100", credits: 3, meetings: [meeting("Mon", "bench-arts")], instructorRating: 4, historicalGpa: 3 },
      { id: "sec-bb", courseCode: "TIE 100", credits: 3, meetings: [meeting("Mon", "bench-arts")], instructorRating: 4, historicalGpa: 3 },
      { id: "sec-cc", courseCode: "TIE 200", credits: 3, meetings: [meeting("Tue", "bench-sci")], instructorRating: 4, historicalGpa: 3 },
    ];
    const req: OptimizeRequest = {
      sections,
      requestedCourseCodes: ["TIE 100", "TIE 200"],
      lockedSectionIds: [],
      excludedSectionIds: [],
      hardConstraints: {},
      softWeights: {
        perGapMinute: 1,
        perWalkingSecond: 0.1,
        perEarlyStartMinute: 1,
        perLateEndMinute: 1,
        perDayOnCampus: 10,
        perRatingPoint: 2,
        perGpaPoint: 1,
        perUnknownWalking: 5,
      },
      k: 2,
      timeBudgetMs: 1000,
      walkingTime: benchWalkingTime,
    };
    const result = await bnbOptimize(req);
    expect(result.status).toBe("optimal");
    expect(result.schedules).toHaveLength(2);
    const first = result.schedules[0];
    const second = result.schedules[1];
    expect(first.breakdown.cost).toBe(second.breakdown.cost); // an EXACT tie
    expect(first.sectionIds).toEqual(["sec-aa", "sec-cc"]); // smaller join wins
    expect(second.sectionIds).toEqual(["sec-bb", "sec-cc"]);
    expect(runChecker(req, result)).toEqual([]);
  }, 15000);
});
