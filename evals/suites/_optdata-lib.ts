/**
 * _optdata-lib — shared machinery for the optimizer and data suites.
 *
 * The underscore prefix marks this as a helper module, not a suite; the
 * runner's explicit SUITE_REGISTRY (decision 685b) never registers it, and
 * *.test.* files are skipped, so it exports no suite-shaped default.
 *
 * DESIGN RULE (decision 685c — replaces the review-era detect-and-adapt
 * rule): the data and optimizer adapters call the TARGET's REAL tools with
 * the exact CLI those tools define. The invocations below are prescribed —
 * discovered once by reading the tools' own code at the PR heads that
 * introduced them (catalog-consistency at the PR #6 head, run-bench.ts at
 * the PR #14 head), not re-derived at run time from the target:
 *
 *   data:      node tools/catalog-consistency/audit.mjs \
 *                --input frontend/src/lib/generated/seed-data.json --out <dir>
 *              node tools/catalog-consistency/verify.mjs \
 *                --results <dir> --repo-root <target-root>
 *              (verify.mjs's parser REQUIRES --repo-root; audit.mjs's own
 *              "verify with:" hint line omits it — the parser is authoritative.)
 *
 *   optimizer: cd frontend && bun run src/lib/optimizer/bench/run-bench.ts \
 *                --variant=./src/lib/optimizer/brute-force --suite=all \
 *                --k=3 --repeat=3
 *              then read frontend/src/lib/optimizer/bench/results/
 *              brute-force-all.json (the runner writes results next to
 *              itself: import.meta.dir/results).
 *
 * Not-applicable is reserved for ABSENT target files. A tool that exists
 * but exits nonzero, times out, or writes output that cannot be parsed
 * FAILS the case — that is a real application finding, never a skip.
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

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Round to one decimal for compact `measured` strings (p95 in ms). */
export function roundNumber(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Prescribed real-tool invocations (decision 685c) — the adapters run the
// TARGET's real tools with the exact CLI those tools' own code defines (read
// once at the PR heads that introduced them; see the file header). Pure
// builders: no filesystem probing happens here.
// ---------------------------------------------------------------------------

export const DATA_AUDIT_REL = path.join("tools", "catalog-consistency", "audit.mjs");
export const DATA_VERIFY_REL = path.join("tools", "catalog-consistency", "verify.mjs");
export const SEED_DATA_REL = path.join("frontend", "src", "lib", "generated", "seed-data.json");

export const BENCH_RUN_REL = path.join("frontend", "src", "lib", "optimizer", "bench", "run-bench.ts");
export const BENCH_RESULTS_DIR_REL = path.join("frontend", "src", "lib", "optimizer", "bench", "results");
/** The bench's own default reference variant (run-bench.ts's usage header). */
export const BENCH_VARIANT = "./src/lib/optimizer/brute-force";
/** Results file the real runner writes for `--suite=all`: <variant-basename>-<suite>.json. */
export const BENCH_RESULTS_FILE_REL = path.join(BENCH_RESULTS_DIR_REL, "brute-force-all.json");
/**
 * The pinned 8-course instance family (bench instances.ts; the bench README
 * commits to these family names). The bar's "8 courses" maps to this record.
 */
export const XL_INSTANCE_NAME = "worst-case-xl";

export interface PrescribedCommand {
  cmd: string;
  args: string[];
  cwd: string;
  describe: string;
}

/** The real audit.mjs invocation, cwd = the target root. */
export function catalogAuditCommand(targetDir: string, outDir: string): PrescribedCommand {
  return {
    cmd: "node",
    args: [DATA_AUDIT_REL, "--input", SEED_DATA_REL, "--out", outDir],
    cwd: targetDir,
    describe: `node ${DATA_AUDIT_REL} --input ${SEED_DATA_REL} --out ${outDir}`,
  };
}

/** The real verify.mjs invocation, cwd = the target root (--repo-root is required by its parser). */
export function catalogVerifyCommand(targetDir: string, resultsDir: string): PrescribedCommand {
  return {
    cmd: "node",
    args: [DATA_VERIFY_REL, "--results", resultsDir, "--repo-root", targetDir],
    cwd: targetDir,
    describe: `node ${DATA_VERIFY_REL} --results ${resultsDir} --repo-root ${targetDir}`,
  };
}

/** The real run-bench.ts invocation, cwd = the target's frontend/. */
export function benchCommand(targetDir: string): PrescribedCommand {
  const frontendDir = path.join(targetDir, "frontend");
  const runRel = path.relative(frontendDir, path.join(targetDir, BENCH_RUN_REL));
  return {
    cmd: "bun",
    args: ["run", runRel, `--variant=${BENCH_VARIANT}`, "--suite=all", "--k=3", "--repeat=3"],
    cwd: frontendDir,
    describe: `bun run ${runRel} --variant=${BENCH_VARIANT} --suite=all --k=3 --repeat=3`,
  };
}

export type VerifyVerdict = "PASS" | "FAIL";

/**
 * verify.mjs's verdict is the LAST non-empty line of its output:
 * `verdict: PASS` or `verdict: FAIL`. Anything else is unparseable (null).
 */
export function parseVerifyVerdict(stdout: string): VerifyVerdict | null {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === "verdict: PASS") return "PASS";
  if (last === "verdict: FAIL") return "FAIL";
  return null;
}

/** Strictly read a target tool's JSON output file: a JSON object, or undefined. */
export function readJsonObjectFile(filePath: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  return parseJsonObject(text);
}

