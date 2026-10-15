import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Identity, StoreState } from "@untangle/sync";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import { planningTerm } from "@/lib/planner-sections";
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
  setSavedPlanIdentity,
} from "@/lib/saved-plans/store";
import { httpSyncIO, PlannerSync } from "@/lib/sync/planner-sync";
import type { PlannerState } from "@/lib/types";
import {
  advanceTime,
  FakeDocumentServer,
  failSessionLookup,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  waitFor,
  type PersistedDocumentStore,
  type PlannerValue,
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
const pushes: string[] = [];
const router = {
  back() {}, forward() {}, refresh() {}, replace() {}, prefetch: async () => {},
  push(href: string) { pushes.push(href); },
};
let previousFetch: typeof fetch;
let server: FakeDocumentServer;
let store: PersistedDocumentStore;
const mounted: Array<() => Promise<void>> = [];

beforeAll(installDom);
afterAll(removeDom);
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
  pushes.length = 0;
  store = resetDocumentStore();
  previousFetch = globalThis.fetch;
  server = new FakeDocumentServer();
  globalThis.fetch = server.fetch as typeof fetch;
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  setSession(null);
  globalThis.fetch = previousFetch;
});

async function mount(extra?: () => React.ReactNode) {
  const planner = await mountPlanner(extra);
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "identity hydrated");
  return planner;
}

const label = (planner: { get(): PlannerValue }) => planner.get().saveState.label;

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
/** Everything a user's documents in this browser's store hold, as one string to search. */
async function storedText(userId: string) {
  return JSON.stringify(await store.stored(userId));
}
/** True when a user's stored documents or server documents carry A's transcript row. */
const holdsTranscript = (text: string) => text.includes(transcript.id);

/**
 * The server commits the next PUT at once, under the session that sent it,
 * and its response reaches the browser only on release: a late acknowledgment.
 */
function holdNextPutResponse(): () => void {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let armed = true;
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await inner(input, init);
    if (armed && (init?.method ?? "GET").toUpperCase() === "PUT") {
      armed = false;
      await gate;
    }
    return response;
  }) as typeof fetch;
  return release;
}

/** Records which identities read or write this browser's document store. */
function observeDocumentStore(target: PersistedDocumentStore) {
  const touched: string[] = [];
  const read = target.read.bind(target);
  const transact = target.transact.bind(target);
  target.read = (identity: Identity) => { touched.push(`${identity.kind}:${identity.id}`); return read(identity); };
  target.transact = <T,>(identity: Identity, change: (state: StoreState) => T) => {
    touched.push(`${identity.kind}:${identity.id}`);
    return transact(identity, change);
  };
  return touched;
}

/** Puts a user's documents in this browser's store, as an earlier signed-in visit left them. */
async function storeDocuments(userId: string, state: PlannerState) {
  const initial = getInitialPlannerState();
  const sync = new PlannerSync(store, userId, planningTerm.id, httpSyncIO(() => server.fetch as typeof fetch), {
    state: initial,
    preferences: defaultSchedulePreferences(initial.optimization),
  });
  await sync.save(() => ({ state, preferences: defaultSchedulePreferences(state.optimization) }));
}

async function mountWithAccountMenu() {
  const React = await import("react");
  const { AccountMenu } = await import("@/components/shell/AccountMenu");
  return mount(() => React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(AccountMenu)));
}

