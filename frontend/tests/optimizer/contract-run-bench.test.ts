/**
 * Regression tests for the bench runner's review findings (PR #14 FIX):
 * every repeat must be validated (a single invalid repeat is caught even
 * when later repeats pass) and variant exceptions must be classified
 * STRUCTURALLY — a genuine enumerability refusal is a skip; any other
 * exception is a loud variant error, never an expected-refusal skip.
 *
 * Instance selection is defensive on purpose: the pure-classification tests
 * never touch the registry, the instance-driven tests no-op when the
 * registry is unavailable, and no module-scope code can throw — every one
 * of the seven tests registers and runs.
 */

import { describe, expect, test } from "bun:test";
import * as bruteForce from "../../src/lib/optimizer/brute-force";
import { NonEnumerableRefusal } from "../../src/lib/optimizer/brute-force";
import { benchmarkInstance, classifyVariantFailure } from "../../src/lib/optimizer/bench/run-bench";
import { suiteInstances } from "../../src/lib/optimizer/bench/instances";
import type { OptimizeRequest, OptimizeResult } from "../../src/lib/optimizer/types";

interface BenchInstance {
  name: string;
  enumerable: boolean;
  req: OptimizeRequest;
}

const all: BenchInstance[] = (() => {
  try {
    return suiteInstances("all") as BenchInstance[];
  } catch (error) {
    console.warn(`contract-run-bench: suiteInstances("all") unavailable: ${String(error)}`);
    return [];
  }
})();

const enumerableReq: OptimizeRequest | undefined = all.find(
  (i) => i.enumerable && (i.req.requestedCourseCodes?.length ?? 0) > 0,
)?.req;

/** First instance whose true brute-force result is infeasible with an IIS. */
async function findInfeasibleReq(): Promise<OptimizeRequest | undefined> {
  for (const inst of all) {
    try {
      const r = await bruteForce.optimize(inst.req);
      if (r.status === "infeasible" && r.infeasibleSubset) return inst.req;
    } catch {
      // non-enumerable refusal — keep scanning
    }
  }
  return undefined;
}

/** Result with a tampered cost — the independent checker must flag it. */
async function tamperedResult(req: OptimizeRequest): Promise<OptimizeResult> {
  const result = await bruteForce.optimize(req);
  return {
    ...result,
    schedules: result.schedules.map((s) => ({
      ...s,
      breakdown: { ...s.breakdown, cost: s.breakdown.cost + 1 },
    })),
  };
}

describe("contract-run-bench: structural error classification", () => {
  test("classifyVariantFailure never message-matches: renaming the error text cannot reclassify it", () => {
    expect(classifyVariantFailure(new Error("variant refused non-enumerable instance (candidate-product 999)"), false)).toEqual({
      kind: "error",
      errorClass: "variant-error",
      message: "Error: variant refused non-enumerable instance (candidate-product 999)",
    });
    expect(classifyVariantFailure(new NonEnumerableRefusal(2_000_000), false).kind).toBe("skip");
    expect(classifyVariantFailure(new NonEnumerableRefusal(2_000_000), true)).toEqual({
      kind: "error",
      errorClass: "refusal-on-enumerable",
      message: expect.stringContaining("ENUMERABLE"),
    });
    expect(classifyVariantFailure("boom", true)).toEqual({
      kind: "error",
      errorClass: "variant-error",
      message: "boom",
    });
  });

  test("arbitrary variant error on a non-enumerable instance is an ERROR record, not a skip", async () => {
    const broken = async (): Promise<OptimizeResult> => {
      throw new Error("solver exploded mid-search");
    };
    const outcome = await benchmarkInstance(broken, enumerableReq ?? ({ k: 1 } as OptimizeRequest), { enumerable: false, repeat: 2 });
    expect(outcome.repeatsErrored).toBe(2);
    expect(outcome.repeatsSkipped).toBe(0);
    expect(outcome.errorClass).toBe("variant-error");
    expect(outcome.errorMessage).toContain("solver exploded mid-search");
    expect(outcome.violations).toBeNull();
  });

  test("genuine typed refusal on a non-enumerable instance is a skip with its reason", async () => {
    const refuse = async (): Promise<OptimizeResult> => {
      throw new NonEnumerableRefusal(2_000_000);
    };
    const outcome = await benchmarkInstance(refuse, enumerableReq ?? ({ k: 1 } as OptimizeRequest), { enumerable: false, repeat: 2 });
    expect(outcome.repeatsSkipped).toBe(2);
    expect(outcome.repeatsErrored).toBe(0);
    expect(outcome.errorClass).toBeNull();
    expect(outcome.skipReason).toContain("non-enumerable");
    expect(outcome.skipReason).toContain("2000000");
  });

  test("typed refusal on an ENUMERABLE instance is an error (inconsistent bound)", async () => {
    const refuse = async (): Promise<OptimizeResult> => {
      throw new NonEnumerableRefusal(12);
    };
    const outcome = await benchmarkInstance(refuse, enumerableReq ?? ({ k: 1 } as OptimizeRequest), { enumerable: true, repeat: 1 });
    expect(outcome.repeatsErrored).toBe(1);
    expect(outcome.errorClass).toBe("refusal-on-enumerable");
  });
});

describe("contract-run-bench: every repeat is validated", () => {
  test("an invalid EARLIER repeat is caught even when later repeats pass", async () => {
    if (!enumerableReq) return; // registry unavailable — instance-driven checks no-op
    let call = 0;
    const flaky = async (req: OptimizeRequest): Promise<OptimizeResult> => {
      call += 1;
      if (call === 1) return tamperedResult(req); // invalid: checker must flag
      return bruteForce.optimize(req); // later repeats clean
    };
    const outcome = await benchmarkInstance(flaky, enumerableReq, { enumerable: true, repeat: 3 });
    expect(outcome.repeatsRan).toBe(3);
    expect(outcome.repeatsErrored).toBe(0);
    // Old bug: only the last repeat was checked -> violations 0. Fixed:
    expect(outcome.violations).toBeGreaterThan(0);
    expect(outcome.repeatViolations[0]).toBeGreaterThan(0);
    expect(outcome.repeatViolations[1]).toBe(0);
    expect(outcome.repeatViolations[2]).toBe(0);
  });

  test("a clean variant keeps zero violations and a zero optimality gap", async () => {
    if (!enumerableReq) return;
    const outcome = await benchmarkInstance(bruteForce.optimize, enumerableReq, { enumerable: true, repeat: 2 });
    expect(outcome.repeatsRan).toBe(2);
    expect(outcome.violations).toBe(0);
    expect(outcome.repeatViolations).toEqual([0, 0]);
    expect(outcome.errorClass).toBeNull();
    expect(outcome.optimalityGap).toBe(0);
  });

  test("an invalid IIS in any repeat flips the aggregate to false", async () => {
    const req = await findInfeasibleReq();
    if (!req) return;
    const brokenIis = async (r: OptimizeRequest): Promise<OptimizeResult> => {
      const result = await bruteForce.optimize(r);
      if (!result.infeasibleSubset) return result;
      // Tamper the subset: drop one member -> no longer irreducible.
      const members = result.infeasibleSubset.members.slice(0, -1);
      return { ...result, infeasibleSubset: { members } };
    };
    const outcome = await benchmarkInstance(brokenIis, req, { enumerable: false, repeat: 2 });
    expect(outcome.iisValid).toBe(false);
  });
});
