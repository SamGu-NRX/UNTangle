import { describe, expect, it } from "bun:test";
import { optimize, isFeasible } from "../../src/lib/optimizer/brute-force";
import { generateInstance } from "../../src/lib/optimizer/bench/generator";
import { BASE_SEED } from "../../src/lib/optimizer/bench/instances";
import { runChecker, independentSubFeasible } from "../../src/lib/optimizer/checker";
import { pruneToMembers, allMembers } from "../../src/lib/optimizer/iis-reference";
import type { OptimizeRequest } from "../../src/lib/optimizer/types";

const PROFILES = ["plain", "anchors", "daysOff", "blocked", "transfer", "credits", "mixed", "infeasibleCredits", "infeasibleBlocked", "infeasibleTransfer"] as const;

function smallInstance(i: number): OptimizeRequest {
  const profile = PROFILES[i % PROFILES.length];
  const courses = 2 + (i % 2); // 2..3
  const sectionsPerCourse = 2 + (i % 2); // 2..3
  return generateInstance(BASE_SEED + i * 13, {
    courses,
    sectionsPerCourse,
    locks: i % 3 === 0 ? 1 : 0,
    exclusions: i % 4 === 0 ? 1 : 0,
    constraintDensity: 0.4,
    profile,
  });
}

describe("brute force cross-validation", () => {
  it("40 small instances: results pass the independent checker; infeasible verdicts match an independent enumeration", async () => {
    for (let i = 0; i < 40; i++) {
      const req = smallInstance(i);
      const result = await optimize(req);

      if (result.status === "infeasible") {
        // The test's own independent enumeration must also find nothing feasible.
        const full: OptimizeRequest = pruneToMembers(req, allMembers(req));
        expect(independentSubFeasible(full)).toBe(false);
        expect(result.schedules).toEqual([]);
        expect(runChecker(req, result)).toEqual([]);
        continue;
      }

      expect(result.status).toBe("optimal");
      expect(result.schedules.length).toBeGreaterThanOrEqual(1);
      expect(result.schedules.length).toBeLessThanOrEqual(req.k);
      expect(runChecker(req, result)).toEqual([]);
    }
  });

  it("running twice gives identical output (determinism, timings aside)", async () => {
    for (const i of [3, 7, 11]) {
      const req = smallInstance(i);
      const first = await optimize(req);
      const second = await optimize(req);
      // initMs/searchMs are honest wall-clock measurements and may differ.
      expect(JSON.stringify({ ...first, initMs: 0, searchMs: 0 })).toEqual(
        JSON.stringify({ ...second, initMs: 0, searchMs: 0 }),
      );
    }
  });

  it("an empty request is optimal with one empty schedule of cost 0", async () => {
    const req = smallInstance(0);
    const empty: OptimizeRequest = {
      ...req,
      requestedCourseCodes: [],
      lockedSectionIds: [],
      excludedSectionIds: [],
    };
    const result = await optimize(empty);
    expect(result.status).toBe("optimal");
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].sectionIds).toEqual([]);
    expect(result.schedules[0].breakdown.cost).toBe(0);
    expect(result.diversity).toBe(0);
  });

  it("isFeasible agrees with optimize on both verdicts", async () => {
    for (let i = 0; i < 12; i++) {
      const req = smallInstance(i);
      const result = await optimize(req);
      expect(isFeasible(req)).toBe(result.status !== "infeasible");
    }
  });
});
