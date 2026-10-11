import { describe, expect, test } from "bun:test";
import highsLoader from "highs";

/**
 * Solver smoke tests for the `highs` WASM package (the mip variant's only
 * dependency). These verify the solver itself — loading, solving, detecting
 * infeasibility, and honoring options — independently of the mip encoding.
 */

describe("highs wasm solver", () => {
  test("loads and exposes a solve function", async () => {
    const highs = await highsLoader();
    expect(typeof highs.solve).toBe("function");
  }, 30000);

  test("solves a trivial binary MIP to optimality", async () => {
    const highs = await highsLoader();
    const solution = highs.solve(
      ["Minimize", " obj: -2 x0 - 3 x1", "Subject To", " cap: 2 x0 + 2 x1 <= 3", "Binaries", "  x0 x1", " End"].join("\n"),
      { output_flag: false, random_seed: 0, mip_rel_gap: 0 },
    );
    expect(solution.Status).toBe("Optimal");
    expect(solution.ObjectiveValue).toBeCloseTo(-3, 9); // x1 alone (weight 3 > 2*1)
    const columns = solution.Columns as unknown as Record<string, { readonly Primal: number }>;
    expect(columns.x0?.Primal ?? 0).toBe(0);
    expect(columns.x1?.Primal ?? 0).toBe(1);
  });

  test("detects infeasibility", async () => {
    const highs = await highsLoader();
    const solution = highs.solve(
      ["Minimize", " obj: x0", "Subject To", " lo: x0 >= 1", " hi: x0 <= 0", "Binaries", "  x0", " End"].join("\n"),
      { output_flag: false },
    );
    expect(solution.Status).toBe("Infeasible");
  });

  test("honors time_limit and other passthrough options without hanging", async () => {
    const highs = await highsLoader();
    const started = performance.now();
    const solution = highs.solve(
      ["Minimize", " obj: -x0", "Subject To", " c0: x0 >= 1", "Binaries", "  x0", " End"].join("\n"),
      { output_flag: false, random_seed: 0, mip_rel_gap: 0, time_limit: 0.001 },
    );
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000); // did not hang past a generous cap
    expect(["Optimal", "Time limit reached"]).toContain(solution.Status);
  });
});
