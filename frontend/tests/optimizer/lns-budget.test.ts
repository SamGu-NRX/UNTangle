import { describe, expect, it } from "bun:test";
import { runChecker } from "../../src/lib/optimizer/checker";
import { optimize } from "../../src/lib/optimizer/lns/lns-optimizer";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";

function pinned(name: string) {
  const instance = suiteInstances("all").find((candidate) => candidate.name === name);
  if (!instance) throw new Error("missing pinned instance " + name);
  return instance;
}

describe("lns budget and k behavior", () => {
  it("timeBudgetMs=1 on worst-case-xl -> timeout, checker-clean, no hang", async () => {
    const req = { ...pinned("worst-case-xl").req, timeBudgetMs: 1 };
    const result = await optimize(req);
    expect(result.status).toBe("timeout");
    expect(runChecker(req, result)).toEqual([]);
  });

  it("k=1 best equals k=5 best", async () => {
    const base = pinned("plain-m").req; // feasible instance (mixed-m is infeasible)
    const best = await optimize({ ...base, k: 1, timeBudgetMs: 2000 });
    const top5 = await optimize({ ...base, k: 5, timeBudgetMs: 2000 });
    expect(best.schedules.length).toBe(1);
    expect(top5.schedules.length).toBeGreaterThan(0);
    expect(top5.schedules[0]).toEqual(best.schedules[0]);
  });

  it("k=0 -> empty schedules list, checker-clean", async () => {
    const req = { ...pinned("plain-m").req, k: 0, timeBudgetMs: 2000 };
    const result = await optimize(req);
    expect(result.schedules).toEqual([]);
    expect(runChecker(req, result)).toEqual([]);
  });
});
