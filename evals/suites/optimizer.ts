/**
 * Optimizer suite — conditional-presence evaluation of the schedule
 * optimizer's benchmark.
 *
 * Every case first checks whether the TARGET checkout carries
 * frontend/src/lib/optimizer/bench/ (a runnable benchmark; run with bun or
 * node per its entrypoint). When the bench is absent — as on this branch's
 * head, before the integrated app lands it — each case is not-applicable and
 * names the missing path. When it is present, the suite runs it once per
 * invocation (results memoized across the three cases; the bench is
 * deterministic by contract: fixed --seed) and judges:
 *
 *   optimizer/violations-zero — hard-constraint violations = 0
 *   optimizer/gap-zero        — optimality gap = 0 on enumerable instances
 *   optimizer/p95-8courses    — solve-time p95 <= 500 ms at 8 courses
 *
 * Bar values come from evals/bars.json (suite "optimizer"). The harness
 * owns the statistics: p95 is computed here (nearest-rank, the routing
 * suite's convention) from the bench's raw solveTimesMs samples.
 *
 * The bench interface contract is documented in optdata-lib.ts. A bench
 * that exists but does not conform (no entrypoint, non-JSON output, missing
 * fields, wrong course count) is a FAIL — present-but-broken is an
 * application finding, distinct from absent (not-applicable).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";
import {
  artifactCommand,
  isDirectory,
  missingPathNote,
  parseJsonObjectFromProcess,
  parseBenchReport,
  percentileNearestRank,
  resolveTargetDir,
  round1,
  runCaptured,
} from "./optdata-lib";
import type { BenchReport } from "./optdata-lib";

const BENCH_REL = path.join("frontend", "src", "lib", "optimizer", "bench");
const BENCH_COURSES = 8;
const BENCH_SAMPLES = 20;
const BENCH_SEED = 0;
// bars.json suite "optimizer": "0 hard-constraint violations, optimality gap
// 0 on enumerable instances, p95 <=500ms at 8 courses".
const P95_BAR_MS = 500;
const BENCH_TIMEOUT_MS = 90_000;

type BenchExecution =
  | { kind: "ok"; report: BenchReport; evidencePath: string; invocation: string }
  | { kind: "error"; headline: string; detail: string; evidencePath: string | null };

let memoized: BenchExecution | undefined;

function writeEvidence(runDir: string, name: string, payload: unknown): string {
  mkdirSync(runDir, { recursive: true });
  const evidencePath = path.join(runDir, name);
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
  return evidencePath;
}

/** Run the target's bench once per runner invocation; cases share the result. */
async function benchExecution(ctx: SuiteContext, targetDir: string, benchDir: string): Promise<BenchExecution> {
  if (memoized !== undefined) return memoized;

  const command = artifactCommand(benchDir, ["--courses", String(BENCH_COURSES), "--samples", String(BENCH_SAMPLES), "--seed", String(BENCH_SEED), "--format", "json"], targetDir);
  if (!command.ok) {
    memoized = { kind: "error", headline: "bench present but not runnable", detail: command.reason, evidencePath: null };
    return memoized;
  }

  const run = await runCaptured({ cmd: command.cmd, args: command.args, cwd: command.cwd, timeoutMs: BENCH_TIMEOUT_MS });

  const payload = parseJsonObjectFromProcess(run.stdout);
  const parsed = payload ? parseBenchReport(payload) : undefined;
  const evidencePath = writeEvidence(ctx.runDir, "optdata-optimizer-bench-evidence.json", {
    what: "optimizer bench execution evidence",
    invocation: `${command.describe} --courses ${BENCH_COURSES} --samples ${BENCH_SAMPLES} --seed ${BENCH_SEED} --format json`,
    cwd: command.cwd,
    exitCode: run.code,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTail: run.stdout.slice(-20_000),
    stderrTail: run.stderr.slice(-20_000),
    parsed,
  });

  if (run.spawnError !== undefined) {
    memoized = { kind: "error", headline: "bench could not be spawned", detail: run.spawnError, evidencePath };
    return memoized;
  }
  if (run.timedOut) {
    memoized = { kind: "error", headline: `bench did not finish within ${BENCH_TIMEOUT_MS}ms`, detail: `stderr tail: ${run.stderr.slice(-400)}`, evidencePath };
    return memoized;
  }
  if (run.code !== 0) {
    memoized = { kind: "error", headline: `bench exited ${run.code ?? "with a signal"}`, detail: `stderr tail: ${run.stderr.slice(-400)}`, evidencePath };
    return memoized;
  }
  if (!parsed || !parsed.ok) {
    memoized = {
      kind: "error",
      headline: "bench output does not match the documented contract",
      detail: parsed ? parsed.problems.join("; ") : `stdout is not a JSON object: ${run.stdout.slice(0, 200)}`,
      evidencePath,
    };
    return memoized;
  }
  memoized = { kind: "ok", report: parsed.report, evidencePath, invocation: command.describe };
  return memoized;
}

