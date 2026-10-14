import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { getInitialPlannerState } from "@/lib/planner";
import {
  clearPlannerIdentity,
  createPlannerStateStore,
  LEGACY_PLANNER_STATE_STORE_KEY,
  plannerStateKey,
} from "@/lib/planner-store";
import {
  clearSavedPlansIdentity,
  createSavedPlanStore,
  LEGACY_SAVED_PLANS_STORE_KEY,
  savedPlansKey,
} from "@/lib/saved-plans/store";
import type { PlannerState } from "@/lib/types";
import {
  FakePlannerServer,
  failSessionLookup,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  setSession,
  waitFor,
} from "./test-dom";

const userA = { id: "privacy-a", email: "a@my.unt.edu", name: "A" };
const userB = { id: "privacy-b", email: "b@my.unt.edu", name: "B" };
const transcript: PlannerState["transcriptRecords"][number] = {
  id: "private-transcript-a", code: "ANTH 1150", title: "A's course",
  term: "2024 Fall", grade: "A", credits: 3, confidence: 1,
  rationale: "Synthetic privacy fixture", duplicateExcluded: false,
  prerequisiteSatisfied: true, reviewRequired: false, appliedStatus: "completed", sourceKind: "unt",
};
const privateState = (): PlannerState => ({
  ...getInitialPlannerState(), optimization: "clusterNight", transcriptRecords: [transcript],
});
let previousFetch: typeof fetch;
let server: FakePlannerServer;
const mounted: Array<() => Promise<void>> = [];

beforeAll(installDom);
afterAll(removeDom);
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
  previousFetch = globalThis.fetch;
  server = new FakePlannerServer();
  globalThis.fetch = server.fetch as typeof fetch;
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  setSession(null);
  globalThis.fetch = previousFetch;
});

async function mount() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "identity hydrated");
  return planner;
}

function readPlanner(userId: string | null) {
  const read = createPlannerStateStore(window.localStorage, userId).read();
  if (!read.ok) throw new Error(read.failure.message);
  return read;
}
function library(userId: string | null) {
  return createSavedPlanStore(window.localStorage, userId);
}
function plans(store: ReturnType<typeof createSavedPlanStore>) {
  const read = store.list();
  if (!read.ok) throw new Error(read.failure.message);
  return read.doc.plans;
}
function legacyPlanner(state: PlannerState) {
  const raw = JSON.stringify({ storeSchemaVersion: 1, revision: 7, savedAt: "2026-10-14T12:00:00Z", state });
  window.localStorage.setItem(LEGACY_PLANNER_STATE_STORE_KEY, raw);
  return raw;
}
function quarantines(prefix: string) {
  return Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
}

