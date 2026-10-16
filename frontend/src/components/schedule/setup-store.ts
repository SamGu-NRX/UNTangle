/**
 * Whether this browser has shown "Set up Auto", Week's first-run setup, to
 * an identity. Kept per identity, like the preferences beside it
 * (preferences-store.ts): the account id when signed in, the per-browser
 * guest id otherwise, so a second account on the same browser still gets
 * its own first run.
 */
import { equal } from "@untangle/sync";
import type { SchedulePreferences } from "@/lib/types";
import { preferencesKey, readGuestId, readStoredPreferences, type Identity } from "./preferences-store";

/**
 * The identity whose preferences are loaded, as the planner keys them: the
 * account in the plan's stamp ("user:<id>"), else this browser's guest id,
 * which the planner creates before it reads a guest's preferences. Null
 * until they are ready, and when there is no usable storage or guest id.
 */
export function loadedIdentity(ready: boolean, stamp: string, storage: Pick<Storage, "getItem"> | null): Identity | null {
  if (!ready) return null;
  if (stamp.startsWith("user:")) return { kind: "user", id: stamp.slice("user:".length) };
  const id = storage ? readGuestId(storage) : null;
  return id ? { kind: "guest", id } : null;
}

export const SETUP_SEEN_PREFIX = "untangle-setup-auto-seen:v1:";

export function setupSeenKey(identity: Identity): string {
  return `${SETUP_SEEN_PREFIX}${identity.kind}:${identity.id}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * True when the setup should open for `identity` on this visit: it has
 * never been skipped or finished here, and no preferences are saved for this
 * identity. Unusable storage answers false, because the setup could not
 * remember being seen and would open on every visit.
 *
 * Where preferences are saved depends on the identity. A guest's live in
 * this browser's storage, keyed by guest id. An account's sync with the
 * account (the planner moved them there and deletes the local copy), so
 * the check is the preferences loaded for it: anything other than the
 * defaults was saved by the student, here or on another device.
 */
export function setupDue(storage: StorageLike, identity: Identity, loaded: { preferences: SchedulePreferences; defaults: SchedulePreferences }): boolean {
  let seen: string | null;
  try {
    seen = storage.getItem(setupSeenKey(identity));
  } catch {
    return false;
  }
  if (seen !== null) return false;
  if (identity.kind === "user") return equal(loaded.preferences, loaded.defaults);
  const saved = readStoredPreferences(storage, preferencesKey(identity));
  // "invalid" counts as none saved: those preferences are replaced by defaults on the next write.
  return saved.kind === "absent" || saved.kind === "invalid";
}

/** Records that `identity` skipped or finished the setup. False when storage refused the write. */
export function markSetupSeen(storage: StorageLike, identity: Identity, now: Date): boolean {
  try {
    storage.setItem(setupSeenKey(identity), now.toISOString());
    return true;
  } catch {
    return false;
  }
}
