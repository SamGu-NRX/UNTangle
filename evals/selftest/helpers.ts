/**
 * Self-test helpers — "prove the harness can fail".
 *
 * These tests exercise the REAL runner (evals/run.ts, spawned as a bounded
 * subprocess) against throwaway fixtures built under a fresh mkdtemp dir:
 *
 *   - a fake TARGET checkout (a bare directory — decision 685a: the target
 *     carries nothing the runner requires — plus optional dataset files for
 *     the planted-failure test),
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
  opts: { cwd?: string; timeoutMs: number; env?: Record<string, string | undefined> },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    // Extra env vars merge over the inherited environment (the runner needs
    // PATH, HOME, etc.); omitting env keeps the default full inheritance.
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env === undefined ? undefined : { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
 * A minimal fake target checkout: a bare directory. Decision 685a — the
 * runner requires NOTHING inside the target (the harness hashes its own
 * evals/CONTRACT.md); suites discover what they need and report honest
 * not-applicable when it is absent. Deliberately NOT a git repo, so the real
 * preflight's `submodule-backend` step fails fast (see runner-infra-exit3.test.ts).
 */
export function makeFakeTarget(root: string, name = "target"): string {
  const targetDir = path.join(root, name);
  mkdirSync(targetDir, { recursive: true });
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
  // Decision 685b: suites run because they are REGISTERED. The copy's real
  // registry is patched (never the repo's), so every runner-level test
  // exercises the same explicit-registry load path as production.
  const runTs = readFileSync(harness.runTs, "utf8");
  const patched = runTs.replace(
    'const SUITE_REGISTRY: readonly string[] = [',
    'const SUITE_REGISTRY: readonly string[] = [\n  "fakesuite",\n  "failsuite",\n  "throwsuite",\n  "crashysuite",',
  );
  if (patched === runTs) {
    throw new Error("writeFakeSuites: could not patch the harness copy's SUITE_REGISTRY (run.ts shape changed?)");
  }
  writeFileSync(harness.runTs, patched);
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

// ---------------------------------------------------------------------------
// Real-suite planted-defect fixtures
//
// Each builder plants a defect at the boundary a REAL suite observes, without
// touching the repo tree: optimizer -> the target's bench artifact; data ->
// the target's descriptor/bundle/tool artifacts; routing -> an HTTP app whose
// /api/map/* responses the suite consumes (the stub stack's ctx points the
// suite at it via UNTANGLE_SELFTEST_FRONTEND_ORIGIN).
// ---------------------------------------------------------------------------

/**
 * The optimizer bench's conformance shape (the real run-bench.ts contract,
 * decision 685c): one optional defect per planted bench, everything else
 * healthy — so a failing case is attributable to the planted defect alone.
 */
export interface BenchPlant {
  /** Hard-constraint violations on one enumerable instance (healthy: 0). */
  violations?: number;
  /** Optimality gap on one enumerable instance (healthy: 0). */
  gap?: number;
  /** The pinned 8-course family's solve-time p95 in ms (healthy: 44). */
  xlWallMsP95?: number;
  /** Make the bench EXIT nonzero without writing results (run-level failure). */
  exitCode?: number;
}

/**
 * Plant a CONFORMING real bench at frontend/src/lib/optimizer/bench/
 * run-bench.ts (decision 685c): it parses the bench's REAL CLI
 * (--variant/--suite/--k/--repeat), writes the real results file
 * results/<variant-basename>-<suite>.json in the real report shape
 * ({variant, suite, k, repeat, instances[], sizeSummary}), and exits 0 —
 * carrying exactly the planted defects above.
 */
export function writeBenchArtifact(targetDir: string, plant: BenchPlant = {}): string {
  const benchDir = path.join(targetDir, "frontend", "src", "lib", "optimizer", "bench");
  mkdirSync(benchDir, { recursive: true });
  const violations = plant.violations ?? 0;
  const gap = plant.gap ?? 0;
  const xlP95 = plant.xlWallMsP95 ?? 44;
  const exitGuard =
    plant.exitCode === undefined
      ? ""
      : `process.exit(${plant.exitCode}); // planted run-level failure: exits before writing any results\n`;
  writeFileSync(
    path.join(benchDir, "run-bench.ts"),
    `// selftest-planted bench: conforms to the real run-bench.ts contract (decision 685c)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArg(name) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

const variant = parseArg("variant") ?? "./src/lib/optimizer/brute-force";
const suite = parseArg("suite") ?? "all";
const k = Number(parseArg("k") ?? 3);
const repeat = Number(parseArg("repeat") ?? 3);
${exitGuard}
const instance = (name, extra) => ({
  name: name,
  suite: "baseline",
  sizeClass: "8 courses",
  enumerable: true,
  statuses: 64,
  violations: 0,
  iisValid: true,
  optimalityGap: 0,
  topKAgreement: k,
  diversity: 0.9,
  initMsP50: 1,
  initMsP95: 2,
  searchMsP50: 3,
  searchMsP95: 4,
  wallMsP50: 5,
  wallMsP95: 40,
  ...extra,
});
const instances = [
  instance("baseline-8", { violations: ${violations} }),
  instance("dense-8", { optimalityGap: ${gap} }),
  instance("worst-case-xl", { wallMsP95: ${xlP95} }),
];
const resultsDir = path.join(import.meta.dir, "results");
mkdirSync(resultsDir, { recursive: true });
const resultsName = path.basename(variant) + "-" + suite + ".json";
writeFileSync(
  path.join(resultsDir, resultsName),
  JSON.stringify({ variant: variant, suite: suite, k: k, repeat: repeat, instances: instances, sizeSummary: [] }, null, 2) + "\\n",
);
console.log("bench: " + instances.length + " instances");
`,
  );
  return benchDir;
}

export interface DataArtifacts {
  bundlePath: string;
  descriptorPath: string;
  toolDir: string;
  seedDataPath: string;
  /** Mutate one byte of the bundled catalog: the descriptor's sha256 no longer matches, counts still do. */
  corruptBundle(): void;
  /**
   * Tamper one value in seed-data.json (a string where the audit's rule
   * demands a positive integer): the real audit rule fails, so the chain
   * exits nonzero and the certification case fails. Counts stay equal, so
   * the descriptor case is unaffected.
   */
  corruptSeedData(): void;
}

// A REAL audit.mjs: rules over --input, report.json under --out, exit 0 only
// when the rules pass (decision 685c: the fixture conforms to the real
// tool's CLI and exit-code semantics, discovered at the PR #6 head).
const AUDIT_MJS = `// selftest-planted catalog-consistency audit: real rules over --input
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArg(name) {
  // The real tools' union: audit.mjs uses node:util parseArgs (both
  // --name=value and --name value), verify.mjs's manual loop takes
  // --name value only. The adapter's prescribed commands use the space form.
  const argv = process.argv.slice(2);
  const eq = "--" + name + "=";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(eq)) return a.slice(eq.length);
    if (a === "--" + name) return argv[i + 1];
  }
  return null;
}

const input = parseArg("input");
const out = parseArg("out");
if (input === null || out === null) {
  console.error("usage: node audit.mjs --input <seed-data.json> --out <dir>");
  process.exit(2);
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(input, "utf8"));
} catch (error) {
  console.error("audit: cannot read the catalog at " + input + ": " + error.message);
  process.exit(2);
}

const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const sections = Array.isArray(catalog.sections) ? catalog.sections : [];
const malformedCourseIds = courses.filter((c) => typeof c !== "string" || !/^UNTC-[0-9]+$/.test(c)).length;
const malformedSections = sections.filter(
  (s) => s === null || typeof s !== "object" || !Number.isInteger(s.seats) || s.seats <= 0,
).length;
const report = {
  counts: {
    courses: courses.length,
    sections: sections.length,
    instructors: typeof catalog.instructors === "number" ? catalog.instructors : 0,
  },
  violations: { malformedCourseIds: malformedCourseIds, malformedSections: malformedSections },
};
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\\n");
const failures = malformedCourseIds + malformedSections;
if (failures > 0) {
  console.error("audit: " + failures + " failures (malformedCourseIds=" + malformedCourseIds + ", malformedSections=" + malformedSections + ")");
  process.exit(1);
}
console.log("audit: catalog clean");
`;

// A REAL verify.mjs: certifies the EVIDENCE CHAIN — the recorded report must
// still describe the current data and carry no findings — ending with the
// tool's own verdict line ("verdict: PASS" / "verdict: FAIL").
const VERIFY_MJS = `// selftest-planted catalog-consistency verify: certifies the evidence chain
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseArg(name) {
  // The real tools' union: audit.mjs uses node:util parseArgs (both
  // --name=value and --name value), verify.mjs's manual loop takes
  // --name value only. The adapter's prescribed commands use the space form.
  const argv = process.argv.slice(2);
  const eq = "--" + name + "=";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(eq)) return a.slice(eq.length);
    if (a === "--" + name) return argv[i + 1];
  }
  return null;
}

const results = parseArg("results");
const repoRoot = parseArg("repo-root");
if (results === null || repoRoot === null) {
  console.error("usage: node verify.mjs --results <dir> --repo-root <root>");
  process.exit(2);
}

const reportPath = path.join(results, "report.json");
if (!existsSync(reportPath)) {
  console.error("verify: no report.json under " + results);
  process.exit(2);
}
let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error("verify: report.json is unparseable: " + error.message);
  process.exit(2);
}

const seedPath = path.join(repoRoot, "frontend", "src", "lib", "generated", "seed-data.json");
let catalog;
try {
  catalog = JSON.parse(readFileSync(seedPath, "utf8"));
} catch (error) {
  console.error("verify: seed-data.json is unparseable: " + error.message);
  process.exit(2);
}

const courses = Array.isArray(catalog.courses) ? catalog.courses : [];
const sections = Array.isArray(catalog.sections) ? catalog.sections : [];
const currentViolations = {
  malformedCourseIds: courses.filter((c) => typeof c !== "string" || !/^UNTC-[0-9]+$/.test(c)).length,
  malformedSections: sections.filter((s) => s === null || typeof s !== "object" || !Number.isInteger(s.seats) || s.seats <= 0).length,
};
const findings = currentViolations.malformedCourseIds + currentViolations.malformedSections;
if (findings > 0) {
  console.error("verify: the audited data carries " + findings + " findings");
  console.log("verdict: FAIL");
  process.exit(1);
}
const mismatches = [];
if ((report.counts ? report.counts.courses : undefined) !== courses.length) mismatches.push("counts.courses");
if ((report.counts ? report.counts.sections : undefined) !== sections.length) mismatches.push("counts.sections");
for (const key of Object.keys(currentViolations)) {
  if ((report.violations ? report.violations[key] : undefined) !== currentViolations[key]) mismatches.push("violations." + key);
}
if (mismatches.length > 0) {
  console.error("verify: the recorded evidence no longer describes the current data: " + mismatches.join(", "));
  console.log("verdict: FAIL");
  process.exit(1);
}
console.log("verify: evidence chain certified against the current data");
console.log("verdict: PASS");
`;

/**
 * Plant the data suite's target artifacts, healthy by default (decision
 * 685c: the REAL tool interface the adapter drives):
 *   - frontend/src/lib/generated/seed-data.json: the audit's real input;
 *   - tools/catalog-consistency/audit.mjs + verify.mjs: real node tools
 *     (audit's rules over --input; verify's evidence-chain certification
 *     ending in its own verdict line);
 *   - frontend/src/lib/data-provenance.ts: an activeDataset descriptor whose
 *     sha256/counts exactly match the bundled catalog file;
 *   - frontend/src/data/catalog/complete.json: the bundled catalog bundle.
 */
export function writeDataArtifacts(targetDir: string): DataArtifacts {
  const bundlePath = path.join(targetDir, "frontend", "src", "data", "catalog", "complete.json");
  const descriptorPath = path.join(targetDir, "frontend", "src", "lib", "data-provenance.ts");
  const seedDataPath = path.join(targetDir, "frontend", "src", "lib", "generated", "seed-data.json");
  const toolDir = path.join(targetDir, "tools", "catalog-consistency");
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  mkdirSync(path.dirname(descriptorPath), { recursive: true });
  mkdirSync(path.dirname(seedDataPath), { recursive: true });
  mkdirSync(toolDir, { recursive: true });

  writeFileSync(
    bundlePath,
    JSON.stringify({
      courses: Array.from({ length: 84 }, (_, i) => `UNTC-${1000 + i}`),
      sections: Array.from({ length: 312 }, (_, i) => ({ id: i, seats: 30 })),
      instructors: 57,
    }),
  );
  const goodHash = createHash("sha256").update(readFileSync(bundlePath, "utf8")).digest("hex");
  writeFileSync(
    descriptorPath,
    `// selftest-planted data-provenance descriptor (flat primitive literal)
export const activeDataset = {
  dataset: "UNT 2026 fall",
  file: "src/data/catalog/complete.json",
  sha256: "${goodHash}",
  courses: 84,
  sections: 312,
  instructors: 57,
} as const;
`,
  );
  writeFileSync(
    seedDataPath,
    JSON.stringify({
      generatedAt: "selftest-fixture (synthetic; not a real term)",
      courses: Array.from({ length: 84 }, (_, i) => `UNTC-${1000 + i}`),
      sections: Array.from({ length: 312 }, (_, i) => ({ id: i, seats: 30 })),
      instructors: 57,
    }, null, 2) + "\n",
  );
  writeFileSync(path.join(toolDir, "audit.mjs"), AUDIT_MJS);
  writeFileSync(path.join(toolDir, "verify.mjs"), VERIFY_MJS);

  return {
    bundlePath,
    descriptorPath,
    toolDir,
    seedDataPath,
    corruptBundle(): void {
      const before = readFileSync(bundlePath, "utf8");
      writeFileSync(bundlePath, `${before} `); // array lengths unchanged; hash changes
    },
    corruptSeedData(): void {
      const catalog = JSON.parse(readFileSync(seedDataPath, "utf8")) as { sections: Array<Record<string, unknown>> };
      const first = catalog.sections[0];
      if (first === undefined) throw new Error("corruptSeedData: fixture has no sections");
      first.seats = "30"; // a string where the audit's rule demands a positive integer
      writeFileSync(seedDataPath, JSON.stringify(catalog, null, 2) + "\n");
    },
  };
}

export interface FakeRoutingApp {
  origin: string;
  /** Resolve the serving promise (Bun.serve keeps the process alive until stopped). */
  stop(): Promise<void>;
}

/**
 * A fake UNTangle app at the routing suite's real boundary (POST
 * /api/map/resolve and /api/map/route), healthy unless plantSubGeodesic:
 * then every route response reports a distance far below the great-circle
 * floor — the lead's "mutated /api/map/route response" defect. Building
 * coverage is unaffected (resolve answers exactly from the fixture roster),
 * so a failing route-geodesic-floor is attributable to the plant.
 */
export function startFakeRoutingApp(harness: HarnessCopy, opts: { plantSubGeodesic?: boolean } = {}): FakeRoutingApp {
  const fixture = JSON.parse(
    readFileSync(path.join(harness.evalsDir, "fixtures", "campus-routes.json"), "utf8"),
  ) as {
    buildings: Array<{ id: string; name: string; shortName: string; inRoutingBounds: boolean }>;
  };
  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method !== "POST") return new Response("not found", { status: 404 });
      if (url.pathname === "/api/map/resolve") {
        const body = JSON.parse(await request.text()) as { locations?: Array<{ location?: string }> };
        const locations = (body.locations ?? []).map(({ location }) => {
          const wanted = (location ?? "").trim().toLowerCase();
          const building = fixture.buildings.find(
            (b) => b.name.toLowerCase() === wanted || b.shortName.toLowerCase() === wanted,
          );
          if (building === undefined) return { location: location ?? "", resolutionStatus: "missing" };
          return building.inRoutingBounds
            ? { location: location ?? "", buildingId: building.id, resolutionStatus: "local", lat: 33.2, lng: -97.15 }
            : {
                location: location ?? "",
                buildingId: building.id,
                resolutionStatus: "unresolved",
                unsupportedReason: "off-campus",
              };
        });
        return Response.json({ locations });
      }
      if (url.pathname === "/api/map/route") {
        const body = JSON.parse(await request.text()) as { stops?: Array<{ lat: number; lng: number }> };
        const stops = body.stops ?? [];
        const [a, b] = stops;
        const earthRadiusMeters = 6_371_000;
        const dLat = (((b?.lat ?? 0) - (a?.lat ?? 0)) * Math.PI) / 180;
        const dLng = (((b?.lng ?? 0) - (a?.lng ?? 0)) * Math.PI) / 180;
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(((a?.lat ?? 0) * Math.PI) / 180) * Math.cos(((b?.lat ?? 0) * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        const greatCircle = 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
        // Healthy: a legal walking distance (floor + margin). Planted: far below the floor.
        const distanceMeters = opts.plantSubGeodesic === true ? 1 : Math.round(greatCircle + 25);
        return Response.json({ distanceMeters, geometry: stops, source: "selftest-fake-app" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

export interface RunnerInvocation {
  harness: HarnessCopy;
  targetDir: string;
  suite: string;
  outPath: string;
  taskId: string;
  timeoutMs?: number;
  /** Extra env for the spawned runner (e.g. the stub stack's origin wiring). */
  env?: Record<string, string | undefined>;
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
    { cwd: inv.harness.root, timeoutMs: inv.timeoutMs ?? 90_000, env: inv.env },
  );
  return { ...result, outPath: inv.outPath };
}

/** Spawn the REPO's runner with a raw argv (usage-error tests); installs evals deps once if needed. */
export async function runRepoRunnerRaw(argv: string[], timeoutMs = 60_000): Promise<SpawnResult> {
  await ensureEvalsDeps();
  return spawnBounded(process.execPath, [REPO_RUN_TS, ...argv], { cwd: REPO_ROOT, timeoutMs });
}
