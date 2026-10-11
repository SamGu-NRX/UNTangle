/**
 * Self-test helpers — "prove the harness can fail".
 *
 * These tests exercise the REAL runner (evals/run.ts, spawned as a bounded
 * subprocess) against throwaway fixtures built under a fresh mkdtemp dir:
 *
 *   - a fake TARGET checkout (just evals/CONTRACT.md, plus optional dataset
 *     files for the planted-failure test),
 *   - where case accounting is under test, a full COPY of evals/ whose
 *     stack.ts is replaced by a healthy stub, so no Postgres, backend,
 *     frontend build, or browser is ever booted.
 *
 * The real stack module is exercised unstubbed only by
 * runner-infra-exit3.test.ts, where a deliberately non-git fake target fails
 * the `submodule-backend` preflight step within seconds — the same code path
 * as the broken-Postgres exit-3 reference (step() → StackBootError → infra
 * scorecard), taken at the earliest breakable step.
 *
 * Scope: nothing here modifies the repo's evals tree; every fixture lives in
 * a unique tmp dir and is removed after the tests.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SELFTEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const EVALS_DIR = path.resolve(SELFTEST_DIR, "..");
export const REPO_ROOT = path.resolve(EVALS_DIR, "..");
export const REPO_RUN_TS = path.join(EVALS_DIR, "run.ts");

/** Any 40-hex string passes the runner's SHA shape check (it is never resolved to a commit). */
export const FAKE_SHA_40 = "a".repeat(40);
/** The branch head's abbreviated SHA — the shape the runner must reject. */
export const SHORT_SHA = "65d372f";

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const STREAM_TAIL_CHARS = 40_000;

/** Spawn a bounded subprocess capturing the exit code plus stream tails; never throws on non-zero exit. */
export function spawnBounded(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-STREAM_TAIL_CHARS);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STREAM_TAIL_CHARS);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

let depsPromise: Promise<void> | null = null;

/**
 * The real runner imports pg (via evals/stack.ts) at module load, so spawning
 * it requires evals/node_modules to exist. Installs once, lazily; the
 * stubbed harness copy used by the accounting tests never needs this.
 */
export function ensureEvalsDeps(): Promise<void> {
  depsPromise ??= (async () => {
    if (existsSync(path.join(EVALS_DIR, "node_modules"))) return;
    const result = await spawnBounded(process.execPath, ["install"], { cwd: EVALS_DIR, timeoutMs: 300_000 });
    if (result.code !== 0) {
      throw new Error(`bun install in evals/ failed (code ${result.code}): ${result.stderr.slice(-800)}`);
    }
  })();
  return depsPromise;
}

/** Fresh unique scratch dir (mkdtemp), so concurrent sessions can never collide. */
export function makeTempRoot(label: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `untangle-selftest-${label}-`));
}

/**
 * A minimal fake target checkout: the runner's only hard requirement is
 * evals/CONTRACT.md. Deliberately NOT a git repo, so the real preflight's
 * `submodule-backend` step fails fast (see runner-infra-exit3.test.ts).
 */
export function makeFakeTarget(root: string, name = "target", contract?: string): string {
  const targetDir = path.join(root, name);
  mkdirSync(path.join(targetDir, "evals"), { recursive: true });
  writeFileSync(
    path.join(targetDir, "evals", "CONTRACT.md"),
    contract ?? "# fake target\n\nThrowaway fixture: the runner only requires this file to exist.\n",
  );
  return targetDir;
}

export interface DatasetTarget {
  targetDir: string;
  bundlePath: string;
  descriptorPath: string;
  /** Mutate ONE byte of the bundle so the recorded descriptor hash no longer matches. */
  plant(): void;
}

/**
 * A fake target carrying the toy dataset the fakesuite detector hashes:
 * dataset/bundle.json (the data) plus dataset/descriptor.json (the recorded
 * sha256) — the optimizer/data suites' descriptor pattern at fixture scale.
 */
export function makeDatasetTarget(root: string, name = "target-dataset"): DatasetTarget {
  const targetDir = makeFakeTarget(root, name);
  const datasetDir = path.join(targetDir, "dataset");
  mkdirSync(datasetDir, { recursive: true });
  const bundlePath = path.join(datasetDir, "bundle.json");
  const descriptorPath = path.join(datasetDir, "descriptor.json");
  writeFileSync(bundlePath, `${JSON.stringify({ dataset: "selftest-fixture", entries: 3 }, null, 2)}\n`);
  const goodHash = createHash("sha256").update(readFileSync(bundlePath, "utf8")).digest("hex");
  writeFileSync(
    descriptorPath,
    `${JSON.stringify({ files: { "bundle.json": { sha256: goodHash } } }, null, 2)}\n`,
  );
  return {
    targetDir,
    bundlePath,
    descriptorPath,
    plant(): void {
      const before = readFileSync(bundlePath, "utf8");
      writeFileSync(bundlePath, `${before}\n`);
    },
  };
}

