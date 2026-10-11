/**
 * Optimizer suite — conditional-presence evaluation of the schedule
 * optimizer's benchmark.
 *
 * Every case first checks whether the TARGET checkout carries
 * frontend/src/lib/optimizer/bench/. When it is absent — as on this
 * branch's head, before the integrated app lands it — each case is
 * not-applicable and names the missing path.
 *
 * When the bench is present, the suite drives ITS interface, derived from
 * the bench's own code at run time (its package.json scripts, then its
 * entrypoint files; no arguments are prescribed — see _optdata-lib.ts). The
 * bench runs once per runner invocation with its own defaults (results
 * memoized across the three cases) and its output is recorded verbatim.
 * The suite then judges only what the bench itself reports:
 *
 *   optimizer/violations-zero — a reported violations count that is 0
 *   optimizer/gap-zero        — a reported optimality gap that is 0
 *   optimizer/p95-8courses    — reported solve-time p95 within the 500 ms
 *                               bar when the bench reports an 8-course run
 *
 * Bar values come from evals/bars.json (suite "optimizer"). Output whose
 * shape exposes no recognizable measurements is NOT-APPLICABLE with the
 * reason and the verbatim evidence path — the harness never fails a bench
 * for not matching a schema it never agreed to. Run-level failures (spawn
 * error, timeout, non-zero exit) remain application findings and fail.
 */

import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";
import {
  artifactCommand,
  interpretBenchOutput,
  isDirectory,
  missingPathNote,
  parseJsonObjectFromProcess,
  percentileNearestRank,
  resolveTargetDir,
  round1,
  runCaptured,
  writeEvidence,
} from "./_optdata-lib";
import type { BenchMeasurements } from "./_optdata-lib";

const BENCH_REL = path.join("frontend", "src", "lib", "optimizer", "bench");
// bars.json suite "optimizer": "0 hard-constraint violations, optimality gap
// 0 on enumerable instances, p95 <=500ms at 8 courses".
const BAR_COURSES = 8;
const P95_BAR_MS = 500;
const BENCH_TIMEOUT_MS = 120_000;

/**
 * One bench observation shared by all three cases per runner invocation:
 * the bench's real interface is derived at run time and its output is
 * recorded verbatim; interpretation happens per case.
 */
type BenchObservation =
  | { kind: "ok"; measurements: BenchMeasurements; evidencePath: string; invocation: string }
  | { kind: "no-json"; evidencePath: string; invocation: string; stdoutHead: string }
  | { kind: "run-failed"; headline: string; detail: string; evidencePath: string | null };

let memoized: BenchObservation | undefined;

/** Run the target's bench once per runner invocation; cases share the result. */
async function benchObservation(ctx: SuiteContext, benchDir: string): Promise<BenchObservation> {
  if (memoized !== undefined) return memoized;

  const command = artifactCommand(benchDir);
  if (!command.ok) {
    memoized = { kind: "run-failed", headline: "bench present but not runnable", detail: command.reason, evidencePath: null };
    return memoized;
  }

  const run = await runCaptured({ cmd: command.cmd, args: command.args, cwd: command.cwd, timeoutMs: BENCH_TIMEOUT_MS });
  const payload = parseJsonObjectFromProcess(run.stdout);
  const measurements = payload ? interpretBenchOutput(payload) : undefined;
  const evidencePath = writeEvidence(ctx.runDir, "optdata-optimizer-bench-evidence.json", {
    what: "optimizer bench execution evidence (output recorded verbatim; interpretation is best-effort recognition)",
    invocation: command.describe,
    invocationSource: command.source,
    cwd: command.cwd,
    args: command.args,
    exitCode: run.code,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTail: run.stdout.slice(-20_000),
    stderrTail: run.stderr.slice(-20_000),
    reportedNumericFields: measurements?.numericFields ?? null,
    reportedNonNumericFields: measurements?.nonNumericFields ?? null,
    recognizedMeasurements: measurements ?? null,
  });

  if (run.spawnError !== undefined) {
    memoized = { kind: "run-failed", headline: "bench could not be spawned", detail: run.spawnError, evidencePath };
    return memoized;
  }
  if (run.timedOut) {
    memoized = { kind: "run-failed", headline: `bench did not finish within ${BENCH_TIMEOUT_MS}ms`, detail: `stderr tail: ${run.stderr.slice(-400)}`, evidencePath };
    return memoized;
  }
  if (run.code !== 0) {
    memoized = { kind: "run-failed", headline: `bench exited ${run.code ?? "with a signal"}`, detail: `stderr tail: ${run.stderr.slice(-400)}`, evidencePath };
    return memoized;
  }
  if (!measurements) {
    memoized = { kind: "no-json", evidencePath, invocation: command.describe, stdoutHead: run.stdout.slice(0, 200) };
    return memoized;
  }
  memoized = { kind: "ok", measurements, evidencePath, invocation: command.describe };
  return memoized;
}

function notApplicable(reason: string): CaseOutcome {
  return { status: "not-applicable", note: reason };
}

/**
 * Resolved (target, benchDir) for this run, or the not-applicable outcome
 * every case shares when the target or the bench is absent.
 */
function benchPresence(ctx: SuiteContext): { ok: true; benchDir: string } | { ok: false; outcome: CaseOutcome } {
  const target = resolveTargetDir(ctx);
  if (!target.ok) return { ok: false, outcome: notApplicable(`${target.reason} (infrastructure, not an application result)`) };
  const benchDir = path.join(target.dir, BENCH_REL);
  if (!isDirectory(benchDir)) return { ok: false, outcome: notApplicable(missingPathNote(target.dir, BENCH_REL)) };
  return { ok: true, benchDir };
}

