/**
 * The benchmark runner: one variant over the pinned suites on identical
 * seeds, validated by the independent checker and (on enumerable instances)
 * compared against the brute-force reference.
 *
 * Usage:
 *   cd frontend && bun run src/lib/optimizer/bench/run-bench.ts \
 *     --variant=./src/lib/optimizer/brute-force --suite=all --k=3 --repeat=5
 *
 * Per instance it records status, checker violation count, optimality gap
 * vs brute force and top-k agreement (enumerable instances only),
 * diversity, initMs/searchMs/wallMs (median and p95 across repeats; the
 * timed runs use the request's own time budget), and IIS validity for
 * infeasible results.
 *
 * Review hardening (PR #14 round-1 fix): EVERY repeat is validated — the
 * instance record keeps per-repeat evidence (repeatViolations,
 * repeatIIsValid, repeatWallMs, repeatSearchMs), aggregates violations as
 * the max over repeats and IIS validity as false-if-any-repeat-invalid. A
 * single invalid repeat flags the instance even when later repeats are
 * clean; nothing is silently replaced. Variant exceptions are classified
 * STRUCTURALLY (instanceof, never message matching): the typed
 * NonEnumerableRefusal (exported from ../brute-force) on a non-enumerable
 * instance is a skip with its reason; any other exception — including the
 * typed refusal on an enumerable instance — is a variant ERROR, recorded
 * per instance and in the run-level errorInstances, printed loudly, and
 * fails the run (non-zero exit) AFTER the JSON is written so errors appear
 * in committed results.
 *
 * The JSON output is deterministic apart from the timing numbers.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runChecker, verifyIis } from "../checker";
import * as bruteForce from "../brute-force";
import { suiteInstances } from "./instances";
import type { OptimizeRequest, OptimizeResult } from "../types";

export type VariantOptimize = (req: OptimizeRequest) => Promise<OptimizeResult>;

export type VariantErrorClass = "variant-error" | "refusal-on-enumerable";

/**
 * How a variant's exception is classified.
 * - skip: the variant legitimately refused a non-enumerable instance
 *   (typed NonEnumerableRefusal) — recorded as an expected skip.
 * - error: a variant defect (arbitrary exception, or the typed refusal
 *   thrown on an instance that IS enumerable) — recorded loudly and
 *   failing the run.
 */
export type VariantFailure =
  | { kind: "skip"; reason: string }
  | { kind: "error"; errorClass: VariantErrorClass; message: string };

