import { describe, expect, it } from "bun:test";
import { optimize } from "../../src/lib/optimizer/lns/lns-optimizer";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeResult } from "../../src/lib/optimizer/types";

function withoutTimings(result: OptimizeResult) {
  return {
    status: result.status,
    schedules: result.schedules,
    diversity: result.diversity,
    infeasibleSubset: result.infeasibleSubset,
  };
}

describe("lns determinism (seeded PRNG, no Math.random)", () => {
  for (const name of ["plain-m", "mixed-m"]) {
    it(name + ": same request twice -> identical result ignoring timings", async () => {
      const instance = suiteInstances("all").find((candidate) => candidate.name === name);
      if (!instance) throw new Error("missing pinned instance " + name);
      const req = { ...instance.req, timeBudgetMs: 2000 };
      const first = await optimize(req);
      const second = await optimize(req);
      expect(withoutTimings(second)).toEqual(withoutTimings(first));
    });
  }
});
