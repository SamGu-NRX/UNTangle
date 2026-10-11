/**
 * Real-suite planted defect: optimizer.
 *
 * The optimizer suite's boundary is the target's bench artifact
 * (frontend/src/lib/optimizer/bench/run.{ts,js} or main.{ts,js}); the suite
 * executes it (cwd = bench dir, --format json) and parses its JSON report
 * (evals/suites/optdata-lib.ts runBenchReport). These tests plant that
 * artifact against a stubbed-stack harness copy — no Postgres, backend,
 * frontend build, or browser — and assert the REAL suite's verdicts:
 *
 *   no bench in target            -> 3 x not-applicable           -> exit 0
 *   conforming bench (viol. 0)    -> 3 x pass                     -> exit 0
 *   planted bench (viol. 3)       -> violations-zero FAIL, others pass -> exit 1
 *
 * The planted report is otherwise healthy (courses 8, gap 0, 20/20
 * enumerable instances, solve p95 ~59 ms), so a failing violations-zero is
 * attributable to the planted violations alone, and gap-zero passing
 * alongside proves per-case verdicts rather than a blanket failure.
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
        // missingPathNote: the target checkout has no <BENCH_REL> (looked at ...)
        expect(record.note).toContain("has no frontend/src/lib/optimizer/bench");
      }
    },
    { timeout: 150_000 },
  );

  test(
    "conforming bench (0 violations, gap 0, fast): all three cases pass and the run exits 0",
    async () => {
      const target = makeFakeTarget(root, "target-good-bench");
      writeBenchArtifact(target, { violations: 0 });
      const out = path.join(root, "good-bench", "card.json");
      const { code, card } = await runOptimizer(target, out);

      expect(code).toBe(0);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      for (const record of card.cases) {
        expect(record.status).toBe("pass");
      }
    },
    { timeout: 150_000 },
  );

  test(
    "planted bench reporting 3 hard-constraint violations: violations-zero fails naming the count, gap-zero still passes, run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-bad-bench");
      writeBenchArtifact(target, { violations: 3 });
      const out = path.join(root, "bad-bench", "card.json");
      const { code, card, stderr } = await runOptimizer(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const violations = caseRecord(card, "violations-zero");
      expect(violations.status).toBe("fail");
      expect(violations.note).toBe("bench reports 3 hard-constraint violations across 20 instances");
      expect(violations.bar).toBe("hard-constraint violations = 0");

      // The defect was planted only in the violation count: the same run
      // still passes the latency case (per-case verdicts, not a blanket fail).
      const latency = caseRecord(card, "p95-8courses");
      expect(latency.status).toBe("pass");
      expect(String(latency.measured)).toContain("p95=");
      expect(latency.bar).toBe("solve-time p95 <= 500 ms at 8 courses");
      expect(String(latency.note)).toContain("vs bar 500 ms");
    },
    { timeout: 150_000 },
  );
});
