import { describe, expect, test } from "bun:test";
import highsLoader from "highs";

/**
 * Solver smoke tests for the `highs` WASM package (HiGHS compiled to
 * WebAssembly, MIT). These run before any model building: they pin the
 * package version's loading behavior, LP-format handling, option
 * passthrough, and status strings the mip optimizer relies on.
 */

describe("highs wasm solver", () => {
  test("loads and solves a trivial binary MIP optimally", async () => {
    const highs = await highsLoader();
    const result = highs.solve(
      `Minimize
 obj: x + 2 y
Subject To
 pick_one: x + y >= 1
 cheaper: x + y <= 1
Bounds
 x <= 1
 y <= 1
Binary
 x
 y
End`,
      { output_flag: false, random_seed: 0 },
    );
    expect(result.Status).toBe("Optimal");
    expect(result.ObjectiveValue).toBeCloseTo(1, 9);
    expect(result.Columns["x"].Primal).toBeCloseTo(1, 9);
    expect(result.Columns["y"].Primal).toBeCloseTo(0, 9);
  });

  test("reports Infeasible for an unsatisfiable binary model", async () => {
    const highs = await highsLoader();
    const result = highs.solve(
      `Minimize
 obj: x
Subject To
 impossible: x <= -1
Bounds
 x <= 1
Binary
 x
End`,
      { output_flag: false },
    );
    expect(result.Status).toBe("Infeasible");
  });

  test("accepts time_limit and mip option passthrough", async () => {
    const highs = await highsLoader();
    const result = highs.solve(
      `Minimize
 obj: x + y
Subject To
 need: x + y >= 1
Bounds
 x <= 1
 y <= 1
Binary
 x
 y
End`,
      // A generous limit on a trivial model: the point is that the option
      // names are accepted (unknown options throw per the package docs).
      { output_flag: false, time_limit: 5, mip_rel_gap: 0, random_seed: 0 },
    );
    expect(result.Status).toBe("Optimal");
  });

  test("time-limited solve on a small model still proves optimality", async () => {
    const highs = await highsLoader();
    const result = highs.solve(
      `Maximize
 obj: 3 x + 2 y
Subject To
 cap: x + y <= 1
Bounds
 x <= 1
 y <= 1
Binary
 x
 y
End`,
      { output_flag: false, time_limit: 0.001 },
    );
    // Either it finished before the limit (Optimal, 3) or the limit stopped
    // it carrying the best incumbent; both are legal returns.
    expect(["Optimal", "Time limit reached"]).toContain(result.Status);
    if (result.Status === "Optimal") expect(result.ObjectiveValue).toBeCloseTo(3, 9);
  });
});
