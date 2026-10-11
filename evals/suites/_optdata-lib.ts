/**
 * _optdata-lib — shared machinery for the optimizer and data suites.
 *
 * The underscore prefix marks this as a helper module, not a suite; suite
 * discovery skips underscore-prefixed and *.test.* files, so it exports no
 * suite-shaped default and needs no discovery shim.
 *
 * DESIGN RULE (review finding): the harness never invents an interface for a
 * target artifact. At run time the suites DETECT the real artifact in the
 * target checkout and drive ITS interface: the invocation is derived from the
 * artifact's own code (its package.json scripts, then its entrypoint files),
 * no arguments are prescribed, and its outputs are recorded verbatim. The
 * suites only ever judge:
 *   - run-level verdicts (spawn failure, timeout, exit code), and
 *   - claims the artifact itself makes that the suite can recognize and
 *     check (a reported violations/gap/p95/course count, a claimed sha256,
 *     a claimed count with a bundle counterpart).
 * Anything else (no recognizable measurements, unfamiliar output shape,
 * unknown instance size) is reported NOT-APPLICABLE with the reason and the
 * verbatim evidence path — never a fail for not matching a shape the
 * artifact never agreed to.
 *
 * Pure logic and bounded IO live here so both suites stay thin and the
 * logic is unit-testable (optdata-lib.test.ts).
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  // evals/suites/_optdata-lib.ts -> evals/suites -> evals -> <target root>
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

export function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Human-auditable "what we looked for and where" note text. */
export function missingPathNote(targetDir: string, relativePath: string): string {
  return `the target checkout has no ${relativePath} (looked at ${path.join(targetDir, relativePath)})`;
}

/** Shared evidence writer: JSON payloads land next to the scorecard. */
export function writeEvidence(runDir: string, name: string, payload: unknown): string {
  mkdirSync(runDir, { recursive: true });
  const evidencePath = path.join(runDir, name);
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
  return evidencePath;
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
 * Never throws — every failure mode lands in the returned record so a case
 * can report it.
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
        stdout: Buffer.concat(out).toString("utf8") + (outTruncated ? "\n[_optdata-lib] stdout truncated at 1 MiB" : ""),
        stderr: Buffer.concat(err).toString("utf8") + (errTruncated ? "\n[_optdata-lib] stderr truncated at 1 MiB" : ""),
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
// Small pure helpers
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

// ---------------------------------------------------------------------------
// Artifact invocation discovery — derive the command from the artifact's own
// code. No arguments are ever prescribed; the artifact runs with its own
// defaults, cwd = the artifact directory.
// ---------------------------------------------------------------------------

/** First existing entrypoint file of an artifact directory. */
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
 * Package-script names the suites recognize inside an artifact's own
 * package.json, in preference order. This is not an imposed schema — these
 * are the script names a runnable artifact plausibly declares for itself;
 * a package.json whose scripts match none of them (and declares more than
 * one, so none is unambiguous) yields undefined and entry-file discovery
 * takes over.
 */
const PACKAGE_SCRIPT_CANDIDATES = ["bench", "start", "check", "verify", "consistency", "main"];

/**
 * Read the artifact's own package.json and return the script it declares for
 * running the artifact, or undefined when that cannot be determined.
 */
export function discoverPackageScript(dir: string): string | undefined {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath) || !statSync(pkgPath).isFile()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return undefined;
  }
  const scripts = (parsed as { scripts?: Record<string, unknown> } | null)?.scripts;
  if (scripts === undefined || scripts === null || typeof scripts !== "object") return undefined;
  for (const name of PACKAGE_SCRIPT_CANDIDATES) {
    if (typeof scripts[name] === "string") return name;
  }
  const declared = Object.keys(scripts).filter((key) => typeof scripts[key] === "string");
  return declared.length === 1 ? declared[0] : undefined;
}

