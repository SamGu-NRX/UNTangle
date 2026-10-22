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
 *   3  infrastructure failure — the scorecard is still written: every declared
 *      case is not-applicable and infrastructure.error names what broke (a
 *      stack step, or a registered suite that failed to load — decision 685b)
 *
 * Suites come from the explicit registry below (SUITE_REGISTRY, decision
 * 685b): the seven real suites, each resolving to evals/suites/<name>.ts in
 * the HARNESS checkout. evals/suite-kit.ts defines the authoring convention;
 * a suite runs because it is registered here — adding a suite means adding
 * the file AND its registry entry. Helper modules (underscore-prefixed files
 * like _optdata-lib/_persist-helpers/_persist-injections, ui-* helpers,
 * *.test.ts) are imported by suites and are never registered or run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  "            --suite <name|all> --out <scorecard.json> [--task-id <id>] \\",
  "            [--only <case-id>]...",
  "",
  "--only repeats; each value is an exact declared case id (e.g. journey/discover-guest-desktop).",
  "A filtered run writes a partial scorecard — its cases array names exactly what ran.",
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
  /** Exact declared case ids from repeatable --only flags; empty = run all. */
  only: string[];
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

  const knownFlags = ["--target-dir", "--target-sha", "--suite", "--out", "--task-id", "--only"];
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

  // --only is repeatable; each value is an exact declared case id.
  const only: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--only") continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) usageError(usage, "--only needs a case id");
    only.push(value);
  }

  return { ...base, suite, taskId: get("--task-id") ?? "default", only };
}

interface RegisteredSuite {
  name: string;
  path: string;
}

/**
 * The explicit suite registry (decision 685b). There is no directory scan: a
 * suite runs because it is registered here, by name, resolving to
 * evals/suites/<name>.ts in the HARNESS checkout. Adding a suite means adding
 * the file AND its registry entry; helper modules (underscore-prefixed files
 * like _optdata-lib/_persist-helpers/_persist-injections, ui-* helpers,
 * *.test.ts) are imported by suites and are never registered. A registered
 * suite that is missing or broken is a harness defect and surfaces loudly at
 * load time (see main()) — it is never silently skipped.
 */
const SUITE_REGISTRY: readonly string[] = [
  "journey",
  "honesty",
  "a11y-polish",
  "routing",
  "optimizer",
  "data",
  "persistence-faults",
];

/**
 * The run order: the built-in preflight-only suite first (suite-kit's
 * convention — it lives outside suites/ and stays special-cased), then the
 * registry in declaration order for `--suite all`.
 */
function registeredSuites(): RegisteredSuite[] {
  const selfcheck = path.join(HARNESS_DIR, "selfcheck", "index.ts");
  const suites: RegisteredSuite[] = SUITE_REGISTRY.map((name) => ({
    name,
    path: path.join(HARNESS_DIR, "suites", `${name}.ts`),
  }));
  return existsSync(selfcheck) ? [{ name: "selfcheck", path: selfcheck }, ...suites] : suites;
}

