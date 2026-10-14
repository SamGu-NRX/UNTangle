import type { PlannerApiPayload } from "@/lib/types";

import { apiFetch, type FetchLike } from "./http";

/**
 * Result of loading the signed-in student's saved plan.
 *
 * The API contract (frontend/src/app/api/planner/route.ts): 200 carries the
 * state (or null when nothing is saved) with its revision; 401 means no
 * session; a save would be 409 (another device saved first) or 428 (missing
 * X-Planner-Base-Revision). Mobile reads plans in this release, so only the
 * GET paths plus typed carriers for the write statuses exist here.
 */
export type PlannerResult =
  | { ok: true; state: PlannerApiPayload | null; revision: number; persistent: boolean }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "conflict"; currentRevision: number }
  | { ok: false; reason: "unavailable"; message: string };

type PlannerGetPayload = { state: PlannerApiPayload | null; revision: number; persistent: boolean };
type PlannerConflictPayload = { revision?: number };

/**
 * GET /api/planner for the signed-in session. Network failures and
 * unexpected statuses map to `unavailable` rather than throwing, so screens
 * can offer a retry instead of a crash.
 */
export async function fetchPlannerState(fetchLike: FetchLike): Promise<PlannerResult> {
  let response: Response;
  try {
    response = await apiFetch("/api/planner", { fetchLike });
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      message: error instanceof Error ? error.message : "Network request failed",
    };
  }
  if (response.status === 200) {
    const payload = (await response.json()) as PlannerGetPayload;
    return {
      ok: true,
      state: payload.state,
      revision: payload.revision,
      persistent: payload.persistent,
    };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as PlannerConflictPayload | null;
    return { ok: false, reason: "conflict", currentRevision: body?.revision ?? 0 };
  }
  return { ok: false, reason: "unavailable", message: `Unexpected status ${response.status}` };
}