function notApplicable(reason: string): CaseOutcome {
  return { status: "not-applicable", note: reason };
}

/**
 * Resolved (target, benchDir) for this run, or the not-applicable outcome
 * every case shares when the target or the bench is absent.
 */
function benchPresence(ctx: SuiteContext): { ok: true; targetDir: string; benchDir: string } | { ok: false; outcome: CaseOutcome } {
  const target = resolveTargetDir(ctx);
  if (!target.ok) return { ok: false, outcome: notApplicable(`${target.reason} (infrastructure, not an application result)`) };
  const benchDir = path.join(target.dir, BENCH_REL);
  if (!isDirectory(benchDir)) return { ok: false, outcome: notApplicable(missingPathNote(target.dir, BENCH_REL)) };
  return { ok: true, targetDir: target.dir, benchDir };
}

export default defineSuite({
  name: "optimizer",
  caseTimeoutMs: 120_000,

  describe: () => [
    { id: "violations-zero", title: "hard-constraint violations are zero" },
    { id: "gap-zero", title: "optimality gap is zero on enumerable instances" },
    { id: "p95-8courses", title: "solve-time p95 is within the bar at 8 courses" },
  ],

  run: async (caseId, ctx): Promise<CaseOutcome> => {
    const presence = benchPresence(ctx);
    if (!presence.ok) return presence.outcome;

    const execution = await benchExecution(ctx, presence.targetDir, presence.benchDir);
    if (execution.kind === "error") {
      return {
        status: "fail",
        bar: benchBarFor(caseId),
        evidencePath: execution.evidencePath ?? undefined,
        note: `${execution.headline}: ${execution.detail}`.slice(0, 400),
      };
    }

    const report = execution.report;
    switch (caseId) {
      case "violations-zero": {
        const zero = report.violations === 0 && report.violationSamples > 0;
        return {
          status: zero ? "pass" : "fail",
          measured: `violations=${report.violations} across ${report.violationSamples} instances`,
          bar: benchBarFor(caseId),
          evidencePath: execution.evidencePath,
          note:
            report.violations === 0
              ? report.violationSamples > 0
                ? `bench (${execution.invocation}) reports 0 hard-constraint violations across ${report.violationSamples} instances`
                : "bench reports no violation instances — nothing was checked"
              : `bench reports ${report.violations} hard-constraint violations across ${report.violationSamples} instances`,
        };
      }
      case "gap-zero": {
        const zero = report.gap === 0 && report.enumerableInstances > 0;
        return {
          status: zero ? "pass" : "fail",
          measured: `gap=${report.gap} across ${report.enumerableInstances} enumerable instances`,
          bar: benchBarFor(caseId),
          evidencePath: execution.evidencePath,
          note:
            report.gap === 0
              ? report.enumerableInstances > 0
                ? `bench (${execution.invocation}) reports optimality gap 0 across ${report.enumerableInstances} enumerable instances`
                : "bench reports no enumerable instances — optimality is unproven"
              : `bench reports optimality gap ${report.gap} on ${report.enumerableInstances} enumerable instances`,
        };
      }
      case "p95-8courses": {
        if (report.courses !== BENCH_COURSES) {
          return {
            status: "fail",
            measured: `bench ran at ${report.courses} courses, bar is defined at ${BENCH_COURSES}`,
            bar: benchBarFor(caseId),
            evidencePath: execution.evidencePath,
            note: `the bench ignored --courses ${BENCH_COURSES} or reported a different instance size; the p95 bar applies at ${BENCH_COURSES} courses`,
          };
        }
        const p95 = round1(percentileNearestRank(report.solveTimesMs, 95));
        const withinBar = p95 <= P95_BAR_MS;
        return {
          status: withinBar ? "pass" : "fail",
          measured: `p95=${p95}ms over ${report.solveTimesMs.length} solves at ${report.courses} courses`,
          bar: benchBarFor(caseId),
          evidencePath: execution.evidencePath,
          note: withinBar
            ? `solve-time p95 ${p95} ms vs bar ${P95_BAR_MS} ms; n=${report.solveTimesMs.length}, bench deterministic (seed ${BENCH_SEED})`
            : `solve-time p95 ${p95} ms exceeds the ${P95_BAR_MS} ms bar; n=${report.solveTimesMs.length}`,
        };
      }
      default:
        return { status: "not-applicable", note: `unknown case ${caseId}` };
    }
  },
});

function benchBarFor(caseId: string): string {
  switch (caseId) {
    case "violations-zero":
      return "hard-constraint violations = 0";
    case "gap-zero":
      return "optimality gap = 0 on enumerable instances";
    case "p95-8courses":
      return `solve-time p95 <= ${P95_BAR_MS} ms at ${BENCH_COURSES} courses`;
    default:
      return "bench conforms to the documented contract";
  }
}
