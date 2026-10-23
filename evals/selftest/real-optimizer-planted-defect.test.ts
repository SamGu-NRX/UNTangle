/**
 * Real-suite planted defect: optimizer.
 *
 * The optimizer suite's boundary is the REAL bench interface (decision 685c,
 * evals/suites/optimizer.ts): `bun run src/lib/optimizer/bench/run-bench.ts
 * --variant=./src/lib/optimizer/brute-force --suite=all --k=3 --repeat=3`
 * and the results file it writes (results/brute-force-all.json, the
 * {variant, suite, k, repeat, instances[]} report). These tests plant a
 * CONFORMING bench against a stubbed-stack harness copy — no Postgres,
 * backend, frontend build, or browser — carrying one defect at a time, and
 * assert the REAL suite's verdicts:
 *
 *   no bench in target                   -> 3 x not-applicable        -> exit 0
 *   conforming bench, healthy report     -> 3 x pass                  -> exit 0
 *   violations=2 on one instance         -> violations-zero FAIL, rest pass -> exit 1
 *   optimalityGap=0.5 on one instance    -> gap-zero FAIL, rest pass  -> exit 1
 *   worst-case-xl wallMsP95=2000         -> p95-8courses FAIL, rest pass -> exit 1
 *   bench exiting 3, no results file     -> 3 x FAIL (run-level)      -> exit 1
 *
 * The planted report is otherwise healthy (3 enumerable instances, gap 0,
 * p95 40-44 ms), so a failing case is attributable to the planted defect
 * alone, and the sibling cases passing alongside proves per-case verdicts
 * rather than a blanket failure.
 *
 * Run: bun test evals/selftest/real-optimizer-planted-defect.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import {
  makeFakeTarget,
  makeHarnessCopy,
  makeTempRoot,
  readCard,
  runRunner,
  writeBenchArtifact,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;

beforeAll(() => {
  root = makeTempRoot("real-optimizer");
  harness = makeHarnessCopy(root, { stubStack: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function runOptimizer(targetDir: string, out: string): Promise<{ code: number | null; card: Scorecard; stderr: string }> {
  const r = await runRunner({
    harness,
    targetDir,
    suite: "optimizer",
    outPath: out,
    taskId: "selftest-real-optimizer",
    timeoutMs: 120_000,
  });
  return { code: r.code, card: readCard(out) as Scorecard, stderr: r.stderr };
}

function caseRecord(card: Scorecard, caseId: string) {
  const record = card.cases.find((c) => c.id === caseId);
  expect(record).toBeDefined();
  return record as NonNullable<(typeof card.cases)[number]>;
}

describe("real-suite planted defect: optimizer", () => {
  test(
    "target without a bench: all three cases are honestly not-applicable and the run exits 0",
    async () => {
      const target = makeFakeTarget(root, "target-no-bench");
      const out = path.join(root, "no-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(0);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      expect(card.cases.map((c) => c.id).sort()).toEqual([
        "gap-zero",
        "p95-8courses",
        "violations-zero",
      ]);
      for (const record of card.cases) {
        expect(record.status).toBe("not-applicable");
        // missingPathNote: the target checkout has no <BENCH_RUN_REL> (looked at ...)
        expect(record.note).toContain("has no frontend/src/lib/optimizer/bench/run-bench.ts");
      }
    },
    { timeout: 150_000 },
  );

  test(
    "conforming bench with a healthy report: all three cases pass and the run exits 0",
    async () => {
      const target = makeFakeTarget(root, "target-good-bench");
      writeBenchArtifact(target);
      const out = path.join(root, "good-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(0);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      for (const record of card.cases) {
        expect(record.status).toBe("pass");
      }
      // The pass note carries the bench's own measured p95 for the pinned family.
      expect(caseRecord(card, "p95-8courses").note).toContain("p95 44 ms");
    },
    { timeout: 150_000 },
  );

  test(
    "planted bench reporting 2 hard-constraint violations: violations-zero fails naming the count, the sibling cases still pass, run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-violations-bench");
      writeBenchArtifact(target, { violations: 2 });
      const out = path.join(root, "violations-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const violations = caseRecord(card, "violations-zero");
      expect(violations.status).toBe("fail");
      expect(violations.note).toContain("2 hard-constraint violations");
      expect(violations.note).toContain("baseline-8=2");
      expect(violations.bar).toBe("hard-constraint violations = 0");

      // The defect was planted only in the violation count: the same run
      // still passes gap and latency (per-case verdicts, not a blanket fail).
      expect(caseRecord(card, "gap-zero").status).toBe("pass");
      expect(caseRecord(card, "p95-8courses").status).toBe("pass");
    },
    { timeout: 150_000 },
  );

  test(
    "planted bench with optimalityGap 0.5: gap-zero fails naming the breach, the sibling cases still pass, run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-gap-bench");
      writeBenchArtifact(target, { gap: 0.5 });
      const out = path.join(root, "gap-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const gap = caseRecord(card, "gap-zero");
      expect(gap.status).toBe("fail");
      expect(gap.note).toContain("nonzero optimality gap vs brute force");
      expect(gap.note).toContain("dense-8=0.5");

      expect(caseRecord(card, "violations-zero").status).toBe("pass");
      expect(caseRecord(card, "p95-8courses").status).toBe("pass");
    },
    { timeout: 150_000 },
  );

  test(
    "planted bench with worst-case-xl p95 2000 ms: p95-8courses fails against the 500 ms bar, the sibling cases still pass, run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-p95-bench");
      writeBenchArtifact(target, { xlWallMsP95: 2000 });
      const out = path.join(root, "p95-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const p95 = caseRecord(card, "p95-8courses");
      expect(p95.status).toBe("fail");
      expect(p95.note).toContain("2000 ms exceeds the 500 ms bar");
      expect(p95.measured).toContain("p95=2000ms at 8 courses");

      expect(caseRecord(card, "violations-zero").status).toBe("pass");
      expect(caseRecord(card, "gap-zero").status).toBe("pass");
    },
    { timeout: 150_000 },
  );

  test(
    "bench exiting 3 without writing results: all three cases fail at the run level (nonzero exit is a finding, never a skip), run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-exit3-bench");
      writeBenchArtifact(target, { exitCode: 3 });
      const out = path.join(root, "exit3-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      for (const record of card.cases) {
        expect(record.status).toBe("fail");
        expect(record.note).toContain("bench exited 3");
      }
    },
    { timeout: 150_000 },
  );
});
