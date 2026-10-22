/**
 * A timed-out case that ignores its abort signal and never settles must not
 * hang the run. The runner waits a bounded grace period after cancelling,
 * records the case as not drained, fails the rest of that suite, moves on to
 * the next suite, and writes the scorecard. An abort listener that throws must
 * not reach the crash-card handler either.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeFakeTarget, makeHarnessCopy, makeTempRoot, readCard, runRunner, type HarnessCopy } from "./helpers";

interface Card {
  infrastructure: { ok: boolean };
  cases: Array<{ suite: string; id: string; status: string; note?: string }>;
}

const GRACE_MS = 500;
// Bun startup plus the stub stack on a loaded WSL host, with room to spare.
// The runner before this fix never exits here, so it hits the spawn cap.
const FINISH_WITHIN_MS = GRACE_MS + 10_000;
const SPAWN_CAP_MS = 30_000;

const HANG_SUITE = `import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "hangsuite",
  caseTimeoutMs: 50,
  describe: () => [{ id: "never-settles" }, { id: "after-hang" }],
  run: (caseId) => {
    if (caseId === "never-settles") {
      // Ignores ctx.signal and holds a live handle, as a wedged Playwright
      // transport does, so the event loop cannot empty on its own.
      setInterval(() => undefined, 1_000);
      return new Promise(() => undefined);
    }
    return { status: "pass", measured: "ran beside an undrained case" };
  },
});
`;

const NEXT_SUITE = `import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "nextsuite",
  describe: () => [{ id: "still-runs" }],
  run: () => ({ status: "pass", measured: "later suite ran" }),
});
`;

const THROW_ABORT_SUITE = `import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "throwabortsuite",
  caseTimeoutMs: 50,
  describe: () => [{ id: "listener-throws" }, { id: "after-throw" }],
  run: (caseId, ctx) => {
    if (caseId === "listener-throws") {
      return new Promise((resolve) => {
        ctx.signal?.addEventListener("abort", () => {
          setTimeout(() => resolve({ status: "fail", note: "drained after a throwing listener" }), 20);
          throw new Error("abort listener boom");
        }, { once: true });
      });
    }
    return { status: "pass", measured: "ran after the throwing listener" };
  },
});
`;

const roots: string[] = [];

/** A stubbed harness copy whose registry holds exactly the given fixture suites, in order. */
function harnessWith(label: string, suites: Record<string, string>): { harness: HarnessCopy; targetDir: string; root: string } {
  const root = makeTempRoot(label);
  roots.push(root);
  const harness = makeHarnessCopy(root, { stubStack: true });
  for (const [name, source] of Object.entries(suites)) {
    writeFileSync(path.join(harness.suitesDir, `${name}.ts`), source);
  }
  const runSource = readFileSync(harness.runTs, "utf8");
  const registry = `const SUITE_REGISTRY: readonly string[] = ${JSON.stringify(Object.keys(suites))};\nconst REAL_SUITE_REGISTRY: readonly string[] = [`;
  const patched = runSource.replace("const SUITE_REGISTRY: readonly string[] = [", registry);
  if (patched === runSource) throw new Error(`${label}: could not patch the harness copy's SUITE_REGISTRY`);
  writeFileSync(harness.runTs, patched);
  return { harness, targetDir: makeFakeTarget(root), root };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("runner contract: a timed-out case that never drains", () => {
  test("is cut off after the grace period; the run finishes and writes a scorecard", async () => {
    const { harness, targetDir, root } = harnessWith("undrained-timeout", { hangsuite: HANG_SUITE, nextsuite: NEXT_SUITE });
    const out = path.join(root, "run", "card.json");
    const started = Date.now();
    const result = await runRunner({
      harness,
      targetDir,
      suite: "all",
      outPath: out,
      taskId: "selftest-undrained-timeout",
      timeoutMs: SPAWN_CAP_MS,
      env: { UNTANGLE_EVAL_DRAIN_GRACE_MS: String(GRACE_MS) },
    });
    const elapsedMs = Date.now() - started;
    expect(result.timedOut).toBeFalse();
    expect(elapsedMs).toBeLessThan(FINISH_WITHIN_MS);
    expect(result.code).toBe(1);

    const card = readCard(out) as Card;
    expect(card.infrastructure.ok).toBeTrue();
    const hang = card.cases.filter((c) => c.suite === "hangsuite");
    expect(hang.map((c) => c.id)).toEqual(["never-settles", "after-hang"]);
    expect(hang[0]?.status).toBe("fail");
    expect(hang[0]?.note).toContain("timed out after 50ms");
    expect(hang[0]?.note).toContain("not drained");
    expect(hang[1]?.status).toBe("fail");
    expect(hang[1]?.note).toContain("not run");
    expect(card.cases.find((c) => c.suite === "nextsuite")?.status).toBe("pass");
  }, 60_000);

  test("an abort listener that throws does not crash the run", async () => {
    const { harness, targetDir, root } = harnessWith("throwing-abort-listener", { throwabortsuite: THROW_ABORT_SUITE });
    const out = path.join(root, "run", "card.json");
    const result = await runRunner({
      harness,
      targetDir,
      suite: "throwabortsuite",
      outPath: out,
      taskId: "selftest-throwing-abort-listener",
      timeoutMs: SPAWN_CAP_MS,
      env: { UNTANGLE_EVAL_DRAIN_GRACE_MS: String(GRACE_MS) },
    });
    expect(result.timedOut).toBeFalse();
    expect(result.code).toBe(1);

    const card = readCard(out) as Card;
    expect(card.infrastructure.ok).toBeTrue();
    expect(card.cases.map((c) => `${c.suite}/${c.id}:${c.status}`)).toEqual([
      "throwabortsuite/listener-throws:fail",
      "throwabortsuite/after-throw:pass",
    ]);
    expect(card.cases[0]?.note).toContain("timed out after 50ms");
    expect(card.cases[0]?.note).not.toContain("not drained");
  }, 60_000);
});
