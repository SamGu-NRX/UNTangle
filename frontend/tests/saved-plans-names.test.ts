/**
 * Copy names (PR #62 review): the list, Compare and Use in Main tell
 * schedules apart only by name, so no new copy may be called "Main" or share
 * another copy's name, compared trimmed and in any letter case. A name the
 * student typed (save, rename) is refused with a message for the field; a
 * name nobody typed (a duplicate, an import, a save the app makes) gets a
 * number instead. Names saved before the rule are left as they are.
 */
import { describe, expect, test } from "bun:test";
import { clashMessage, freeName, nameClash } from "@/lib/saved-plans/names";
import { SAVED_PLANS_STORE_KEY, createSavedPlanStore, type SavedPlanStore } from "@/lib/saved-plans/store";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { defaultPlannerState } from "@/lib/seed-data";
import validFixture from "./fixtures/plan-library/saved-plan-valid.json";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, String(value)),
  };
}

const state = defaultPlannerState;

function saved(store: SavedPlanStore, name: string): SavedPlanSnapshot {
  const result = store.savePlan({ state, name, onClash: "refuse" });
  if (!result.ok) throw new Error(result.failure.message);
  return result.value;
}

function names(store: SavedPlanStore): string[] {
  const listed = store.list();
  if (!listed.ok) throw new Error(listed.failure.message);
  return listed.doc.plans.map((plan) => plan.name);
}

describe("the name rule", () => {
  const plan = (name: string, archivedAt: string | null = null) => ({ planId: name, name, archivedAt }) as SavedPlanSnapshot;

  test("Main is refused in any case and with spaces around it", () => {
    for (const name of ["Main", "main", "  MAIN ", "mAiN"]) expect(nameClash(name, [])).toEqual({ kind: "reserved" });
    expect(nameClash("Main 2", [])).toBeNull();
    expect(nameClash("Mainly", [])).toBeNull();
  });

  test("another copy's name is refused, archived or not, and named as that copy has it", () => {
    expect(nameClash(" plan b", [plan("Plan B")])).toEqual({ kind: "taken", name: "Plan B", archived: false });
    expect(nameClash("OLD", [plan("Old", "2026-10-01T00:00:00.000Z")])).toEqual({ kind: "taken", name: "Old", archived: true });
    // A rename may keep its own name in another case.
    expect(nameClash("plan b", [plan("Plan B")], "Plan B")).toBeNull();
  });

  test("the messages, in the app's voice", () => {
    expect(clashMessage({ kind: "reserved" })).toBe("Main is your plan. Name this copy something else.");
    expect(clashMessage({ kind: "taken", name: "Plan B", archived: false })).toBe("You already have a copy called Plan B.");
    expect(clashMessage({ kind: "taken", name: "Old", archived: true })).toBe("You already have an archived copy called Old.");
  });

  test("a name nobody typed is numbered past Main and every taken name", () => {
    expect(freeName("Plan", [])).toBe("Plan");
    expect(freeName("Plan", ["plan", "PLAN 2"])).toBe("Plan 3");
    expect(freeName("Main", [])).toBe("Main 2");
    expect(freeName(" Main ", ["main 2"])).toBe("Main 3");
  });
});

describe("save", () => {
  test("a typed name that is Main or another copy's is refused, and nothing is stored", () => {
    const store = createSavedPlanStore(memoryStorage());
    saved(store, "Plan B");
    for (const [name, message] of [
      ["main ", "Main is your plan. Name this copy something else."],
      ["plan b", "You already have a copy called Plan B."],
    ]) {
      const result = store.savePlan({ state, name, onClash: "refuse" });
      expect(result.ok ? null : result.failure).toEqual({ kind: "nameClash", message });
    }
    expect(names(store)).toEqual(["Plan B"]);
  });

  test("a save the app makes on its own gets a number instead of failing", () => {
    const store = createSavedPlanStore(memoryStorage());
    saved(store, "From this browser, Oct 17");
    const kept = store.savePlan({ state, name: "From this browser, Oct 17" });
    expect(kept.ok && kept.value.name).toBe("From this browser, Oct 17 2");
    const main = store.savePlan({ state, name: "Main" });
    expect(main.ok && main.value.name).toBe("Main 2");
  });
});

describe("rename", () => {
  test("Main and another copy's name are refused; the copy keeps its name", () => {
    const store = createSavedPlanStore(memoryStorage());
    const a = saved(store, "Plan A");
    saved(store, "Plan B");
    const reserved = store.renamePlan(a.planId, " MAIN");
    expect(reserved.ok ? null : reserved.failure).toEqual({ kind: "nameClash", message: "Main is your plan. Name this copy something else." });
    const taken = store.renamePlan(a.planId, "plan b");
    expect(taken.ok ? null : taken.failure).toEqual({ kind: "nameClash", message: "You already have a copy called Plan B." });
    expect(names(store)).toEqual(["Plan B", "Plan A"]);
  });

  test("an archived copy's name is taken too", () => {
    const store = createSavedPlanStore(memoryStorage());
    const old = saved(store, "Old");
    store.setPlanArchived(old.planId, true);
    const fresh = saved(store, "Fresh");
    const result = store.renamePlan(fresh.planId, "old");
    expect(result.ok ? null : result.failure.message).toBe("You already have an archived copy called Old.");
  });

  test("a copy may change its own name's letter case", () => {
    const store = createSavedPlanStore(memoryStorage());
    const a = saved(store, "plan a");
    const result = store.renamePlan(a.planId, "Plan A");
    expect(result.ok && result.value.name).toBe("Plan A");
  });
});

describe("duplicate", () => {
  test("adds (copy), then a number past any name in use in any case", () => {
    const store = createSavedPlanStore(memoryStorage());
    const a = saved(store, "Plan A");
    saved(store, "plan a (COPY)");
    const first = store.duplicatePlan(a.planId);
    expect(first.ok && first.value.name).toBe("Plan A (copy 2)");
    const second = store.duplicatePlan(a.planId);
    expect(second.ok && second.value.name).toBe("Plan A (copy 3)");
  });
});

describe("import", () => {
  test("a file named like a copy here, or Main, comes in numbered", () => {
    const store = createSavedPlanStore(memoryStorage());
    saved(store, "fall plan");
    const clash = store.importPlan(validFixture);
    expect(clash.ok && clash.snapshot.name).toBe("Fall plan 2");
    const main = store.importPlan({ ...validFixture, name: " Main " });
    expect(main.ok && main.snapshot.name).toBe("Main 2");
    expect(names(store)).toEqual(["Main 2", "Fall plan 2", "fall plan"]);
  });
});

describe("copies saved before the rule", () => {
  test("keep their names, Main and repeats included, and other copies can still be renamed", () => {
    const store = createSavedPlanStore(memoryStorage());
    const a = saved(store, "Plan A");
    const raw = store.list();
    if (!raw.ok) throw new Error(raw.failure.message);
    const legacy = (name: string, planId: string) => ({ ...a, planId, name });
    const storage = memoryStorage({
      [SAVED_PLANS_STORE_KEY]: JSON.stringify({ ...raw.doc, plans: [legacy("Main", "legacy-1"), legacy("Twin", "legacy-2"), legacy("Twin", "legacy-3")] }),
    });
    const old = createSavedPlanStore(storage);
    expect(names(old)).toEqual(["Main", "Twin", "Twin"]);
    const renamed = old.renamePlan("legacy-3", "Twin, later");
    expect(renamed.ok && renamed.value.name).toBe("Twin, later");
    expect(names(old)).toEqual(["Main", "Twin", "Twin, later"]);
  });
});
