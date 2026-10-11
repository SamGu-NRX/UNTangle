/**
 * optdata-lib — shared machinery for the optimizer and data suites.
 *
 * Pure logic (bench-report parsing, activeDataset extraction/verification,
 * percentiles) and bounded IO (subprocess capture, target-dir resolution)
 * live here so both suites stay thin and the logic is unit-testable
 * (optdata-lib.test.ts).
 *
 * Bench interface contract (optimizer suite; the harness defines it until a
 * real bench lands on the integrated branch):
 *   The benchmark directory must contain one of run.ts / run.js / main.ts /
 *   main.js / index.ts / index.js (run.ts preferred). The suite runs it as
 *     <bun|node> <entry> --courses 8 --samples 20 --seed 0 --format json
 *   with cwd = the bench directory, and expects a single JSON object on
 *   stdout shaped like:
 *     {
 *       "courses": 8,             // instances' course count (bar is at 8)
 *       "violations": 0,          // hard-constraint violations observed
 *       "violationSamples": 20,   // instances checked for violations (> 0)
 *       "gap": 0,                 // optimality gap on enumerable instances
 *       "enumerableInstances": 20,// enumerable instances checked (> 0)
 *       "solveTimesMs": [12, 11]  // one solve time per sample (non-empty)
 *     }
 *   The suite computes p95 itself (nearest-rank) from solveTimesMs — the
 *   harness owns the statistic, the bench owns the raw samples.
 *
 * Catalog-consistency interface contract (data suite):
 *   tools/catalog-consistency may be a script file or a directory holding an
 *   entrypoint per the same rule as the bench. The suite runs it with
 *   cwd = the target root and expects a JSON object on stdout whose numeric
 *   fields ARE the certification counts (e.g. certifiedCourses, failures);
 *   they are recorded verbatim. Exit code 0 is required.
 *
 * activeDataset descriptor contract (data suite):
 *   frontend/src/lib/data-provenance.ts must export `activeDataset` as a FLAT
 *   object literal of primitives:
 *     export const activeDataset = {
 *       dataset: "UNT 2026 fall",
 *       file: "src/data/catalog/complete.json", // bundled catalog, relative
 *                                               // to frontend/ (a leading
 *                                               // "frontend/" also accepted)
 *       sha256: "<64-hex sha256 of the bundled file's utf8 bytes>",
 *       courses: 84,            // optional count keys, verified against the
 *       sections: 312,          // bundled JSON: array -> length, number ->
 *       instructors: 57,        // direct compare
 *     } as const;
 *   The descriptor is read statically (never imported) so the harness never
 *   pulls the target's dependency graph.
 */

import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SuiteContext } from "../suite-kit";

// ---------------------------------------------------------------------------
// Target-checkout resolution
// ---------------------------------------------------------------------------

export type TargetResolution =
  | { ok: true; dir: string; source: string }
  | { ok: false; reason: string };

/**
 * The runner knows --target-dir but the SuiteContext does not carry it. The
 * preflight's `target-dir` step returns the resolved absolute target dir as
 * its step detail, so that is the primary source; when absent (e.g. a suite
 * unit-run without the runner), fall back to the harness checkout itself —
 * the standard flow runs the harness from the target checkout's evals/.
 */
