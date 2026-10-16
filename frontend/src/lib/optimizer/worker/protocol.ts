/**
 * What the page and the optimizer worker say to each other.
 *
 * A function cannot cross postMessage, so the page sends the request with
 * its walking-time provider replaced by a table of every pair of buildings
 * the request's sections use (`toPlainRequest`). The worker turns the table
 * back into a provider (`fromPlainRequest`) and answers in up to two phases:
 *
 * 1. `first`: a search with FIRST_BUDGET_MS, posted as soon as it ends, so
 *    the page shows something quickly.
 * 2. `final`: only when the first answer is not settled (status `feasible`
 *    or `timeout`), a fresh search with FINAL_BUDGET_MS that replaces it.
 *
 * `optimal` and `infeasible` are proofs, so nothing follows them. Every
 * reply carries the job's id; the page drops replies to an older job.
 *
 * A browse job (`kind: "browse"`, Week's Browse all) is one call to
 * `enumerateSchedules` with its node budgets and BROWSE_BUDGET_MS as a
 * wall-clock cap, answered once.
 *
 * Imports only engine types, so the worker bundle holds the engine and this
 * file and nothing else (see build-worker.ts).
 */
import type { OptimizeRequest, OptimizeResult, OptWalkingTime, OptWalkingTimeFn } from "../types";
import type { EnumerateRequest, EnumerateResult } from "../enumerate";
import { allowedSections, passesTimeConstraints } from "../prepare";

/** Budget for the answer shown first. */
export const FIRST_BUDGET_MS = 300;
/** Cap for the follow-up search when the first answer is not proven. */
export const FINAL_BUDGET_MS = 3000;

/** Walking times between `ids`, row-major: legs[i * ids.length + j] is ids[i] -> ids[j]. */
export type WalkingTable = { ids: string[]; legs: OptWalkingTime[] };

/** An OptimizeRequest, including its term, that survives structured cloning. Budgets are set by the worker. */
export type PlainRequest = Omit<OptimizeRequest, "walkingTime" | "now" | "timeBudgetMs" | "maxNodes"> & {
  walking: WalkingTable;
};

export type OptimizeJob = { id: number; request: PlainRequest };

export type OptimizeReply =
  | {
      id: number;
      phase: "first" | "final";
      result: OptimizeResult;
      /** True when no further reply is coming for this job. */
      settled: boolean;
    }
  | { id: number; phase: "error"; message: string };

/**
 * Every walk the engine can ask about, as a table. With walking weighted or
 * checked, buildings come from every section of the request's courses,
 * including excluded, locked-out and time-filtered ones, so a suggested
 * relaxation that brings a section back still has its walks. Without
 * walking, walks only feed the breakdown of returned schedules, which use
 * allowed sections alone, so only their buildings are tabulated (none when
 * everything is filtered out). Same-ID legs also come from the provider: an
 * off-campus or otherwise unroutable building may remain unknown.
 */
export function toPlainRequest(request: OptimizeRequest): PlainRequest {
  const { walkingTime, now: _now, timeBudgetMs: _budget, maxNodes: _nodes, ...rest } = request;
  void _now;
  void _budget;
  void _nodes;
  const walkingActive = request.weights.walking > 0 || request.constraints.walking !== null;
  const sections = request.courses.flatMap((course) =>
    walkingActive
      ? course.sections
      : allowedSections(course, request).filter((section) => passesTimeConstraints(section, request.constraints, request.term ?? null)),
  );
  const ids = [
    ...new Set(sections.flatMap((section) => section.meetings.map((meeting) => meeting.buildingId).filter((id): id is string => id !== null))),
  ].sort();
  const legs = ids.flatMap((from) => ids.map((to) => walkingTime(from, to)));
  return { ...rest, walking: { ids, legs } };
}

/** The provider the engine calls, answered from the table. A pair outside it is unknown, never 0. */
export function walkingFromTable(table: WalkingTable): OptWalkingTimeFn {
  const index = new Map(table.ids.map((id, i) => [id, i] as const));
  const n = table.ids.length;
  return (from, to) => {
    const i = index.get(from);
    const j = index.get(to);
    if (i === undefined || j === undefined) return { seconds: null, source: "unknown" };
    return table.legs[i * n + j];
  };
}

export function fromPlainRequest(plain: PlainRequest, timeBudgetMs: number): OptimizeRequest {
  const { walking, ...rest } = plain;
  return { ...rest, walkingTime: walkingFromTable(walking), timeBudgetMs };
}

/** A result that needs no longer search: a proof either way. */
export function isSettled(result: OptimizeResult): boolean {
  return result.status === "optimal" || result.status === "infeasible";
}

export type JobDeps = {
  optimize: (request: OptimizeRequest) => OptimizeResult;
  post: (reply: OptimizeReply) => void;
};

/** Runs one job through both phases. Any throw becomes an `error` reply. */
export function runJob(job: OptimizeJob, deps: JobDeps): void {
  try {
    const first = deps.optimize(fromPlainRequest(job.request, FIRST_BUDGET_MS));
    const settled = isSettled(first);
    deps.post({ id: job.id, phase: "first", result: first, settled });
    if (settled) return;
    const final = deps.optimize(fromPlainRequest(job.request, FINAL_BUDGET_MS));
    deps.post({ id: job.id, phase: "final", result: final, settled: true });
  } catch (error) {
    deps.post({ id: job.id, phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/** Rows the Browse all list asks for. */
export const BROWSE_LIMIT = 500;
/**
 * Wall-clock cap on a browse job, on top of the enumeration's node budgets,
 * for a machine much slower than the one tests/optimizer/browse-bench.ts
 * ran on (where the node budgets end the slowest list near 1.8 s). Not
 * measured on such a machine.
 */
export const BROWSE_BUDGET_MS = 4000;

export type BrowseJob = { id: number; kind: "browse"; request: PlainRequest };

export type BrowseReply =
  | { id: number; phase: "browse"; result: EnumerateResult; settled: true }
  | { id: number; phase: "error"; message: string };

export function browseRequest(plain: PlainRequest): EnumerateRequest {
  const { walking, k: _k, ...rest } = plain;
  void _k;
  return { ...rest, walkingTime: walkingFromTable(walking), limit: BROWSE_LIMIT, timeBudgetMs: BROWSE_BUDGET_MS };
}

export type BrowseDeps = {
  enumerate: (request: EnumerateRequest) => EnumerateResult;
  post: (reply: BrowseReply) => void;
};

/** Runs one browse job. Any throw becomes an `error` reply. */
export function runBrowseJob(job: BrowseJob, deps: BrowseDeps): void {
  try {
    deps.post({ id: job.id, phase: "browse", result: deps.enumerate(browseRequest(job.request)), settled: true });
  } catch (error) {
    deps.post({ id: job.id, phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
