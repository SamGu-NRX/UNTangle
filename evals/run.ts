/**
 * run — the eval runner CLI.
 *
 *   bun evals/run.ts --target-dir <checkout> --target-sha <sha> \
 *        --suite <name|all> --out <scorecard.json> [--task-id <id>]
 *
 * Exit codes:
 *   0  preflight green and every case passed
 *   1  preflight green but at least one case failed
 *   2  usage error (bad or missing arguments)
 *   3  infrastructure failure — the scorecard is still written: every case is
 *      not-applicable and infrastructure.error names the exact broken step
 *
 * Suites are auto-discovered from evals/suites/<name>.ts (evals/suite-kit.ts
 * defines the authoring convention). Suite workers add suite files; they never
 * touch any other harness file.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePreflightArgs, usageError, runPreflight } from "./preflight";
import { StackBootError, readRmpBlockedCount, type RunningStack } from "./stack";
import {
  validateScorecard,
  writeScorecard,
  sha256File,
  type CaseRecord,
  type Scorecard,
  type ScorecardRuntime,
  type StackStepRecord,
} from "./scorecard";
import { isSuiteDefinition, type CaseOutcome, type SuiteContext, type SuiteDefinition } from "./suite-kit";

const usage = [
  "usage: bun evals/run.ts --target-dir <checkout> --target-sha <40-hex sha> \\",
  "            --suite <name|all> --out <scorecard.json> [--task-id <id>]",
  "",
  "exit codes: 0 all pass · 1 case failures · 2 usage error · 3 infrastructure failure",
].join("\n");

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CASE_TIMEOUT_MS = 120_000;

interface RunArgs {
  targetDir: string;
  targetSha: string;
  out: string;
  suite: string;
  taskId: string;
}

function parseRunArgs(argv: string[]): RunArgs {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usageError(usage, `${name} needs a value`);
    }
    return value;
  };

  const knownFlags = ["--target-dir", "--target-sha", "--suite", "--out", "--task-id"];
  const unknown = argv.filter((arg) => arg.startsWith("--") && !knownFlags.includes(arg));
  if (unknown.length > 0) usageError(usage, `unrecognized argument(s): ${unknown.join(" ")}`);

  // parsePreflightArgs owns the strict rules for the three core flags; hand it
  // only those flags and their values so --suite/--task-id don't trip its
  // unknown-arg check. A token is kept when it IS a core flag or immediately
  // follows one (i.e. it is that flag's value).
  const coreFlags = ["--target-dir", "--target-sha", "--out"];
  const base = parsePreflightArgs(
    argv.filter((arg, index) => {
      if (coreFlags.includes(arg)) return true;
      const prev = argv[index - 1];
      return prev !== undefined && coreFlags.includes(prev);
    }),
    usage,
  );

  const suite = get("--suite");
  if (suite === undefined) usageError(usage, "--suite is required (a suite name or 'all')");

  return { ...base, suite, taskId: get("--task-id") ?? "default" };
}

interface DiscoveredSuite {
  name: string;
  path: string;
}

/** evals/suites/<name>.ts files; underscore-prefixed and *.test.* files are skipped. */
function discoverSuites(): DiscoveredSuite[] {
  const suitesDir = path.join(HARNESS_DIR, "suites");
  const discovered = existsSync(suitesDir)
    ? readdirSync(suitesDir)
        .filter((file) => file.endsWith(".ts") && !file.startsWith("_") && !file.includes(".test."))
        .map((file) => ({ name: file.replace(/\.ts$/, ""), path: path.join(suitesDir, file) }))
    : [];
  // The built-in preflight-only suite lives outside suites/ (suite-kit's
  // convention) and runs first.
  const selfcheck = path.join(HARNESS_DIR, "selfcheck", "index.ts");
  if (existsSync(selfcheck)) {
    discovered.unshift({ name: "selfcheck", path: selfcheck });
  }
  return discovered;
}

async function loadSuite(discovered: DiscoveredSuite): Promise<SuiteDefinition> {
  const module = (await import(discovered.path)) as { default?: unknown; suite?: unknown };
  const candidate = module.default ?? module.suite;
  if (!isSuiteDefinition(candidate)) {
    throw new Error(
      `suite file ${discovered.path} must default-export (or export "suite") defineSuite({ name, describe, run })`,
    );
  }
  if (candidate.name !== discovered.name) {
    throw new Error(`suite ${discovered.path} exports name "${candidate.name}" but the file name is "${discovered.name}"`);
  }
  return candidate;
}

