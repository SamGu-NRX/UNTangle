/**
 * scorecard — the scorecard type, validator, and writer.
 *
 * The JSON shape is documented in evals/SCHEMA.md; SCHEMA.md and this file
 * must be kept in lockstep. Every scorecard written to disk goes through
 * validateScorecard() first (and is re-read and re-validated after writing).
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export type CaseStatus = "pass" | "fail" | "not-applicable";
export type StepStatus = "pass" | "fail" | "skipped";

/** One stack/preflight step, with its wall-clock duration. */
export interface StackStepRecord {
  step: string;
  status: StepStatus;
  durationMs: number;
  detail?: string;
  logPath?: string;
}

/** One evaluated case. */
export interface CaseRecord {
  suite: string;
  id: string;
  status: CaseStatus;
  measured?: string | number | boolean | null;
  bar?: string;
  evidencePath?: string;
  note?: string;
}

export interface ScorecardRuntime {
  bun: string;
  node: string;
  postgres: string;
  playwright: string;
  os: string;
}

export interface Scorecard {
  schemaVersion: 1;
  suite: string;
  startedAt: string;
  finishedAt: string;
  target: {
    sha: string;
    dir: string;
    /** Actual `git rev-parse HEAD` of the target checkout, when detectable. */
    actualHead: string | null;
  };
  runtime: ScorecardRuntime;
  /** Per-step stack results, in execution order, with durations. */
  stack: StackStepRecord[];
  infrastructure: {
    ok: boolean;
    /** The named step that broke, when the run died on infrastructure. */
    brokenStep: string | null;
    error?: string;
  };
  cases: CaseRecord[];
  /** Count of RateMyProfessors requests blocked by the rmp-block preload. */
  blockedRmpRequests: number;
  /** Honest labels for degraded/stubbed behavior the run observed. */
  stubs: Array<{ label: string; reason: string }>;
  hashes: {
    /** sha256 of the harness checkout's evals/CONTRACT.md. */
    contractMd: string;
    /** sha256 of the harness checkout's evals/bars.json. */
    barsJson: string;
  };
}

export class ScorecardValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`scorecard failed validation:\n  - ${problems.join("\n  - ")}`);
    this.name = "ScorecardValidationError";
    this.problems = problems;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Hex(await readFile(filePath, "utf8"));
}

/**
 * Returns a list of problems; an empty list means the scorecard is valid.
 * Deliberately total: it never throws, so callers can report every problem.
 */
