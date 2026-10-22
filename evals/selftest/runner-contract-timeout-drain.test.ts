/**
 * The runner must abort and drain a timed-out case before dispatching the
 * next one. A late case cannot keep running beside its successor.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  makeFakeTarget,
  makeHarnessCopy,
  makeTempRoot,
  readCard,
  runRunner,
  type HarnessCopy,
} from "./helpers";

let root: string;
let harness: HarnessCopy;
let targetDir: string;

beforeAll(() => {
  root = makeTempRoot("timeout-drain");
  harness = makeHarnessCopy(root, { stubStack: true });
  targetDir = makeFakeTarget(root, "target");
  mkdirSync(harness.suitesDir, { recursive: true });
  writeFileSync(
    path.join(harness.suitesDir, "timeoutsuite.ts"),
    `import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";

const marker = (ctx) => path.join(ctx.runDir, "timeout-drain.marker");

export default defineSuite({
  name: "timeoutsuite",
  caseTimeoutMs: 10,
  describe: () => [
    { id: "slow-case" },
    { id: "after-timeout" },
  ],
  run: (caseId, ctx) => {
    mkdirSync(ctx.runDir, { recursive: true });
    if (caseId === "slow-case") {
      return new Promise((resolve) => {
        ctx.signal?.addEventListener("abort", () => {
          appendFileSync(marker(ctx), "aborted\\n");
          setTimeout(() => {
            appendFileSync(marker(ctx), "drained\\n");
            resolve({ status: "fail", note: "timed-out case drained" });
          }, 20);
        }, { once: true });
      });
    }
    const markerText = existsSync(marker(ctx)) ? readFileSync(marker(ctx), "utf8") : "";
    return markerText.includes("drained")
      ? { status: "pass", measured: "previous case drained" }
      : { status: "fail", note: "next case started before previous case drained" };
  },
});
`,
  );
  const runSource = readFileSync(harness.runTs, "utf8");
  const patched = runSource.replace(
    'const SUITE_REGISTRY: readonly string[] = [',
    'const SUITE_REGISTRY: readonly string[] = [\n  "timeoutsuite",',
  );
  if (patched === runSource) throw new Error("timeout self-test could not patch suite registry");
  writeFileSync(harness.runTs, patched);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runner contract: timeout cancellation drains before the next case", () => {
  test("a timed-out case is aborted and drained before its successor starts", async () => {
    const out = path.join(root, "run", "card.json");
    const result = await runRunner({
      harness,
      targetDir,
      suite: "timeoutsuite",
      outPath: out,
      taskId: "selftest-timeout-drain",
    });
    expect(result.code).toBe(1);
    expect(result.timedOut).toBeFalse();
    const card = readCard(out);
    expect(card.cases).toHaveLength(2);
    expect(card.cases[0]?.status).toBe("fail");
    expect(card.cases[0]?.note).toContain("timed out after 10ms");
    expect(card.cases[1]?.status).toBe("pass");
  }, 120_000);
});
