import { describe, expect, it } from "bun:test";
import {
  PLANNER_STATE_STORE_KEY,
  PLANNER_STATE_STORE_SCHEMA_VERSION,
  createPlannerStateStore,
} from "@/lib/planner-store";
import { defaultPlannerState } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: {
    ...defaultPlannerState.courseStatuses,
    "ANTH 1010": "inProgress",
  },
  selectedSections: { "ANTH 1010": "anth-1010-001" },
  transcriptRecords: [],
  updatedAt: "2026-10-10T12:00:00.000Z",
  ...overrides,
});

class MemoryStorage {
  private entries = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    Object.entries(initial ?? {}).forEach(([key, value]) => this.entries.set(key, value));
  }
  get length(): number {
    return this.entries.size;
  }
  clear(): void {
    this.entries.clear();
  }
  getItem(key: string): string | null {
    return this.entries.has(key) ? (this.entries.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

class DisabledStorage extends MemoryStorage {
  private deny(): never {
    throw new Error("storage access is disabled");
  }
  getItem(): string | null {
    return this.deny();
  }
  setItem(): void {
    this.deny();
  }
  removeItem(): void {
    this.deny();
  }
  key(): string | null {
    return this.deny();
  }
}

class QuotaStorageForMainKey extends MemoryStorage {
  setItem(key: string, value: string): void {
    if (key === PLANNER_STATE_STORE_KEY) {
      throw new Error("QuotaExceededError");
    }
    super.setItem(key, value);
  }
}

describe("planner-state store (guest durability)", () => {
  it("reads an empty store as revision 0 with no state", () => {
    const store = createPlannerStateStore(new MemoryStorage());
    const read = store.read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.state).toBeNull();
      expect(read.revision).toBe(0);
      expect(read.savedAt).toBeNull();
      expect(read.notices).toEqual([]);
    }
  });

  it("writes a versioned document and reads the same state back", () => {
    const storage = new MemoryStorage();
    const store = createPlannerStateStore(storage);
    const state = stateWith({});
    const write = store.write(state, 0);
    expect(write.ok).toBe(true);
    if (write.ok) {
      expect(write.revision).toBe(1);
    }

    const read = store.read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.revision).toBe(1);
      expect(read.state?.courseStatuses["ANTH 1010"]).toBe("inProgress");
      expect(read.savedAt).toBeTruthy();
    }

    // The persisted document is versioned and schema-stamped.
    const raw = JSON.parse(storage.getItem(PLANNER_STATE_STORE_KEY) as string);
    expect(raw.storeSchemaVersion).toBe(PLANNER_STATE_STORE_SCHEMA_VERSION);
    expect(raw.revision).toBe(1);
  });

  it("refuses a stale-base write with the incoming document instead of clobbering", () => {
    const storage = new MemoryStorage();
    const tabA = createPlannerStateStore(storage);
    const tabB = createPlannerStateStore(storage);

    const writeA = tabA.write(stateWith({}), 0);
    expect(writeA.ok).toBe(true);

    // Tab B still believes revision 0 is current and holds unsaved edits.
    const writeB = tabB.write(
      stateWith({ courseStatuses: { "ANTH 1010": "completed" } }),
      0,
    );
    expect(writeB.ok).toBe(false);
    expect((writeB as { conflict: true }).conflict).toBe(true);
    const incoming = (writeB as { incoming: { revision: number; state: PlannerState } }).incoming;
    expect(incoming.revision).toBe(1);
    expect(incoming.state?.courseStatuses["ANTH 1010"]).toBe("inProgress");

    // The loser, choosing to adopt, writes on top of the newest revision.
    const adopted = tabB.write(
      stateWith({ courseStatuses: { "ANTH 1010": "completed" } }),
      incoming.revision,
    );
    expect(adopted.ok).toBe(true);
    if (adopted.ok) {
      expect(adopted.revision).toBe(2);
    }
    const read = tabA.read();
    if (read.ok && read.state) {
      expect(read.state.courseStatuses["ANTH 1010"]).toBe("completed");
    }
  });

  it("quarantines corrupt bytes under a unique key and restarts empty", () => {
    const corrupt = "not json at all {";
    const storage = new MemoryStorage({ [PLANNER_STATE_STORE_KEY]: corrupt });
    const store = createPlannerStateStore(storage);

    const read = store.read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.state).toBeNull();
      expect(read.revision).toBe(0);
      expect(read.notices).toHaveLength(1);
      // The notice must be honest about the loss: it names the quarantine
      // location and states plainly that nothing was recovered.
      expect(read.notices[0].message).toContain("nothing was recovered");
      expect(read.notices[0].quarantinedTo).toBeTruthy();
    }

    // The quarantined bytes are byte-for-byte intact, never discarded.
    const keys = store.listQuarantined();
    expect(keys).toHaveLength(1);
    expect(store.readQuarantined(keys[0])).toBe(corrupt);
  });

  it("never lets a later quarantine overwrite an earlier one", () => {
    const storage = new MemoryStorage();
    const store = createPlannerStateStore(storage);

    storage.setItem(PLANNER_STATE_STORE_KEY, "corrupt payload one");
    const first = store.read();
    expect(first.ok).toBe(true);

    storage.setItem(PLANNER_STATE_STORE_KEY, "corrupt payload two");
    const second = store.read();
    expect(second.ok).toBe(true);

    const keys = store.listQuarantined();
    expect(keys).toHaveLength(2);
    const contents = new Set(keys.map((key) => store.readQuarantined(key)));
    expect(contents.has("corrupt payload one")).toBe(true);
    expect(contents.has("corrupt payload two")).toBe(true);
  });

  it("treats denied storage as a structured failure, never an empty schedule", () => {
    const store = createPlannerStateStore(new DisabledStorage());
    expect(store.available).toBe(false);

    const read = store.read();
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.failure.kind).toBe("storageUnavailable");
      expect(read.failure.message).not.toContain("empty schedule");
    }

    const write = store.write(stateWith({}), 0);
    expect(write.ok).toBe(false);
    if (!write.ok && "failure" in write) {
      expect(write.failure.kind).toBe("storageUnavailable");
    }
  });

  it("reports quota exhaustion as a failed write that kept the old document", () => {
    const existing = JSON.stringify({
      storeSchemaVersion: PLANNER_STATE_STORE_SCHEMA_VERSION,
      revision: 4,
      savedAt: "2026-10-10T00:00:00.000Z",
      state: stateWith({}),
    });
    const storage = new QuotaStorageForMainKey({ [PLANNER_STATE_STORE_KEY]: existing });
    const store = createPlannerStateStore(storage);

    const write = store.write(stateWith({ activeDay: "Tue" }), 4);
    expect(write.ok).toBe(false);
    if (!write.ok && "failure" in write) {
      expect(write.failure.kind).toBe("quotaExceeded");
      expect(write.failure.message).toContain("was not stored");
    }

    // The old document survived untouched.
    const read = store.read();
    if (read.ok && read.state) {
      expect(read.revision).toBe(4);
      expect(read.state.activeDay).not.toBe("Tue");
    }
  });

  it("refuses to adopt documents from a different schema version", () => {
    const storage = new MemoryStorage({
      [PLANNER_STATE_STORE_KEY]: JSON.stringify({
        storeSchemaVersion: PLANNER_STATE_STORE_SCHEMA_VERSION + 99,
        revision: 7,
        savedAt: "2026-10-10T00:00:00.000Z",
        state: stateWith({}),
      }),
    });
    const store = createPlannerStateStore(storage);
    const read = store.read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.state).toBeNull();
      expect(read.revision).toBe(0);
      expect(read.notices[0].quarantinedTo).toBeTruthy();
    }
  });

  it("writeMirror overwrites silently and never conflicts", () => {
    const storage = new MemoryStorage();
    const tabA = createPlannerStateStore(storage);
    const tabB = createPlannerStateStore(storage);

    tabA.write(stateWith({}), 0);
    // B mirrors regardless of A's newer revision (best-effort backup path).
    tabB.writeMirror(stateWith({ activeDay: "Fri" }));

    const read = tabA.read();
    expect(read.ok).toBe(true);
    if (read.ok && read.state) {
      expect(read.state.activeDay).toBe("Fri");
    }
  });

  it("subscribes to storage events, filters unrelated keys, and unsubscribes cleanly", () => {
    const listeners = new Set<(event: unknown) => void>();
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (_type: string, listener: (event: unknown) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: unknown) => void) =>
        listeners.delete(listener),
    };

    try {
      const store = createPlannerStateStore(new MemoryStorage());
      let calls = 0;
      const unsubscribe = store.subscribe(() => {
        calls += 1;
      });

      // A change to the planner key (or a cleared document, key === null)
      // notifies the listener.
      const plannerChange = { key: PLANNER_STATE_STORE_KEY } as unknown as StorageEvent;
      const clearedChange = { key: null } as unknown as StorageEvent;
      listeners.forEach((listener) => listener(plannerChange));
      expect(calls).toBe(1);
      listeners.forEach((listener) => listener(clearedChange));
      expect(calls).toBe(2);

      // Unrelated storage keys never fire the listener.
      const unrelated = { key: "some.other.key" } as unknown as StorageEvent;
      listeners.forEach((listener) => listener(unrelated));
      expect(calls).toBe(2);

      unsubscribe();
      listeners.forEach((listener) => listener(plannerChange));
      expect(calls).toBe(2);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
