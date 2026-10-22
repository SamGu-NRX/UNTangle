/**
 * Optimizer suite — evaluation of the schedule optimizer's benchmark.
 *
 * The adapter drives the TARGET's REAL bench with the REAL CLI (decision
 * 685c; the invocation is the bench's own, read at the PR #14 head that
 * introduced run-bench.ts):
 *
 *   cd frontend && bun run src/lib/optimizer/bench/run-bench.ts \
 *     --variant=./src/lib/optimizer/brute-force --suite=all --k=3 --repeat=3
 *
 * The bench runs once per runner invocation (memoized across the three
 * cases) and writes its report to
 * frontend/src/lib/optimizer/bench/results/brute-force-all.json
 * (<variant-basename>-<suite>.json next to the runner itself). The suite
 * parses that report — { variant, suite, k, repeat, instances: [...],
 * sizeSummary: [...] } with per-instance checker `violations`,
 * brute-force-compared `optimalityGap`, and `wallMsP95` — and judges:
 *
 *   optimizer/violations-zero — every instance's checker violations count
 *                               is 0 (the checker is the bench's independent
 *                               rule re-implementation)
 *   optimizer/gap-zero        — every enumerable, non-skipped instance's
 *                               optimality gap vs brute force is 0
 *   optimizer/p95-8courses    — the pinned 8-course family's
 *                               (worst-case-xl) wallMsP95 within the 500 ms
 *                               bar
 *
 * Not-applicable is reserved for ABSENT target files (decision 685c) and,
 * at the case layer, for measurements the run genuinely did not produce
 * (every skipped non-enumerable instance under brute force, an infeasible
 * instance's no-cost gap, a skipped or missing pinned 8-course family —
 * each named for what it is). A bench that exists but exits nonzero, times
 * out, or writes a missing/unparseable/foreign-shaped results file FAILS.
 *
 * Bar values come from evals/bars.json (suite "optimizer").
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";
import {
  benchCommand,
  BENCH_RESULTS_FILE_REL,
  BENCH_RUN_REL,
  isRegularFile,
  missingPathNote,
  parseBenchReport,
  resolveTargetDir,
  roundNumber,
  runCaptured,
  summarizeBenchReport,
  writeEvidence,
  XL_INSTANCE_NAME,
} from "./_optdata-lib";
import type { BenchReportSummary } from "./_optdata-lib";

// bars.json suite "optimizer": "0 hard-constraint violations, optimality gap
// 0 on enumerable instances, p95 <=500ms at 8 courses".
const P95_BAR_MS = 500;
const BAR_COURSES = 8;
const BENCH_TIMEOUT_MS = 120_000;
// The bench run is memoized once per runner invocation and may consume most
// of one case's budget; the case cap leaves headroom above the step cap.
export const OPTIMIZER_CASE_TIMEOUT_MS = 180_000;

/**
 * One bench observation shared by all three cases per runner invocation:
 * the prescribed invocation, the real report file, verbatim evidence.
 */
type BenchObservation =
  | { kind: "ok"; summary: BenchReportSummary; evidencePath: string; invocation: string; resultsPath: string }
  | { kind: "run-failed"; headline: string; detail: string; evidencePath: string | null }
  | { kind: "unparseable"; headline: string; detail: string; evidencePath: string };

let memoized: BenchObservation | undefined;

