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
 * infeasible results. It prints a markdown table, aggregates p50/p95
 * latency per instance-size class, and writes JSON to
 * bench/results/<variant>-<suite>.json. Every output is deterministic
 * apart from the timing numbers.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runChecker, verifyIis } from "../checker";
import * as bruteForce from "../brute-force";
import { suiteInstances } from "./instances";
import type { OptimizeRequest, OptimizeResult } from "../types";

interface VariantModule {
  optimize: (req: OptimizeRequest) => Promise<OptimizeResult>;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`run-bench: expected --key=value arguments, got ${JSON.stringify(arg)}`);
    args[match[1]] = match[2];
  }
  return args;
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
const fmt = (value: number | null): string => (value === null ? "-" : String(Math.round(value * 100) / 100));
const fmtGap = (value: number | null): string => (value === null ? "-" : String(value));

interface RepeatTiming {
  status: string;
  initMs: number;
  searchMs: number;
  wallMs: number;
}

interface InstanceRecord {
  name: string;
  suite: string;
  sizeClass: string;
  enumerable: boolean;
  statuses: string;
  /** Max checker violations across repeats (0 = clean). */
  violations: number | null;
  iisValid: boolean | null;
  optimalityGap: number | null;
  topKAgreement: number | null;
  diversity: number | null;
  initMsP50: number | null;
  initMsP95: number | null;
  searchMsP50: number | null;
  searchMsP95: number | null;
  wallMsP50: number | null;
  wallMsP95: number | null;
  skipped?: string;
}

const args = parseArgs(process.argv.slice(2));
const variantArg = args.variant ?? "./src/lib/optimizer/brute-force";
const suiteArg = args.suite ?? "all";
const k = args.k ? Number(args.k) : undefined;
const repeat = args.repeat ? Number(args.repeat) : 5;
if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`run-bench: --repeat must be a positive integer, got ${repeat}`);
if (k !== undefined && (!Number.isInteger(k) || k < 1)) throw new Error(`run-bench: --k must be a positive integer, got ${k}`);

const variantPath = resolve(variantArg);
const variant = (await import(pathToFileURL(variantPath).href)) as VariantModule;
if (typeof variant.optimize !== "function") {
  throw new Error(`run-bench: the variant module ${variantArg} does not export optimize(req): Promise<OptimizeResult>`);
}

const instances = suiteInstances(suiteArg);
const records: InstanceRecord[] = [];
const perRepeatWallBySize = new Map<string, number[]>();
const perRepeatSearchBySize = new Map<string, number[]>();

for (const instance of instances) {
  const req: OptimizeRequest = k === undefined ? instance.req : { ...instance.req, k };

  const repeats: RepeatTiming[] = [];
  let lastResult: OptimizeResult | null = null;
  let skipped: string | undefined;
  for (let r = 0; r < repeat; r++) {
    const t0 = performance.now();
    try {
      lastResult = await variant.optimize(req);
    } catch (error) {
      // The enumerability refusal on non-enumerable instances is expected
      // for exhaustive variants (brute force itself); anything else is a
      // variant bug and must fail the run loudly.
      if (!instance.enumerable) {
        skipped = `variant refused non-enumerable instance: ${(error as Error).message.split(".")[0]}`;
        break;
      }
      throw error;
    }
    repeats.push({ status: lastResult.status, initMs: lastResult.initMs, searchMs: lastResult.searchMs, wallMs: performance.now() - t0 });
  }

  const violations = lastResult ? runChecker(req, lastResult).length : null;
  let iisValid: boolean | null = null;
  if (lastResult && lastResult.status === "infeasible") {
    if (!lastResult.infeasibleSubset) {
      iisValid = false; // status plausibility: infeasible requires the subset
    } else {
      const verdict = verifyIis(req, lastResult.infeasibleSubset);
      iisValid = verdict.subsetInfeasible && verdict.allSingleRemovalsFeasible;
    }
  }

  let optimalityGap: number | null = null;
  let topKAgreement: number | null = null;
  if (instance.enumerable && !skipped) {
    const reference = await bruteForce.optimize(req);
    if (lastResult) {
      const variantBest = lastResult.schedules[0]?.breakdown.cost;
      const referenceBest = reference.schedules[0]?.breakdown.cost;
      if (variantBest !== undefined && referenceBest !== undefined) optimalityGap = variantBest - referenceBest;
      const variantKeys = new Set(lastResult.schedules.map((s) => s.sectionIds.join(",")));
      const referenceKeys = new Set(reference.schedules.map((s) => s.sectionIds.join(",")));
      if (variantKeys.size === 0 && referenceKeys.size === 0) {
        topKAgreement = 1; // both proved infeasible: full agreement
      } else {
        let shared = 0;
        for (const key of variantKeys) if (referenceKeys.has(key)) shared += 1;
        topKAgreement = shared / req.k;
      }
    }
  }

  const wallValues = repeats.map((r) => r.wallMs);
  if (!skipped) {
    const wallPool = perRepeatWallBySize.get(instance.sizeClass) ?? [];
    const searchPool = perRepeatSearchBySize.get(instance.sizeClass) ?? [];
    wallPool.push(...wallValues);
    searchPool.push(...repeats.map((r) => r.searchMs));
    perRepeatWallBySize.set(instance.sizeClass, wallPool);
    perRepeatSearchBySize.set(instance.sizeClass, searchPool);
  }

  records.push({
    name: instance.name,
    suite: instance.suite,
    sizeClass: instance.sizeClass,
    enumerable: instance.enumerable,
    statuses: [...new Set(repeats.map((r) => r.status))].join("|") || (skipped ? "skipped" : ""),
    violations,
    iisValid,
    optimalityGap,
    topKAgreement,
    diversity: lastResult ? lastResult.diversity : null,
    initMsP50: p50(repeats.map((r) => r.initMs)),
    initMsP95: p95(repeats.map((r) => r.initMs)),
    searchMsP50: p50(repeats.map((r) => r.searchMs)),
    searchMsP95: p95(repeats.map((r) => r.searchMs)),
    wallMsP50: p50(wallValues),
    wallMsP95: p95(wallValues),
    skipped,
  });
}

const sizeSummary = [...perRepeatWallBySize.keys()]
  .sort()
  .map((sizeClass) => ({
    sizeClass,
    repeats: perRepeatWallBySize.get(sizeClass)!.length,
    wallMsP50: p50(perRepeatWallBySize.get(sizeClass)!),
    wallMsP95: p95(perRepeatWallBySize.get(sizeClass)!),
    searchMsP50: p50(perRepeatSearchBySize.get(sizeClass)!),
    searchMsP95: p95(perRepeatSearchBySize.get(sizeClass)!),
  }));

const report = {
  variant: basename(variantArg),
  suite: suiteArg,
  k: k ?? 3,
  repeat,
  instances: records,
  sizeSummary,
};

console.log("### Per-instance results");
console.log("");
console.log("| instance | suite | size | status | chk | gap | top-k | div | init p50/p95 | search p50/p95 | wall p50/p95 |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const record of records) {
  const status = record.skipped ? `skipped` : record.statuses;
  console.log(
    `| ${record.name} | ${record.suite} | ${record.sizeClass} | ${status} | ${record.violations ?? "-"} ` +
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