export interface HarnessCopy {
  root: string;
  evalsDir: string;
  runTs: string;
  suitesDir: string;
}

/**
 * Copy the harness into the fixture root. The copy is throwaway: the repo's
 * evals tree is never modified. With stubStack, the copy's stack.ts is
 * replaced by STUB_STACK_TS so startStack() returns a healthy fake
 * RunningStack (no processes, no ports, no database).
 */
export function makeHarnessCopy(root: string, opts: { stubStack: boolean }): HarnessCopy {
  const evalsDir = path.join(root, "harness", "evals");
  cpSync(EVALS_DIR, evalsDir, { recursive: true, filter: (src) => !src.includes("node_modules") });
  if (opts.stubStack) {
    writeFileSync(path.join(evalsDir, "stack.ts"), STUB_STACK_TS);
  }
  return { root, evalsDir, runTs: path.join(evalsDir, "run.ts"), suitesDir: path.join(evalsDir, "suites") };
}

/** Write the throwaway fake suites into a harness copy's suites dir. */
export function writeFakeSuites(harness: HarnessCopy): void {
  mkdirSync(harness.suitesDir, { recursive: true });
  for (const [name, source] of [
    ["fakesuite.ts", FAKE_SUITE_TS],
    ["failsuite.ts", FAIL_SUITE_TS],
    ["throwsuite.ts", THROW_SUITE_TS],
    ["crashysuite.ts", CRASHY_SUITE_TS],
  ] as const) {
    writeFileSync(path.join(harness.suitesDir, name), source);
  }
}

export const STUB_STACK_TS = `/**
 * SELFTEST STUB — replaces evals/stack.ts inside a throwaway harness copy
 * (never in the repo). startStack() returns a healthy fake RunningStack
 * immediately, so runner-level accounting can be tested without booting
 * Postgres, the backend, the frontend build, or a browser. The real stack
 * module is exercised unstubbed by runner-infra-exit3.test.ts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export interface StackStepRecord {
  step: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  detail?: string;
  logPath?: string;
}

export class StackBootError extends Error {
  readonly brokenStep: string;
  readonly steps: StackStepRecord[];
  constructor(brokenStep: string, message: string, steps: StackStepRecord[] = []) {
    super(message);
    this.name = "StackBootError";
    this.brokenStep = brokenStep;
    this.steps = steps;
  }
}

export interface RunningStack {
  steps: StackStepRecord[];
  runDir: string;
  pgDataDir: string;
  pgPort: number;
  backendPort: number;
  frontendPort: number;
  backendOrigin: string;
  frontendOrigin: string;
  databaseUrl: string;
  blockedRmpLogPath: string;
  backendStartMode: string;
  stop(): Promise<void>;
}

/** Mirrors the real helper's shape: a missing log counts zero blocked requests. */
export function readRmpBlockedCount(logPath: string): { count: number; filePresent: boolean } {
  try {
    const raw = JSON.parse(readFileSync(logPath, "utf8")) as { blockedTotal?: unknown };
    return typeof raw.blockedTotal === "number" && Number.isInteger(raw.blockedTotal) && raw.blockedTotal >= 0
      ? { count: raw.blockedTotal, filePresent: true }
      : { count: 0, filePresent: false };
  } catch {
    return { count: 0, filePresent: false };
  }
}

export async function startStack(options: {
  targetDir: string;
  runDir: string;
  taskId: string;
}): Promise<RunningStack> {
  return {
    steps: [
      { step: "target-dir", status: "pass", durationMs: 1, detail: options.targetDir },
      { step: "stub-stack", status: "pass", durationMs: 1, detail: "selftest stub: no real stack was booted" },
    ],
    runDir: options.runDir,
    pgDataDir: options.runDir,
    pgPort: 0,
    backendPort: 0,
    frontendPort: 0,
    backendOrigin: "http://127.0.0.1:3999",
    frontendOrigin: "http://localhost:3998",
    databaseUrl: "postgres://stub/untangle-selftest",
    blockedRmpLogPath: path.join(options.runDir, "rmp-block.json"),
    backendStartMode: "selftest-stub",
    stop: async () => {},
  };
}
`;

/**
 * The throwaway fake suite used by the accounting and planted-failure tests.
 * The descriptor-hash case mirrors the optimizer/data suites' detector at
 * toy scale: the TARGET carries dataset/bundle.json plus a descriptor.json
 * recording the bundle's sha256; the case recomputes and compares. On a bare
 * target (no dataset) the case is honestly not-applicable.
 */
