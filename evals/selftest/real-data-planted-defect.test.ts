/**
 * Real-suite planted defect: data.
 *
 * The data suite's boundaries are two target artifacts (evals/suites/data.ts):
 *   - frontend/src/lib/data-provenance.ts, an `activeDataset` descriptor whose
 *     sha256/counts must match the bundled catalog file it names;
 *   - the catalog-consistency tool, executed with --format json, whose
 *     nonzero failure counts fail the certification case.
 *
 * These tests plant both artifacts against a stubbed-stack harness copy and
 * assert the REAL suite's verdicts:
 *
 *   healthy descriptor + tool          -> both cases pass        -> exit 0
 *   one corrupted bundle byte          -> descriptor FAILS
 *                                        (sha256 MISMATCH), tool passes -> exit 1
 *   tool reporting failures=2          -> certification FAILS naming
 *                                        failures=2, descriptor passes  -> exit 1
 *
 * Run: bun test evals/selftest/real-data-planted-defect.test.ts
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
  writeDataArtifacts,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;

beforeAll(() => {
  root = makeTempRoot("real-data");
  harness = makeHarnessCopy(root, { stubStack: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function runData(targetDir: string, out: string): Promise<{ code: number | null; card: Scorecard; stderr: string }> {
  const r = await runRunner({
    harness,
    targetDir,
    suite: "data",
    outPath: out,
    taskId: "selftest-real-data",
    timeoutMs: 120_000,
  });
  return { code: r.code, card: readCard(out) as Scorecard, stderr: r.stderr };
}

function caseRecord(card: Scorecard, caseId: string) {
  const record = card.cases.find((c) => c.id === caseId);
  expect(record).toBeDefined();
  return record as NonNullable<(typeof card.cases)[number]>;
}

describe("real-suite planted defect: data", () => {
  test(
    "healthy descriptor and tool: both cases pass and the run exits 0",
    async () => {
      const target = makeFakeTarget(root, "target-data-good");
      writeDataArtifacts(target);
      const out = path.join(root, "good", "card.json");
      const { code, card } = await runData(target, out);

      expect(code).toBe(0);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);
      expect(card.cases.map((c) => c.id).sort()).toEqual([
        "catalog-certification-counts",
        "provenance-descriptor",
      ]);
      for (const record of card.cases) {
        expect(record.status).toBe("pass");
      }
      // The pass note names the actually-verified bundled file.
      expect(caseRecord(card, "provenance-descriptor").note).toContain("complete.json");
    },
    { timeout: 150_000 },
  );

  test(
    "one corrupted bundle byte: provenance-descriptor fails with a sha256 MISMATCH note while the certification case still passes; run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-data-hash");
      const artifacts = writeDataArtifacts(target);
      artifacts.corruptBundle(); // counts unchanged, sha256 no longer matches
      const out = path.join(root, "hash", "card.json");
      const { code, card } = await runData(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const descriptor = caseRecord(card, "provenance-descriptor");
      expect(descriptor.status).toBe("fail");
      // data.ts: "sha256 MISMATCH (descriptor <hash> vs bundled <hash>)"
      expect(descriptor.note).toContain("sha256 MISMATCH");
      expect(descriptor.measured).toContain("vs bundled");

      const certification = caseRecord(card, "catalog-certification-counts");
      expect(certification.status).toBe("pass");
    },
    { timeout: 150_000 },
  );

  test(
    "tool reporting failures=2: catalog-certification-counts fails naming the count while the descriptor still passes; run exits 1",
    async () => {
      const target = makeFakeTarget(root, "target-data-tool");
      writeDataArtifacts(target, { toolFailures: 2 });
      const out = path.join(root, "tool", "card.json");
      const { code, card } = await runData(target, out);

      expect(code).toBe(1);
      validateScorecard(card);
      expect(card.infrastructure.ok).toBe(true);

      const certification = caseRecord(card, "catalog-certification-counts");
      expect(certification.status).toBe("fail");
      expect(certification.note).toContain("the tool reports inconsistencies: failures=2");

      const descriptor = caseRecord(card, "provenance-descriptor");
      expect(descriptor.status).toBe("pass");
    },
    { timeout: 150_000 },
  );
});