test("A signs out, the guest starts empty, and A's local planner and library are deleted", async () => {
  server.writeElsewhere(privateState());
  setSession(userA);
  const planner = await mount();
  await planner.run((p) => p.setActiveDay("Thu"));
  await waitFor(() => planner.get().saveState.label === "Saved", "A saved");
  expect(readPlanner(userA.id).state?.transcriptRecords).toEqual([transcript]);
  expect(library(userA.id).savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  expect(plans(library(userA.id)).map((p) => p.name)).toEqual(["A private"]);

  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  await flushSaves();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(planner.get().plannerState.optimization).toBe(getInitialPlannerState().optimization);
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  expect(readPlanner(null).state).toBeNull();
  expect(plans(library(null))).toEqual([]);
  expect(server.row?.state.transcriptRecords).toEqual([transcript]);
});

test("A signs out, then B loads an empty account and saves only B's edits", async () => {
  server.writeElsewhere(privateState());
  setSession(userA);
  const planner = await mount();
  expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  const serverB = new FakePlannerServer();
  globalThis.fetch = serverB.fetch as typeof fetch;
  setSession(userB);
  await waitFor(() => serverB.gets === 1 && planner.get().hydrated && planner.get().isRegistered, "B loaded");
  await flushSaves();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(planner.get().plannerState.optimization).toBe(getInitialPlannerState().optimization);
  expect(serverB.posts).toEqual([]);
  await planner.run((p) => p.setActiveDay("Fri"));
  await waitFor(() => planner.get().saveState.label === "Saved", "B saved");
  expect(serverB.row?.state.activeDay).toBe("Fri");
  expect(serverB.row?.state.transcriptRecords).toEqual([]);
  expect(readPlanner(userB.id).state?.transcriptRecords).toEqual([]);
});

test("guest work and guest library entries survive a signed-out reload", async () => {
  const first = await mount();
  await first.run((p) => p.applyTranscriptRecords([transcript]));
  await waitFor(() => first.get().saveState.label === "Saved", "guest saved");
  expect(library(null).savePlan({ state: first.get().plannerState, name: "Guest work" }).ok).toBe(true);
  await first.unmount();
  mounted.pop();
  const second = await mount();
  expect(second.get().plannerState.transcriptRecords.map((r) => r.id)).toEqual(["private-transcript-a"]);
  expect(second.get().saveState.label).toBe("Saved");
  expect(plans(library(null)).map((p) => p.name)).toEqual(["Guest work"]);
  expect(plans(library(userB.id))).toEqual([]);
});

test("a legacy planner exactly matching A's server copy migrates only into A's backup", async () => {
  const state = privateState();
  const raw = legacyPlanner(state);
  server.writeElsewhere(state);
  setSession(userA);
  const planner = await mount();
  expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
  expect(readPlanner(null).state).toBeNull();
  expect(quarantines("untangle.planner-state.corrupt-legacy-")).toEqual([]);
});

test("an unmatched legacy planner is quarantined and B's server copy remains authoritative", async () => {
  const raw = legacyPlanner(privateState());
  server.writeElsewhere({ ...getInitialPlannerState(), activeDay: "Fri" });
  setSession(userB);
  const planner = await mount();
  expect(planner.get().plannerState.activeDay).toBe("Fri");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  const keys = quarantines("untangle.planner-state.corrupt-legacy-");
  expect(keys).toHaveLength(1);
  expect(window.localStorage.getItem(keys[0])).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
  expect(readPlanner(userB.id).state).toBeNull();
  expect(createPlannerStateStore(window.localStorage).readQuarantined(keys[0])).toBeNull();
  await flushSaves();
  expect(server.posts).toEqual([]);
});

test("a guest quarantines the legacy shared planner without loading it or exposing recovery bytes", async () => {
  const raw = legacyPlanner(privateState());
  const planner = await mount();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  const keys = quarantines("untangle.planner-state.corrupt-legacy-");
  expect(keys).toHaveLength(1);
  expect(window.localStorage.getItem(keys[0])).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
  const guest = createPlannerStateStore(window.localStorage);
  expect(guest.readQuarantined(keys[0])).toBeNull();
  expect(guest.listQuarantined()).toEqual([]);
  expect(readPlanner(null).state).toBeNull();
});

test("a long-lived browser library refuses access while B loads and then follows B's identity", async () => {
  setSession(userA);
  const planner = await mount();
  const store = createSavedPlanStore();
  expect(store.savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  expect(plans(store).map((p) => p.name)).toEqual(["A private"]);
  const serverB = new FakePlannerServer();
  const release = serverB.holdNextGet();
  globalThis.fetch = serverB.fetch as typeof fetch;
  setSession(userB);
  await waitFor(() => serverB.gets === 1, "B loading");
  expect(store.list()).toMatchObject({ ok: false, failure: { kind: "storageUnavailable" } });
  expect(store.savePlan({ state: privateState(), name: "Stale" })).toMatchObject({ ok: false });
  release();
  await waitFor(() => planner.get().hydrated && store.available, "B ready");
  expect(plans(store)).toEqual([]);
  expect(store.savePlan({ state: planner.get().plannerState, name: "B plan" }).ok).toBe(true);
  expect(plans(store).map((p) => [p.name, p.state.transcriptRecords])).toEqual([["B plan", []]]);
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  expect(plans(library(null))).toEqual([]);
});

for (const signedIn of [false, true]) {
  test(`the live library keeps its migration notice when ${signedIn ? "signed in" : "a guest"} loads`, async () => {
    expect(library(userA.id).savePlan({ state: privateState(), name: "Legacy A" }).ok).toBe(true);
    const raw = window.localStorage.getItem(savedPlansKey(userA.id))!;
    window.localStorage.removeItem(savedPlansKey(userA.id));
    window.localStorage.setItem(LEGACY_SAVED_PLANS_STORE_KEY, raw);
    const liveStore = createSavedPlanStore();
    setSession(signedIn ? userB : null);
    await mount();
    const firstRead = liveStore.list();
    if (!firstRead.ok) throw new Error(firstRead.failure.message);
    expect(firstRead.doc.plans).toEqual([]);
    expect(firstRead.notices).toEqual([{
      kind: "corruptDataRecovered",
      message: "An older shared-browser library was quarantined because its owner could not be established.",
    }]);
    const nextRead = liveStore.list();
    if (!nextRead.ok) throw new Error(nextRead.failure.message);
    expect(nextRead.notices).toEqual(firstRead.notices);
    const keys = quarantines("untangle.saved-plans.corrupt-legacy-");
    expect(keys).toHaveLength(1);
    expect(window.localStorage.getItem(keys[0])).toBe(raw);
    expect(window.localStorage.getItem(LEGACY_SAVED_PLANS_STORE_KEY)).toBeNull();
    expect(createSavedPlanStore().readQuarantined(keys[0])).toBeNull();
    expect(createSavedPlanStore().listQuarantined()).toEqual([]);
    expect(plans(library(userA.id))).toEqual([]);
  });
}

test("sign-out deletes old guest work too, so the next guest starts empty", async () => {
  expect(createPlannerStateStore(window.localStorage).write(privateState(), 0).ok).toBe(true);
  expect(library(null).savePlan({ state: privateState(), name: "Old guest" }).ok).toBe(true);
  setSession(userA);
  const planner = await mount();
  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "new guest");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(readPlanner(null).state).toBeNull();
  expect(plans(createSavedPlanStore())).toEqual([]);
});

test("quarantine recovery and sign-out cleanup cannot cross account ids with a common prefix", () => {
  const storage = window.localStorage;
  const otherId = `${userA.id}-other`;
  storage.setItem(plannerStateKey(userA.id), "A corrupt planner");
  storage.setItem(plannerStateKey(otherId), "Other corrupt planner");
  const a = createPlannerStateStore(storage, userA.id);
  const other = createPlannerStateStore(storage, otherId);
  expect(a.read()).toMatchObject({ ok: true, state: null });
  expect(other.read()).toMatchObject({ ok: true, state: null });
  const otherKey = other.listQuarantined()[0];
  expect(other.readQuarantined(otherKey)).toBe("Other corrupt planner");
  expect(a.readQuarantined(otherKey)).toBeNull();
  clearPlannerIdentity(userA.id);
  expect(a.listQuarantined()).toEqual([]);
  expect(other.readQuarantined(otherKey)).toBe("Other corrupt planner");

  storage.setItem(savedPlansKey(userA.id), "A corrupt library");
  storage.setItem(savedPlansKey(otherId), "Other corrupt library");
  expect(library(userA.id).list()).toMatchObject({ ok: true, doc: { plans: [] } });
  expect(library(otherId).list()).toMatchObject({ ok: true, doc: { plans: [] } });
  const otherLibraryKey = library(otherId).listQuarantined()[0].key;
  expect(library(otherId).readQuarantined(otherLibraryKey)).toBe("Other corrupt library");
  expect(library(userA.id).readQuarantined(otherLibraryKey)).toBeNull();
  clearSavedPlansIdentity(userA.id);
  expect(library(userA.id).listQuarantined()).toEqual([]);
  expect(library(otherId).readQuarantined(otherLibraryKey)).toBe("Other corrupt library");
});

test("A's late save acknowledgment cannot recreate a backup after sign-out", async () => {
  server.writeElsewhere(privateState());
  setSession(userA);
  const planner = await mount();
  const release = server.holdNextPost();
  await planner.run((p) => p.setActiveDay("Thu"));
  await waitFor(() => server.postsStarted === 1, "A save started");
  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  release();
  await flushSaves();
  expect(server.row?.state.activeDay).toBe("Thu");
  expect(server.row?.state.transcriptRecords).toEqual([transcript]);
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(readPlanner(null).state).toBeNull();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
});

test("B's queued save uses B's backup after A's in-flight save settles", async () => {
  server.writeElsewhere(privateState());
  setSession(userA);
  const planner = await mount();
  const release = server.holdNextPost();
  await planner.run((p) => p.setActiveDay("Thu"));
  await waitFor(() => server.postsStarted === 1, "A save started");
  const serverB = new FakePlannerServer();
  globalThis.fetch = serverB.fetch as typeof fetch;
  setSession(userB);
  await waitFor(() => serverB.gets === 1 && planner.get().hydrated, "B loaded");
  await planner.run((p) => p.setActiveDay("Fri"));
  await flushSaves();
  expect(serverB.postsStarted).toBe(0);
  release();
  await waitFor(() => planner.get().saveState.label === "Saved", "B queued save stored");
  expect(serverB.row?.state.activeDay).toBe("Fri");
  expect(serverB.row?.state.transcriptRecords).toEqual([]);
  expect(readPlanner(userB.id).state?.activeDay).toBe("Fri");
  expect(readPlanner(userB.id).state?.transcriptRecords).toEqual([]);
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(readPlanner(null).state).toBeNull();
});

test("sign-out cleanup still deletes planner and library data when storage refuses new writes", () => {
  const storage = window.localStorage;
  const planner = createPlannerStateStore(storage, userA.id);
  expect(planner.write(privateState(), 0).ok).toBe(true);
  expect(library(userA.id).savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  expect(readPlanner(userA.id).state?.transcriptRecords).toEqual([transcript]);
  const original = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    clearPlannerIdentity(userA.id);
    clearSavedPlansIdentity(userA.id);
    expect(storage.getItem(plannerStateKey(userA.id))).toBeNull();
    expect(storage.getItem(savedPlansKey(userA.id))).toBeNull();
  } finally {
    storage.setItem = original;
  }
});


test("an import captured for A is refused after switching to B, while B can import its own file", async () => {
  setSession(userA);
  const planner = await mount();
  const store = createSavedPlanStore();
  const saved = store.savePlan({ state: privateState(), name: "A import" });
  if (!saved.ok) throw new Error(saved.failure.message);
  const token = store.captureIdentity();
  const serverB = new FakePlannerServer();
  globalThis.fetch = serverB.fetch as typeof fetch;
  setSession(userB);
  await waitFor(() => serverB.gets === 1 && planner.get().hydrated && store.available, "B ready");
  expect(store.importPlan(saved.value, undefined, token)).toMatchObject({ ok: false });
  expect(plans(store)).toEqual([]);
  const own = store.savePlan({ state: planner.get().plannerState, name: "B import" });
  if (!own.ok) throw new Error(own.failure.message);
  const imported = store.importPlan(own.value, undefined, store.captureIdentity());
  if (!imported.ok) throw new Error(imported.failure.message);
  expect(imported.snapshot.name).toBe("B import");
  expect(imported.snapshot.state.transcriptRecords).toEqual([]);
  expect(plans(store).map((p) => p.name)).toEqual(["B import", "B import"]);
});


for (const status of [0, 500]) {
  test(`a failed session lookup with status ${status} keeps A's identity and local data until confirmed sign-out`, async () => {
    server.writeElsewhere(privateState());
    setSession(userA);
    const planner = await mount();
    await planner.run((p) => p.setActiveDay("Thu"));
    await waitFor(() => planner.get().saveState.label === "Saved", "A backup saved");
    expect(library(userA.id).savePlan({ state: privateState(), name: "A offline copy" }).ok).toBe(true);
    const backup = window.localStorage.getItem(plannerStateKey(userA.id));
    expect(readPlanner(userA.id).state?.transcriptRecords).toEqual([transcript]);

    await planner.run(() => failSessionLookup(status));
    await flushSaves();
    expect(planner.get().isRegistered).toBe(true);
    expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(backup);
    expect(plans(createSavedPlanStore()).map((plan) => plan.name)).toEqual(["A offline copy"]);
    expect(window.localStorage.getItem(plannerStateKey(null))).toBeNull();

    await planner.run(() => setSession(userA));
    await planner.run(() => setSession(null));
    await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "confirmed signed-out guest");
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
    expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  });
}

