import { describe, expect, it } from "bun:test";
import { optimize as bnbOptimize } from "../../src/lib/optimizer/bnb/bnb-optimizer";
import { optimize as bruteOptimize } from "../../src/lib/optimizer/brute-force";
import { runChecker, verifyIis } from "../../src/lib/optimizer/checker";
import { buildSuite } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest } from "../../src/lib/optimizer/types";

const SUITE = buildSuite();

function withBudget(req: OptimizeRequest, ms: number): OptimizeRequest {
  return { ...req, timeBudgetMs: ms };
}

describe("bnb agreement with the exact reference", () => {
  it("on every enumerable pinned instance: same status, same top-k (cost + ids)", async () => {
    const enumerable = SUITE.filter((instance) => instance.enumerable);
    expect(enumerable.length).toBeGreaterThan(10);
    for (const instance of enumerable) {
      const brute = await bruteOptimize(instance.req);
      const mine = await bnbOptimize(withBudget(instance.req, 2000));
      expect(mine.status).toBe(brute.status);
      if (brute.status === "infeasible") {
        expect(mine.schedules).toEqual([]);
        continue;
      }
      expect(mine.status).toBe("optimal");
      expect(mine.schedules.length).toBe(brute.schedules.length);
      for (let i = 0; i < brute.schedules.length; i++) {
        expect(mine.schedules[i].sectionIds).toEqual(brute.schedules[i].sectionIds);
        expect(Math.abs(mine.schedules[i].breakdown.cost - brute.schedules[i].breakdown.cost)).toBeLessThanOrEqual(1e-9);
      }
    }
  }, 30000);

  it("every pinned instance passes the independent checker (1000ms on the big ones)", async () => {
    for (const instance of SUITE) {
      const req = withBudget(instance.req, Math.min(instance.req.timeBudgetMs, 1000));
      const result = await bnbOptimize(req);
      expect(runChecker(req, result)).toEqual([]);
      if (instance.expectFeasible) expect(result.status).not.toBe("infeasible");
      if (instance.expectInfeasible) expect(result.status).toBe("infeasible");
    }
  }, 30000);

  it("infeasible pinned instances carry verified irreducible IIS subsets", async () => {
    const infeasible = SUITE.filter((instance) => instance.expectInfeasible === true);
    expect(infeasible.length).toBeGreaterThanOrEqual(5);
    for (const instance of infeasible) {
      const result = await bnbOptimize(instance.req);
      expect(result.status).toBe("infeasible");
      expect(result.schedules).toEqual([]);
      const subset = result.infeasibleSubset;
      if (!subset) throw new Error(`infeasible result without infeasibleSubset on ${instance.name}`);
      const verdict = verifyIis(instance.req, subset);
      expect(verdict.subsetInfeasible).toBe(true);
      expect(verdict.allSingleRemovalsFeasible).toBe(true);
      expect(runChecker(instance.req, result)).toEqual([]);
    }
  }, 30000);
});