// ---------------------------------------------------------------------------
// Real bench-report reading (decision 685c) — the prescribed run-bench.ts
// report shape, as defined by run-bench.ts's own code at the PR #14 head:
//   { variant, suite, k, repeat, instances: [...], sizeSummary: [...] }
// with per-instance records { name, suite, sizeClass, enumerable, statuses,
// violations (max checker violations across repeats), iisValid, optimalityGap,
// topKAgreement, diversity, initMsP50/P95, searchMsP50/P95, wallMsP50/P95,
// skipped? }. A report that does not parse into that shape fails the case.
// ---------------------------------------------------------------------------

export type BenchReportParse =
  | { ok: true; report: Record<string, unknown>; instances: Array<Record<string, unknown>> }
  | { ok: false; reason: string };

/** Parse the real bench's results file text; unparseable/foreign shapes name exactly what was wrong. */
export function parseBenchReport(text: string): BenchReportParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `bench results file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "bench results file is not a JSON object" };
  }
  const report = parsed as Record<string, unknown>;
  if (!Array.isArray(report.instances)) {
    return { ok: false, reason: "bench results file has no instances array (not the run-bench.ts report shape)" };
  }
  for (const entry of report.instances) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "bench results instances array holds a non-object entry" };
    }
  }
  return { ok: true, report, instances: report.instances as Array<Record<string, unknown>> };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface BenchReportSummary {
  /** Instances whose record carries a numeric `violations` count (the checker ran on them). */
  violationsChecked: number;
  /** Max numeric violations across those instances (null when none reported). */
  violationsMax: number | null;
  /** "name=N" for every instance whose violations count is > 0. */
  violationsBreaches: string[];
  /** Enumerable, non-skipped instances reporting a numeric `optimalityGap` (a comparable best cost). */
  gapChecked: number;
  gapMax: number | null;
  /** "name=G" for every judged instance whose gap is not 0. */
  gapBreaches: string[];
  /** Enumerable, non-skipped instances that reported no comparable gap (e.g. proved infeasible). */
  gapUnjudged: number;
  /** Instances the bench itself skipped, by name, with the bench's own reason. */
  skipped: Array<{ name: string; reason: string }>;
  /** The pinned 8-course family's solve-time p95 (its own wallMsP95). */
  xlWallMsP95: number | null;
  /** Whether the report carries a record named XL_INSTANCE_NAME at all. */
  xlRecordPresent: boolean;
  /** The pinned family's skip reason, when the bench skipped it. */
  xlSkipReason: string | null;
}

/**
 * Summarize the real bench report for the three optimizer cases. Judged
 * fields are the bench's own outputs (checker `violations`, the
 * brute-force-compared `optimalityGap`, per-instance `wallMsP95`); the
 * 8-course condition maps to the pinned family record by its committed name.
 */
export function summarizeBenchReport(instances: Array<Record<string, unknown>>): BenchReportSummary {
  const summary: BenchReportSummary = {
    violationsChecked: 0,
    violationsMax: null,
    violationsBreaches: [],
    gapChecked: 0,
    gapMax: null,
    gapBreaches: [],
    gapUnjudged: 0,
    skipped: [],
    xlWallMsP95: null,
    xlRecordPresent: false,
    xlSkipReason: null,
  };
  for (const record of instances) {
    const name = asNonEmptyString(record.name) ?? "<unnamed>";
    const skipReason = asNonEmptyString(record.skipped);
    if (skipReason !== null) summary.skipped.push({ name, reason: skipReason });

    const violations = asFiniteNumber(record.violations);
    if (violations !== null) {
      summary.violationsChecked += 1;
      if (summary.violationsMax === null || violations > summary.violationsMax) summary.violationsMax = violations;
      if (violations > 0) summary.violationsBreaches.push(`${name}=${violations}`);
    }

    if (record.enumerable === true && skipReason === null) {
      const gap = asFiniteNumber(record.optimalityGap);
      if (gap !== null) {
        summary.gapChecked += 1;
        if (summary.gapMax === null || gap > summary.gapMax) summary.gapMax = gap;
        if (gap !== 0) summary.gapBreaches.push(`${name}=${gap}`);
      } else {
        summary.gapUnjudged += 1;
      }
    }

    if (name === XL_INSTANCE_NAME) {
      summary.xlRecordPresent = true;
      summary.xlSkipReason = skipReason;
      summary.xlWallMsP95 = asFiniteNumber(record.wallMsP95);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Verbatim numeric collection — every number a tool's parsed output carries,
// wherever it nests them. Used for the data suite's certification evidence.
// Output shapes belong to the tool that printed them — the collector adapts,
// it does not prescribe.
// ---------------------------------------------------------------------------

/**
 * Collect every finite number in the payload, descending into nested plain
 * objects (leaf keys get dotted paths like "totals.courses"). Arrays and
 * other non-numbers are not counts; they are named for the evidence note.
 */
export function collectNumericCounts(
  payload: Record<string, unknown>,
): { counts: Record<string, number>; nonNumericFields: string[] } {
  const counts: Record<string, number> = {};
  const nonNumericFields: string[] = [];
  const visit = (value: unknown, prefix: string): void => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, prefix === "" ? k : `${prefix}.${k}`);
      return;
    }
    if (prefix === "") return;
    if (typeof value === "number" && Number.isFinite(value)) counts[prefix] = value;
    else nonNumericFields.push(prefix);
  };
  visit(payload, "");
  return { counts, nonNumericFields };
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