/**
 * Resolve a runnable command for a conditional-presence artifact, deriving
 * everything from the artifact itself:
 *   1. a package.json script (bun run <script>, cwd = the artifact dir),
 *   2. an entrypoint file inside the directory (bun/node, no args),
 *   3. a script file (.ts -> bun, .js/.mjs -> node, no args),
 *   4. an executable file, executed directly.
 * `ok: false` means the artifact is present but no real interface could be
 * derived — the caller reports the affected cases not-applicable with this
 * reason (present-but-undrivable is not judged against any invented shape).
 */
export type ArtifactCommand =
  | { ok: true; cmd: string; args: string[]; cwd: string; describe: string; source: string }
  | { ok: false; reason: string };

export function artifactCommand(artifactPath: string): ArtifactCommand {
  if (isDirectory(artifactPath)) {
    const script = discoverPackageScript(artifactPath);
    if (script !== undefined) {
      return {
        ok: true,
        cmd: "bun",
        args: ["run", script],
        cwd: artifactPath,
        describe: `bun run ${script} (package.json in ${artifactPath})`,
        source: "package.json scripts",
      };
    }
    const entry = discoverEntrypointInDir(artifactPath);
    if (!entry) {
      return {
        ok: false,
        reason:
          `${artifactPath} declares no runnable interface: its package.json (if any) has no ` +
          `${PACKAGE_SCRIPT_CANDIDATES.join("/") } script or single unambiguous script, and no ` +
          `${ENTRY_CANDIDATES.map((c) => c.file).join("/")} entrypoint file exists`,
      };
    }
    return {
      ok: true,
      cmd: entry.cmd,
      args: entry.args,
      cwd: artifactPath,
      describe: `${entry.cmd} ${entry.entryPath}`,
      source: "entrypoint file discovery",
    };
  }
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    return { ok: false, reason: `${artifactPath} is neither a directory nor a file` };
  }
  if (artifactPath.endsWith(".ts")) {
    return { ok: true, cmd: "bun", args: [artifactPath], cwd: path.dirname(artifactPath), describe: `bun ${artifactPath}`, source: "script file" };
  }
  if (artifactPath.endsWith(".js") || artifactPath.endsWith(".mjs")) {
    return { ok: true, cmd: "node", args: [artifactPath], cwd: path.dirname(artifactPath), describe: `node ${artifactPath}`, source: "script file" };
  }
  return {
    ok: true,
    cmd: artifactPath,
    args: [],
    cwd: path.dirname(artifactPath),
    describe: `${artifactPath} (executed directly)`,
    source: "executable file",
  };
}

// ---------------------------------------------------------------------------
// Bench output recognition — interpret what the artifact actually reported,
// never prescribe what it must report. Unrecognized measurements stay null;
// every numeric field is also recorded verbatim.
// ---------------------------------------------------------------------------

export interface BenchMeasurements {
  /** Recognized hard-constraint violation count, if the output exposes one. */
  violations: number | null;
  /** Sample/instance count the output associates with the violations check. */
  violationSamples: number | null;
  /** Recognized optimality gap, if exposed. */
  gap: number | null;
  /** Instance count the output associates with the gap check. */
  gapInstances: number | null;
  /** Recognized instance size (course count), if exposed. */
  courses: number | null;
  /** A p95 the bench computed itself, if exposed (assumed milliseconds). */
  reportedP95Ms: number | null;
  /** Raw solve-time samples, if exposed (milliseconds). */
  solveTimesMs: number[] | null;
  /** EVERY numeric top-level field the bench reported, verbatim. */
  numericFields: Record<string, number>;
  /** Fields present but not numeric (recorded verbatim as evidence). */
  nonNumericFields: string[];
}

