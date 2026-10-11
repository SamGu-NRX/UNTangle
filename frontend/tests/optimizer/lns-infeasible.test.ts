import { describe, expect, it } from "bun:test";
import { runChecker } from "../../src/lib/optimizer/checker";
import { optimize } from "../../src/lib/optimizer/lns/lns-optimizer";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";

const infeasible = suiteInstances("all").filter((instance) => instance.expectInfeasible);

describe("lns infeasibility with verified irreducible subsets", () => {
  it("covers the pinned infeasible families", () => {
    expect(infeasible.length).toBeGreaterThanOrEqual(7);
  });

  for (const instance of infeasible) {
    it(instance.name + ": infeasible, IIS passes verifyIis", async () => {
      const result = await optimize(instance.req);
      expect(result.status).toBe("infeasible");
      expect(result.infeasibleSubset).toBeDefined();
      // runChecker verifies the subset independently (subset infeasible +
      // every single removal feasible).
      expect(runChecker(instance.req, result)).toEqual([]);
    });
  }
});