export function resolveTargetDir(ctx: SuiteContext): TargetResolution {
  const step = ctx.preflightSteps.find((s) => s.step === "target-dir");
  const fromStep = typeof step?.detail === "string" ? step.detail.trim() : "";
  if (fromStep.length > 0 && isDirectory(fromStep)) {
    return { ok: true, dir: fromStep, source: "preflight target-dir step detail" };
  }
  // evals/suites/optdata-lib.ts -> evals/suites -> evals -> <target root>
  const derived = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (existsSync(path.join(derived, "evals", "CONTRACT.md"))) {
    return {
      ok: true,
      dir: derived,
      source: "derived from the suite file's own location (harness checkout)",
    };
  }
  return {
    ok: false,
    reason: `could not resolve the target checkout dir (preflight target-dir detail: ${
      fromStep === "" ? "absent" : fromStep
    }; derived ${derived} has no evals/CONTRACT.md)`,
  };
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Human-auditable "what we looked for and where" note text. */
export function missingPathNote(targetDir: string, relativePath: string): string {
  return `the target checkout has no ${relativePath} (looked at ${path.join(targetDir, relativePath)})`;
}

// ---------------------------------------------------------------------------
// Bounded subprocess capture
// ---------------------------------------------------------------------------

export interface CapturedRun {
  /** Exit code; null when killed by a signal or spawn failed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Set only when the process could not be spawned at all. */
  spawnError?: string;
}

const CAPTURE_LIMIT_BYTES = 1 << 20; // 1 MiB per stream; overflow noted in evidence

/**
 * Run a command with a hard wall-clock cap, capturing stdout/stderr as text.
 * Deterministic and side-effect free beyond the child itself; never throws —
 * every failure mode lands in the returned record so a case can report it.
 */
export function runCaptured(options: {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CapturedRun> {
  const { cmd, args, cwd, timeoutMs } = options;
  return new Promise((resolve) => {
    const started = Date.now();
    // Sync spawn-wrapper so a spawn failure is data, not an exception path.
    const spawned: { child: ChildProcess } | { error: string } = (() => {
      try {
        return { child: spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    })();
    if ("error" in spawned) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        durationMs: Date.now() - started,
        spawnError: spawned.error,
      });
      return;
    }
    const child = spawned.child;
    let timedOut = false;
    let settled = false;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let outTruncated = false;
    let errTruncated = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null, spawnError?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8") + (outTruncated ? "\n[optdata-lib] stdout truncated at 1 MiB" : ""),
        stderr: Buffer.concat(err).toString("utf8") + (errTruncated ? "\n[optdata-lib] stderr truncated at 1 MiB" : ""),
        timedOut,
        durationMs: Date.now() - started,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= CAPTURE_LIMIT_BYTES) out.push(chunk);
      else outTruncated = true;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes <= CAPTURE_LIMIT_BYTES) err.push(chunk);
      else errTruncated = true;
    });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
  });
}

// ---------------------------------------------------------------------------
// Small pure helpers (shared with the routing suite's conventions)
// ---------------------------------------------------------------------------

/** Tolerant JSON-object parse: malformed bodies become recorded problems, not crashes. */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a subprocess's stdout as a JSON object, tolerating leading log lines:
 * strict parse first, then the span from the first "{" to the last "}".
 */
export function parseJsonObjectFromProcess(stdout: string): Record<string, unknown> | undefined {
  const strict = parseJsonObject(stdout);
  if (strict !== undefined) return strict;
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first === -1 || last <= first) return undefined;
  return parseJsonObject(stdout.slice(first, last + 1));
}

/** Nearest-rank percentile over a copy of the samples (same statistic as routing). */
export function percentileNearestRank(samples: number[], pct: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.ceil((pct / 100) * sorted.length), 1), sorted.length);
  const value = sorted[rank - 1];
  return value ?? Number.NaN;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** First existing entrypoint of a (bench | tool) directory, runner included. */
export type EntryPoint = { cmd: "bun" | "node"; args: string[]; entryPath: string };

const ENTRY_CANDIDATES: Array<{ file: string; cmd: "bun" | "node" }> = [
  { file: "run.ts", cmd: "bun" },
  { file: "run.js", cmd: "node" },
  { file: "main.ts", cmd: "bun" },
  { file: "main.js", cmd: "node" },
  { file: "index.ts", cmd: "bun" },
  { file: "index.js", cmd: "node" },
];

export function discoverEntrypointInDir(dir: string): EntryPoint | undefined {
  for (const candidate of ENTRY_CANDIDATES) {
    const entryPath = path.join(dir, candidate.file);
    if (existsSync(entryPath) && statSync(entryPath).isFile()) {
      return { cmd: candidate.cmd, args: [entryPath], entryPath };
    }
  }
  return undefined;
}