const VIOLATION_KEYS = ["violations", "hardConstraintViolations", "violationCount", "hardViolations"];
const VIOLATION_SAMPLE_KEYS = ["violationSamples", "instancesChecked", "violationInstances", "samplesChecked"];
const GAP_KEYS = ["gap", "optimalityGap", "optimalityGapRatio", "gapRatio"];
const GAP_INSTANCE_KEYS = ["enumerableInstances", "gapInstances", "enumerableInstancesChecked", "gapSamples"];
const COURSES_KEYS = ["courses", "courseCount", "numCourses", "nCourses"];
const P95_KEYS = ["p95Ms", "p95ms", "solveTimeP95Ms", "p95Millis", "p95"];
const SOLVE_TIME_KEYS = ["solveTimesMs", "solveTimes", "timesMs", "solveDurationsMs", "times"];

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function firstNumberArray(payload: Record<string, unknown>, keys: string[]): number[] | null {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0 && value.every((t) => typeof t === "number" && Number.isFinite(t))) {
      return value as number[];
    }
  }
  return null;
}

/**
 * Best-effort recognition of the bench's reported measurements. Field names
 * are recognized, not required: a bench that reports none of them simply
 * yields nulls and the affected cases go not-applicable with that reason.
 */
export function interpretBenchOutput(payload: Record<string, unknown>): BenchMeasurements {
  const numericFields: Record<string, number> = {};
  const nonNumericFields: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "number" && Number.isFinite(value)) numericFields[key] = value;
    else nonNumericFields.push(key);
  }
  return {
    violations: firstNumber(payload, VIOLATION_KEYS),
    violationSamples: firstNumber(payload, VIOLATION_SAMPLE_KEYS),
    gap: firstNumber(payload, GAP_KEYS),
    gapInstances: firstNumber(payload, GAP_INSTANCE_KEYS),
    courses: firstNumber(payload, COURSES_KEYS),
    reportedP95Ms: firstNumber(payload, P95_KEYS),
    solveTimesMs: firstNumberArray(payload, SOLVE_TIME_KEYS),
    numericFields,
    nonNumericFields,
  };
}

// ---------------------------------------------------------------------------
// activeDataset descriptor — static reading of whatever object literal the
// module exports. The literal's SHAPE is the artifact's choice: every
// primitive field is recorded verbatim; the suites then recognize the claims
// they can check (a .json file reference, a sha256 digest, count numbers).
// ---------------------------------------------------------------------------

export interface ActiveDatasetDescriptor {
  /** Every primitive string/number/boolean field seen, verbatim (nested
   * group members get dotted keys like "counts.courses"). */
  fields: Record<string, string | number | boolean>;
  /** Numeric count keys (courses, counts.buildings, ...) claimed by the descriptor. */
  counts: Record<string, number>;
  /** Keys whose values could not be read statically (arrays, spreads, computed values). */
  ignored: string[];
}

export type DescriptorExtraction =
  | { found: true; descriptor: ActiveDatasetDescriptor }
  | { found: false; reason: string };

