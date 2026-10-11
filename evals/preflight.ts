/**
 * preflight — argument parsing and the runPreflight wrapper.
 *
 * The preflight is the bounded "is this stack bootable?" check: parse args
 * strictly, then bring the whole stack up via stack.ts's startStack() and hand
 * the RunningStack to the caller.
 *
 * Contract enforced here (evals/CONTRACT.md §2):
 *   - assertTargetDir exits 2 with the usage line when the directory is
 *     missing or not a directory — it never "creates" one.
 *   - parsePreflightArgs exits 2 unless exactly --target-dir <dir>,
 *     --target-sha <40-hex> and --out <file> are given.
 * Both use process.exit(2) — a usage error is not a stack failure (that's
 * exit 3) and not an application case failure (exit 1).
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { startStack, type RunningStack } from "./stack";

export interface PreflightArgs {
  targetDir: string;
  targetSha: string;
  out: string;
}

export function usageError(usage: string, message: string): never {
  console.error(`error: ${message}`);
  console.error(usage);
  process.exit(2);
}

export function assertTargetDir(dir: string | undefined, usage: string): string {
  if (dir === undefined || dir === "") {
    usageError(usage, "--target-dir is required");
  }
  if (!existsSync(dir)) {
    usageError(usage, `--target-dir does not exist: ${dir}`);
  }
  if (!statSync(dir).isDirectory()) {
    usageError(usage, `--target-dir is not a directory: ${dir}`);
  }
  return path.resolve(dir);
}

export function parsePreflightArgs(argv: string[], usage: string): PreflightArgs {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usageError(usage, `${name} needs a value`);
    }
    return value;
  };

  const unknown = argv.filter((arg) => !["--target-dir", "--target-sha", "--out"].includes(arg));
  if (unknown.length > 0) {
    usageError(usage, `unrecognized argument(s): ${unknown.join(" ")}`);
  }

  const targetSha = get("--target-sha");
  if (targetSha === undefined) usageError(usage, "--target-sha is required");
  if (!/^[0-9a-f]{40}$/.test(targetSha)) {
    usageError(usage, `--target-sha must be a 40-hex commit SHA, got: ${targetSha}`);
  }

  const out = get("--out");
  if (out === undefined) usageError(usage, "--out is required");
  if (!out.endsWith(".json")) {
    usageError(usage, `--out must end in .json, got: ${out}`);
  }

  return {
    targetDir: assertTargetDir(get("--target-dir"), usage),
    targetSha,
    out,
  };
}

export interface RunPreflightOptions {
  targetDir: string;
  targetSha: string;
  out: string;
  /** Stable task id for the Postgres data dir name. */
  taskId: string;
  /** Where step logs and evidence land (default: <out-dir>/preflight-logs). */
  runDir?: string;
}

/** Boot the whole stack; throws StackBootError (naming the broken step) on failure. */
export async function runPreflight(options: RunPreflightOptions): Promise<RunningStack> {
  const runDir = options.runDir ?? path.join(path.dirname(path.resolve(options.out)), "preflight-logs");
  return startStack({
    targetDir: options.targetDir,
    runDir,
    taskId: options.taskId,
  });
}