export function validateScorecard(card: unknown): string[] {
  const problems: string[] = [];
  const p = (message: string): void => {
    problems.push(message);
  };

  if (!isPlainObject(card)) {
    return ["scorecard must be a JSON object"];
  }
  const sc = card as Record<string, unknown>;

  if (sc.schemaVersion !== 1) p(`schemaVersion must be 1, got ${JSON.stringify(sc.schemaVersion)}`);
  if (!isNonEmptyString(sc.suite)) p("suite must be a non-empty string");

  for (const key of ["startedAt", "finishedAt"] as const) {
    const value = sc[key];
    if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
      p(`${key} must be an ISO-8601 timestamp, got ${JSON.stringify(value)}`);
    }
  }
  if (
    typeof sc.startedAt === "string" &&
    typeof sc.finishedAt === "string" &&
    Date.parse(sc.finishedAt) < Date.parse(sc.startedAt)
  ) {
    p("finishedAt must not be before startedAt");
  }

  const target = sc.target;
  if (!isPlainObject(target)) {
    p("target must be an object");
  } else {
    if (typeof target.sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(target.sha)) {
      p("target.sha must be a git sha (7-40 hex chars)");
    }
    if (!isNonEmptyString(target.dir)) p("target.dir must be a non-empty string");
    const head = target.actualHead;
    if (head !== null && (typeof head !== "string" || !/^[0-9a-f]{7,40}$/i.test(head))) {
      p("target.actualHead must be null or a git sha");
    }
  }

  const runtime = sc.runtime;
  if (!isPlainObject(runtime)) {
    p("runtime must be an object");
  } else {
    for (const key of ["bun", "node", "postgres", "playwright", "os"] as const) {
      if (!isNonEmptyString(runtime[key])) p(`runtime.${key} must be a non-empty string`);
    }
  }

  const stack = sc.stack;
  if (!Array.isArray(stack) || stack.length === 0) {
    p("stack must be a non-empty array of step records");
  } else {
    const seen = new Set<string>();
    for (const entry of stack) {
      if (!isPlainObject(entry)) {
        p("every stack entry must be an object");
        continue;
      }
      const step = entry.step;
      if (!isNonEmptyString(step)) {
        p("every stack entry needs a step id");
        continue;
      }
      if (seen.has(step)) p(`duplicate stack step id: ${step}`);
      seen.add(step);
      if (entry.status !== "pass" && entry.status !== "fail" && entry.status !== "skipped") {
        p(`stack[${step}].status must be pass|fail|skipped`);
      }
      if (typeof entry.durationMs !== "number" || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) {
        p(`stack[${step}].durationMs must be a non-negative number`);
      }
    }
  }

  const infra = sc.infrastructure;
  if (!isPlainObject(infra)) {
    p("infrastructure must be an object");
  } else {
    if (typeof infra.ok !== "boolean") p("infrastructure.ok must be a boolean");
    if (infra.ok === false && !isNonEmptyString(infra.brokenStep)) {
      p("infrastructure.brokenStep must name the broken step when ok is false");
    }
    if (infra.ok === true && infra.brokenStep !== null) {
      p("infrastructure.brokenStep must be null when ok is true");
    }
  }

  if (!Array.isArray(sc.cases)) {
    p("cases must be an array");
  } else {
    for (const entry of sc.cases) {
      if (!isPlainObject(entry)) {
        p("every case must be an object");
        continue;
      }
      const label = isNonEmptyString(entry.id) ? entry.id : "<missing id>";
      if (!isNonEmptyString(entry.suite)) p(`cases[${label}].suite must be a non-empty string`);
      if (!isNonEmptyString(entry.id)) p("every case needs a non-empty id");
      if (entry.status !== "pass" && entry.status !== "fail" && entry.status !== "not-applicable") {
        p(`cases[${label}].status must be pass|fail|not-applicable`);
      }
      if (entry.bar !== undefined && !isNonEmptyString(entry.bar)) {
        p(`cases[${label}].bar must be a non-empty string when present`);
      }
    }
  }

  if (
    typeof sc.blockedRmpRequests !== "number" ||
    !Number.isInteger(sc.blockedRmpRequests) ||
    sc.blockedRmpRequests < 0
  ) {
    p("blockedRmpRequests must be a non-negative integer");
  }

  if (!Array.isArray(sc.stubs)) {
    p("stubs must be an array");
  } else {
    for (const entry of sc.stubs) {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.label) || !isNonEmptyString(entry.reason)) {
        p("every stub needs non-empty label and reason strings");
      }
    }
  }

  const hashes = sc.hashes;
  if (!isPlainObject(hashes)) {
    p("hashes must be an object");
  } else {
    for (const key of ["contractMd", "barsJson"] as const) {
      const value = hashes[key];
      if (typeof value !== "string" || !SHA256_HEX.test(value)) {
        p(`hashes.${key} must be a 64-char sha256 hex digest`);
      }
    }
  }

  return problems;
}

export function assertValidScorecard(card: unknown): void {
  const problems = validateScorecard(card);
  if (problems.length > 0) throw new ScorecardValidationError(problems);
}

/**
 * Validates, writes pretty JSON, then re-reads and re-validates from disk so
 * the file itself (not just the in-memory object) is proven valid.
 */
export async function writeScorecard(filePath: string, card: Scorecard): Promise<void> {
  assertValidScorecard(card);
  const json = JSON.stringify(card, null, 2);
  await writeFile(filePath, json);
  const reread = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  assertValidScorecard(reread);
}
