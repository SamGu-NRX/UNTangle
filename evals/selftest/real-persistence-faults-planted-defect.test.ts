/**
 * Real-suite planted defect: persistence-faults (full real stack).
 *
 * The persistence-faults suite drives the REAL UI against the REAL stack, so
 * its boundary cannot be stubbed: the lead's reference plant is "a save
 * endpoint that returns 500 while the UI shows Saved". On the baseline head
 * every persistence case is a documented expected-fail, so the plant cannot
 * flip a verdict from pass to fail; what it CAN and must show is that the
 * run honestly blames CASES, not infrastructure (exit 1 with
 * infrastructure.ok true — correct attribution even under sabotage), that
 * the failed-saves case is among the failures, and that the suite's verdict
 * text changes when its data boundary is poisoned (cases report "case could
 * not complete" harness-error notes instead of the measured expected-fail
 * notes about missing contract elements).
 *
 * The plant: an in-test saboteur kills Postgres (SIGKILL on the postmaster
 * pid) the moment the stack's playwright-launch step has started — after
 * every stack step has passed, before any case runs. The suite never injects
 * anything itself here; the real save endpoint fails server-side while the
 * UI is up, the closest a full-stack run can get to the reference plant
 * without owning the browser session.
 *
 * This test boots the real target checkout (frontend + backend + Postgres)
 * and is therefore the heavy one: ~10-25 min cold, less warm. It must not
 * run concurrently with other Playwright work on this host.
 *
 * Run: bun test evals/selftest/real-persistence-faults-planted-defect.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { validateScorecard } from "../scorecard";
import type { Scorecard } from "../scorecard";
import { EVALS_DIR, REPO_RUN_TS, spawnBounded, type SpawnResult } from "./helpers";

/** Persistent target checkout (a local clone of this repo) — node_modules warm across runs. */
const TARGET_DIR = "/home/user/work/untangle-selftest-target";
const RUNS_DIR = "/home/user/work/persist-plant-runs";

let targetSha = "";
const runDirs: string[] = [];

beforeAll(async () => {
  if (!existsSync(path.join(TARGET_DIR, ".git"))) {
    const clone = await spawnBounded("git", [
      "clone", "--local", "--branch", "obv/untangle-evals-f1-selftests",
      "/home/user/work/clone-selftests", TARGET_DIR,
    ], { timeoutMs: 300_000 });
    if (clone.code !== 0) throw new Error(`cloning the persistence target failed: ${clone.stderr.slice(-500)}`);
  }
  // The pinned backend submodule must exist for the stack's submodule step to pass.
  const sub = await spawnBounded("git", ["submodule", "update", "--init", "backend"], {
    cwd: TARGET_DIR, timeoutMs: 600_000,
  });
  if (sub.code !== 0) throw new Error(`submodule init failed: ${sub.stderr.slice(-500)}`);
  const sha = await spawnBounded("git", ["rev-parse", "HEAD"], { cwd: TARGET_DIR, timeoutMs: 15_000 });
  if (sha.code !== 0) throw new Error(`rev-parse failed: ${sha.stderr.slice(-300)}`);
  targetSha = sha.stdout.trim();

  // The runner (this repo's evals) loads the persistence suite, which imports
  // Playwright — refresh deps in case the merge changed the lockfile.
  const install = await spawnBounded(process.execPath, ["install"], { cwd: EVALS_DIR, timeoutMs: 300_000 });
  if (install.code !== 0) throw new Error(`evals install failed: ${install.stderr.slice(-500)}`);
}, 900_000);

afterAll(() => {
  // Run dirs are kept on purpose: each holds the scorecard + preflight logs
  // that are this test's evidence (see the report).
});

/**
 * Saboteur: wait for the playwright-launch step's log to appear under the
 * run's preflight-logs, then SIGKILL the newest pgdata run's postmaster.
 * Resolves true when the plant fired, false if it never saw the step start.
 */
function sabotagePostgresOnce(runDir: string, taskId: string): Promise<boolean> {
  return (async () => {
    const launchLog = path.join(runDir, "preflight-logs", "step-playwright-launch.log");
    const deadline = Date.now() + 25 * 60_000;
    while (!existsSync(launchLog)) {
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    // Launch started; postgres-start ran before it, so the pid file exists.
    // pgdata lives at /home/user/work/pgdata-<taskId>/run-<ts>-<pid> (stack.ts).
    const pgBase = path.join("/home/user/work", `pgdata-${taskId}`);
    let pidFile = "";
    const pidDeadline = Date.now() + 60_000;
    while (pidFile === "" && Date.now() < pidDeadline) {
      const runs = readdirSync(pgBase).filter((d) => d.startsWith("run-")).sort();
      const candidate = path.join(pgBase, runs.at(-1) ?? "", "postmaster.pid");
      if (runs.length > 0 && existsSync(candidate)) pidFile = candidate;
      else await new Promise((r) => setTimeout(r, 500));
    }
    if (pidFile === "") return false;
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").split("\n")[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, "SIGKILL");
    return true;
  })();
}

describe("real-suite planted defect: persistence-faults (full real stack, Postgres killed after launch)", () => {
  // Heavy gate: the run boots the full real stack (Postgres, backend build,
  // frontend build, a real browser). It runs only under SELFTEST_HEAVY=1 so a
  // plain `bun test evals/selftest` never boots the stack alongside other
  // Playwright work on the shared 2-core host — run it solo per the README.
  const HEAVY = process.env.SELFTEST_HEAVY === "1";
  test.skipIf(!HEAVY)(
    "dead Postgres after stack boot: exit 1 blaming CASES (infrastructure.ok true), failed-saves-never-saved failing, poisoned-run notes visible",
    async () => {
      const taskId = `selftest-persist-plant-${Date.now()}`;
      const outDir = path.join(RUNS_DIR, String(Date.now()));
      mkdirSync(outDir, { recursive: true });
      runDirs.push(outDir);
      const outPath = path.join(outDir, "card.json");

      const saboteur = sabotagePostgresOnce(outDir, taskId);

      const r: SpawnResult = await spawnBounded(
        process.execPath,
        [
          REPO_RUN_TS,
          "--target-dir", TARGET_DIR,
          "--target-sha", targetSha,
          "--suite", "persistence-faults",
          "--out", outPath,
          "--task-id", taskId,
        ],
        { cwd: EVALS_DIR, timeoutMs: 1_500_000 },
      );
      const planted = await saboteur;

      expect(planted).toBe(true);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(1);
      validateScorecard(JSON.parse(readFileSync(outPath, "utf8")));
      const card = JSON.parse(readFileSync(outPath, "utf8")) as Scorecard;

      // Correct attribution: cases are blamed, not the stack. The steps are
      // the scorecard's top-level `stack` records; all passed before the kill.
      expect(card.infrastructure.ok).toBe(true);
      expect(card.stack.every((s) => s.status === "pass")).toBe(true);

      const failedSaves = card.cases.find((c) => c.id === "failed-saves-never-saved");
      expect(failedSaves).toBeDefined();
      expect((failedSaves as NonNullable<typeof failedSaves>).status).toBe("fail");

      // The plant's signature: with the data boundary dead the suite records
      // "case could not complete" harness-error notes, distinct from the
      // baseline head's measured expected-fail notes.
      const poisonedNotes = card.cases.filter((c) => (c.note ?? "").includes("could not complete"));
      expect(poisonedNotes.length).toBeGreaterThan(0);
    },
    { timeout: 1_800_000 },
  );
});
