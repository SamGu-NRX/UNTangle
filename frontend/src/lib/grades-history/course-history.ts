/**
 * Reading one course's grade history from the browser: the same history
 * result the grades routes serve, for callers that need accepted evidence
 * on the client (the planner feeds it to the optimizer's instructor
 * tie-break). No storage, no retries; the caller owns pacing. Every request
 * is bounded by a timeout, so a stalled connection resolves unavailable
 * instead of hanging forever, and `fetchMissingHistories` keeps one fetch
 * per course per session.
 */

import type { CourseHistory, HistoryResult } from "./types";

const BASE = "/api/grades/courses";

/** How long one history request may run before it resolves unavailable. */
export const COURSE_HISTORY_TIMEOUT_MS = 10_000;

export type FetchCourseHistoryOptions = {
  /** Aborts the request with the caller; aborting still rejects. */
  signal?: AbortSignal;
  /** Overrides the default request bound (tests use a short one). */
  timeoutMs?: number;
};

export async function fetchCourseHistory(subject: string, number: string, options: FetchCourseHistoryOptions = {}): Promise<HistoryResult<CourseHistory>> {
  const timeoutMs = options.timeoutMs ?? COURSE_HISTORY_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${BASE}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    // The bound's own abort is an unavailable result, not a throw: one
    // stalled connection is one course's unknown evidence, never a crash.
    // The caller's own abort (an effect cancelling) still rejects.
    if (timeout.aborted && !options.signal?.aborted) {
      return {
        status: "unavailable",
        source: "untgrades.app",
        data: null,
        error: { reason: "upstream", message: `course history request timed out after ${timeoutMs} ms` },
      };
    }
    throw error;
  }
  if (!response.ok) {
    return { status: "unavailable", source: "untgrades.app", data: null, error: { reason: "upstream", message: `course history request failed with ${response.status}` } };
  }
  return (await response.json()) as HistoryResult<CourseHistory>;
}

/**
 * Histories for `codes`, fetching only what `cached` lacks: a course's
 * history does not change with the catalog, so re-mapping cached results on
 * every catalog update costs no request (the planner's evidence effect runs
 * per update). Failures cache too — a dead service stays one bounded
 * attempt per course, never a retry loop. Dropped codes are pruned.
 */
export function fetchMissingHistories(
  codes: Iterable<string>,
  cached: ReadonlyMap<string, Promise<HistoryResult<CourseHistory>>>,
  fetchOne: (code: string) => Promise<HistoryResult<CourseHistory>>,
): Map<string, Promise<HistoryResult<CourseHistory>>> {
  const next = new Map<string, Promise<HistoryResult<CourseHistory>>>();
  for (const code of codes) {
    const existing = cached.get(code);
    next.set(code, existing ?? fetchOne(code));
  }
  return next;
}
