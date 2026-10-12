import { normalizePlannerState } from "@/lib/planner";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

/**
 * Server save classifier — turns the outcome of a registered-user load or save
 * into an honest result the provider can act on.
 *
 * Durability rule 2: a failed save (server 500, dropped connection, expired
 * session) is NEVER shown as `Saved`. A save is only acknowledged as durable
 * when the server confirmed it actually persisted the row (`state` present in
 * the response). A 200 response without a persisted state means the
 * deployment has no server storage — that is `Not saved…`, not `Saved`.
 *
 * Revisions: every stored row carries a revision. A save names the revision it
 * was based on (`X-Planner-Base-Revision`); the server refuses with 409 when a
 * newer revision exists, so one tab or device can never silently overwrite
 * another's newer save.
 */

export const BASE_REVISION_HEADER = "X-Planner-Base-Revision";

export type ServerSaveOutcome =
  | { kind: "saved"; state: PlannerApiPayload; revision: number }
  /** Another tab or device stored a newer revision; nothing was written. */
  | { kind: "conflict"; theirs: PlannerState | null; revision: number; savedAt: string | null }
  /** Storage is not available for this save; edits stay in memory. */
  | { kind: "not-saved"; message: string }
  /** The save failed and can be retried; nothing was stored. */
  | { kind: "failed"; reason: "server" | "network" | "session"; message: string };

export type ServerLoadOutcome =
  | { kind: "loaded"; state: PlannerState | null; revision: number; persistent: boolean }
  /** 401: the session ended before the load. Nothing was read; nothing may be written over it. */
  | { kind: "signed-out"; message: string }
  | { kind: "unavailable"; message: string };

const NETWORK_MESSAGE = "UNTangle could not reach the server to load your schedule.";

/** The slice of `fetch` the classifier uses; the global is assignable. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function readRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

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
    return {
      kind: "signed-out",
      message: "Your session ended before your saved schedule could load. Sign in again; nothing was overwritten.",
    };
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
      revision?: unknown;
      persistent?: boolean;
    };
    return {
      kind: "loaded",
      state: payload.state ? normalizePlannerState(payload.state) : null,
      revision: payload.state ? readRevision(payload.revision) : 0,
      persistent: payload.persistent !== false,
    };
  } catch {
    return { kind: "unavailable", message: "The server returned an unreadable schedule response." };
  }
}

export async function savePlannerStateToServer(
  state: PlannerState,
  baseRevision: number,
  fetchImpl: FetchLike = fetch,
): Promise<ServerSaveOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/planner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [BASE_REVISION_HEADER]: String(baseRevision),
      },
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
      message: "Your session ended, so the save was rejected. Your edits are kept in this browser; sign in again to save them.",
    };
  }

  if (response.status === 409) {
    try {
      const payload = (await response.json()) as {
        state: PlannerState | null;
        revision?: unknown;
      };
      return {
        kind: "conflict",
        theirs: payload.state ? normalizePlannerState(payload.state) : null,
        revision: readRevision(payload.revision),
        savedAt: payload.state?.updatedAt ?? null,
      };
    } catch {
      return {
        kind: "failed",
        reason: "server",
        message: "The server reported a newer saved version but sent an unreadable copy of it.",
      };
    }
  }

  if (!response.ok) {
    return {
      kind: "failed",
      reason: "server",
      message: `The server could not save your schedule (error ${response.status}).`,
    };
  }

  try {
    const payload = (await response.json()) as {
      state: PlannerApiPayload | null;
      revision?: unknown;
    };
    if (payload.state) {
      return { kind: "saved", state: payload.state, revision: readRevision(payload.revision) };
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
