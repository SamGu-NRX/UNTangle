import { describe, expect, it } from "bun:test";
import { optimize as bruteForceOptimize } from "../../src/lib/optimizer/brute-force";
import { runChecker } from "../../src/lib/optimizer/checker";
import { optimizeWithDiagnostics } from "../../src/lib/optimizer/lns/lns-optimizer";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";

const AGREEMENT_BUDGET_MS = 2000;
const all = suiteInstances("all");
const enumerable = all.filter((instance) => instance.enumerable);

describe("lns agreement with brute force on enumerable pinned instances", () => {
  it("covers the enumerable families", () => {
    expect(enumerable.length).toBeGreaterThanOrEqual(15);
  });

  for (const instance of enumerable) {
    it(instance.name + ": checker-clean, gap 0 on the small/medium classes", async () => {
      const req = { ...instance.req, timeBudgetMs: AGREEMENT_BUDGET_MS };
      const result = await optimizeWithDiagnostics(req);
      expect(runChecker(req, result)).toEqual([]);
      const reference = await bruteForceOptimize(instance.req);
      if (reference.status === "infeasible") {
        expect(result.status).toBe("infeasible");
        return;
      }
      expect(reference.schedules.length).toBeGreaterThan(0);
      expect(result.schedules.length).toBeGreaterThan(0);
      const gap = result.schedules[0].breakdown.cost - reference.schedules[0].breakdown.cost;
      // Every enumerable pinned instance is xs/s/m (the l/xl families are not
      // enumerable), so the gap must be exactly 0 on all of them.
      expect(Math.abs(gap)).toBeLessThanOrEqual(1e-9);
      if (result.diagnostics.fullyEnumerated) {
        // Provably enumerated the whole space: top-k must equal brute force's.
        expect(result.schedules.map((schedule) => schedule.sectionIds.join("|"))).toEqual(
          reference.schedules.map((schedule) => schedule.sectionIds.join("|")),
        );
      }
      console.log(
        "[gap] " + instance.name + ": status=" + result.status + " gap=" + gap +
        " fullyEnumerated=" + result.diagnostics.fullyEnumerated + " schedules=" + result.schedules.length,
      );
    });
  }
});
