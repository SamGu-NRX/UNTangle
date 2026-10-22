/**
 * suite-kit — the authoring surface for UNTangle eval suites.
 *
 * Convention (enforced by evals/run.ts):
 *   - A suite file lives at `evals/suites/<name>.ts` (suite workers add these;
 *     they must not touch any other harness file) or, for the built-in
 *     preflight-only suite, at `evals/selfcheck/index.ts`.
 *   - The file default-exports (or exports as `suite`) the result of
 *     `defineSuite({ name, describe, run })`.
 *   - `describe()` returns the case list up front so the runner can still emit
 *     an honest all-`not-applicable` scorecard when infrastructure dies.
 *   - `run(caseId, ctx)` executes ONE case and returns a `CaseOutcome`.
 *   - `run.ts` runs suites from the explicit registry (SUITE_REGISTRY in
 *     evals/run.ts, decision 685b) — a suite exists when its file is present
 *     AND it is registered; a suite file's basename must equal its `name`.
 *     Helper modules (underscore-prefixed files) are imported by suites and
 *     are never registered.
 */

export type CaseStatus = "pass" | "fail" | "not-applicable";

export interface CaseSpec {
  /** Stable case id, unique within the suite. */
  id: string;
  /** Human title used in the markdown summary. */
  title?: string;
}

export interface CaseOutcome {
  status: CaseStatus;
  /** The value actually observed (e.g. "median 412ms", "0 violations", 3). */
  measured?: string | number | boolean | null;
  /** The bar this case was judged against. Defaults to the suite's bars.json bar. */
  bar?: string;
  /** Path to a file (log, screenshot, JSON) evidencing the outcome. */
  evidencePath?: string;
  /** Free-form context, e.g. why a case is not-applicable. */
  note?: string;
}

export interface SuiteContext {
  /** Directory holding this run's logs and evidence files. */
  runDir: string;
  /** Frontend app origin, e.g. http://localhost:3902 (BETTER_AUTH_URL-aligned). */
  frontendOrigin: string;
  /** Backend origin, e.g. http://127.0.0.1:3961. */
  backendOrigin: string;
  /** Postgres connection string handed to the frontend (persistence gate). */
  databaseUrl: string;
  /** JSON file where the rmp-block preload records blocked requests. */
  blockedRmpLogPath: string;
  /** Results of the preflight/stack steps, for suites that assert plumbing. */
  preflightSteps: Array<{
    step: string;
    status: "pass" | "fail" | "skipped";
    durationMs: number;
    detail?: string;
  }>;
  /** Aborted by the runner when this case exceeds its wall-clock budget. */
  signal?: AbortSignal;
}

export interface SuiteDefinition {
  name: string;
  describe: () => CaseSpec[] | Promise<CaseSpec[]>;
  run: (caseId: string, ctx: SuiteContext) => Promise<CaseOutcome> | CaseOutcome;
  /** Per-case wall-clock cap (default 120000). */
  caseTimeoutMs?: number;
}

export function defineSuite(definition: SuiteDefinition): SuiteDefinition {
  return definition;
}

/** Structural check applied to every discovered suite module. */
export function isSuiteDefinition(value: unknown): value is SuiteDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.describe === "function" &&
    typeof candidate.run === "function"
  );
}