/** Run the target's bench once per runner invocation; cases share the result. */
async function benchObservation(ctx: SuiteContext, targetDir: string): Promise<BenchObservation> {
  if (memoized !== undefined) return memoized;

  const command = benchCommand(targetDir);
  const run = await runCaptured({
    cmd: command.cmd,
    args: command.args,
    cwd: command.cwd,
    timeoutMs: BENCH_TIMEOUT_MS,
    signal: ctx.signal,
  });

  if (run.aborted) {
    // Memoized like any other failed run, so the next optimizer case does not
    // start another full bench after the runner has already given up on one.
    memoized = {
      kind: "run-failed",
      headline: "bench was killed when the runner cancelled its timed-out case",
      detail: `stderr tail: ${run.stderr.slice(-400)}`,
      evidencePath: null,
    };
    return memoized;
  }
  if (run.spawnError !== undefined) {
    memoized = { kind: "run-failed", headline: "bench could not be spawned", detail: run.spawnError, evidencePath: null };
    return memoized;
  }
  if (run.timedOut) {
    memoized = {
      kind: "run-failed",
      headline: `bench did not finish within ${BENCH_TIMEOUT_MS}ms`,
      detail: `stderr tail: ${run.stderr.slice(-400)}`,
      evidencePath: null,
    };
    return memoized;
  }
  if (run.code !== 0) {
    memoized = {
      kind: "run-failed",
      headline: `bench exited ${run.code ?? "with a signal"}`,
      detail: `stderr tail: ${run.stderr.slice(-400)}`,
      evidencePath: null,
    };
    return memoized;
  }

  const resultsPath = path.join(targetDir, BENCH_RESULTS_FILE_REL);
  let resultsText: string | null = null;
  try {
    resultsText = readFileSync(resultsPath, "utf8");
  } catch {
    resultsText = null;
  }
  if (resultsText === null) {
    memoized = {
      kind: "unparseable",
      headline: "bench exited 0 but wrote no readable results file",
      detail: `expected ${resultsPath} (the bench writes <variant-basename>-<suite>.json next to itself)`,
      evidencePath: writeBenchEvidence(ctx, command, run, resultsPath, null),
    };
    return memoized;
  }
  const parsed = parseBenchReport(resultsText);
  if (!parsed.ok) {
    memoized = {
      kind: "unparseable",
      headline: "bench results file is unparseable or not the run-bench.ts report shape",
      detail: parsed.reason,
      evidencePath: writeBenchEvidence(ctx, command, run, resultsPath, null),
    };
    return memoized;
  }
  const summary = summarizeBenchReport(parsed.instances);
  memoized = {
    kind: "ok",
    summary,
    evidencePath: writeBenchEvidence(ctx, command, run, resultsPath, parsed.report),
    invocation: command.describe,
    resultsPath,
  };
  return memoized;
}

function writeBenchEvidence(
  ctx: SuiteContext,
  command: { describe: string; cwd: string },
  run: { code: number | null; timedOut: boolean; durationMs: number; stdout: string; stderr: string },
  resultsPath: string | null,
  report: Record<string, unknown> | null,
): string {
  return writeEvidence(ctx.runDir, "optdata-optimizer-bench-evidence.json", {
    what: "optimizer bench execution evidence (decision 685c: the real run-bench.ts, its real CLI, its real report file)",
    invocation: command.describe,
    cwd: command.cwd,
    exitCode: run.code,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTail: run.stdout.slice(-20_000),
    stderrTail: run.stderr.slice(-20_000),
    resultsFile: resultsPath,
    reportParsed: report !== null,
    report,
  });
}

function notApplicable(reason: string): CaseOutcome {
  return { status: "not-applicable", note: reason };
}

