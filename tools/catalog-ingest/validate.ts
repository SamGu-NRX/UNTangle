#!/usr/bin/env bun
/**
 * CLI: validate a candidate catalog bundle.
 *
 * Usage: bun tools/catalog-ingest/validate.ts <candidate-bundle.json>
 *
 * Exit codes: 0 = bundle valid; 1 = bundle invalid (all errors printed);
 * 2 = usage or IO error.
 */
import { readFileSync } from "node:fs";
import { validateBundle } from "./lib/schema";

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error("usage: bun tools/catalog-ingest/validate.ts <candidate-bundle.json>");
  process.exit(2);
}

const path = process.argv[2];
if (!path) fail("missing candidate bundle path");

let raw: string;
try {
  raw = readFileSync(path, "utf8");
} catch (err) {
  fail(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  fail(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
}

const result = validateBundle(parsed);
if (result.ok) {
  console.log(`OK: ${path} is a valid candidate bundle`);
  process.exit(0);
}

for (const error of result.errors) {
  console.error(error);
}
console.error(`\n${result.errors.length} error(s) in ${path}`);
process.exit(1);
