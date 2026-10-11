import { normalizePlannerState } from "@/lib/planner";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

/**
 * Server save classifier — turns the outcome of a registered-user save into
 * an honest save-state the UI can acknowledge.
 *
 * Durability rule 2: a failed save (server 500, dropped connection, expired
 * session) is NEVER shown as `Saved`. A save is only acknowledged as durable
 * when the server confirmed it actually persisted the row (`state` present in
 * the response). A 200 response without a persisted state means the
 * deployment has no server storage — that is `Not saved…`, not `Saved`.
 */

export type ServerSaveOutcome =
  | { kind: "saved"; state: PlannerApiPayload }
  /** Storage is not available for this save; edits stay in memory. */
  | { kind: "not-saved"; message: string }
  /** The save failed and can be retried; nothing was stored. */
  | { kind: "failed"; reason: "server" | "network" | "session"; message: string };

export type ServerLoadOutcome =
  | { kind: "loaded"; state: PlannerState | null; persistent: boolean }
  | { kind: "unavailable"; message: string };

const NETWORK_MESSAGE = "UNTangle could not reach the server to load your schedule.";

/** The slice of `fetch` the classifier uses; the global is assignable. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function loadPlannerStateFromServer(
  fetchImpl: FetchLike = fetch,
): Promise<ServerLoadOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/planner", { cache: "no-store" });
  } catch {
    return { kind: "unavailable", message: NETWORK_MESSAGE };
  }

  if (response.status === 401) {
    // Not signed in (or the session expired between render and load): the
    // caller treats this as "no server state", not as an error banner.
    return { kind: "loaded", state: null, persistent: true };
  }

  if (!response.ok) {
    return {
      kind: "unavailable",
      message: `The server could not load your saved schedule (error ${response.status}).`,
    };
  }

  try {
    const payload = (await response.json()) as {
      state: PlannerState | null;
      persistent?: boolean;
    };
    return {
      kind: "loaded",
      state: payload.state ? normalizePlannerState(payload.state) : null,
      persistent: payload.persistent !== false,
    };
  } catch {
    return { kind: "unavailable", message: "The server returned an unreadable schedule response." };
  }
}

export async function savePlannerStateToServer(
  state: PlannerState,
  fetchImpl: FetchLike = fetch,
): Promise<ServerSaveOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    return {
      kind: "failed",
      reason: "network",
      message: "The connection dropped while saving. Your schedule was not stored on the server.",
    };
  }

  if (response.status === 401) {
    return {
      kind: "failed",
      reason: "session",
      message: "Your session expired, so the save was rejected. Sign in again, then retry.",
    };
  }

  if (!response.ok) {
    return {
      kind: "failed",
      reason: "server",
      message: `The server could not save your schedule (error ${response.status}).`,
    };
  }

  try {
    const payload = (await response.json()) as { state: PlannerApiPayload | null };
    if (payload.state) {
      return { kind: "saved", state: payload.state };
    }
    return {
      kind: "not-saved",
      message:
        "Server storage is unavailable on this deployment, so your schedule lives in this browser only.",
    };
  } catch {
    return {
      kind: "failed",
      reason: "server",
      message: "The server returned an unreadable save response.",
    };
  }
}