async function loadSuite(registered: RegisteredSuite): Promise<SuiteDefinition> {
  const module = (await import(registered.path)) as { default?: unknown; suite?: unknown };
  const candidate = module.default ?? module.suite;
  if (!isSuiteDefinition(candidate)) {
    throw new Error(
      `suite file ${registered.path} must default-export (or export "suite") defineSuite({ name, describe, run })`,
    );
  }
  if (candidate.name !== registered.name) {
    throw new Error(`suite ${registered.path} exports name "${candidate.name}" but the registered name is "${registered.name}"`);
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string, cancel: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          cancel();
          reject(new Error(`${what} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      // Cancellation is cooperative. Do not start another case until the
      // timed-out case's finally blocks and child cleanup have drained; the
      // timeout remains the scored error, while this await prevents overlap
      // and detached late rejections.
      await promise.catch(() => undefined);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCase(
  suite: SuiteDefinition,
  caseId: string,
  ctx: SuiteContext,
): Promise<{ outcome: CaseOutcome | null; note?: string }> {
  const controller = new AbortController();
  const caseContext: SuiteContext = { ...ctx, signal: controller.signal };
  const promise = Promise.resolve().then(() => suite.run(caseId, caseContext));
  try {
    return {
      outcome: await withTimeout(
        promise,
        suite.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
        `case ${suite.name}/${caseId}`,
        () => controller.abort(),
      ),
    };
  } catch (error) {
    return { outcome: null, note: `case threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function runSuite(suite: SuiteDefinition, stack: RunningStack, bars: BarsFile, only: readonly string[]): Promise<CaseRecord[]> {
  const specs = await suite.describe();
  // Validated pre-boot in main(); here it is a pure filter. Suites with no
  // matching id (the --suite all path) simply contribute no cases.
  const selected = only.length === 0 ? specs : specs.filter((s) => only.includes(s.id));
  const ctx = suiteContext(stack);
  const suiteBar = bars.bars[suite.name]?.bar;
  const records: CaseRecord[] = [];
  for (const spec of selected) {
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
// Crash-card salvage: an uncaught error outside the per-suite guard (observed
// as Playwright's transport dying with `connect ENOENT` mid-journey on
// 2026-10-19, twice) kills the process at exit 1 with no scorecard — every
// completed case and stack step is lost evidence. main() populates this
// context as it advances; the handlers below serialize what exists at the
// moment of death. The suite-crash catch inside main() stays the first line
// of defense; this only fires when even that machinery cannot run.
const crashCtx: {
  outPath: string | null;
  suiteSelector: string;
  startedAt: string;
  cases: CaseRecord[];
  stack: RunningStack | null;
  hashes: { contractHash: string; barsHash: string } | null;
  actualHead: string | null;
  targetDir: string;
  targetSha: string;
} = {
  outPath: null,
  suiteSelector: "(unknown)",
  startedAt: new Date().toISOString(),
  cases: [],
  stack: null,
  hashes: null,
  actualHead: null,
  targetDir: "(unknown)",
  targetSha: "(unknown)",
};

async function writeCrashCard(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run] fatal (crash card): ${error instanceof Error ? error.stack ?? error.message : message}`);
  try {
    const cases: CaseRecord[] = [
      ...crashCtx.cases,
      {
        suite: "(runner)",
        id: "(runner crashed outside the per-suite guard)",
        status: "fail",
        measured: null,
        note: `uncaught ${error instanceof Error ? error.name : "error"}: ${message} — best-effort crash card; case records above may be partial`,
      },
    ];
    const scorecard = buildScorecard({
      suiteSelector: crashCtx.suiteSelector,
      cases,
      target: { dir: crashCtx.targetDir, sha: crashCtx.targetSha, actualHead: crashCtx.actualHead },
      stackSteps: crashCtx.stack?.steps ?? [],
      infraError: `runner crashed after ${crashCtx.cases.length} case record(s): ${message}`,
      brokenStep: crashCtx.stack ? "case-loop" : "preflight",
      blockedRmpCount: crashCtx.stack ? readRmpBlockedCount(crashCtx.stack.blockedRmpLogPath).count : 0,
      backendStartMode: crashCtx.stack?.backendStartMode ?? "never-started",
      startedAt: crashCtx.startedAt,
      contractHash: crashCtx.hashes?.contractHash ?? "(unknown: runner crashed before hashing)",
      barsHash: crashCtx.hashes?.barsHash ?? "(unknown: runner crashed before hashing)",
      runtime: collectRuntime(),
    });
    if (crashCtx.outPath) {
      await writeOutputs(scorecard, crashCtx.outPath);
      console.error(`[run] crash card written: ${crashCtx.outPath}`);
    }
  } catch (cardError) {
    console.error(`[run] could not write the crash card: ${(cardError as Error).message}`);
  }
  if (crashCtx.stack) {
    try {
      await Promise.race([crashCtx.stack.stop(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    } catch {
      // best-effort stop; the port fences protect the next run either way
    }
  }
  process.exit(1);
}

process.on("uncaughtException", (error) => {
  void writeCrashCard(error);
});
// An unhandled rejection means nothing in-process awaited the promise, so the
// affected case (if any) fails on its own per-case timeout and the suite drains
// to a scored card. Exiting here (the old behavior) let one transient
// playwright spawn rejection ("Failed to connect", observed 2026-10-19
// mid-a11y-run) kill a 20-minute suite after six cases had already scored.
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[run] unhandledRejection (continuing): ${message}`);
});

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

async function hashTargetFiles(): Promise<{ contractHash: string; barsHash: string }> {
  // The contract and bars belong to the HARNESS checkout, never the target:
  // baseline targets are application states that do not carry evals/ at all.
  // The scorecard hashes identify exactly which harness ran — the contract
  // and bar set actually enforced.
  return {
    contractHash: await sha256File(path.join(HARNESS_DIR, "CONTRACT.md")),
    barsHash: await sha256File(path.join(HARNESS_DIR, "bars.json")),
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.error(usage);
    return argv.length === 0 ? 2 : 0;
  }
  const args = parseRunArgs(argv);
  crashCtx.outPath = args.out;
  crashCtx.suiteSelector = args.suite;
  crashCtx.targetDir = args.targetDir;
  crashCtx.targetSha = args.targetSha;

  // The contract, bars, and suites belong to the HARNESS checkout, never the
  // target: baseline targets are application states that do not (and should
  // not) carry evals/.
  if (!existsSync(path.join(HARNESS_DIR, "CONTRACT.md"))) {
    usageError(usage, `harness checkout has no evals/CONTRACT.md — is this the harness checkout? ${HARNESS_DIR}`);
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
  crashCtx.actualHead = actualHead;


  const bars = loadBars();
  const all = registeredSuites();
  const chosen = args.suite === "all" ? all : all.filter((d) => d.name === args.suite);
  if (chosen.length === 0) {
    console.error(`[run] suite "${args.suite}" not found. Available: ${all.map((d) => d.name).join(", ")}`);
    return 2;
  }
  console.error(`[run] suites: ${chosen.map((d) => d.name).join(", ")}`);

  const startedAt = new Date().toISOString();
  crashCtx.startedAt = startedAt;
  const hashes = await hashTargetFiles();
  crashCtx.hashes = hashes;

  // Decision 685b: load every chosen suite BEFORE booting the stack. A
  // registered suite that fails to load (missing file, broken module, wrong
  // export shape) is a harness defect — never silently skipped. The run
  // fails as infrastructure (exit 3) with an honest scorecard: a suite-load
  // step record names every failing suite, and the loadable suites' declared
  // cases are recorded not-applicable with the reason.
  const loadStart = Date.now();
  const loaded: Array<{ registered: RegisteredSuite; suite: SuiteDefinition }> = [];
  const loadFailures: Array<{ name: string; message: string }> = [];
  for (const d of chosen) {
    try {
      loaded.push({ registered: d, suite: await loadSuite(d) });
    } catch (error) {
      loadFailures.push({ name: d.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (loadFailures.length > 0) {
    const loadMessage = loadFailures
      .map((f) => `registered suite "${f.name}" failed to load: ${f.message}`)
      .join("; ");
    console.error(`[run] SUITE LOAD FAILURE (harness defect): ${loadMessage}`);
    const cases: CaseRecord[] = [];
    for (const entry of loaded) {
      let ids: string[] = [];
      try {
        ids = (await entry.suite.describe()).map((s) => s.id);
      } catch (describeError) {
        console.error(
          `[run] could not read the declared cases of ${entry.suite.name}: ${(describeError as Error).message}`,
        );
      }
      for (const id of ids) {
        cases.push({
          suite: entry.suite.name,
          id,
          status: "not-applicable",
          measured: null,
          note: `not run: registered suite(s) ${loadFailures.map((f) => `"${f.name}"`).join(", ")} failed to load (harness defect) — the run aborted before any case could execute`,
        });
      }
    }
    const loadStep: StackStepRecord = {
      step: "suite-load",
      status: "fail",
      durationMs: Date.now() - loadStart,
      detail: loadMessage,
    };
    const scorecard = buildScorecard({
      suiteSelector: args.suite,
      cases,
      target: { dir: args.targetDir, sha: args.targetSha, actualHead },
      stackSteps: [loadStep],
      infraError: `suite load failure: ${loadMessage}`,
      brokenStep: "suite-load",
      blockedRmpCount: 0,
      backendStartMode: "never-started",
      startedAt,
      contractHash: hashes.contractHash,
      barsHash: hashes.barsHash,
      runtime: collectRuntime(),
    });
    await writeOutputs(scorecard, args.out);
    console.error(`[run] infra scorecard (suite-load failure): ${args.out}`);
    return 3;
  }

  // Case-level selection for precise reruns: validate every --only id
  // against the suites' declared cases BEFORE the stack boots. A typo must
  // exit 2 here — never silently measure nothing, and never exit mid-run
  // where the stop would leak the booted stack.
  if (args.only.length > 0) {
    const declaredIds = new Set<string>();
    for (const entry of loaded) {
      for (const spec of await entry.suite.describe()) declaredIds.add(spec.id);
    }
    const missing = args.only.filter((id) => !declaredIds.has(id));
    if (missing.length > 0) {
      usageError(usage, `--only: no such declared case(s): ${missing.join(", ")}`);
    }
    console.error(`[run] filter: --only ${args.only.join(", ")}`);
  }

  let stack: RunningStack | null = null;
  try {
    stack = await runPreflight({ ...args, runDir: path.join(path.dirname(path.resolve(args.out)), "preflight-logs") });
    crashCtx.stack = stack;
  } catch (error) {
    const brokenStep = error instanceof StackBootError ? error.brokenStep : "(unknown step)";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run] INFRASTRUCTURE FAILURE at step "${brokenStep}": ${message}`);

    // Infra scorecard: every declared case is not-applicable; the error block
    // names the broken step. Never marked as application failures.
    const cases: CaseRecord[] = [];
    for (const entry of loaded) {
      let ids: string[] = [];
      try {
        ids = (await entry.suite.describe()).map((s) => s.id);
      } catch (loadError) {
        console.error(`[run] could not load suite ${entry.suite.name} for the infra scorecard: ${(loadError as Error).message}`);
      }
      for (const id of ids) {
        cases.push({
          suite: entry.suite.name,
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
    const cases: CaseRecord[] = crashCtx.cases;
    for (const { suite } of loaded) {
      try {
        cases.push(...(await runSuite(suite, stack, bars, args.only)));
      } catch (error) {
        console.error(`[run] suite ${suite.name} crashed: ${(error as Error).message}`);
        cases.push({
          suite: suite.name,
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
    // Explicit exit: every durable artifact (scorecard, step logs, case
    // screenshots) is on disk before main() returns and the stack stop is
    // bounded. A passive exitCode let lingering teardown handles — a
    // bounded-out browser close whose promise never settles — keep the
    // process alive indefinitely after the card was written (observed
    // 2026-10-19, a11y run: card at 15:29:57Z, runner still alive at 15:35Z,
    // recipe hung waiting on the child's exit).
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(`[run] fatal: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