for (const failure of ["401", "500", "network"]) {
  test(`a ${failure} planner load leaves the legacy key untouched until a successful ownership retry`, async () => {
    const state = privateState();
    const raw = legacyPlanner(state);
    server.writeElsewhere(state);
    let first = true;
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (first) {
        first = false;
        if (failure === "network") throw new Error("Synthetic dropped connection");
        return new Response("{}", { status: Number(failure) });
      }
      return server.fetch(input, init);
    }, { preconnect: previousFetch.preconnect });
    setSession(userA);
    const planner = await mount();
    expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBe(raw);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
    expect(quarantines("untangle.planner-state.corrupt-legacy-")).toEqual([]);
    expect(server.posts).toEqual([]);

    await planner.run((p) => p.retrySave());
    await waitFor(() => planner.get().saveState.label === "Saved", "server ownership retry loaded");
    expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
    expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
    expect(quarantines("untangle.planner-state.corrupt-legacy-")).toEqual([]);
    expect(server.posts).toEqual([]);
  });
}

test("legacy ownership ignores map insertion order after normalization", async () => {
  const state: PlannerState = {
    ...privateState(),
    courseStatuses: { ...getInitialPlannerState().courseStatuses, "ANTH 1010": "inProgress", "CSCE 1030": "inProgress" },
    selectedSections: { "ANTH 1010": "anth-1010-001", "CSCE 1030": "csce-1030-001" },
    lockedSections: { "ANTH 1010": "anth-1010-001", "CSCE 1030": "csce-1030-001" },
  };
  const raw = legacyPlanner(state);
  server.writeElsewhere({
    ...state,
    courseStatuses: Object.fromEntries(Object.entries(state.courseStatuses).reverse()),
    selectedSections: Object.fromEntries(Object.entries(state.selectedSections).reverse()),
    lockedSections: Object.fromEntries(Object.entries(state.lockedSections ?? {}).reverse()),
  });
  setSession(userA);
  const planner = await mount();
  expect(planner.get().plannerState.lockedSections).toEqual({ "ANTH 1010": "anth-1010-001", "CSCE 1030": "csce-1030-001" });
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
  expect(quarantines("untangle.planner-state.corrupt-legacy-")).toEqual([]);
});


test("a session lookup explicitly returning 401 confirms sign-out and deletes the old account's local data", async () => {
  server.writeElsewhere(privateState());
  setSession(userA);
  const planner = await mount();
  await planner.run((p) => p.setActiveDay("Thu"));
  await waitFor(() => planner.get().saveState.label === "Saved", "A backup saved");
  expect(readPlanner(userA.id).state?.transcriptRecords).toEqual([transcript]);
  expect(library(userA.id).savePlan({ state: privateState(), name: "A copy" }).ok).toBe(true);
  await planner.run(() => failSessionLookup(401));
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "server-confirmed guest");
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
});
