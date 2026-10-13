/**
 * Builds src/lib/optimizer/worker/optimize.worker.bundle.js, the file the
 * browser runs as the optimizer worker. Next 16.1's Turbopack copies a
 * TypeScript worker as a raw asset instead of compiling it, so the bundle
 * is built here and committed; worker.test.ts fails when it is stale.
 *
 * Run: bun tests/optimizer/build-worker.ts --write
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WORKER_ENTRY = join(import.meta.dir, "../../src/lib/optimizer/worker/optimize.worker.ts");
export const WORKER_BUNDLE = join(import.meta.dir, "../../src/lib/optimizer/worker/optimize.worker.bundle.js");

const BANNER = "// Generated from optimize.worker.ts by `bun tests/optimizer/build-worker.ts --write`. Do not edit.\n/* eslint-disable */\n";

export async function buildWorkerBundle(): Promise<string> {
  const out = await Bun.build({ entrypoints: [WORKER_ENTRY], target: "browser", format: "esm", minify: false });
  if (!out.success) throw new AggregateError(out.logs, "optimizer worker bundle failed to build");
  if (out.outputs.length !== 1) throw new Error(`expected one bundle file, got ${out.outputs.length}`);
  return BANNER + (await out.outputs[0].text());
}

export function committedWorkerBundle(): string {
  return readFileSync(WORKER_BUNDLE, "utf8");
}

if (import.meta.main) {
  const text = await buildWorkerBundle();
  if (process.argv.includes("--write")) {
    await Bun.write(WORKER_BUNDLE, text);
    console.log(`wrote ${WORKER_BUNDLE} (${text.length} bytes)`);
  } else {
    console.log(text === committedWorkerBundle() ? "up to date" : "stale: run with --write");
  }
}