/** Resolved target for this run, or the not-applicable outcome every case shares when the bench is absent. */
function benchPresence(ctx: SuiteContext): { ok: true; targetDir: string } | { ok: false; outcome: CaseOutcome } {
  const target = resolveTargetDir(ctx);
  if (!target.ok) return { ok: false, outcome: notApplicable(`${target.reason} (infrastructure, not an application result)`) };
  const benchPath = path.join(target.dir, BENCH_RUN_REL);
  // Not-applicable ONLY when the target file is absent (decision 685c).
  if (!isRegularFile(benchPath)) return { ok: false, outcome: notApplicable(missingPathNote(target.dir, BENCH_RUN_REL)) };
  return { ok: true, targetDir: target.dir };
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
  caseTimeoutMs: OPTIMIZER_CASE_TIMEOUT_MS,

  describe: () => [
    { id: "violations-zero", title: "hard-constraint violations are zero" },
    { id: "gap-zero", title: "optimality gap is zero on enumerable instances" },
    { id: "p95-8courses", title: "solve-time p95 is within the bar at 8 courses" },
  ],

  run: async (caseId, ctx): Promise<CaseOutcome> => {
    const presence = benchPresence(ctx);
    if (!presence.ok) return presence.outcome;

    const observation = await benchObservation(ctx, presence.targetDir);
    if (observation.kind === "run-failed") {
      return {
        status: "fail",
        bar: benchBarFor(caseId),
        evidencePath: observation.evidencePath ?? undefined,
        note: `${observation.headline}: ${observation.detail}`.slice(0, 400),
      };
    }
    if (observation.kind === "unparseable") {
      return {
        status: "fail",
        bar: benchBarFor(caseId),
        evidencePath: observation.evidencePath,
        note: `${observation.headline}: ${observation.detail}`.slice(0, 400),
      };
    }

    const s = observation.summary;
    const skippedNote = s.skipped.length === 0 ? "" : ` (${s.skipped.length} skipped: ${s.skipped.map((k) => k.name).join(", ")})`;
    switch (caseId) {
      case "violations-zero": {
        if (s.violationsChecked === 0) {
          return notApplicable(
            `the bench ran (${observation.invocation}) but no instance record carries a checker violations count (results: ${observation.resultsPath}; evidence: ${observation.evidencePath})`,
          );
        }
        if (s.violationsBreaches.length > 0) {
          return {
            status: "fail",
            measured: `violations=${s.violationsMax} across ${s.violationsChecked} checked instances${skippedNote}`,
            bar: benchBarFor(caseId),
            evidencePath: observation.evidencePath,
            note: `bench reports ${s.violationsMax} hard-constraint violations across ${s.violationsChecked} checked instances (breaches: ${s.violationsBreaches.join(", ")})`,
          };
        }
        return {
          status: "pass",
          measured: `violations=${s.violationsMax ?? 0} across ${s.violationsChecked} checked instances${skippedNote}`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note: `bench (${observation.invocation}) reports 0 hard-constraint violations across ${s.violationsChecked} checked instances${skippedNote}`,
        };
      }
      case "gap-zero": {
        if (s.gapChecked === 0) {
          return notApplicable(
            `the bench ran (${observation.invocation}) but no enumerable, non-skipped instance carries a comparable optimality gap (${s.gapUnjudged} enumerable instances reported no comparable cost; results: ${observation.resultsPath}; evidence: ${observation.evidencePath})`,
          );
        }
        if (s.gapBreaches.length > 0) {
          return {
            status: "fail",
            measured: `gap=${s.gapMax} on ${s.gapChecked} enumerable instances (${s.gapUnjudged} without a comparable cost)`,
            bar: benchBarFor(caseId),
            evidencePath: observation.evidencePath,
            note: `bench reports nonzero optimality gap vs brute force (breaches: ${s.gapBreaches.join(", ")})`,
          };
        }
        return {
          status: "pass",
          measured: `gap=${s.gapMax ?? 0} on ${s.gapChecked} enumerable instances (${s.gapUnjudged} without a comparable cost)`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note: `bench (${observation.invocation}) reports optimality gap 0 on ${s.gapChecked} enumerable instances${s.gapUnjudged > 0 ? `; ${s.gapUnjudged} further instances reported no comparable cost` : ""}`,
        };
      }
      case "p95-8courses": {
        if (!s.xlRecordPresent) {
          return notApplicable(
            `the bench's report (${observation.resultsPath}) carries no ${XL_INSTANCE_NAME} record — the pinned ${BAR_COURSES}-course family — so the bar cannot be judged from this run (evidence: ${observation.evidencePath})`,
          );
        }
        if (s.xlSkipReason !== null) {
          return notApplicable(
            `the bench skipped ${XL_INSTANCE_NAME} (the pinned ${BAR_COURSES}-course family): "${s.xlSkipReason}" — the bar's solve-time p95 cannot be measured from this run (evidence: ${observation.evidencePath})`,
          );
        }
        if (s.xlWallMsP95 === null) {
          return notApplicable(
            `the ${XL_INSTANCE_NAME} record carries no numeric wallMsP95, so the bar's solve-time p95 cannot be judged (results: ${observation.resultsPath}; evidence: ${observation.evidencePath})`,
          );
        }
        const p95 = roundNumber(s.xlWallMsP95);
        if (p95 > P95_BAR_MS) {
          return {
            status: "fail",
            measured: `p95=${p95}ms at ${BAR_COURSES} courses (${XL_INSTANCE_NAME})`,
            bar: benchBarFor(caseId),
            evidencePath: observation.evidencePath,
            note: `solve-time p95 ${p95} ms exceeds the ${P95_BAR_MS} ms bar at ${BAR_COURSES} courses (${XL_INSTANCE_NAME}'s own wallMsP95)`,
          };
        }
        return {
          status: "pass",
          measured: `p95=${p95}ms at ${BAR_COURSES} courses (${XL_INSTANCE_NAME})`,
          bar: benchBarFor(caseId),
          evidencePath: observation.evidencePath,
          note: `bench (${observation.invocation}) reports solve-time p95 ${p95} ms vs bar ${P95_BAR_MS} ms at ${BAR_COURSES} courses (${XL_INSTANCE_NAME}'s own wallMsP95)`,
        };
      }
      default:
        return notApplicable(`unknown case ${caseId}`);
    }
  },
});
