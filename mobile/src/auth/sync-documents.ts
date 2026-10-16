import { SYNC_PULL_PATH } from "./device-api";
import { apiFetch, type FetchLike } from "../data/http";

/**
 * A first read of the signed-in student's documents, so sign-in can say how
 * much the account holds. The real sync engine is the next task; this module
 * exists so the count reads the same wire shape it will.
 */

export type SyncEntry = {
  documentId: string;
  kind: string;
  revision: number;
  deleted: boolean;
};

export type SyncPullResult =
  | { ok: true; entries: SyncEntry[] }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "unavailable"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function guardPullList(value: unknown): SyncEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SyncEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { documentId, kind, revision, deleted } = item;
    if (typeof documentId !== "string" || documentId.length === 0) return null;
    if (typeof kind !== "string" || kind.length === 0) return null;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
    if (typeof deleted !== "boolean") return null;
    entries.push({ documentId, kind, revision, deleted });
  }
  return entries;
}

/**
 * GET /api/v1/sync with the device's bearer token. 401 means the grant is
 * gone (revoked, reused refresh token, or a security generation bump) and the
 * caller should sign out; everything else maps to unavailable.
 */
export async function fetchSyncList(accessToken: string, fetchLike?: FetchLike): Promise<SyncPullResult> {
  let response: Response;
  try {
    response = await apiFetch(SYNC_PULL_PATH, { headers: { Authorization: `Bearer ${accessToken}` }, fetchLike });
  } catch (error) {
    return { ok: false, reason: "unavailable", message: error instanceof Error ? error.message : "Network request failed" };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (response.status !== 200) return { ok: false, reason: "unavailable", message: `Unexpected status ${response.status}` };
  const guard = guardPullList((await response.json().catch(() => null)) as unknown);
  if (guard === null) return { ok: false, reason: "unavailable", message: "The sync response did not match the contract." };
  return { ok: true, entries: guard };
}
