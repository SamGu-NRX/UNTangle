import { describe, expect, it } from "bun:test";
import { runChecker } from "../../src/lib/optimizer/checker";
import { optimize } from "../../src/lib/optimizer/lns/lns-optimizer";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";

const CHECK_BUDGET_MS = 1000;
const all = suiteInstances("all");

describe("lns through the independent checker on every pinned instance", () => {
  for (const instance of all) {
    it(instance.name + ": zero violations, honest status", async () => {
      const req =
        instance.req.timeBudgetMs > CHECK_BUDGET_MS ? { ...instance.req, timeBudgetMs: CHECK_BUDGET_MS } : instance.req;
      const result = await optimize(req);
      expect(runChecker(req, result)).toEqual([]);
      if (!instance.enumerable) {
        // Honesty on instances brute force cannot enumerate: never 'optimal'.
        expect(result.status).not.toBe("optimal");
      }
      if (instance.expectInfeasible) expect(result.status).toBe("infeasible");
      if (instance.expectFeasible) expect(result.status === "optimal" || result.status === "feasible").toBe(true);
      console.log(
        "[status] " + instance.name + ": " + result.status + " schedules=" + result.schedules.length +
        (instance.enumerable ? "" : " (non-enumerable)"),
      );
    });
  }
});