/**
 * Resolve a runnable command for a conditional-presence artifact that may be
 * a directory (entrypoint discovery inside it) or a script file (.ts -> bun,
 * .js -> node, anything else -> executed directly). cwdPolicy states which
 * working directory the artifact's contract assumes: "artifact-dir" (the
 * optimizer bench reads fixtures relative to its own directory) or
 * "repo-root" (repo tools like catalog-consistency resolve repo paths from
 * the target root).
 */
export type ArtifactCommand =
  | { ok: true; cmd: string; args: string[]; cwd: string; describe: string }
  | { ok: false; reason: string };

export function artifactCommand(
  artifactPath: string,
  extraArgs: string[],
  fallbackCwd: string,
  cwdPolicy: "artifact-dir" | "repo-root",
): ArtifactCommand {
  if (isDirectory(artifactPath)) {
    const entry = discoverEntrypointInDir(artifactPath);
    if (!entry) {
      return {
        ok: false,
        reason: `${artifactPath} is a directory but holds no runnable entrypoint (looked for ${ENTRY_CANDIDATES.map(
          (c) => c.file,
        ).join(", ")})`,
      };
    }
    return {
      ok: true,
      cmd: entry.cmd,
      args: [...entry.args, ...extraArgs],
      cwd: cwdPolicy === "artifact-dir" ? artifactPath : fallbackCwd,
      describe: `${entry.cmd} ${path.relative(fallbackCwd, entry.entryPath) || entry.entryPath}`,
    };
  }
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    return { ok: false, reason: `${artifactPath} is neither a directory nor a file` };
  }
  if (artifactPath.endsWith(".ts")) {
    return { ok: true, cmd: "bun", args: [artifactPath, ...extraArgs], cwd: fallbackCwd, describe: `bun ${artifactPath}` };
  }
  if (artifactPath.endsWith(".js") || artifactPath.endsWith(".mjs")) {
    return { ok: true, cmd: "node", args: [artifactPath, ...extraArgs], cwd: fallbackCwd, describe: `node ${artifactPath}` };
  }
  return {
    ok: true,
    cmd: artifactPath,
    args: [...extraArgs],
    cwd: fallbackCwd,
    describe: `${artifactPath} (executed directly)`,
  };
}

// ---------------------------------------------------------------------------
// Optimizer bench report contract
// ---------------------------------------------------------------------------

export interface BenchReport {
  courses: number;
  violations: number;
  violationSamples: number;
  gap: number;
  enumerableInstances: number;
  solveTimesMs: number[];
  /** Extra numeric fields the bench chose to report (recorded, not judged). */
  extraCounts: Record<string, number>;
}

export type BenchReportParse =
  | { ok: true; report: BenchReport }
  | { ok: false; problems: string[] };

/**
 * Validate a bench stdout object against the documented contract. Every
 * problem is collected (not fail-fast) so the evidence names all gaps.
 */
