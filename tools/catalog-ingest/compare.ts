#!/usr/bin/env bun
/**
 * CLI: compare the current seed bundle with a candidate bundle and write a
 * deterministic markdown report (optionally JSON alongside).
 *
 * Usage:
 *   bun tools/catalog-ingest/compare.ts \
 *     --current <seed-data.json> --candidate <candidate-bundle.json> \
 *     --out <report.md> [--json <report.json>]
 *
 * Exit codes: 0 = report written; 2 = usage, IO, or invalid candidate error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compareBundles, readCurrentBundle, renderReport } from "./lib/compare";
import { validateBundle, type CandidateBundle } from "./lib/schema";

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error(
    "usage: bun tools/catalog-ingest/compare.ts --current <seed.json> --candidate <bundle.json> --out <report.md> [--json <report.json>]",
  );
  process.exit(2);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`cannot read or parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument ${arg}`);
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      args.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const value = argv[i + 1];
      if (value === undefined) fail(`missing value for ${arg}`);
      args.set(arg.slice(2), value);
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const currentPath = args.get("current");
const candidatePath = args.get("candidate");
const outPath = args.get("out");
const jsonPath = args.get("json");
if (!currentPath || !candidatePath || !outPath) {
  fail("missing --current, --candidate, or --out");
}

const current = readCurrentBundle(readJson(currentPath));
const candidateJson = readJson(candidatePath);
const check = validateBundle(candidateJson);
if (!check.ok) {
  console.error(`candidate bundle ${candidatePath} is not valid:`);
  for (const error of check.errors) console.error(error);
  process.exit(2);
}

const report = compareBundles(current, candidateJson as CandidateBundle);
writeFileSync(outPath, renderReport(report));
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
}
console.log(`wrote report to ${outPath}${jsonPath ? ` and ${jsonPath}` : ""}`);