interface BarsFile {
  bars: Record<string, { bar: string; reason: string }>;
}

function loadBars(): BarsFile {
  const barsPath = path.join(HARNESS_DIR, "bars.json");
  return JSON.parse(readFileSync(barsPath, "utf8")) as BarsFile;
}

function suiteContext(stack: RunningStack): SuiteContext {
  return {
    runDir: stack.runDir,
    frontendOrigin: stack.frontendOrigin,
    backendOrigin: stack.backendOrigin,
    databaseUrl: stack.databaseUrl,
    blockedRmpLogPath: stack.blockedRmpLogPath,
    preflightSteps: stack.steps.map((s) => ({
      step: s.step,
      status: s.status,
      durationMs: s.durationMs,
      detail: s.detail,
    })),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCase(
  suite: SuiteDefinition,
  caseId: string,
  ctx: SuiteContext,
): Promise<{ outcome: CaseOutcome | null; note?: string }> {
  try {
    return { outcome: await withTimeout(Promise.resolve(suite.run(caseId, ctx)), suite.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS, `case ${suite.name}/${caseId}`) };
  } catch (error) {
    return { outcome: null, note: `case threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runSuite(discovered: DiscoveredSuite, stack: RunningStack, bars: BarsFile): Promise<CaseRecord[]> {
  const suite = await loadSuite(discovered);
  const specs = await suite.describe();
  const ctx = suiteContext(stack);
  const suiteBar = bars.bars[suite.name]?.bar;
  const records: CaseRecord[] = [];
  for (const spec of specs) {
    console.error(`[run] ${suite.name}/${spec.id} ...`);
    const { outcome, note } = await runCase(suite, spec.id, ctx);
    const record: CaseRecord = {
      suite: suite.name,
      id: spec.id,
      status: outcome?.status ?? "fail",
      measured: outcome?.measured ?? null,
      bar: outcome?.bar ?? suiteBar,
      evidencePath: outcome?.evidencePath,
      note: outcome?.note ?? note,
    };
    records.push(record);
    console.error(`[run] ${suite.name}/${spec.id} → ${record.status}${record.note ? ` (${record.note})` : ""}`);
  }
  return records;
}

interface BuildOptions {
  suiteSelector: string;
  cases: CaseRecord[];
  target: { dir: string; sha: string; actualHead: string | null };
  stackSteps: StackStepRecord[];
  infraError: string | null;
  brokenStep: string | null;
  blockedRmpCount: number;
  backendStartMode: string;
  startedAt: string;
  contractHash: string;
  barsHash: string;
  runtime: ScorecardRuntime;
}

/**
 * Bounded, failure-tolerant `binary --version` probe. Runtime versions are
 * observability, never gates: a missing binary (e.g. UNTANGLE_PG_BIN pointing
 * nowhere during a sabotage test) must not stop the scorecard from rendering.
 */
function safeVersion(cmd: string, args: string[]): string {
  try {
    const r = execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
    return r.trim() || "unknown";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `unknown (${code ?? (error as Error).message})`;
  }
}

function collectRuntime(): ScorecardRuntime {
  let playwright = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(path.join(HARNESS_DIR, "node_modules", "@playwright", "test", "package.json"), "utf8")) as { version?: string };
    playwright = pkg.version ?? "unknown";
  } catch {
    // playwright metadata is optional context — degrade, don't crash.
  }
  return {
    bun: process.versions.bun ?? "unknown",
    node: safeVersion("node", ["--version"]),
    postgres: safeVersion(path.join(process.env.UNTANGLE_PG_BIN ?? "/usr/lib/postgresql/17/bin", "postgres"), [
      "--version",
    ]),
    playwright,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
  };
}

/** Pure assembler: Scorecard from observed facts; the caller supplies runtime versions. */
function buildScorecard(opts: BuildOptions): Scorecard {
  return {
    schemaVersion: 1,
    suite: opts.suiteSelector,
    startedAt: opts.startedAt,
    finishedAt: new Date().toISOString(),
    target: opts.target,
    runtime: opts.runtime,
    stack: opts.stackSteps,
    infrastructure: {
      ok: opts.infraError === null,
      brokenStep: opts.brokenStep,
      ...(opts.infraError === null ? {} : { error: opts.infraError }),
    },
    cases: opts.cases,
    blockedRmpRequests: opts.blockedRmpCount,
    stubs: [
      ...(opts.backendStartMode === "node-tsx"
        ? [
            {
              label: "backend-runtime-fallback",
              reason:
                "the pinned backend's better-sqlite3 native addon crashes Bun (NAPI panic), so the backend ran under its documented Node/tsx runtime with the same rmp-block preload injected via NODE_OPTIONS",
            },
          ]
        : []),
    ],
    hashes: {
      contractMd: opts.contractHash,
      barsJson: opts.barsHash,
    },
  };
}

function summarize(cases: CaseRecord[]): { total: number; pass: number; fail: number; notApplicable: number } {
  return {
    total: cases.length,
    pass: cases.filter((c) => c.status === "pass").length,
    fail: cases.filter((c) => c.status === "fail").length,
    notApplicable: cases.filter((c) => c.status === "not-applicable").length,
  };
}

function markdownSummary(scorecard: Scorecard): string {
  const lines: string[] = [];
  const suites = [...new Set(scorecard.cases.map((c) => c.suite))];
  lines.push(`# eval run — ${suites.length > 0 ? suites.join(", ") : "no suites"}`);
  lines.push("");
  lines.push(`- target: \`${scorecard.target.sha}\` at ${scorecard.target.dir} (checkout HEAD: ${scorecard.target.actualHead ?? "unknown"})`);
  lines.push(`- started: ${scorecard.startedAt} · finished: ${scorecard.finishedAt}`);
  lines.push(`- backend start mode: ${scorecard.stubs.some((s) => s.label === "backend-runtime-fallback") ? "node-tsx (see stubs)" : "bun-preload"}`);
  lines.push(`- blocked RateMyProfessors requests: ${scorecard.blockedRmpRequests}`);
  lines.push(`- hashes: CONTRACT.md \`${scorecard.hashes.contractMd}\` · bars.json \`${scorecard.hashes.barsJson}\``);
  if (scorecard.infrastructure.error) {
    lines.push(`- **infrastructure failure** at step \`${scorecard.infrastructure.brokenStep}\`: ${scorecard.infrastructure.error}`);
  }
  lines.push("");
  for (const suite of suites) {
    lines.push(`## suite ${suite}`);
    lines.push("");
    lines.push("| case | status | measured | bar | evidence |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const record of scorecard.cases.filter((c) => c.suite === suite)) {
      lines.push(
        `| ${record.id} | ${record.status} | ${record.measured ?? "—"} | ${record.bar ?? "—"} | ${record.evidencePath ?? "—"} |`,
      );
    }
    lines.push("");
  }
  lines.push("## preflight steps");
  lines.push("");
  for (const step of scorecard.stack) {
    lines.push(`- ${step.step}: **${step.status}** (${step.durationMs}ms) — ${step.detail ?? ""}`);
  }
  lines.push("");
  lines.push(`<details><summary>runtime versions</summary>`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(scorecard.runtime, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  return `${lines.join("\n")}\n`;
}

async function writeOutputs(scorecard: Scorecard, outPath: string): Promise<void> {
  const resolved = path.resolve(outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  await writeScorecard(resolved, scorecard);
  writeFileSync(resolved.replace(/\.json$/, ".md"), markdownSummary(scorecard));
}

async function hashTargetFiles(targetDir: string): Promise<{ contractHash: string; barsHash: string }> {
  // The target checkout normally carries its own evals/bars.json (the harness
  // lives there); when pointing at a bare UNTangle checkout that lacks it, fall
  // back to the harness's own bars — SCHEMA.md documents this.
  const targetBars = path.join(targetDir, "evals", "bars.json");
  const barsSource = existsSync(targetBars) ? targetBars : path.join(HARNESS_DIR, "bars.json");
  return {
    contractHash: await sha256File(path.join(targetDir, "evals", "CONTRACT.md")),
    barsHash: await sha256File(barsSource),
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.error(usage);
    return argv.length === 0 ? 2 : 0;
  }
  const args = parseRunArgs(argv);

  if (!existsSync(path.join(args.targetDir, "evals", "CONTRACT.md"))) {
    usageError(usage, `--target-dir has no evals/CONTRACT.md — is it a UNTangle checkout? ${args.targetDir}`);
  }

  // Attribution guard: warn loudly when the checkout is not at --target-sha.
  let actualHead: string | null = null;
  try {
    actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: args.targetDir, encoding: "utf8" }).trim();
    if (actualHead !== args.targetSha) {
      console.error(
        `[run] WARNING: --target-sha ${args.targetSha} != checkout HEAD ${actualHead} — the scorecard records both; verify which code was actually exercised`,
      );
    }
  } catch (error) {
    console.error(`[run] WARNING: could not read HEAD of ${args.targetDir}: ${(error as Error).message}`);
  }

  const bars = loadBars();
  const discovered = discoverSuites();
  const chosen = args.suite === "all" ? discovered : discovered.filter((d) => d.name === args.suite);
  if (chosen.length === 0) {
    console.error(
      discovered.length === 0
        ? `[run] no suite files found in ${path.join(HARNESS_DIR, "suites")} — nothing to run`
        : `[run] suite "${args.suite}" not found. Available: ${discovered.map((d) => d.name).join(", ")}`,
    );
    return 2;
  }
  console.error(`[run] suites: ${chosen.map((d) => d.name).join(", ")}`);

  const startedAt = new Date().toISOString();
  const hashes = await hashTargetFiles(args.targetDir);

  let stack: RunningStack | null = null;
  try {
    stack = await runPreflight({ ...args, runDir: path.join(path.dirname(path.resolve(args.out)), "preflight-logs") });
  } catch (error) {
    const brokenStep = error instanceof StackBootError ? error.brokenStep : "(unknown step)";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run] INFRASTRUCTURE FAILURE at step "${brokenStep}": ${message}`);

    // Infra scorecard: every declared case is not-applicable; the error block
    // names the broken step. Never marked as application failures.
    const cases: CaseRecord[] = [];
    for (const d of chosen) {
      let ids: string[] = [];
      try {
        ids = (await (await loadSuite(d)).describe()).map((s) => s.id);
      } catch (loadError) {
        console.error(`[run] could not load suite ${d.name} for the infra scorecard: ${(loadError as Error).message}`);
      }
      for (const id of ids) {
        cases.push({
          suite: d.name,
          id,
          status: "not-applicable",
          measured: null,
          note: "not run: the stack failed before any case could execute",
        });
      }
    }
    const scorecard = buildScorecard({
      suiteSelector: args.suite,
      cases,
      target: { dir: args.targetDir, sha: args.targetSha, actualHead },
      stackSteps: error instanceof StackBootError ? error.steps : [],
      infraError: `broken step "${brokenStep}": ${message}`,
      brokenStep,
      blockedRmpCount: 0,
      backendStartMode: "never-started",
      startedAt,
      contractHash: hashes.contractHash,
      barsHash: hashes.barsHash,
      runtime: collectRuntime(),
    });
    await writeOutputs(scorecard, args.out);
    console.error(`[run] infra scorecard: ${args.out}`);
    return 3;
  }

  try {
    const cases: CaseRecord[] = [];
    for (const d of chosen) {
      try {
        cases.push(...(await runSuite(d, stack, bars)));
      } catch (error) {
        console.error(`[run] suite ${d.name} crashed: ${(error as Error).message}`);
        cases.push({
          suite: d.name,
          id: "(suite crashed before any case result)",
          status: "fail",
          measured: null,
          note: (error as Error).message,
        });
      }
    }

    const blockedRmp = readRmpBlockedCount(stack.blockedRmpLogPath);
    const scorecard = buildScorecard({
      suiteSelector: args.suite,
      cases,
      target: { dir: args.targetDir, sha: args.targetSha, actualHead },
      stackSteps: stack.steps,
      infraError: null,
      brokenStep: null,
      blockedRmpCount: blockedRmp.count,
      backendStartMode: stack.backendStartMode,
      startedAt,
      contractHash: hashes.contractHash,
      barsHash: hashes.barsHash,
      runtime: collectRuntime(),
    });
    await writeOutputs(scorecard, args.out);

    const summary = summarize(cases);
    console.error(
      `[run] ${summary.pass}/${summary.total} pass, ${summary.fail} fail, ${summary.notApplicable} n/a — scorecard ${args.out}`,
    );
    return summary.fail === 0 ? 0 : 1;
  } finally {
    await stack.stop();
  }
}

// The default exit code is 1 so a runner crash (never reaching main's return)
// can never masquerade as success.
process.exitCode = 1;
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[run] fatal: ${(error as Error).stack ?? String(error)}`);
    process.exitCode = 1;
  });