/**
 * Statically extract `activeDataset = { ... }` (or `activeDataset: {...}`)
 * from the target's data-provenance.ts WITHOUT importing it (the harness
 * never pulls the target's dependency graph). Flat primitives are read
 * directly; one-level nested groups of primitives flatten to dotted keys;
 * other non-primitive values are recorded as ignored — they are metadata,
 * and computed/templated values simply leave nothing to verify. Nothing
 * here fails on shape: `found: false` only means no readable object literal
 * exists at all, in which case the caller reports not-applicable with the
 * reason (the real interface cannot be determined statically).
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
      // One-level nested groups flatten. A group named `counts` is a
      // conventional count container — its numeric members merge under
      // their bare names (`counts: { buildings: 16 }` claims 16
      // buildings). Any other group is metadata: members are kept as
      // dotted fields for evidence but never become count claims.
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
      // verify statically; record and move on.
      ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(literal, cursor);
      continue;
    }
    const value = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))/.exec(rest);
    if (value === null) {
      // Not a primitive literal (identifier, template, arithmetic). Skip
      // past the value so its interior (ternaries etc.) is never misread
      // as top-level keys. Computed values are metadata, never a failure —
      // the harness does not prescribe the descriptor's shape.
      ignored.push(key);
      pair.lastIndex = skipToTopLevelSeparator(literal, cursor);
      continue;
    }
    // A primitive match is only the whole value if a member terminator
    // follows: `'a'.repeat(64)` starts like the string "a" but is a
    // computed value, so it is ignored rather than misread as "a". The
    // literal slice excludes the closing brace, so end-of-slice is a
    // complete member, not a truncated one.
    let afterValue = cursor + (value[0]?.length ?? 0);
    while (afterValue < literal.length && /\s/.test(literal[afterValue] ?? "")) afterValue += 1;
    const nextCh = literal[afterValue] ?? "";
    if (nextCh !== "," && nextCh !== "}" && nextCh !== "") {
      ignored.push(key);
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

  return { found: true, descriptor: { fields, counts, ignored } };
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
    // Same continuation rule as the top-level scanner: a primitive match
    // followed by anything but a separator is a computed value. `inner`
    // excludes the group's closing brace, so end-of-slice is a complete
    // member, not a truncated one.
    let afterValue = cursor + (value[0]?.length ?? 0);
    while (afterValue < inner.length && /\s/.test(inner[afterValue] ?? "")) afterValue += 1;
    const nextCh = inner[afterValue] ?? "";
    if (nextCh !== "," && nextCh !== "}" && nextCh !== "") {
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

// ---------------------------------------------------------------------------
// Descriptor claim recognition + verification — the suite checks only claims
// the descriptor itself makes; absence of recognizable claims is
// not-applicable, a FALSE claim is a fail.
// ---------------------------------------------------------------------------

export interface DescriptorClaims {
  /** A string field naming a bundled file (name in FILE_CLAIM_NAMES, or any
   * string value that looks like a .json path). */
  fileClaim: { key: string; value: string } | null;
  /** A 64-hex digest field, whatever its name. */
  hashClaim: { key: string; value: string } | null;
  /** Numeric fields eligible for bundle comparison (bare keys). */
  countClaims: Record<string, number>;
  /** File-claim keys considered and rejected (evidence). */
  fileClaimCandidatesRejected: Array<{ key: string; value: string; why: string }>;
}

/** Field names whose string value is read as a bundled-file reference. */
const FILE_CLAIM_NAMES = ["file", "bundle", "catalogFile", "datasetFile", "path"];

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * Recognize the verifiable claims inside an extracted descriptor. File
 * claims are recognized by field name first, then by .json-suffix values;
 * hash claims by 64-hex shape, whatever the field is called. This is
 * recognition, not prescription: a descriptor with none of these simply
 * yields nulls and the caller reports what could and could not be checked.
 */
export function recognizeDescriptorClaims(descriptor: ActiveDatasetDescriptor): DescriptorClaims {
  const rejected: Array<{ key: string; value: string; why: string }> = [];
  let fileClaim: { key: string; value: string } | null = null;

  for (const [key, value] of Object.entries(descriptor.fields)) {
    if (typeof value !== "string") continue;
    if (FILE_CLAIM_NAMES.includes(key)) {
      fileClaim = { key, value: value.trim() };
      break;
    }
  }
  if (fileClaim === null) {
    for (const [key, value] of Object.entries(descriptor.fields)) {
      if (typeof value !== "string") continue;
      if (/\.json$/i.test(value.trim()) && !HEX64.test(value)) {
        fileClaim = { key, value: value.trim() };
        break;
      }
      rejected.push({ key, value, why: "not a file-reference field name or .json value" });
    }
  }

  let hashClaim: { key: string; value: string } | null = null;
  for (const [key, value] of Object.entries(descriptor.fields)) {
    if (typeof value === "string" && HEX64.test(value.trim()) && value.trim() !== fileClaim?.value) {
      hashClaim = { key, value: value.trim().toLowerCase() };
      break;
    }
  }

  return {
    fileClaim,
    hashClaim,
    countClaims: { ...descriptor.counts },
    fileClaimCandidatesRejected: rejected,
  };
}