async function signOutFromMenu(planner: Awaited<ReturnType<typeof mount>>) {
  const avatar = document.querySelector<HTMLButtonElement>(`button[aria-label="Account: ${userA.email}"]`);
  expect(avatar).not.toBeNull();
  await planner.run(() => avatar!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Sign out");
  expect(item).toBeDefined();
  await planner.run(() => item!.click());
  await waitFor(() => pushes.length === 1, "signed out");
  // better-auth's session store answers the sign-out.
  await planner.run(() => setSession(null));
}

test("A signs out, the guest starts empty, and A's local planner, library and documents are deleted", async () => {
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  const planner = await mountWithAccountMenu();
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  await planner.run((p) => p.setSelectedMajor("math"));
  await waitFor(() => label(planner) === "Synced", "A synced");
  expect((await store.stored(userA.id)).documents).toHaveLength(3);
  expect(holdsTranscript(await storedText(userA.id))).toBe(true);
  expect(library(userA.id).savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  expect(plans(library(userA.id)).map((p) => p.name)).toEqual(["A private"]);

  await signOutFromMenu(planner);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  await flushSaves();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(planner.get().plannerState.optimization).toBe(getInitialPlannerState().optimization);
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  expect((await store.stored(userA.id)).documents).toEqual([]);
  expect(readPlanner(null).state).toBeNull();
  expect(plans(library(null))).toEqual([]);
  expect(server.plan(userA.id)?.transcriptRecords).toEqual([transcript]);
  expect(server.plan(userA.id)?.selectedMajor).toBe("math");
});

test("A signs out, then B loads an empty account and saves only B's edits", async () => {
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  const planner = await mount();
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  const pulls = server.pulls;
  setSession(userB);
  await waitFor(() => server.pulls === pulls + 1 && planner.get().hydrated && planner.get().isRegistered, "B loaded");
  await flushSaves();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(planner.get().plannerState.optimization).toBe(getInitialPlannerState().optimization);
  expect(label(planner)).toBe("Not saved yet");
  expect(server.puts).toEqual([]);
  await planner.run((p) => p.setSelectedMajor("math"));
  await waitFor(() => label(planner) === "Synced", "B synced");
  expect(server.plan(userB.id)?.selectedMajor).toBe("math");
  expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
  for (const put of server.puts) expect(holdsTranscript(JSON.stringify(put.write))).toBe(false);
  expect((await store.stored(userB.id)).documents.length).toBeGreaterThan(0);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
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
  server.seedPlan(userA.id, state);
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
  server.seedPlan(userB.id, { ...getInitialPlannerState(), optimization: "compact" });
  setSession(userB);
  const planner = await mount();
  expect(planner.get().plannerState.optimization).toBe("compact");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  const keys = quarantines("untangle.planner-state.corrupt-legacy-");
  expect(keys).toHaveLength(1);
  expect(window.localStorage.getItem(keys[0])).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
  expect(readPlanner(userB.id).state).toBeNull();
  expect(createPlannerStateStore(window.localStorage).readQuarantined(keys[0])).toBeNull();
  await flushSaves();
  expect(server.puts).toEqual([]);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
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

test("a long-lived browser library follows B's identity before B's server plan loads", async () => {
  setSession(userA);
  const planner = await mount();
  const saved = createSavedPlanStore();
  expect(saved.savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  expect(plans(saved).map((p) => p.name)).toEqual(["A private"]);
  const pulls = server.pulls;
  const release = server.holdNextPull();
  setSession(userB);
  await waitFor(() => server.pulls === pulls + 1, "B loading");
  expect(plans(saved)).toEqual([]);
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  release();
  await waitFor(() => planner.get().planStamp.identity === `user:${userB.id}` && planner.get().hydrated && saved.available, "B ready");
  expect(plans(saved)).toEqual([]);
  expect(saved.savePlan({ state: planner.get().plannerState, name: "B plan" }).ok).toBe(true);
  expect(plans(saved).map((p) => [p.name, p.state.transcriptRecords])).toEqual([["B plan", []]]);
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

test("A's late save acknowledgment, and the rest of A's outbox, never reach B's documents after A's session ends", async () => {
  server.seedPlan(userA.id, privateState());
  // B's documents sit at the revisions A's do, so a stray write of A's would be accepted, not refused.
  const bState: PlannerState = { ...getInitialPlannerState(), optimization: "compact" };
  server.seedPlan(userB.id, bState);
  setSession(userA);
  const planner = await mount();
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  const release = holdNextPutResponse();
  // Two documents change, so A's outbox still holds a write while the first one's answer is late.
  await planner.run((p) => {
    p.setSelectedMajor("math");
    p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, daysOff: ["Fri"] } }));
  });
  await waitFor(() => server.puts.length === 1, "A's first write committed, its answer held");

  setSession(null);
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "guest loaded");
  setSession(userB);
  await waitFor(() => planner.get().planStamp.identity === `user:${userB.id}` && planner.get().hydrated, "B loaded");
  await waitFor(() => planner.get().plannerState.optimization === "compact", "B's plan shown");
  // A's second write waits behind the held answer, so anything of A's sent from here on carries B's session.
  expect(server.putsStarted).toBe(1);
  release();
  await flushSaves();
  await advanceTime(5000);

  expect(server.plan(userA.id)?.selectedMajor).toBe("math");
  expect(server.plan(userB.id)?.selectedMajor).toBeNull();
  expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
  const bPreferences = server.document(userB.id, "preferences-unt")?.body as { constraints: { daysOff: string[] } };
  expect(bPreferences.constraints.daysOff).toEqual([]);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(planner.get().plannerState.selectedMajor).toBeNull();
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(readPlanner(null).state).toBeNull();
});

test("B saves independently while A's retired save is still in flight", async () => {
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  const planner = await mount();
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  const release = holdNextPutResponse();
  await planner.run((p) => p.setSelectedMajor("math"));
  await waitFor(() => server.putsStarted === 1, "A save started");
  setSession(userB);
  await waitFor(() => planner.get().planStamp.identity === `user:${userB.id}` && planner.get().hydrated, "B loaded");
  await planner.run((p) => p.setSelectedMajor("ce"));
  await waitFor(() => label(planner) === "Synced", "B synced while A's answer is held");
  expect(server.putsStarted).toBe(2);
  release();
  await flushSaves();
  expect(label(planner)).toBe("Synced");
  expect(server.plan(userB.id)?.selectedMajor).toBe("ce");
  expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
  expect(planner.get().plannerState.selectedMajor).toBe("ce");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
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
  const saved = createSavedPlanStore();
  const kept = saved.savePlan({ state: privateState(), name: "A import" });
  if (!kept.ok) throw new Error(kept.failure.message);
  const token = saved.captureIdentity();
  const pulls = server.pulls;
  setSession(userB);
  await waitFor(() => server.pulls === pulls + 1 && planner.get().planStamp.identity === `user:${userB.id}` && planner.get().hydrated && saved.available, "B ready");
  expect(saved.importPlan(kept.value, undefined, token)).toMatchObject({ ok: false });
  expect(plans(saved)).toEqual([]);
  const own = saved.savePlan({ state: planner.get().plannerState, name: "B import" });
  if (!own.ok) throw new Error(own.failure.message);
  const imported = saved.importPlan(own.value, undefined, saved.captureIdentity());
  if (!imported.ok) throw new Error(imported.failure.message);
  expect(imported.snapshot.name).toBe("B import");
  expect(imported.snapshot.state.transcriptRecords).toEqual([]);
  expect(plans(saved).map((p) => p.name)).toEqual(["B import", "B import"]);
});


for (const status of [0, 500]) {
  test(`a failed session lookup with status ${status} keeps A's identity and local data until confirmed sign-out`, async () => {
    server.seedPlan(userA.id, privateState());
    setSession(userA);
    const planner = await mount();
    await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Synced", "A synced");
    expect(library(userA.id).savePlan({ state: privateState(), name: "A offline copy" }).ok).toBe(true);
    const documents = await storedText(userA.id);
    expect(holdsTranscript(documents)).toBe(true);

    await planner.run(() => failSessionLookup(status));
    await flushSaves();
    expect(planner.get().isRegistered).toBe(true);
    expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
    expect(await storedText(userA.id)).toBe(documents);
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
    server.seedPlan(userA.id, state);
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
    expect(server.puts).toEqual([]);

    await planner.run((p) => p.retrySave());
    await waitFor(() => label(planner) === "Saved on this device", "server ownership retry loaded");
    expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
    expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
    expect(quarantines("untangle.planner-state.corrupt-legacy-")).toEqual([]);
    expect(server.puts).toEqual([]);
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
  server.seedPlan(userA.id, {
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
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  const planner = await mount();
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  await planner.run((p) => p.setSelectedMajor("math"));
  await waitFor(() => label(planner) === "Synced", "A synced");
  expect(holdsTranscript(await storedText(userA.id))).toBe(true);
  expect(library(userA.id).savePlan({ state: privateState(), name: "A copy" }).ok).toBe(true);
  await planner.run(() => failSessionLookup(401));
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "server-confirmed guest");
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  // Every write was confirmed, so nothing waits in the outbox that a deletion could lose.
  expect((await store.stored(userA.id)).documents).toEqual([]);
});

test("B's first render, pagehide, saves, and stored documents never contain A's planner or library", async () => {
  const React = await import("react");
  const { usePlanner } = await import("@/components/planner-provider");
  const liveLibrary = createSavedPlanStore();
  const frames: Array<{ identity: string; transcriptIds: string[]; libraryNames: string[] }> = [];
  function ObserveIdentity() {
    const planner = usePlanner();
    const read = liveLibrary.list();
    frames.push({
      identity: planner.planStamp.identity,
      transcriptIds: planner.plannerState.transcriptRecords.map((record) => record.id),
      libraryNames: read.ok ? read.doc.plans.map((plan) => plan.name) : [],
    });
    React.useLayoutEffect(() => {
      if (planner.planStamp.identity === `user:${userB.id}`) {
        window.dispatchEvent(new Event("pagehide"));
      }
    }, [planner.planStamp.identity]);
    return React.createElement("span", null, planner.plannerState.transcriptRecords.map((record) => record.title).join(", "));
  }
  server.seedPlan(userA.id, privateState());
  expect(library(userA.id).savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
  const bState: PlannerState = { ...getInitialPlannerState(), optimization: "compact" };
  server.seedPlan(userB.id, bState);
  expect(library(userB.id).savePlan({ state: bState, name: "B copy" }).ok).toBe(true);
  setSession(userA);
  const planner = await mount(() => React.createElement(ObserveIdentity));
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  expect(frames.some((frame) => frame.identity === `user:${userA.id}` && frame.transcriptIds.includes(transcript.id))).toBe(true);
  await planner.run((p) => p.setSelectedMajor("math"));
  const retiredA = planner.get();
  const putsBeforeB = server.putsStarted;
  const pulls = server.pulls;
  const release = server.holdNextPull();
  try {
    await planner.run(() => setSession(userB));
    await waitFor(() => server.pulls === pulls + 1, "B load started");
    retiredA.resetPlanner();
    retiredA.retrySave();
    expect(await retiredA.transact(() => ({ next: privateState(), result: "stale" }), retiredA.planStamp)).toEqual({ status: "identity_changed" });
    expect(server.putsStarted).toBe(putsBeforeB);
    const firstB = frames.filter((frame) => frame.identity === `user:${userB.id}`);
    expect(firstB.length).toBeGreaterThan(0);
    for (const frame of firstB) {
      expect(frame.transcriptIds).toEqual([]);
      expect(frame.libraryNames).not.toContain("A private");
    }
    await flushSaves();
  } finally {
    release();
  }
  await waitFor(() => planner.get().hydrated && planner.get().plannerState.optimization === "compact", "B hydrated");
  await planner.run((p) => p.setSelectedMajor("ce"));
  await waitFor(() => label(planner) === "Synced", "B edit synced");
  for (const frame of frames.filter((frame) => frame.identity === `user:${userB.id}`)) {
    expect(frame.transcriptIds).toEqual([]);
    expect(frame.libraryNames).not.toContain("A private");
  }
  expect(plans(liveLibrary).map((plan) => plan.name)).toEqual(["B copy"]);
  expect(server.plan(userB.id)?.selectedMajor).toBe("ce");
  expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
  for (const put of server.puts) expect(holdsTranscript(JSON.stringify(put.write))).toBe(false);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
});

// The signed-in localStorage mirror is gone; an unsent edit surviving a reload is covered in document-sync.test.ts ("the outbox").

test("B's goal edit before bootstrap is saved against B's stored documents only", async () => {
  const React = await import("react");
  const { usePlanner } = await import("@/components/planner-provider");
  function EarlyEdit() {
    const planner = usePlanner();
    const editedRef = React.useRef(false);
    React.useLayoutEffect(() => {
      if (planner.planStamp.identity === `user:${userB.id}` && !editedRef.current) {
        editedRef.current = true;
        planner.setOptimization("clusterNight");
      }
    }, [planner]);
    return null;
  }
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  const planner = await mount(() => React.createElement(EarlyEdit));
  await waitFor(() => planner.get().plannerState.transcriptRecords.length === 1, "A's plan shown");
  server.seedPlan(userB.id, { ...getInitialPlannerState(), optimization: "compact" });
  const pulls = server.pulls;
  const release = server.holdNextPull();
  await planner.run(() => setSession(userB));
  await waitFor(() => server.pulls === pulls + 1, "B load started after its goal edit");
  expect(planner.get().plannerState.optimization).toBe("clusterNight");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(server.putsStarted).toBe(0);
  release();
  await waitFor(() => planner.get().hydrated, "B hydrated");
  await flushSaves();
  // Only the goal changed, so it merges into B's preferences like another tab's edit; B's schedule is not written.
  await waitFor(() => label(planner) === "Synced", "B's edit saved over B's documents");
  expect(planner.get().syncConflict).toBeNull();
  expect(server.puts.map((put) => [put.write.documentId, put.status])).toEqual([["preferences-unt", 200]]);
  expect(server.plan(userB.id)?.optimization).toBe("clusterNight");
  expect(planner.get().plannerState.optimization).toBe("clusterNight");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
  expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
  for (const put of server.puts) expect(holdsTranscript(JSON.stringify(put.write))).toBe(false);
  expect(holdsTranscript(await storedText(userB.id))).toBe(false);
});

test("StrictMode replay restarts bootstrap and ignores the retired first load", async () => {
  server.seedPlan(userA.id, privateState());
  setSession(userA);
  setSavedPlanIdentity(userA.id);
  const planner = await mountPlanner(undefined, undefined, true);
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "replayed bootstrap loaded");
  expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
  expect(label(planner)).toBe("Saved on this device");
  await flushSaves();
  // The retired first run stops before it reaches the network; only the replay pulls.
  expect(server.pulls).toBe(1);
  expect(server.puts).toEqual([]);
  expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
});

for (const status of [0, 500]) {
  test(`a cold session ${status} error renders guest work without accessing user storage`, async () => {
    const React = await import("react");
    const { PlannerPersistencePanel } = await import("@/components/planner-persistence-panel");
    const guest = { ...getInitialPlannerState(), activeDay: "Thu" as const };
    expect(createPlannerStateStore(window.localStorage, null).write(guest, 0).ok).toBe(true);
    await storeDocuments(userA.id, privateState());
    expect(library(null).savePlan({ state: guest, name: "Guest work" }).ok).toBe(true);
    expect(library(userA.id).savePlan({ state: privateState(), name: "A private" }).ok).toBe(true);
    const userDocuments = await storedText(userA.id);
    expect(holdsTranscript(userDocuments)).toBe(true);
    const userLibrary = window.localStorage.getItem(savedPlansKey(userA.id));
    // A module snapshot is not proof of a session after the provider remounts.
    setSavedPlanIdentity(status === 0 ? undefined : userA.id);
    failSessionLookup(status);
    const touchedDocuments = observeDocumentStore(store);
    const storage = window.localStorage;
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    const reads: string[] = [];
    const writes: string[] = [];
    const removals: string[] = [];
    const observedStorage: Storage = {
      get length() { return storage.length; },
      key: (index) => storage.key(index),
      clear: () => storage.clear(),
      getItem(key) { reads.push(key); return storage.getItem(key); },
      setItem(key, value) { writes.push(key); storage.setItem(key, value); },
      removeItem(key) { removals.push(key); storage.removeItem(key); },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: observedStorage });
    try {
      const planner = await mount(() => React.createElement(PlannerPersistencePanel));
      expect(planner.get().planStamp.identity).toBe("guest");
      expect(planner.get().plannerState.activeDay).toBe("Thu");
      expect(planner.get().plannerState.transcriptRecords).toEqual([]);
      expect(plans(createSavedPlanStore()).map((plan) => plan.name)).toEqual(["Guest work"]);
      expect(planner.container.querySelector('[aria-label="Save state"]')?.textContent).toContain("Not saved");
      expect(planner.get().saveState.detail).toContain("not synced");
      await planner.run((p) => p.setActiveDay("Fri"));
      await flushSaves();
      await planner.run((p) => p.retrySave());
      expect(planner.get().saveState.status).toBe("not-saved");
      expect(readPlanner(null).state?.activeDay).toBe("Fri");
      expect(server.pulls).toBe(0);
      expect(server.puts).toEqual([]);
      expect(reads).toContain(plannerStateKey(null));
      expect(writes).toContain(plannerStateKey(null));
      expect(reads.some((key) => key.includes(":user:"))).toBe(false);
      expect(writes.some((key) => key.includes(":user:"))).toBe(false);
      expect(removals.some((key) => key.includes(":user:"))).toBe(false);
      expect(touchedDocuments).toEqual([]);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else Reflect.deleteProperty(window, "localStorage");
    }
    expect(await storedText(userA.id)).toBe(userDocuments);
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBe(userLibrary);
  });
}

for (const stored of [false, true]) {
  test(`a recovered session uses ${stored ? "the account's server plan" : "an empty account"} without silently adopting unknown-session guest work`, async () => {
    const React = await import("react");
    const { usePlanner } = await import("@/components/planner-provider");
    const userFrames: string[][] = [];
    function ObserveAccount() {
      const planner = usePlanner();
      if (planner.planStamp.identity === `user:${userB.id}`) {
        userFrames.push(planner.plannerState.transcriptRecords.map((record) => record.id));
      }
      return null;
    }
    const guest: PlannerState = { ...privateState(), activeDay: "Thu" };
    expect(createPlannerStateStore(window.localStorage, null).write(guest, 0).ok).toBe(true);
    expect(library(null).savePlan({ state: guest, name: "Guest work" }).ok).toBe(true);
    const guestLibrary = window.localStorage.getItem(savedPlansKey(null));
    setSavedPlanIdentity(undefined);
    failSessionLookup(0);
    const planner = await mount(() => React.createElement(ObserveAccount));
    expect(planner.get().planStamp.identity).toBe("guest");
    expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
    await planner.run((p) => p.setActiveDay("Fri"));
    await flushSaves();
    const guestBackup = window.localStorage.getItem(plannerStateKey(null));
    if (stored) server.seedPlan(userB.id, { ...getInitialPlannerState(), optimization: "compact" });
    await planner.run(() => setSession(userB));
    await waitFor(() => planner.get().planStamp.identity === `user:${userB.id}` && planner.get().hydrated, "confirmed account loaded");
    await flushSaves();
    expect(planner.get().plannerState.transcriptRecords).toEqual([]);
    expect(planner.get().plannerState.optimization).toBe(stored ? "compact" : getInitialPlannerState().optimization);
    expect(planner.get().conflict).toBeNull();
    expect(planner.get().syncConflict).toBeNull();
    expect(server.puts).toEqual([]);
    expect(window.localStorage.getItem(plannerStateKey(userB.id))).toBeNull();
    expect(plans(createSavedPlanStore())).toEqual([]);
    expect(window.localStorage.getItem(savedPlansKey(userB.id))).toBeNull();
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Synced", "account edit synced");
    expect(server.plan(userB.id)?.selectedMajor).toBe("math");
    expect(server.plan(userB.id)?.transcriptRecords).toEqual([]);
    expect(holdsTranscript(await storedText(userB.id))).toBe(false);
    expect(userFrames.length).toBeGreaterThan(0);
    for (const frame of userFrames) expect(frame).toEqual([]);
    expect(window.localStorage.getItem(plannerStateKey(null))).toBe(guestBackup);
    expect(window.localStorage.getItem(savedPlansKey(null))).toBe(guestLibrary);
  });
}