export const FAKE_SUITE_TS = `
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath, "utf8")).digest("hex");
}

// Same convention as optdata-lib.ts resolveTargetDir: the preflight's
// "target-dir" step records the resolved target dir as its step detail.
function resolveTargetDir(ctx: SuiteContext): string {
  const step = ctx.preflightSteps.find((s) => s.step === "target-dir");
  const detail = typeof step?.detail === "string" ? step.detail.trim() : "";
  if (detail.length === 0) throw new Error("no target-dir step detail in the suite context");
  return detail;
}

export default defineSuite({
  name: "fakesuite",
  describe: () => [
    { id: "always-green", title: "control case that always passes" },
    { id: "descriptor-hash-matches-data", title: "the descriptor's recorded sha256 equals the bundle's actual hash" },
  ],
  run: (caseId, ctx): CaseOutcome => {
    switch (caseId) {
      case "always-green":
        return { status: "pass", measured: "ok", bar: "control case passes" };
      case "descriptor-hash-matches-data": {
        const targetDir = resolveTargetDir(ctx);
        const bundlePath = path.join(targetDir, "dataset", "bundle.json");
        const descriptorPath = path.join(targetDir, "dataset", "descriptor.json");
        for (const fixturePath of [bundlePath, descriptorPath]) {
          if (!existsSync(fixturePath)) {
            return { status: "not-applicable", note: "the target has no " + fixturePath + " (nothing to hash)" };
          }
        }
        const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
          files?: Record<string, { sha256?: string }>;
        };
        const recorded = descriptor.files?.["bundle.json"]?.sha256;
        const actual = sha256File(bundlePath);
        if (typeof recorded !== "string") {
          return {
            status: "fail",
            measured: actual.slice(0, 16),
            bar: "descriptor records a sha256 for bundle.json",
            note: "descriptor declares no sha256 for bundle.json",
          };
        }
        if (recorded === actual) {
          return {
            status: "pass",
            measured: "sha256 " + actual.slice(0, 16) + " matches",
            bar: "recorded sha256 equals the bundle's actual hash",
          };
        }
        return {
          status: "fail",
          measured: "recorded " + recorded.slice(0, 16) + " != actual " + actual.slice(0, 16),
          bar: "recorded sha256 equals the bundle's actual hash",
          note: "planted dataset mutation detected: bundle bytes no longer match the descriptor",
        };
      }
      default:
        return { status: "fail", note: "fakesuite does not know case " + caseId };
    }
  },
});
`;

export const FAIL_SUITE_TS = `
import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "failsuite",
  describe: () => [{ id: "deliberate-fail", title: "always fails, for exit-code accounting" }],
  run: () => ({
    status: "fail" as const,
    measured: "planted deliberate failure",
    bar: "this case always fails",
    note: "deliberate failure planted by the self-test fixtures",
  }),
});
`;

export const THROW_SUITE_TS = `
import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "throwsuite",
  describe: () => [{ id: "deliberate-throw", title: "always throws, for exit-code accounting" }],
  run: () => {
    throw new Error("deliberate case exception planted by the self-test fixtures");
  },
});
`;

export const CRASHY_SUITE_TS = `
import { defineSuite } from "../suite-kit";

export default defineSuite({
  name: "crashysuite",
  describe: () => {
    throw new Error("crashysuite: describe() exploded before any case could be declared");
  },
  run: () => ({ status: "pass" as const }),
});
`;

/** Parse a written scorecard (or any JSON fixture) from disk. */
export function readCard(outPath: string): unknown {
  return JSON.parse(readFileSync(outPath, "utf8"));
}

export interface RunnerInvocation {
  harness: HarnessCopy;
  targetDir: string;
  suite: string;
  outPath: string;
  taskId: string;
  timeoutMs?: number;
}

export interface RunnerResult extends SpawnResult {
  outPath: string;
}

/** Spawn the (copied) runner end-to-end; the stubbed copy boots no real stack. */
export async function runRunner(inv: RunnerInvocation): Promise<RunnerResult> {
  const result = await spawnBounded(
    process.execPath,
    [
      inv.harness.runTs,
      "--target-dir",
      inv.targetDir,
      "--target-sha",
      FAKE_SHA_40,
      "--suite",
      inv.suite,
      "--out",
      inv.outPath,
      "--task-id",
      inv.taskId,
    ],
    { cwd: inv.harness.root, timeoutMs: inv.timeoutMs ?? 90_000 },
  );
  return { ...result, outPath: inv.outPath };
}

/** Spawn the REPO's runner with a raw argv (usage-error tests); installs evals deps once if needed. */
export async function runRepoRunnerRaw(argv: string[], timeoutMs = 60_000): Promise<SpawnResult> {
  await ensureEvalsDeps();
  return spawnBounded(process.execPath, [REPO_RUN_TS, ...argv], { cwd: REPO_ROOT, timeoutMs });
}
