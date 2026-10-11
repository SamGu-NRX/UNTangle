/**
 * Bundle-size probe for a variant: Bun.build minified with the variant
 * module as the entry, then gzip, reporting bytes. No new dependencies.
 *
 * Usage:
 *   cd frontend && bun run src/lib/optimizer/bench/bundle-size.ts \
 *     --variant=./src/lib/optimizer/brute-force
 *
 * Writes bench/results/bundle-<variant>.json and prints one markdown row.
 * The number measures the variant's transitive optimizer graph (scorer,
 * types, bench references it pulls in) — a planning input for the round's
 * bundle budget, not a shipping figure.
 */

import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args: Record<string, string> = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
  if (match) args[match[1]] = match[2];
}
if (!args.variant) {
  throw new Error("bundle-size: pass --variant=<module path exporting optimize>");
}

const entry = resolve(args.variant);
const build = await Bun.build({ entrypoints: [entry], minify: true, target: "browser" });
if (!build.success) {
  for (const log of build.logs) console.error(log);
  throw new Error(`bundle-size: Bun.build failed for ${args.variant}`);
}

const chunks = await Promise.all(build.outputs.map((output) => output.arrayBuffer()));
let minifiedBytes = 0;
for (const chunk of chunks) minifiedBytes += chunk.byteLength;
const concatenated = new Uint8Array(minifiedBytes);
let offset = 0;
for (const chunk of chunks) {
  concatenated.set(new Uint8Array(chunk), offset);
  offset += chunk.byteLength;
}
const gzippedBytes = gzipSync(concatenated).byteLength;

const report = {
  variant: basename(args.variant),
  minifiedBytes,
  gzippedBytes,
  outputKinds: build.outputs.map((output) => output.kind),
};

console.log(`| ${report.variant} | ${minifiedBytes} | ${gzippedBytes} |`);
const resultsDir = resolve(import.meta.dir, "results");
mkdirSync(resultsDir, { recursive: true });
const outPath = resolve(resultsDir, `bundle-${report.variant}.json`);
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
