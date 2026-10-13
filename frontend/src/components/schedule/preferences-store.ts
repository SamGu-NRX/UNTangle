/**
 * The schedule builder's constraints and weights, kept in this browser's
 * localStorage, one entry per identity: the account id when signed in, a
 * per-browser guest id otherwise. Two accounts on one browser never read
 * each other's settings. (Saving them in the plan itself needs a plan
 * schema change and is left for later.)
 *
 * Each entry carries a revision. A write first re-reads the entry; when
 * another tab wrote since this tab last read it, the change is applied on
 * top of that tab's version instead of overwriting it (`rebased`). Other
 * tabs pick up a write through the `storage` event.
 */
import { GOAL_WEIGHTS } from "@/lib/optimizer/presets";
import { defaultSchedulePreferences, parseSchedulePreferences } from "@/lib/planner";
import type { OptimizationKey, SchedulePreferences } from "@/lib/types";

export const PREFERENCES_PREFIX = "untangle-schedule-preferences:v2:";
export const GUEST_ID_KEY = "untangle-guest-id:v1";

export type Identity = { kind: "user"; id: string } | { kind: "guest"; id: string };

export function preferencesKey(identity: Identity): string {
  return `${PREFERENCES_PREFIX}${identity.kind}:${identity.id}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** This browser's guest id, created on first use; null when storage is unusable. */
export function readOrCreateGuestId(storage: StorageLike, makeId: () => string): string | null {
  try {
    const existing = storage.getItem(GUEST_ID_KEY);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
    const id = makeId();
    storage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export type StoredRead =
  | { kind: "ok"; revision: number; preferences: SchedulePreferences }
  /** Nothing stored for this identity yet. */
  | { kind: "absent" }
  /** Something is stored but it is not valid preferences; it is replaced on the next write. */
  | { kind: "invalid" }
  | { kind: "unavailable" };

export function readStoredPreferences(storage: StorageLike, key: string): StoredRead {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { kind: "unavailable" };
  }
  if (raw === null) return { kind: "absent" };
  try {
    const doc = JSON.parse(raw) as { revision?: unknown; preferences?: unknown };
    const preferences = parseSchedulePreferences(doc?.preferences);
    if (!preferences || typeof doc.revision !== "number" || !Number.isInteger(doc.revision) || doc.revision < 1) {
      return { kind: "invalid" };
    }
    return { kind: "ok", revision: doc.revision, preferences };
  } catch {
    return { kind: "invalid" };
  }
}

export type WriteOutcome =
  | { kind: "stored"; revision: number; preferences: SchedulePreferences }
  /** Another tab had written first; `preferences` is the update applied to its version. */
  | { kind: "rebased"; revision: number; preferences: SchedulePreferences }
  /** The write failed; `preferences` lives in this tab only. */
  | { kind: "not-stored"; revision: number; preferences: SchedulePreferences };

/**
 * Applies `update` and stores the result. `baseRevision` is the revision
 * this tab last read or wrote (0 for none) and `inMemory` its current value.
 */
export function writeStoredPreferences(
  storage: StorageLike,
  key: string,
  baseRevision: number,
  inMemory: SchedulePreferences,
  update: (current: SchedulePreferences) => SchedulePreferences,
): WriteOutcome {
  const stored = readStoredPreferences(storage, key);
  const theirs = stored.kind === "ok" && stored.revision !== baseRevision ? stored : null;
  const next = update(theirs ? theirs.preferences : inMemory);
  const revision = (stored.kind === "ok" ? Math.max(stored.revision, baseRevision) : baseRevision) + 1;
  try {
    storage.setItem(key, JSON.stringify({ revision, preferences: next }));
  } catch {
    return { kind: "not-stored", revision: baseRevision, preferences: next };
  }
  return { kind: theirs ? "rebased" : "stored", revision, preferences: next };
}

/**
 * The preferences to start from once the plan has loaded: the stored ones,
 * or, when none are stored or they are unreadable, the defaults for the
 * plan's saved goal (a plan saved with "nights" starts with the nights
 * weights, not the app default).
 */
export function initialPreferences(read: StoredRead, goal: OptimizationKey): SchedulePreferences {
  return read.kind === "ok" ? read.preferences : defaultSchedulePreferences(goal);
}

/** A goal chosen outside the rail (a plan restore) sets the weights to its preset and keeps the constraints. */
export function withGoalWeights(preferences: SchedulePreferences, goal: OptimizationKey): SchedulePreferences {
  return { ...preferences, weights: { ...GOAL_WEIGHTS[goal] } };
}