export function parseBenchReport(payload: Record<string, unknown>): BenchReportParse {
  const problems: string[] = [];
  const num = (key: string): number | undefined => {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    problems.push(`field "${key}" must be a finite number, got ${JSON.stringify(value ?? null)}`);
    return undefined;
  };

  const courses = num("courses");
  const violations = num("violations");
  const violationSamples = num("violationSamples");
  const gap = num("gap");
  const enumerableInstances = num("enumerableInstances");

  const rawTimes = payload.solveTimesMs;
  let solveTimesMs: number[] = [];
  if (Array.isArray(rawTimes) && rawTimes.every((t) => typeof t === "number" && Number.isFinite(t))) {
    solveTimesMs = rawTimes as number[];
    if (solveTimesMs.length === 0) problems.push('field "solveTimesMs" must be non-empty');
  } else {
    problems.push('field "solveTimesMs" must be an array of finite numbers');
  }

  if (problems.length > 0) return { ok: false, problems };

  const extraCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      key !== "courses" &&
      key !== "violations" &&
      key !== "violationSamples" &&
      key !== "gap" &&
      key !== "enumerableInstances" &&
      key !== "solveTimesMs" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      extraCounts[key] = value;
    }
  }

  return {
    ok: true,
    report: {
      courses: courses as number,
      violations: violations as number,
      violationSamples: violationSamples as number,
      gap: gap as number,
      enumerableInstances: enumerableInstances as number,
      solveTimesMs,
      extraCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// activeDataset descriptor extraction + verification
// ---------------------------------------------------------------------------

export interface ActiveDatasetDescriptor {
  /** Every primitive string/number/boolean field seen, verbatim (nested
   * group members get dotted keys like "counts.courses"). */
  fields: Record<string, string | number | boolean>;
  /** The keys required by the contract (presence checked by the caller). */
  dataset?: string;
  file?: string;
  sha256?: string;
  /** Numeric count keys (courses, counts.buildings, ...) claimed by the descriptor. */
  counts: Record<string, number>;
  /** Keys whose values could not be verified (arrays, spreads, computed values). */
  ignored: string[];
}

export type DescriptorExtraction =
  | { found: true; descriptor: ActiveDatasetDescriptor }
  | { found: false; reason: string };

/**
 * Statically extract `export const activeDataset = { ... }` from the target's
 * data-provenance.ts WITHOUT importing it (the harness never pulls the
 * target's dependency graph). Flat primitives are read directly; one-level
 * nested groups of primitives (e.g. `counts: { courses: 84 }`) flatten to
 * dotted keys; other non-primitive values are recorded as ignored — they are
 * metadata, not part of the verifiable contract. The extraction fails only
 * when a contract field (file, sha256) itself is not statically readable.
 */
export function extractActiveDataset(sourceText: string): DescriptorExtraction {
  const decl = /activeDataset\s*:(?!:)|activeDataset\s*=(?!=)/.exec(sourceText);
  if (decl === null) {
    return { found: false, reason: "no activeDataset declaration found in frontend/src/lib/data-provenance.ts" };
  }
  const braceStart = sourceText.indexOf("{", decl.index);
  if (braceStart === -1) {
    return { found: false, reason: "the activeDataset declaration has no object literal to read" };
  }

  // String-aware scan for the matching closing brace.
  let depth = 0;
  let end = -1;
  let inString: string | null = null;
  for (let i = braceStart; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (inString !== null) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    return { found: false, reason: "the activeDataset object literal is never closed (unbalanced braces)" };
  }
  const literal = sourceText.slice(braceStart + 1, end);

  const fields: Record<string, string | number | boolean> = {};
  const counts: Record<string, number> = {};
  const ignored: string[] = [];
  const unreadableContract: string[] = [];

  // Top-level "key: value" pairs; primitives are read directly, one-level
  // nested primitive groups flatten to dotted keys, anything else is ignored.
  const pair = /([A-Za-z_$][\w$]*)\s*:\s*/g;
  pair.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(literal)) !== null) {
    const key = match[1];
    if (key === undefined) break;
    let cursor = match.index + match[0].length;
    // Skip whitespace and comments between ":" and the value.
    while (cursor < literal.length && /\s/.test(literal[cursor] ?? "")) cursor += 1;
    const rest = literal.slice(cursor);
    if (rest.startsWith("{")) {
      // One-level nested groups flatten. A group named `counts` is the
      // conventional count container — its members ARE the count names
      // (`counts: { buildings: 16 }` claims 16 buildings), so numeric
      // members merge under their bare names. Any other group is metadata:
      // members are kept as dotted fields for evidence but never become
      // count checks (the bundle lookup is top-level only).
      const group = parsePrimitiveGroup(literal, cursor);
      const isCountGroup = key === "counts";
      for (const [innerKey, innerValue] of group.entries) {
        fields[`${key}.${innerKey}`] = innerValue;
        if (typeof innerValue === "number" && isCountGroup) counts[innerKey] = innerValue;
      }
      for (const innerIgnored of group.ignored) ignored.push(`${key}.${innerIgnored}`);
      pair.lastIndex = group.endIndex;
      continue;
    }
    if (rest.startsWith("[") || rest.startsWith("...") || rest.startsWith("(")) {
      // Arrays, spreads and call results are metadata the harness cannot
      // verify statically; they are not part of the verifiable contract
      // (file/sha256/counts), so record and move on.
      ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(literal, cursor);
      continue;
    }
    const value = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))/.exec(rest);
    if (value === null) {
      // Not a primitive literal (identifier, template, arithmetic). Skip past
      // the value so its interior (ternaries etc.) is never misread as
      // top-level keys. A computed CONTRACT field is fatal; computed
      // metadata is merely unverifiable.
      if (key === "file" || key === "sha256") unreadableContract.push(key);
      else ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(literal, cursor);
      continue;
    }
    if (value[1] !== undefined) fields[key] = JSON.parse(`"${value[1]}"`) as string;
    else if (value[2] !== undefined) fields[key] = value[2].replace(/\\'/g, "'");
    else if (value[3] !== undefined) {
      const asNumber = Number(value[3]);
      fields[key] = asNumber;
      counts[key] = asNumber;
    } else fields[key] = value[4] === "true";

    pair.lastIndex = cursor + (value[0]?.length ?? 0);
  }

  if (unreadableContract.length > 0) {
    return {
      found: false,
      reason: `activeDataset's ${unreadableContract.join(" and ")} is not a statically readable plain literal (computed or templated value); the contract requires plain string literals to verify`,
    };
  }

  return { found: true, descriptor: { fields, counts, ignored, dataset: asString(fields.dataset), file: asString(fields.file), sha256: asString(fields.sha256) } };
}

