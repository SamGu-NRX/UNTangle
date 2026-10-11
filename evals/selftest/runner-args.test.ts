/**
 * Scenario 4: the runner refuses bad arguments with exit code 2 (usage
 * error) — never a case failure (1) or infra failure (3), and it never
 * boots the stack or writes a scorecard.
 *
 *   missing --target-sha  -> exit 2, "--target-sha is required"
 *   short --target-sha    -> exit 2, "must be a 40-hex commit SHA"
 *   no arguments at all   -> exit 2 with the usage line
 *   unknown --suite       -> exit 2 after parsing, before any stack work
 *
 * Run: bun test evals/selftest/runner-args.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { FAKE_SHA_40, makeFakeTarget, makeTempRoot, runRepoRunnerRaw, SHORT_SHA } from "./helpers";

let root: string;
let targetDir: string;

beforeAll(() => {
  root = makeTempRoot("args");
  targetDir = makeFakeTarget(root, "target-args");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runner argument validation (exit 2)", () => {
  test(
    "missing --target-sha exits 2 with the usage line and never writes a scorecard",
    async () => {
      const out = path.join(root, "missing-sha", "card.json");
      const r = await runRepoRunnerRaw(["--target-dir", targetDir, "--suite", "selfcheck", "--out", out]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("error: --target-sha is required");
      expect(r.stderr).toContain("usage: bun evals/run.ts");
      expect(r.stderr).toContain("2 usage error");
      expect(existsSync(out)).toBeFalse();
    },
    60_000,
  );

  test(
    "short --target-sha (7-hex) exits 2: the runner demands the full 40-hex SHA",
    async () => {
      const out = path.join(root, "short-sha", "card.json");
      const r = await runRepoRunnerRaw([
        "--target-dir",
        targetDir,
        "--target-sha",
        SHORT_SHA,
        "--suite",
        "selfcheck",
        "--out",
        out,
      ]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`error: --target-sha must be a 40-hex commit SHA, got: ${SHORT_SHA}`);
      expect(existsSync(out)).toBeFalse();
    },
    60_000,
  );

  test(
    "no arguments at all exits 2 with the usage line",
    async () => {
      const r = await runRepoRunnerRaw([]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("usage: bun evals/run.ts");
    },
    60_000,
  );

  test(
    "unknown --suite name exits 2 after parsing — without booting the stack",
    async () => {
      const out = path.join(root, "unknown-suite", "card.json");
      const r = await runRepoRunnerRaw([
        "--target-dir",
        targetDir,
        "--target-sha",
        FAKE_SHA_40,
        "--suite",
        "no-such-suite",
        "--out",
        out,
      ]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('suite "no-such-suite" not found');
      expect(r.stderr).toContain("Available:");
      expect(existsSync(out)).toBeFalse();
      // The preflight never ran: no run dir was created next to the scorecard.
      expect(existsSync(path.join(path.dirname(out), "preflight-logs"))).toBeFalse();
    },
    60_000,
  );
});