function benchBarFor(caseId: string): string {
  switch (caseId) {
    case "violations-zero":
      return "hard-constraint violations = 0";
    case "gap-zero":
      return "optimality gap = 0 on enumerable instances";
    case "p95-8courses":
      return `solve-time p95 <= ${P95_BAR_MS} ms at ${BAR_COURSES} courses`;
    default:
      return "bench reports results consistent with the bars";
  }
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

    const observation = await benchObservation(ctx, presence.benchDir);
    if (observation.kind === "run-failed") {
      return {
        status: "fail",
        bar: benchBarFor(caseId),
        evidencePath: observation.evidencePath ?? undefined,
        note: `${observation.headline}: ${observation.detail}`.slice(0, 400),
      };
    }
    if (observation.kind === "no-json") {
      return notApplicable(
        `the bench ran (${observation.invocation}) but printed no JSON object its output could be read from (stdout head: ${observation.stdoutHead}); full output recorded verbatim at ${observation.evidencePath} — no measurement could be recognized`,
      );
    }

    const m = observation.measurements;
    switch (caseId) {
      case "violations-zero": {
        if (m.violations === null) {
          return notApplicable(
            `the bench's output exposes no recognizable violations count (looked for: violations/hardConstraintViolations/violationCount/hardViolations); reported numeric fields recorded verbatim at ${observation.evidencePath}`,
          );
        }
        const samples = m.violationSamples === null ? "instance count not reported" : `across ${m.violationSamples} instances`;
        const zero = m.violations === 0 && (m.violationSamples === null || m.violationSamples > 0);
        return {
          status: zero ? "pass" : "fail",
          measured: `violations=${m.violations} ${samples}`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note:
            m.violations === 0
              ? m.violationSamples === null
                ? `bench (${observation.invocation}) reports 0 hard-constraint violations; it did not report how many instances were checked`
                : `bench (${observation.invocation}) reports 0 hard-constraint violations across ${m.violationSamples} instances`
              : `bench reports ${m.violations} hard-constraint violations ${samples}`,
        };
      }
      case "gap-zero": {
        if (m.gap === null) {
          return notApplicable(
            `the bench's output exposes no recognizable optimality gap (looked for: gap/optimalityGap/optimalityGapRatio/gapRatio); reported numeric fields recorded verbatim at ${observation.evidencePath}`,
          );
        }
        const instances = m.gapInstances === null ? "instance count not reported" : `on ${m.gapInstances} enumerable instances`;
        const zero = m.gap === 0 && (m.gapInstances === null || m.gapInstances > 0);
        return {
          status: zero ? "pass" : "fail",
          measured: `gap=${m.gap} ${instances}`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note:
            m.gap === 0
              ? m.gapInstances === null
                ? `bench (${observation.invocation}) reports optimality gap 0; it did not report how many enumerable instances were checked`
                : `bench (${observation.invocation}) reports optimality gap 0 on ${m.gapInstances} enumerable instances`
              : `bench reports optimality gap ${m.gap} ${instances}`,
        };
      }
      case "p95-8courses": {
        if (m.courses !== null && m.courses !== BAR_COURSES) {
          return notApplicable(
            `the bench's default run exercised ${m.courses} courses (reported); the bar is defined at ${BAR_COURSES} courses and cannot be asserted from this run (output recorded verbatim at ${observation.evidencePath})`,
          );
        }
        const p95 =
          m.reportedP95Ms ?? (m.solveTimesMs !== null ? round1(percentileNearestRank(m.solveTimesMs, 95)) : null);
        if (p95 === null) {
          return notApplicable(
            `the bench's output exposes no recognizable solve-time data (looked for: p95Ms/p95 or a solveTimes array); reported numeric fields recorded verbatim at ${observation.evidencePath}`,
          );
        }
        const overBar = p95 > P95_BAR_MS;
        if (overBar) {
          return {
            status: "fail",
            measured: `p95=${p95}ms${m.courses === null ? "" : ` at ${m.courses} courses`}`,
            bar: benchBarFor(caseId),
            evidencePath: observation.evidencePath,
            note:
              `solve-time p95 ${p95} ms exceeds the ${P95_BAR_MS} ms bar` +
              (m.courses === null ? " (the bench did not report the instance size, so this holds regardless of course count)" : ` at ${m.courses} courses`),
          };
        }
        if (m.courses === null) {
          return notApplicable(
            `the bench reports solve-time p95 ${p95} ms (within the ${P95_BAR_MS} ms bar) but no course count, so the bar's at-${BAR_COURSES}-courses condition cannot be confirmed (output recorded verbatim at ${observation.evidencePath})`,
          );
        }
        return {
          status: "pass",
          measured: `p95=${p95}ms at ${m.courses} courses${m.solveTimesMs === null ? "" : ` (n=${m.solveTimesMs.length} solves)`}`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note: `bench (${observation.invocation}) reports solve-time p95 ${p95} ms vs bar ${P95_BAR_MS} ms at ${m.courses} courses${m.solveTimesMs === null ? "" : `; n=${m.solveTimesMs.length}`}`,
        };
      }
      default:
        return notApplicable(`unknown case ${caseId}`);
    }
  },
});