/**
 * Parse a one-level object literal (starting at openBraceIdx) whose members
 * are primitives. Non-primitive or nested members are recorded in `ignored`;
 * the scanner never descends into them. endIndex is the index just past the
 * group's closing brace (or text.length if unbalanced).
 */
function parsePrimitiveGroup(text: string, openBraceIdx: number): {
  entries: [string, string | number | boolean][];
  ignored: string[];
  endIndex: number;
} {
  // String-aware scan for the matching closing brace.
  let depth = 0;
  let close = -1;
  let str: string | null = null;
  for (let i = openBraceIdx; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (str !== null) {
      if (ch === "\\") i += 1;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") str = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const entries: [string, string | number | boolean][] = [];
  const ignored: string[] = [];
  if (close === -1) return { entries, ignored, endIndex: text.length };
  const inner = text.slice(openBraceIdx + 1, close);

  const pair = /([A-Za-z_$][\w$]*)\s*:\s*/g;
  pair.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(inner)) !== null) {
    const key = match[1];
    if (key === undefined) break;
    let cursor = match.index + match[0].length;
    while (cursor < inner.length && /\s/.test(inner[cursor] ?? "")) cursor += 1;
    const rest = inner.slice(cursor);
    if (rest.startsWith("{") || rest.startsWith("[") || rest.startsWith("...") || rest.startsWith("(")) {
      ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(inner, cursor);
      continue;
    }
    const value = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))/.exec(rest);
    if (value === null) {
      ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(inner, cursor);
      continue;
    }
    if (value[1] !== undefined) entries.push([key, JSON.parse(`"${value[1]}"`) as string]);
    else if (value[2] !== undefined) entries.push([key, value[2].replace(/\\'/g, "'")]);
    else if (value[3] !== undefined) entries.push([key, Number(value[3])]);
    else entries.push([key, value[4] === "true"]);
    pair.lastIndex = cursor + (value[0]?.length ?? 0);
  }
  return { entries, ignored, endIndex: close + 1 };
}

function asString(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Index just past the next top-level `,` (or the literal's end), string- and
 * bracket-aware — used to skip a non-primitive value without misreading its
 * interior `key:` pairs as descriptor fields.
 */
function skipToTopLevelSeparator(text: string, from: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (str !== null) {
      if (ch === "\\") i += 1;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") str = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) return i + 1;
  }
  return text.length;
}

export interface CountCheck {
  key: string;
  expected: number;
  actual: string;
  ok: boolean;
  kind: "array-length" | "number" | "missing-key" | "not-array-or-number";
}

export interface DescriptorVerification {
  bundledFile: string | null;
  hashExpected: string | null;
  hashActual: string | null;
  hashOk: boolean | null; // null = could not compare (file missing)
  countChecks: CountCheck[];
  allOk: boolean;
}

/**
 * Verify an extracted descriptor against the actually-bundled catalog file:
 * sha256 of the file's utf8 bytes, then each claimed count against the
 * bundled JSON (array -> length, number -> direct compare).
 */
export function verifyDescriptorAgainstBundle(
  descriptor: ActiveDatasetDescriptor,
  bundledAbsPath: string,
  bundledUtf8: string | null,
): DescriptorVerification {
  const hashExpected = typeof descriptor.sha256 === "string" ? descriptor.sha256.toLowerCase() : null;
  const hashActual = bundledUtf8 === null ? null : sha256Hex(bundledUtf8);
  const hashOk = hashExpected !== null && hashActual !== null ? hashExpected === hashActual : null;

  const countChecks: CountCheck[] = [];
  if (bundledUtf8 !== null && Object.keys(descriptor.counts).length > 0) {
    const root = parseJsonObject(bundledUtf8);
    for (const [key, expected] of Object.entries(descriptor.counts)) {
      if (root === undefined) {
        countChecks.push({ key, expected, actual: "bundle is not valid JSON", ok: false, kind: "missing-key" });
        continue;
      }
      const actual = root[key];
      if (Array.isArray(actual)) {
        countChecks.push({ key, expected, actual: `array length ${actual.length}`, ok: actual.length === expected, kind: "array-length" });
      } else if (typeof actual === "number" && Number.isFinite(actual)) {
        countChecks.push({ key, expected, actual: `${actual}`, ok: actual === expected, kind: "number" });
      } else {
        countChecks.push({
          key,
          expected,
          actual: Array.isArray(actual) ? "array" : typeof actual,
          ok: false,
          kind: "not-array-or-number",
        });
      }
    }
  }

  const allOk =
    hashOk === true &&
    countChecks.every((c) => c.ok) &&
    (Object.keys(descriptor.counts).length === 0 || bundledUtf8 !== null);

  return {
    bundledFile: bundledUtf8 === null ? null : bundledAbsPath,
    hashExpected,
    hashActual,
    hashOk,
    countChecks,
    allOk,
  };
}

/**
 * Resolve the descriptor's `file` claim to an absolute path in the target
 * checkout: relative to frontend/ by contract; a "frontend/"-prefixed claim
 * is also accepted. Returns every path tried so evidence can name them.
 */
export function resolveBundledCatalogPath(targetDir: string, fileClaim: string): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  const candidates = fileClaim.startsWith("frontend/")
    ? [path.join(targetDir, fileClaim)]
    : [path.join(targetDir, "frontend", fileClaim), path.join(targetDir, fileClaim)];
  for (const candidate of candidates) {
    tried.push(candidate);
    if (existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

// ---------------------------------------------------------------------------
// Discovery-compliance shim
// ---------------------------------------------------------------------------

/**
 * run.ts auto-discovers every evals/suites/*.ts and requires a suite-shaped
 * default export whose name equals the file basename. This helper declares
 * zero cases, so `--suite all` produces no records for it.
 */
export default {
  name: "optdata-lib",
  describe: () => [],
  run: () => ({ status: "not-applicable" as const, note: "optdata-lib is a helper module, not a suite" }),
};