/** Structural classification of a variant exception — never message matching. */
export function classifyVariantFailure(error: unknown, enumerable: boolean): VariantFailure {
  if (error instanceof bruteForce.NonEnumerableRefusal) {
    if (!enumerable) {
      return {
        kind: "skip",
        reason: `variant refused non-enumerable instance (candidate-product ${error.productSize} exceeds the reference bound)`,
      };
    }
    return {
      kind: "error",
      errorClass: "refusal-on-enumerable",
      message: `variant refused an ENUMERABLE instance (candidate-product ${error.productSize}) — inconsistent enumerability bound`,
    };
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { kind: "error", errorClass: "variant-error", message };
}

/** Evidence from one repeat that ran to completion. */
export interface RepeatOutcome {
  status: string;
  initMs: number;
  searchMs: number;
  wallMs: number;
  /** runChecker violations for THIS repeat (0 = clean). */
  violations: number;
  /** null unless this repeat returned 'infeasible'; false when its IIS is absent or invalid. */
  iisValid: boolean | null;
}

/** Aggregated outcome over all repeats for one instance. */
export interface InstanceOutcome {
  /** Union of statuses over the repeats that ran. */
  statuses: string[];
  repeatsRan: number;
  repeatsSkipped: number;
  repeatsErrored: number;
  /** MAX runChecker violations over the ran repeats; null when none ran. */
  violations: number | null;
  /** Per-ran-repeat violation counts — a single invalid repeat stays visible. */
  repeatViolations: number[];
  /** false if ANY repeat's IIS is absent/invalid; true if at least one infeasible result was verified; null otherwise. */
  iisValid: boolean | null;
  repeatIIsValid: (boolean | null)[];
  optimalityGap: number | null;
  topKAgreement: number | null;
  diversity: number | null;
  initMsP50: number | null;
  initMsP95: number | null;
  searchMsP50: number | null;
  searchMsP95: number | null;
  wallMsP50: number | null;
  wallMsP95: number | null;
  /** Raw per-repeat wall/search measurements (pooled for size-class aggregates). */
  repeatWallMs: number[];
  repeatSearchMs: number[];
  /** Set when every observed repeat was an expected enumerability skip. */
  skipReason: string | null;
  /** Set when at least one repeat failed with a variant defect. */
  errorClass: VariantErrorClass | null;
  errorMessage: string | null;
}

/** Nearest-rank percentile over a copy of the values. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const p50 = (values: number[]): number | null => percentile(values, 0.5);
const p95 = (values: number[]): number | null => percentile(values, 0.95);

/**
 * Runs one instance `repeat` times against `optimize`, validating EVERY
 * repeat with the independent checker (and IIS verification for infeasible
 * results), and compares the last ran result against the brute-force
 * reference on enumerable instances. Exceptions are classified
 * structurally; every repeat's evidence is kept.
 */
export async function benchmarkInstance(
  optimize: VariantOptimize,
  req: OptimizeRequest,
  opts: { enumerable: boolean; repeat: number; reference?: VariantOptimize },
): Promise<InstanceOutcome> {
  const { enumerable, repeat } = opts;
  const reference = opts.reference ?? bruteForce.optimize;

  const outcomes: RepeatOutcome[] = [];
  let skips = 0;
  let errors = 0;
  let skipReason: string | null = null;
  let errorClass: VariantErrorClass | null = null;
  let errorMessage: string | null = null;
  let lastResult: OptimizeResult | null = null;

  for (let r = 0; r < repeat; r++) {
    const t0 = performance.now();
    let result: OptimizeResult;
    try {
      result = await optimize(req);
    } catch (error) {
      const failure = classifyVariantFailure(error, enumerable);
      if (failure.kind === "skip") {
        skips += 1;
        skipReason = failure.reason;
      } else {
        errors += 1;
        errorClass = failure.errorClass;
        errorMessage = failure.message;
      }
      continue; // every repeat is observed; later repeats still run
    }
    const wallMs = performance.now() - t0;
    lastResult = result;

    const violations = runChecker(req, result).length;
    let iisValid: boolean | null = null;
    if (result.status === "infeasible") {
      if (!result.infeasibleSubset) {
        iisValid = false; // status plausibility: infeasible requires the subset
      } else {
        const verdict = verifyIis(req, result.infeasibleSubset);
        iisValid = verdict.subsetInfeasible && verdict.allSingleRemovalsFeasible;
      }
    }
    outcomes.push({
      status: result.status,
      initMs: result.initMs,
      searchMs: result.searchMs,
      wallMs,
      violations,
      iisValid,
    });
  }

  const repeatViolations = outcomes.map((o) => o.violations);
  const repeatIIsValid = outcomes.map((o) => o.iisValid);
  let iisValid: boolean | null = null;
  if (repeatIIsValid.some((v) => v === false)) iisValid = false;
  else if (repeatIIsValid.some((v) => v === true)) iisValid = true;

  let optimalityGap: number | null = null;
  let topKAgreement: number | null = null;
  if (enumerable && errors === 0 && skips === 0 && lastResult) {
    const ref = await reference(req);
    const variantBest = lastResult.schedules[0]?.breakdown.cost;
    const referenceBest = ref.schedules[0]?.breakdown.cost;
    if (variantBest !== undefined && referenceBest !== undefined) optimalityGap = variantBest - referenceBest;
    const variantKeys = new Set(lastResult.schedules.map((s) => s.sectionIds.join(",")));
    const referenceKeys = new Set(ref.schedules.map((s) => s.sectionIds.join(",")));
    if (variantKeys.size === 0 && referenceKeys.size === 0) {
      topKAgreement = 1; // both proved infeasible: full agreement
    } else {
      let shared = 0;
      for (const key of variantKeys) if (referenceKeys.has(key)) shared += 1;
      topKAgreement = shared / req.k;
    }
  }

  const wallValues = outcomes.map((o) => o.wallMs);
  return {
    statuses: [...new Set(outcomes.map((o) => o.status))],
    repeatsRan: outcomes.length,
    repeatsSkipped: skips,
    repeatsErrored: errors,
    violations: outcomes.length > 0 ? Math.max(...repeatViolations) : null,
    repeatViolations,
    iisValid,
    repeatIIsValid,
    optimalityGap,
    topKAgreement,
    diversity: lastResult ? lastResult.diversity : null,
    initMsP50: p50(outcomes.map((o) => o.initMs)),
    initMsP95: p95(outcomes.map((o) => o.initMs)),
    searchMsP50: p50(outcomes.map((o) => o.searchMs)),
    searchMsP95: p95(outcomes.map((o) => o.searchMs)),
    wallMsP50: p50(wallValues),
    wallMsP95: p95(wallValues),
    repeatWallMs: wallValues,
    repeatSearchMs: outcomes.map((o) => o.searchMs),
    skipReason,
    errorClass,
    errorMessage,
  };
}

const fmt = (value: number | null): string => (value === null ? "-" : String(Math.round(value * 100) / 100));
const fmtGap = (value: number | null): string => (value === null ? "-" : String(value));

interface InstanceRecord extends InstanceOutcome {
  name: string;
  suite: string;
  sizeClass: string;
  enumerable: boolean;
}

async function main(): Promise<void> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`run-bench: expected --key=value arguments, got ${JSON.stringify(arg)}`);
    args[match[1]] = match[2];
  }
  const variantArg = args.variant ?? "./src/lib/optimizer/brute-force";
  const suiteArg = args.suite ?? "all";
  const kRaw = args.k ? Number(args.k) : undefined;
  const repeat = args.repeat ? Number(args.repeat) : 5;
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`run-bench: --repeat must be a positive integer, got ${repeat}`);
  if (kRaw !== undefined && (!Number.isInteger(kRaw) || kRaw < 1)) throw new Error(`run-bench: --k must be a positive integer, got ${kRaw}`);

  const variantPath = resolve(variantArg);
  const variantModule = (await import(pathToFileURL(variantPath).href)) as { optimize?: VariantOptimize };
  if (typeof variantModule.optimize !== "function") {
    throw new Error(`run-bench: the variant module ${variantArg} does not export optimize(req): Promise<OptimizeResult>`);
  }
  const optimize = variantModule.optimize;

  const instances = suiteInstances(suiteArg);
  const records: InstanceRecord[] = [];

  for (const instance of instances) {
    const req: OptimizeRequest = kRaw === undefined ? instance.req : { ...instance.req, k: kRaw };
    const outcome = await benchmarkInstance(optimize, req, { enumerable: instance.enumerable, repeat });
    records.push({ name: instance.name, suite: instance.suite, sizeClass: instance.sizeClass, enumerable: instance.enumerable, ...outcome });
  }

  const sizeSummary = [...new Set(records.map((r) => r.sizeClass))]
    .sort()
    .map((sizeClass) => {
      const rows = records.filter((r) => r.sizeClass === sizeClass);
      const wall = rows.flatMap((r) => r.repeatWallMs);
      const search = rows.flatMap((r) => r.repeatSearchMs);
      return {
        sizeClass,
        repeats: wall.length,
        wallMsP50: p50(wall),
        wallMsP95: p95(wall),
        searchMsP50: p50(search),
        searchMsP95: p95(search),
      };
    });

  const errorInstances = records.filter((r) => r.errorClass !== null).map((r) => r.name);
  const runFailed = errorInstances.length > 0;

  const report = {
    variant: basename(variantArg),
    suite: suiteArg,
    k: kRaw ?? 3,
    repeat,
    runFailed,
    errorInstances,
    instances: records,
    sizeSummary,
  };

  console.log("### Per-instance results");
  console.log("");
  console.log("| instance | suite | size | status | ran/skip/err | chk | iis | gap | top-k | div | init p50/p95 | search p50/p95 | wall p50/p95 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const record of records) {
    const chk = record.repeatViolations.length > 0 ? `${record.violations} [${record.repeatViolations.join(",")}]` : "-";
    console.log(
      `| ${record.name} | ${record.suite} | ${record.sizeClass} | ${record.statuses.join("|") || "-"} ` +
        `| ${record.repeatsRan}/${record.repeatsSkipped}/${record.repeatsErrored} ` +
        `| ${chk} | ${record.iisValid === null ? "-" : record.iisValid ? "ok" : "INVALID"} ` +
        `| ${fmtGap(record.optimalityGap)} | ${record.topKAgreement === null ? "-" : record.topKAgreement.toFixed(3)} ` +
        `| ${record.diversity === null ? "-" : record.diversity.toFixed(3)} ` +
        `| ${fmt(record.initMsP50)}/${fmt(record.initMsP95)} | ${fmt(record.searchMsP50)}/${fmt(record.searchMsP95)} ` +
        `| ${fmt(record.wallMsP50)}/${fmt(record.wallMsP95)} |`,
    );
  }
  console.log("");
  console.log("### Per-size-class latency (ms, pooled repeats)");
  console.log("");
  console.log("| class | repeats | wall p50 | wall p95 | search p50 | search p95 |");
  console.log("|---|---|---|---|---|---|");
  for (const row of sizeSummary) {
    console.log(`| ${row.sizeClass} | ${row.repeats} | ${fmt(row.wallMsP50)} | ${fmt(row.wallMsP95)} | ${fmt(row.searchMsP50)} | ${fmt(row.searchMsP95)} |`);
  }

  const resultsDir = resolve(import.meta.dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const outPath = resolve(resultsDir, `${basename(variantArg)}-${suiteArg}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log("");
  console.log(`Wrote ${outPath}`);

  if (runFailed) {
    console.error("");
    console.error(`RUN FAILED — variant errors on ${errorInstances.length} instance(s): ${errorInstances.join(", ")}`);
    for (const record of records) {
      if (record.errorClass !== null) {
        console.error(`  [${record.errorClass}] ${record.name}: ${record.errorMessage ?? "unknown error"}`);
      }
    }
    console.error("The JSON report was still written; committed results must include this failure.");
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
