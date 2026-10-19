/**
 * Decision 685b: a REGISTERED suite that fails to load (module-level throw,
 * missing file, wrong export shape) is a harness defect — the runner must
 * exit 3 with an honest scorecard naming the suite, never silently skip it
 * the way probe-by-import discovery did.
 *
 * The harness copy's registry is patched by writeFakeSuites, so this test
 * exercises the REAL registry-load path (SUITE_REGISTRY → loadSuite → main's
 * load-failure accounting) with the stubbed stack (no processes booted).
 *
 * Run: bun test evals/selftest/runner-contract-registry-load-failure.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import { makeFakeTarget, makeHarnessCopy, makeTempRoot, readCard, runRunner, writeFakeSuites } from "./helpers";

let root: string;
let harness: ReturnType<typeof makeHarnessCopy>;
let targetDir: string;

beforeAll(() => {
  root = makeTempRoot("registry");
  harness = makeHarnessCopy(root, { stubStack: true });
  writeFakeSuites(harness);
  targetDir = makeFakeTarget(root, "target-registry");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runner contract: explicit registry (decision 685b)", () => {
  test(
    "a registered suite whose module throws on import exits 3 with a scorecard naming the suite",
    async () => {
      // Plant: failsuite.ts explodes at module-evaluation time — exactly the
      // shape probe-by-import used to swallow with one console line.
      writeFileSync(
        path.join(harness.suitesDir, "failsuite.ts"),
        `throw new Error("failsuite module exploded at import time (selftest plant)");\n`,
      );

      const out = path.join(root, "registry", "card.json");
      const r = await runRunner({
        harness,
        targetDir,
        suite: "all",
        outPath: out,
        taskId: `selftest-registry-${process.pid}-${Date.now()}`,
      });

      // Exit 3 — infrastructure/harness-defect accounting, never a silent skip.
      expect(r.code).toBe(3);
      expect(r.timedOut).toBeFalse();
      expect(r.stderr).toContain('registered suite "failsuite" failed to load');
      expect(r.stderr).toContain("failsuite module exploded at import time (selftest plant)");

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);
      expect(card.infrastructure.ok).toBeFalse();
      expect(card.infrastructure.brokenStep).toBe("suite-load");
      expect(card.infrastructure.error).toContain('registered suite "failsuite" failed to load');

      // The loadable suites' declared cases are honestly not-applicable.
      expect(card.cases.length).toBeGreaterThan(0);
      for (const record of card.cases) {
        expect(record.status).toBe("not-applicable");
        expect(record.note).toContain('"failsuite" failed to load');
      }
      // No record from the broken suite itself — it declared nothing.
      expect(card.cases.some((c) => c.suite === "failsuite")).toBeFalse();

      // The suite-load step record carries the named failure as evidence.
      const loadStep = card.stack.find((s) => s.step === "suite-load");
      expect(loadStep?.status).toBe("fail");
      expect(loadStep?.detail).toContain("failsuite");

      const markdown = readFileSync(out.replace(/\.json$/, ".md"), "utf8");
      expect(markdown).toContain("infrastructure failure");
      expect(markdown).toContain("suite-load");
    },
    60_000,
  );

  test("a registry name with no suite file is a load failure naming the suite, not a skip", async () => {
    writeFileSync(
      path.join(harness.suitesDir, "ghostsuite.ts"),
      `import { defineSuite } from "../suite-kit";\n\nexport default defineSuite({\n  name: "ghostsuite",\n  describe: () => [{ id: "never-declared", title: "file will be deleted below" }],\n  run: () => ({ status: "pass" as const, measured: "ok", bar: "control" }),\n});\n`,
    );
    // Register it in the copy's registry (685b: a suite exists when registered),
    // THEN delete the file — the registry entry now points at nothing.
    const runTs = readFileSync(harness.runTs, "utf8");
    writeFileSync(
      harness.runTs,
      runTs.replace(
        'const SUITE_REGISTRY: readonly string[] = [',
        'const SUITE_REGISTRY: readonly string[] = [\n  "ghostsuite",',
      ),
    );
    rmSync(path.join(harness.suitesDir, "ghostsuite.ts"));

    const out = path.join(root, "registry", "ghost.json");
    const r = await runRunner({
      harness,
      targetDir,
      suite: "ghostsuite",
      outPath: out,
      taskId: `selftest-registry-ghost-${process.pid}-${Date.now()}`,
    });

    expect(r.code).toBe(3);
    expect(r.stderr).toContain('registered suite "ghostsuite" failed to load');
    const card = readCard(out) as Scorecard;
    expect(validateScorecard(card)).toEqual([]);
    expect(card.infrastructure.brokenStep).toBe("suite-load");
    expect(card.cases).toHaveLength(0);
  });

  test("an unknown --suite name is still a usage error (exit 2) listing the registry", async () => {
    const out = path.join(root, "registry", "unknown.json");
    const r = await runRunner({
      harness,
      targetDir,
      suite: "nosuchsuite",
      outPath: out,
      taskId: `selftest-registry-unknown-${process.pid}-${Date.now()}`,
    });

    expect(r.code).toBe(2);
    expect(r.stderr).toContain('suite "nosuchsuite" not found');
    expect(r.stderr).toContain("Available: selfcheck, ghostsuite, fakesuite, failsuite, throwsuite, crashysuite");
    // No scorecard is written for a usage error.
    expect(() => readCard(out)).toThrow();
  });
});
