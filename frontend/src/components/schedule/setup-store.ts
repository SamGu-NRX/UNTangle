/**
 * Whether this browser has shown "Set up Auto", Week's first-run setup, to
 * an identity. Kept per identity, like the preferences beside it
 * (preferences-store.ts): the account id when signed in, the per-browser
 * guest id otherwise, so a second account on the same browser still gets
 * its own first run.
 */
import { preferencesKey, readStoredPreferences, type Identity } from "./preferences-store";

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
 */
export function setupDue(storage: StorageLike, identity: Identity): boolean {
  let seen: string | null;
  try {
    seen = storage.getItem(setupSeenKey(identity));
  } catch {
    return false;
  }
  if (seen !== null) return false;
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
