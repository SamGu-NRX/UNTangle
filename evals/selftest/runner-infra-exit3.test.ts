/**
 * Scenarios 1b + 3: a preflight/stack failure is an honest infrastructure
 * failure — exit 3, a scorecard that is STILL written, every case
 * not-applicable, and infrastructure.brokenStep naming the exact broken
 * step.
 *
 * The real (unstubbed) runner and the real stack.ts are exercised. The fake
 * target is a directory holding only evals/CONTRACT.md and is deliberately
 * NOT a git repo, so the `submodule-backend` step fails within seconds.
 * That is the same code path as the broken-Postgres exit-3 reference
 * (step() → StackBootError → infra scorecard), taken at the earliest
 * breakable step — no Postgres, no backend install, no frontend build, no
 * browser.
 *
 * Run: bun test evals/selftest/runner-infra-exit3.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import {
  ensureEvalsDeps,
  FAKE_SHA_40,
  makeFakeTarget,
  makeTempRoot,
  readCard,
  REPO_RUN_TS,
  spawnBounded,
} from "./helpers";

let root: string;
let targetDir: string;

beforeAll(async () => {
  await ensureEvalsDeps();
  root = makeTempRoot("infra");
  targetDir = makeFakeTarget(root, "target-infra");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("infrastructure failure accounting (real stack.ts, sabotaged target)", () => {
  test(
    "a broken preflight step exits 3 with a complete, honest, all-not-applicable scorecard",
    async () => {
      const out = path.join(root, "infra", "card.json");
      const taskId = `selftest-infra-${process.pid}-${Date.now()}`;
      const r = await spawnBounded(
        process.execPath,
        [
          REPO_RUN_TS,
          "--target-dir",
          targetDir,
          "--target-sha",
          FAKE_SHA_40,
          "--suite",
          "selfcheck",
          "--out",
          out,
          "--task-id",
          taskId,
        ],
        { cwd: root, timeoutMs: 120_000 },
      );

      // Exit 3 — never 0 (nothing passed) and never 1 (no case failed).
      expect(r.code).toBe(3);
      expect(r.timedOut).toBeFalse();
      expect(r.stderr).toContain('INFRASTRUCTURE FAILURE at step "submodule-backend"');
      // The real failure detail is carried honestly, not swallowed.
      expect(r.stderr).toContain("a UNTangle checkout?");

      const card = readCard(out) as Scorecard;
      expect(validateScorecard(card)).toEqual([]);

      // The infrastructure block names the exact broken step.
      expect(card.infrastructure.ok).toBeFalse();
      expect(card.infrastructure.brokenStep).toBe("submodule-backend");
      expect(card.infrastructure.error).toContain('broken step "submodule-backend"');

      // Every declared selfcheck case is honestly not-applicable — none is
      // recorded as an application failure.
      expect(card.cases).toHaveLength(4);
      for (const record of card.cases) {
        expect(record.status).toBe("not-applicable");
        expect(record.note).toBe("not run: the stack failed before any case could execute");
      }

      // The stack record shows the real progression and the named break.
      expect(card.stack.map((s) => s.step).slice(0, 2)).toEqual(["target-dir", "contract-present"]);
      const broken = card.stack.find((s) => s.step === "submodule-backend");
      expect(broken?.status).toBe("fail");

      // No app stack was ever booted: the run died at the third preflight
      // step, with its step log kept as evidence.
      expect(existsSync(path.join(path.dirname(out), "preflight-logs", "step-submodule-backend.log"))).toBeTrue();
      expect(existsSync("/home/user/work/pgdata-selftest-infra")).toBeFalse();

      const markdown = readFileSync(out.replace(/\.json$/, ".md"), "utf8");
      expect(markdown).toContain("infrastructure failure");
      expect(markdown).toContain("submodule-backend");
    },
    150_000,
  );
});
