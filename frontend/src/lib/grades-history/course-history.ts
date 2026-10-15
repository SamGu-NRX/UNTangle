/**
 * Reading one course's grade history from the browser: the same history
 * result the grades routes serve, for callers that need accepted evidence
 * on the client (the planner feeds it to the optimizer's instructor
 * tie-break). No storage, no retries; the caller owns pacing.
 */

import type { CourseHistory, HistoryResult } from "./types";

const BASE = "/api/grades/courses";

export async function fetchCourseHistory(subject: string, number: string, signal?: AbortSignal): Promise<HistoryResult<CourseHistory>> {
  const response = await fetch(`${BASE}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    return { status: "unavailable", source: "untgrades.app", data: null, error: { reason: "upstream", message: `course history request failed with ${response.status}` } };
  }
  return (await response.json()) as HistoryResult<CourseHistory>;
}
