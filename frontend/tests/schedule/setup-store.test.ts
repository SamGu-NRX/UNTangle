/**
 * When Set up Auto opens by itself: once per identity on this browser, and
 * only for an identity with no saved preferences.
 */
import { describe, expect, test } from "bun:test";
import { GUEST_ID_KEY, preferencesKey, readGuestId, readOrCreateGuestId, writeStoredPreferences, type Identity } from "@/components/schedule/preferences-store";
import { markSetupSeen, setupDue, setupSeenKey } from "@/components/schedule/setup-store";
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

describe("setupDue", () => {
  test("a new guest with nothing stored is due", () => {
    expect(setupDue(memoryStorage(), guest)).toBe(true);
  });

  test("skipping or finishing marks it seen for that identity only", () => {
    const storage = memoryStorage();
    expect(markSetupSeen(storage, ana, NOW)).toBe(true);
    expect(storage.data.get(setupSeenKey(ana))).toBe(NOW.toISOString());
    expect(setupDue(storage, ana)).toBe(false);
    // Another account on the same browser, and the guest, still get their own first run.
    expect(setupDue(storage, ben)).toBe(true);
    expect(setupDue(storage, guest)).toBe(true);
  });

  test("a guest and an account with the same id are different identities", () => {
    const storage = memoryStorage();
    markSetupSeen(storage, { kind: "guest", id: "same-id-123" }, NOW);
    expect(setupDue(storage, { kind: "user", id: "same-id-123" })).toBe(true);
  });

  test("saved preferences mean it isn't due, even when never seen", () => {
    const storage = memoryStorage();
    const p = defaultSchedulePreferences("clusterMorning");
    writeStoredPreferences(storage, preferencesKey(ana), 0, p, (q) => ({ ...q, weights: { ...q.weights, rating: 3 } }));
    expect(setupDue(storage, ana)).toBe(false);
    expect(setupDue(storage, ben)).toBe(true);
  });

  test("unreadable stored preferences count as none saved", () => {
    const storage = memoryStorage();
    storage.setItem(preferencesKey(guest), "{not json");
    expect(setupDue(storage, guest)).toBe(true);
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
    expect(setupDue(broken, guest)).toBe(false);
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
