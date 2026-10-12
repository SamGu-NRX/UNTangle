import { describe, expect, it } from "bun:test";
import { optimize as bnbOptimize } from "../../src/lib/optimizer/bnb/bnb-optimizer";
import { runChecker, verifyIis } from "../../src/lib/optimizer/checker";
import { buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest } from "../../src/lib/optimizer/types";

const SUITE = buildSuite();

function withBudget(req: OptimizeRequest, ms: number): OptimizeRequest {
  return { ...req, timeBudgetMs: ms };
}

/**
 * Regression tests for the review blocker: IIS explanation work (the
 * deletion filter and every feasibility oracle call) must respect the
 * request deadline, and an unproven explanation must never come back as
 * "infeasible" — the honest bounded outcome is "timeout" with no subset.
 */
describe("bnb bounded IIS explanation (deadline-honest)", () => {
  it("budget too small to finish the proof: honest bounded outcome, never an unproven infeasible", async () => {
    const infeasible = SUITE.filter((instance) => instance.expectInfeasible === true);
    expect(infeasible.length).toBeGreaterThan(0);
    for (const instance of infeasible) {
      const req = withBudget(instance.req, 40);
      const result = await bnbOptimize(req);
      const billed = result.initMs + result.searchMs;
      expect(billed).toBeLessThanOrEqual(req.timeBudgetMs + 50);
      if (result.status === "infeasible") {
        // Only reachable when the proof genuinely completed: the subset
        // must be present and verify as irreducible.
        const subset = result.infeasibleSubset;
        expect(subset).toBeDefined();
        const verdict = verifyIis(instance.req, subset!);
        expect(verdict.subsetInfeasible).toBe(true);
        expect(verdict.allSingleRemovalsFeasible).toBe(true);
      } else {
        // The honest bounded outcome: no schedules, no subset claimed.
        expect(result.status).toBe("timeout");
        expect(result.schedules).toEqual([]);
        expect(result.infeasibleSubset).toBeUndefined();
      }
      expect(runChecker(req, result)).toEqual([]);
    }
  }, 30000);

  it("generous budget: prepare-level infeasibility still yields a proven irreducible subset", async () => {
    const feasible = SUITE.find((instance) => instance.expectFeasible === true);
    expect(feasible).toBeDefined();
    const base = feasible!.req;
    const firstCourse = base.requestedCourseCodes[0];
    const section = base.sections.find(
      (s) => s.courseCode === firstCourse && !base.excludedSectionIds.includes(s.id),
    );
    expect(section).toBeDefined();
    const req: OptimizeRequest = {
      ...base,
      timeBudgetMs: 2000,
      lockedSectionIds: [...base.lockedSectionIds, section!.id],
      excludedSectionIds: [...base.excludedSectionIds, section!.id],
    };
    const result = await bnbOptimize(req);
    expect(result.status).toBe("infeasible");
    const subset = result.infeasibleSubset;
    expect(subset).toBeDefined();
    const verdict = verifyIis(req, subset!);
    expect(verdict.subsetInfeasible).toBe(true);
    expect(verdict.allSingleRemovalsFeasible).toBe(true);
    expect(runChecker(req, result)).toEqual([]);
  }, 30000);

  it("irreducibility proof still completes on the pinned infeasible instances at their normal budget", async () => {
    const infeasible = SUITE.filter((instance) => instance.expectInfeasible === true);
    for (const instance of infeasible) {
      const result = await bnbOptimize(instance.req);
      expect(result.status).toBe("infeasible");
      const subset = result.infeasibleSubset;
      expect(subset).toBeDefined();
      const verdict = verifyIis(instance.req, subset!);
      expect(verdict.subsetInfeasible).toBe(true);
      expect(verdict.allSingleRemovalsFeasible).toBe(true);
    }
  }, 30000);
});
