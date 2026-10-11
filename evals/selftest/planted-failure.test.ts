/**
 * Scenario 2: a deliberately planted data defect is CAUGHT — the mirror of
 * the optimizer/data worker's planted dataset-descriptor hash mismatch.
 *
 * The same throwaway fake suite (fakesuite, whose descriptor-hash case
 * recomputes the bundle's sha256 and compares it to the target's recorded
 * descriptor) and the same fake target run twice through the same runner:
 *
 *   run 1  bundle matches its descriptor           -> case passes, exit 0
 *   plant()  one mutated byte in the bundle
 *   run 2  bundle no longer matches the descriptor  -> case fails, exit 1
 *
 * The suite file is byte-identical across both runs (asserted), so the
 * verdict flip is caused by the planted data defect, not by a changed
 * oracle: the detector is load-bearing.
 *
 * The stubbed-stack harness copy is used — no real stack is ever booted.
 *
 * Run: bun test evals/selftest/planted-failure.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import {
  makeDatasetTarget,
  makeHarnessCopy,
  makeTempRoot,
  readCard,
  runRunner,
  writeFakeSuites,
  type DatasetTarget,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;
let dataset: DatasetTarget;

beforeAll(() => {
  root = makeTempRoot("planted");
  harness = makeHarnessCopy(root, { stubStack: true });
  writeFakeSuites(harness);
  dataset = makeDatasetTarget(root, "target-dataset");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const suiteFilePath = (): string => path.join(harness.suitesDir, "fakesuite.ts");

async function runFakesuite(label: string): Promise<{ code: number | null; card: Scorecard; stderr: string }> {
  const out = path.join(root, label, "card.json");
  const r = await runRunner({
    harness,
    targetDir: dataset.targetDir,
    suite: "fakesuite",
    outPath: out,
    taskId: `selftest-planted-${label}`,
  });
  return { code: r.code, card: readCard(out) as Scorecard, stderr: r.stderr };
}

describe("planted failure is caught (fake suite + fake target)", () => {
  test(
    "clean target: the hash detector passes and the run exits 0",
    async () => {
      const suiteBytesBefore = readFileSync(suiteFilePath(), "utf8");
      const { code, card, stderr } = await runFakesuite("clean");

      expect(code).toBe(0);
      expect(validateScorecard(card)).toEqual([]);
      const descriptorCase = card.cases.find((c) => c.id === "descriptor-hash-matches-data");
      expect(descriptorCase?.status).toBe("pass");
      expect(descriptorCase?.measured).toContain("matches");
      expect(stderr).toContain("[run] 2/2 pass, 0 fail, 0 n/a");

      // The oracle did not change between runs.
      expect(readFileSync(suiteFilePath(), "utf8")).toBe(suiteBytesBefore);
    },
    120_000,
  );

  test(
    "planted byte mutation: the same detector fails the case and the run exits 1",
    async () => {
      const suiteBytesBefore = readFileSync(suiteFilePath(), "utf8");
      dataset.plant();
      const { code, card, stderr } = await runFakesuite("planted");

      expect(code).toBe(1);
      expect(validateScorecard(card)).toEqual([]);

      const descriptorCase = card.cases.find((c) => c.id === "descriptor-hash-matches-data");
      expect(descriptorCase?.status).toBe("fail");
      expect(descriptorCase?.measured).toContain("!=");
      expect(descriptorCase?.note).toContain("planted dataset mutation detected");

      // The runner did not over-report: the always-green control still passed.
      const control = card.cases.find((c) => c.id === "always-green");
      expect(control?.status).toBe("pass");
      expect(stderr).toContain("[run] 1/2 pass, 1 fail, 0 n/a");

      // The oracle did not change between runs — only the data did.
      expect(readFileSync(suiteFilePath(), "utf8")).toBe(suiteBytesBefore);
    },
    120_000,
  );
});
