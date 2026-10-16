/**
 * When Set up Auto opens by itself: once per identity on this browser, and
 * only for an identity with no saved preferences.
 */
import { describe, expect, test } from "bun:test";
import { GUEST_ID_KEY, preferencesKey, readGuestId, readOrCreateGuestId, writeStoredPreferences, type Identity } from "@/components/schedule/preferences-store";
import { loadedIdentity, markSetupSeen, setupDue, setupSeenKey } from "@/components/schedule/setup-store";
import { defaultSchedulePreferences } from "@/lib/planner";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const guest: Identity = { kind: "guest", id: "guest-0001-aaaa" };
const ana: Identity = { kind: "user", id: "user-ana" };
const ben: Identity = { kind: "user", id: "user-ben" };
const NOW = new Date("2026-10-15T12:00:00Z");
const DEFAULTS = defaultSchedulePreferences("clusterMorning");
/** What the planner loaded for the identity: here, still the defaults. */
const fresh = { preferences: DEFAULTS, defaults: DEFAULTS };
const changed = { preferences: { ...DEFAULTS, weights: { ...DEFAULTS.weights, rating: 3 } }, defaults: DEFAULTS };

describe("setupDue", () => {
  test("a new guest with nothing stored is due", () => {
    expect(setupDue(memoryStorage(), guest, fresh)).toBe(true);
  });

  test("skipping or finishing marks it seen for that identity only", () => {
    const storage = memoryStorage();
    expect(markSetupSeen(storage, ana, NOW)).toBe(true);
    expect(storage.data.get(setupSeenKey(ana))).toBe(NOW.toISOString());
    expect(setupDue(storage, ana, fresh)).toBe(false);
    // Another account on the same browser, and the guest, still get their own first run.
    expect(setupDue(storage, ben, fresh)).toBe(true);
    expect(setupDue(storage, guest, fresh)).toBe(true);
  });

  test("a guest and an account with the same id are different identities", () => {
    const storage = memoryStorage();
    markSetupSeen(storage, { kind: "guest", id: "same-id-123" }, NOW);
    expect(setupDue(storage, { kind: "user", id: "same-id-123" }, fresh)).toBe(true);
  });

  test("a guest's preferences saved in this browser mean it isn't due, even when never seen", () => {
    const storage = memoryStorage();
    writeStoredPreferences(storage, preferencesKey(guest), 0, DEFAULTS, (q) => ({ ...q, weights: { ...q.weights, rating: 3 } }));
    expect(setupDue(storage, guest, fresh)).toBe(false);
    expect(setupDue(storage, { kind: "guest", id: "guest-0002-bbbb" }, fresh)).toBe(true);
  });

  test("an account's preferences sync with the account, so the loaded ones decide, not this browser's storage", () => {
    const storage = memoryStorage();
    // Saved on another device: nothing on this browser, but the loaded preferences aren't the defaults.
    expect(setupDue(storage, ana, changed)).toBe(false);
    expect(setupDue(storage, ana, fresh)).toBe(true);
    // Key order in a synced document means nothing.
    const reordered = { constraints: DEFAULTS.constraints, weights: Object.fromEntries(Object.entries(DEFAULTS.weights).reverse()) } as typeof DEFAULTS;
    expect(setupDue(storage, ana, { preferences: reordered, defaults: DEFAULTS })).toBe(true);
  });

  test("unreadable stored preferences count as none saved", () => {
    const storage = memoryStorage();
    storage.setItem(preferencesKey(guest), "{not json");
    expect(setupDue(storage, guest, fresh)).toBe(true);
  });

  test("storage that throws is never due: it could not remember being seen", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(setupDue(broken, guest, fresh)).toBe(false);
    expect(markSetupSeen(broken, guest, NOW)).toBe(false);
  });
});

describe("readGuestId", () => {
  test("reads the id the planner created, and never creates one", () => {
    const storage = memoryStorage();
    expect(readGuestId(storage)).toBeNull();
    expect(storage.data.size).toBe(0);
    const id = readOrCreateGuestId(storage, () => "guest-made-0001");
    expect(readGuestId(storage)).toBe(id);
  });

  test("a malformed id reads as none", () => {
    const storage = memoryStorage();
    storage.setItem(GUEST_ID_KEY, "x");
    expect(readGuestId(storage)).toBeNull();
  });
});

describe("loadedIdentity", () => {
  test("nothing until preferences are ready", () => {
    expect(loadedIdentity(false, "user:abc", memoryStorage())).toBeNull();
  });

  test("an account comes from the plan's stamp", () => {
    expect(loadedIdentity(true, "user:abc", null)).toEqual({ kind: "user", id: "abc" });
  });

  test("a guest is this browser's guest id", () => {
    const storage = memoryStorage();
    storage.setItem(GUEST_ID_KEY, "guest-0001-aaaa");
    expect(loadedIdentity(true, "guest", storage)).toEqual({ kind: "guest", id: "guest-0001-aaaa" });
  });

  test("a guest with no id or no storage has no identity, so nothing is marked seen", () => {
    expect(loadedIdentity(true, "guest", memoryStorage())).toBeNull();
    expect(loadedIdentity(true, "guest", null)).toBeNull();
  });
});
