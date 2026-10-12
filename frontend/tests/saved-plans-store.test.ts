import { describe, expect, it } from "bun:test";
import {
  SAVED_PLANS_STORE_KEY,
  createSavedPlanStore,
  defaultPlanName,
  exportPlanJson,
} from "@/lib/saved-plans/store";
import { defaultPlannerState } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";
import validFixture from "./fixtures/plan-library/saved-plan-valid.json";

const capturedAt = "2026-10-10T12:00:00.000Z";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: {
    ...defaultPlannerState.courseStatuses,
    "ANTH 1010": "inProgress",
    "ANTH 1150": "completed",
  },
  selectedSections: { "ANTH 1010": "anth-1010-001" },
  transcriptRecords: [],
  updatedAt: capturedAt,
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

class FullStorage extends MemoryStorage {
  setItem(key: string, value: string): void {
    if (key === SAVED_PLANS_STORE_KEY) {
      throw new Error("quota exceeded");
    }
    super.setItem(key, value);
  }
}

describe("saved-plan store", () => {
  it("saves, lists, renames and archives plans", () => {
    const store = createSavedPlanStore(new MemoryStorage() as unknown as Storage);

    const saved = store.savePlan({ state: stateWith({}), name: "Fall plan", now: new Date(capturedAt) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.name).toBe("Fall plan");
    expect(saved.value.source.kind).toBe("workingState");

    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.doc.plans).toHaveLength(1);

    const renamed = store.renamePlan(saved.value.planId, "Fall final");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.name).toBe("Fall final");

    const archived = store.setPlanArchived(saved.value.planId, true, new Date(capturedAt));
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.archivedAt).toBe(capturedAt);

    const unarchived = store.setPlanArchived(saved.value.planId, false);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) return;
    expect(unarchived.value.archivedAt).toBeNull();
  });

  it("duplicates plans with copy naming and duplicate source identity", () => {
    const store = createSavedPlanStore(new MemoryStorage() as unknown as Storage);
    const saved = store.savePlan({ state: stateWith({}), name: "Fall plan", now: new Date(capturedAt) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const duplicate = store.duplicatePlan(saved.value.planId, new Date(capturedAt));
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok || !duplicate.value) return;
    expect(duplicate.value.planId).not.toBe(saved.value.planId);
    expect(duplicate.value.name).toBe("Fall plan (copy)");
    expect(duplicate.value.source.kind).toBe("duplicate");
    expect(duplicate.value.source.detail).toContain("Fall plan");
    expect(duplicate.value.state).toEqual(saved.value.state);
    expect(duplicate.value.catalog).toEqual(saved.value.catalog);
  });

  it("reports storageUnavailable instead of throwing when storage is disabled", () => {
    const store = createSavedPlanStore(new DisabledStorage() as unknown as Storage);
    expect(store.available).toBe(false);

    const listed = store.list();
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.failure.kind).toBe("storageUnavailable");

    const saved = store.savePlan({ state: stateWith({}) });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.failure.kind).toBe("storageUnavailable");
  });

  it("reports quotaExceeded and keeps existing data intact when storage is full", () => {
    const scratch = createSavedPlanStore(new MemoryStorage() as unknown as Storage);
    const first = scratch.savePlan({ state: stateWith({}), name: "Kept plan", now: new Date(capturedAt) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const seeded = new FullStorage({
      [SAVED_PLANS_STORE_KEY]: JSON.stringify({
        storeSchemaVersion: 1,
        revision: 1,
        plans: [first.value],
        unreadable: [],
      }),
    });
    const fullStore = createSavedPlanStore(seeded as unknown as Storage);

    const saved = fullStore.savePlan({ state: stateWith({}), name: "New plan" });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.failure.kind).toBe("quotaExceeded");
    expect(saved.failure.message).toContain("Export it as a file");

    const listed = fullStore.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.doc.plans).toHaveLength(1);
    expect(listed.doc.plans[0].name).toBe("Kept plan");
  });

  it("quarantines corrupt storage byte-for-byte and restarts empty", () => {
    const corruptRaw = "}{ not json at all";
    const storage = new MemoryStorage({ [SAVED_PLANS_STORE_KEY]: corruptRaw });
    const store = createSavedPlanStore(storage as unknown as Storage);

    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.doc.plans).toHaveLength(0);
    expect(listed.notices).toHaveLength(1);
    expect(listed.notices[0].kind).toBe("corruptDataRecovered");
    expect(listed.notices[0].quarantinedTo).toMatch(/^untangle\.saved-plans\.corrupt-/);
    expect(storage.getItem(listed.notices[0].quarantinedTo as string)).toBe(corruptRaw);

    const saved = store.savePlan({ state: stateWith({}), name: "Fresh start" });
    expect(saved.ok).toBe(true);
  });

  it("quarantines an unrecognized store document the same way", () => {
    const storage = new MemoryStorage({ [SAVED_PLANS_STORE_KEY]: JSON.stringify({ hello: true }) });
    const store = createSavedPlanStore(storage as unknown as Storage);
    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.doc.plans).toHaveLength(0);
    expect(listed.notices[0]?.kind).toBe("corruptDataRecovered");
  });

  it("keeps unreadable records visible and preserves them through later writes", () => {
    const unreadableRecord = { ...validFixture, schemaVersion: 99 };
    const storage = new MemoryStorage({
      [SAVED_PLANS_STORE_KEY]: JSON.stringify({
        storeSchemaVersion: 1,
        revision: 3,
        plans: [validFixture, unreadableRecord],
        unreadable: [],
      }),
    });
    const store = createSavedPlanStore(storage as unknown as Storage);

    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.doc.plans).toHaveLength(1);
    expect(listed.doc.unreadable).toHaveLength(1);
    expect(listed.doc.unreadable[0].reason).toContain("schema version");

    const renamed = store.renamePlan(validFixture.planId, "Renamed");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    const after = store.list();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.doc.plans[0].name).toBe("Renamed");
    expect(after.doc.unreadable).toHaveLength(1);
    expect(after.doc.unreadable[0].record).toEqual(unreadableRecord);
  });

  it("applies mutations on top of concurrent external writes instead of clobbering them", () => {
    const storage = new MemoryStorage();
    const store = createSavedPlanStore(storage as unknown as Storage);

    const saved = store.savePlan({ state: stateWith({}), name: "Plan A", now: new Date(capturedAt) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    // Another "tab" lands a write directly in storage between our read and
    // the next mutation.
    const external = JSON.parse(storage.getItem(SAVED_PLANS_STORE_KEY) as string);
    const importedPlan = { ...validFixture, planId: "99999999-9999-4999-8999-999999999999", name: "Imported B" };
    external.plans = [importedPlan, ...external.plans];
    external.revision += 1;
    storage.setItem(SAVED_PLANS_STORE_KEY, JSON.stringify(external));

    const renamed = store.renamePlan(saved.value.planId, "Plan A renamed");
    expect(renamed.ok).toBe(true);

    const after = store.list();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.doc.plans).toHaveLength(2);
    expect(after.doc.plans.find((plan) => plan.planId === saved.value.planId)?.name).toBe("Plan A renamed");
    expect(after.doc.plans.find((plan) => plan.planId === importedPlan.planId)?.name).toBe("Imported B");
  });

  it("imports valid payloads through the snapshot contract and rejects invalid ones", () => {
    const store = createSavedPlanStore(new MemoryStorage() as unknown as Storage);

    const imported = store.importPlan(validFixture, new Date(capturedAt));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.snapshot.source.kind).toBe("import");
    expect(imported.snapshot.planId).not.toBe(validFixture.planId);
    expect(imported.references.preserved).toHaveLength(1);

    const invalid = store.importPlan({ ...validFixture, schemaVersion: 2 });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.failure.kind).toBe("invalidPayload");
    expect(invalid.failure.message).toContain("Unsupported saved-plan schema version: 2");
  });

  it("falls back to a generated default name when saving unnamed", () => {
    expect(defaultPlanName(new Date("2026-10-10T12:34:00.000Z"))).toBe("Plan 2026-10-10 12:34");

    const store = createSavedPlanStore(new MemoryStorage() as unknown as Storage);
    const saved = store.savePlan({ state: stateWith({}), now: new Date("2026-10-10T12:34:00.000Z") });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.name).toBe("Plan 2026-10-10 12:34");
  });

  it("exports a plan as pretty JSON that validates back through the contract", () => {
    const store = createSavedPlanStore(new MemoryStorage() as unknown as Storage);
    const saved = store.savePlan({ state: stateWith({}), name: "Exported", now: new Date(capturedAt) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const json = exportPlanJson(saved.value);
    const reparsed = JSON.parse(json);
    expect(reparsed.name).toBe("Exported");
    expect(reparsed.schemaVersion).toBe(1);
  });
});