export interface CountCheck {
  key: string;
  expected: number;
  actual: string;
  ok: boolean | null; // null = no counterpart in the bundle (recorded, not judged)
  kind: "array-length" | "number" | "no-counterpart" | "bundle-not-json";
}

export interface DescriptorVerification {
  bundledFile: string | null;
  /** Hash comparison: null where there was no hash claim or no readable bundle. */
  hashExpected: string | null;
  hashActual: string | null;
  hashOk: boolean | null;
  countChecks: CountCheck[];
  /** True only when every recognized claim was checked and held. */
  allCheckedOk: boolean;
  /** True when at least one claim (hash or count) could actually be checked. */
  anythingChecked: boolean;
}

/**
 * Verify recognized descriptor claims against the actually-bundled catalog
 * file: sha256 of the file's utf8 bytes (when the descriptor claims one),
 * then each claimed count that has a counterpart in the bundle (array ->
 * length, number -> direct compare). Claims with no bundle counterpart are
 * recorded but not judged — the harness does not prescribe the bundle's
 * shape either.
 */
export function verifyDescriptorAgainstBundle(
  claims: DescriptorClaims,
  bundledAbsPath: string,
  bundledUtf8: string | null,
): DescriptorVerification {
  const hashExpected = claims.hashClaim?.value ?? null;
  const hashActual = bundledUtf8 === null ? null : sha256Hex(bundledUtf8);
  const hashOk = hashExpected !== null && hashActual !== null ? hashExpected === hashActual : null;

  const countChecks: CountCheck[] = [];
  let root: Record<string, unknown> | undefined;
  if (bundledUtf8 !== null) root = parseJsonObject(bundledUtf8);
  for (const [key, expected] of Object.entries(claims.countClaims)) {
    if (bundledUtf8 === null) {
      countChecks.push({ key, expected, actual: "bundle unreadable", ok: null, kind: "no-counterpart" });
      continue;
    }
    if (root === undefined) {
      countChecks.push({ key, expected, actual: "bundle is not valid JSON", ok: false, kind: "bundle-not-json" });
      continue;
    }
    const actual = root[key];
    if (Array.isArray(actual)) {
      countChecks.push({ key, expected, actual: `array length ${actual.length}`, ok: actual.length === expected, kind: "array-length" });
    } else if (typeof actual === "number" && Number.isFinite(actual)) {
      countChecks.push({ key, expected, actual: `${actual}`, ok: actual === expected, kind: "number" });
    } else {
      countChecks.push({ key, expected, actual: Array.isArray(actual) ? "array" : typeof actual, ok: null, kind: "no-counterpart" });
    }
  }

  const judged = countChecks.filter((c) => c.ok !== null);
  return {
    bundledFile: bundledUtf8 === null ? null : bundledAbsPath,
    hashExpected,
    hashActual,
    hashOk,
    countChecks,
    // No check may have failed; checks that could not be performed (no hash
    // claim, no bundle) are the caller's not-applicable concern.
    allCheckedOk: hashOk !== false && judged.every((c) => c.ok === true),
    anythingChecked: hashOk !== null || judged.length > 0,
  };
}

/**
 * Resolve a descriptor's file claim to an absolute path in the target
 * checkout. The claim's base is the artifact's choice, so every plausible
 * base is tried and recorded: frontend/, the repo root, and the provenance
 * module's own directory. Returns every path tried so evidence can name them.
 */
export function resolveBundledCatalogPath(targetDir: string, fileClaim: string): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  const trimmed = fileClaim.trim();
  const candidates = [
    path.join(targetDir, "frontend", trimmed),
    path.join(targetDir, trimmed),
    path.join(targetDir, "frontend", "src", "lib", trimmed),
  ];
  for (const candidate of candidates) {
    tried.push(candidate);
    if (existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}
