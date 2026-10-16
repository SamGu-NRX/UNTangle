/**
 * What a page load and the account menu do before and around the first
 * session answer: planner views render from the server HTML on, read and
 * write no stored data until an identity is prepared, and stay mounted when
 * the answer arrives. The account menu follows the account the planner
 * confirmed, and a failed sign-out says so and keeps the account's data.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { useEffect, type ReactNode } from "react";

// CSS modules have no loader under bun test: each class name is its own key.
mock.module("@/components/schedules-library/library.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Identity, StoreState } from "@untangle/sync";
import { getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, LEGACY_PLANNER_STATE_STORE_KEY, plannerStateKey } from "@/lib/planner-store";
import { createSavedPlanStore, savedPlansKey, setSavedPlanIdentity } from "@/lib/saved-plans/store";
import type { PlannerState } from "@/lib/types";
import {
  advanceTime,
  FakeDocumentServer,
  failSessionLookup,
  installDom,
  mountPlanner,
  pendSessionLookup,
  removeDom,
  resetDocumentStore,
  resetSignOut,
  setSession,
  setSignOut,
  waitFor,
  type PersistedDocumentStore,
} from "./test-dom";

const userA = { id: "first-render-a", email: "a@my.unt.edu", name: "A" };
const transcript: PlannerState["transcriptRecords"][number] = {
  id: "first-render-transcript", code: "ANTH 1150", title: "A's course",
  term: "2024 Fall", grade: "A", credits: 3, confidence: 1,
  rationale: "Synthetic fixture", duplicateExcluded: false,
  prerequisiteSatisfied: true, reviewRequired: false, appliedStatus: "completed", sourceKind: "unt",
};
const stateA = (): PlannerState => ({ ...getInitialPlannerState(), optimization: "clusterNight", transcriptRecords: [transcript] });
const pushes: string[] = [];
const router = {
  back() {}, forward() {}, refresh() {}, replace() {}, prefetch: async () => {},
  push(href: string) { pushes.push(href); },
};
const STORAGE_PROBE_KEY = "untangle.storage-probe";

let previousFetch: typeof fetch;
let server: FakeDocumentServer;
let store: PersistedDocumentStore;
const mounted: Array<() => Promise<void>> = [];

const consoleError = console.error;
beforeAll(() => {
  installDom();
  // The server render and the hydrating client share React's context objects in
  // one process, which React's development build reports as two concurrent
  // renderers. A real server and browser never share them.
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("Detected multiple renderers concurrently rendering")) return;
    consoleError(...args);
  };
});
afterAll(() => {
  console.error = consoleError;
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  setSavedPlanIdentity(undefined);
  pushes.length = 0;
  store = resetDocumentStore();
  previousFetch = globalThis.fetch;
  server = new FakeDocumentServer();
  globalThis.fetch = server.fetch as typeof fetch;
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  const { dismissToast } = await import("@/components/ui/Toast");
  // Every root is unmounted by now, so clearing the toast store renders nothing.
  dismissToast();
  setSession(null);
  resetSignOut();
  globalThis.fetch = previousFetch;
});

/** Records every localStorage call made through `window.localStorage` until `restore()`. */
function observeStorage() {
  const storage = window.localStorage;
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  const calls: string[] = [];
  const observed: Storage = {
    get length() { calls.push("length"); return storage.length; },
    key: (index) => { calls.push(`key:${index}`); return storage.key(index); },
    clear: () => { calls.push("clear"); storage.clear(); },
    getItem(key) { calls.push(`get:${key}`); return storage.getItem(key); },
    setItem(key, value) { calls.push(`set:${key}`); storage.setItem(key, value); },
    removeItem(key) { calls.push(`remove:${key}`); storage.removeItem(key); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: observed });
  return {
    calls,
    restore() {
      if (original) Object.defineProperty(window, "localStorage", original);
      else Reflect.deleteProperty(window, "localStorage");
    },
  };
}

/** Records which identities read or write this browser's document store until `restore()`. */
function observeDocumentStore() {
  const calls: string[] = [];
  const read = store.read;
  const transact = store.transact;
  store.read = (identity: Identity) => { calls.push(`read:${identity.kind}:${identity.id}`); return read.call(store, identity); };
  store.transact = <T,>(identity: Identity, change: (state: StoreState) => T) => {
    calls.push(`transact:${identity.kind}:${identity.id}`);
    return transact.call(store, identity, change) as Promise<T>;
  };
  return {
    calls,
    restore() {
      store.read = read;
      store.transact = transact;
    },
  };
}

function legacyPlanner(state: PlannerState) {
  const raw = JSON.stringify({ storeSchemaVersion: 1, revision: 7, savedAt: "2026-10-14T12:00:00Z", state });
  window.localStorage.setItem(LEGACY_PLANNER_STATE_STORE_KEY, raw);
  return raw;
}

for (const answer of ["signed in as A", "no session"] as const) {
  test(`a page load renders planner views from the server HTML, touches no stored data while the first lookup is pending, and keeps them mounted when it answers ${answer}`, async () => {
    const { usePlanner } = await import("@/components/planner-provider");
    const { SchedulesClient: PlansClient } = await import("@/components/schedules-library/schedules-client");
    const { PlannerPersistencePanel } = await import("@/components/planner-persistence-panel");
    let mounts = 0;
    const frames: Array<{ identityReady: boolean; hydrated: boolean }> = [];
    function View() {
      const planner = usePlanner();
      frames.push({ identityReady: planner.identityReady, hydrated: planner.hydrated });
      useEffect(() => { mounts += 1; }, []);
      return <p data-view="">{`identityReady=${planner.identityReady} hydrated=${planner.hydrated}`}</p>;
    }
    const views = (): ReactNode => (
      <AppRouterContext.Provider value={router}>
        <View />
        <PlannerPersistencePanel />
        <PlansClient />
      </AppRouterContext.Provider>
    );
    server.seedPlan(userA.id, stateA());
    expect(createPlannerStateStore(window.localStorage, null).write({ ...getInitialPlannerState(), activeDay: "Thu" }, 0).ok).toBe(true);
    expect(createSavedPlanStore(window.localStorage, null).savePlan({ state: getInitialPlannerState(), name: "Guest copy" }).ok).toBe(true);
    // Written last: a guest store quarantines a legacy planner on any access.
    const raw = legacyPlanner(stateA());
    pendSessionLookup();

    const storage = observeStorage();
    const documents = observeDocumentStore();
    let planner: Awaited<ReturnType<typeof mountPlanner>>;
    try {
      planner = await mountPlanner(views, undefined, false, { hydrate: true });
      mounted.push(planner.unmount);
      expect(planner.serverHtml).toContain("identityReady=false hydrated=false");
      expect(planner.recoverableErrors).toEqual([]);
      expect(planner.get().identityReady).toBe(false);
      expect(planner.get().hydrated).toBe(false);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((frame) => !frame.identityReady && !frame.hydrated)).toBe(true);
      expect(mounts).toBe(1);
      // The library view checks storage with a key that holds no one's data; nothing else is touched.
      expect(storage.calls.filter((call) => !call.endsWith(`:${STORAGE_PROBE_KEY}`))).toEqual([]);
      expect(documents.calls).toEqual([]);
      expect(server.pulls).toBe(0);
    } finally {
      storage.restore();
      documents.restore();
    }
    expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBe(raw);

    if (answer === "signed in as A") {
      await planner.run(() => setSession(userA));
      await waitFor(() => planner.get().identityReady && planner.get().hydrated, "A loaded");
      expect(planner.get().plannerState.transcriptRecords).toEqual([transcript]);
      // The pending lookup left the legacy planner alone, so A's matching server copy claims it.
      expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
      expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
      expect(Object.keys(window.localStorage).filter((key) => key.includes("corrupt-legacy-"))).toEqual([]);
    } else {
      await planner.run(() => setSession(null));
      await waitFor(() => planner.get().identityReady && planner.get().hydrated, "guest loaded");
      expect(planner.get().plannerState.activeDay).toBe("Thu");
      expect(planner.get().plannerState.transcriptRecords).toEqual([]);
      expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
      expect(Object.keys(window.localStorage).filter((key) => key.includes("corrupt-legacy-"))).toHaveLength(1);
      expect(server.pulls).toBe(0);
    }
    // No confirmed guest used this browser session, so signing in leaves the guest's library where it is.
    await waitFor(() => planner.container.textContent?.includes(answer === "no session" ? "Guest copy" : "Save a copy of Main to try another week") ?? false, "library read");
    expect(mounts).toBe(1);
  });
}

test("a pending first lookup leaves the legacy planner for the account it belongs to", async () => {
  const raw = legacyPlanner(stateA());
  server.seedPlan(userA.id, stateA());
  pendSessionLookup();
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await advanceTime(500);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBe(raw);
  expect(Object.keys(window.localStorage).filter((key) => key.includes("corrupt-legacy-"))).toEqual([]);
  expect(planner.get().hydrated).toBe(false);

  await planner.run(() => setSession(userA));
  await waitFor(() => planner.get().hydrated, "A loaded");
  expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(raw);
  expect(window.localStorage.getItem(LEGACY_PLANNER_STATE_STORE_KEY)).toBeNull();
});

test("an account switch remounts the views, so state they hold for A cannot reach B", async () => {
  const { usePlanner } = await import("@/components/planner-provider");
  const { useState } = await import("react");
  const held: Array<{ identity: string; note: string }> = [];
  function NoteView() {
    const planner = usePlanner();
    // Stands in for view state such as a parsed transcript or an Undo snapshot.
    const [note] = useState(() => `kept since ${planner.planStamp.identity}`);
    held.push({ identity: planner.planStamp.identity, note });
    return null;
  }
  server.seedPlan(userA.id, stateA());
  setSession(userA);
  const planner = await mountPlanner(() => <NoteView />);
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "A loaded");
  await planner.run(() => setSession({ id: "first-render-b", email: "b@my.unt.edu", name: "B" }));
  await waitFor(() => planner.get().hydrated && planner.get().planStamp.identity === "user:first-render-b", "B loaded");
  const seenByB = held.filter((frame) => frame.identity === "user:first-render-b");
  expect(seenByB.length).toBeGreaterThan(0);
  for (const frame of seenByB) expect(frame.note).toBe("kept since user:first-render-b");
  expect(planner.get().plannerState.transcriptRecords).toEqual([]);
});

async function mountAccountMenu() {
  const { AccountMenu } = await import("@/components/shell/AccountMenu");
  const { Toaster } = await import("@/components/ui/Toast");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <AccountMenu />
      <Toaster />
    </AppRouterContext.Provider>
  ));
  mounted.push(planner.unmount);
  return planner;
}

const avatar = () => document.querySelector<HTMLButtonElement>(`button[aria-label="Account: ${userA.email}"]`);
const signInLink = () => [...document.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Sign in") ?? null;

test("the account menu keeps the confirmed account through a failed or pending lookup until sign-out is confirmed", async () => {
  server.seedPlan(userA.id, stateA());
  setSession(userA);
  const planner = await mountAccountMenu();
  await waitFor(() => planner.get().hydrated, "A loaded");
  expect(avatar()).not.toBeNull();

  await planner.run(() => failSessionLookup(500));
  expect(planner.get().isRegistered).toBe(true);
  expect(avatar()).not.toBeNull();
  expect(signInLink()).toBeNull();

  await planner.run(() => pendSessionLookup());
  expect(avatar()).not.toBeNull();

  await planner.run(() => failSessionLookup(401));
  await waitFor(() => !planner.get().isRegistered && planner.get().hydrated, "confirmed sign-out");
  expect(avatar()).toBeNull();
  expect(signInLink()).not.toBeNull();
});

const dialogButton = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((el) => el.textContent?.trim().startsWith(name));

async function chooseSignOut(planner: Awaited<ReturnType<typeof mountPlanner>>) {
  await planner.run(() => avatar()!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Sign out");
  expect(item).toBeDefined();
  await planner.run(() => item!.click());
}

const toastText = () => document.querySelector(".ui-toast__message")?.textContent ?? null;

for (const failure of ["rejects", "returns an error"] as const) {
  test(`a sign-out that ${failure} says so, keeps the account's local data, and Try again signs out`, async () => {
    server.seedPlan(userA.id, stateA());
    setSession(userA);
    const planner = await mountAccountMenu();
    await waitFor(() => planner.get().hydrated && planner.get().saveState.label === "Synced", "A loaded");
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => planner.get().saveState.label === "Synced", "A synced");
    expect(createSavedPlanStore().savePlan({ state: stateA(), name: "A copy" }).ok).toBe(true);
    const documents = JSON.stringify(await store.stored(userA.id));
    expect(documents).toContain(transcript.id);
    const library = window.localStorage.getItem(savedPlansKey(userA.id));

    setSignOut(failure === "rejects"
      ? async () => { throw new TypeError("Failed to fetch"); }
      : async () => ({ data: null, error: { message: "Server error", status: 500 } }));
    await chooseSignOut(planner);
    // The saved copy lives only on this browser, so signing out asks before removing it.
    await waitFor(() => dialogButton("Remove and sign out") !== undefined, "saved schedules warning");
    await planner.run(() => dialogButton("Remove and sign out")!.click());
    await waitFor(() => toastText() !== null, "failure toast");
    expect(toastText()).toBe("Couldn't sign out. You're still signed in on this device.");
    expect(document.querySelector(".ui-toast")?.getAttribute("data-tone")).toBe("error");
    expect(JSON.stringify(await store.stored(userA.id))).toBe(documents);
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBe(library);
    expect(pushes).toEqual([]);
    expect(planner.get().isRegistered).toBe(true);

    resetSignOut();
    const retry = [...document.querySelectorAll<HTMLButtonElement>(".ui-toast__action")].find((el) => el.textContent === "Try again");
    expect(retry).toBeDefined();
    await planner.run(() => retry!.click());
    await waitFor(() => pushes.length === 1, "signed out");
    expect(pushes).toEqual(["/"]);
    expect((await store.stored(userA.id)).documents).toEqual([]);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  });
}

test("signing out names the saved schedules only this browser keeps, and keeps them unless the student chooses to remove them", async () => {
  server.seedPlan(userA.id, stateA());
  setSession(userA);
  const planner = await mountAccountMenu();
  await waitFor(() => planner.get().hydrated && planner.get().saveState.label === "Synced", "A loaded");
  expect(createSavedPlanStore().savePlan({ state: stateA(), name: "Kept from this device, Oct 15" }).ok).toBe(true);
  const library = window.localStorage.getItem(savedPlansKey(userA.id));

  await chooseSignOut(planner);
  await waitFor(() => document.querySelector('[role="alertdialog"]') !== null, "warning");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "1 saved schedule is kept only on this browser. Export it from Schedules to keep a copy.",
  );
  await planner.run(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(pushes).toEqual([]);
  expect(planner.get().isRegistered).toBe(true);
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBe(library);

  await chooseSignOut(planner);
  await waitFor(() => dialogButton("Remove and sign out") !== undefined, "warning again");
  await planner.run(() => dialogButton("Remove and sign out")!.click());
  await waitFor(() => pushes.length === 1, "signed out");
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
});

test("signing out while guest work waits for an answer says so before removing it", async () => {
  const { stampGuestWork } = await import("@/lib/guest-session");
  // The account's Main plans a course the guest's doesn't, so signing in asks.
  server.seedPlan(userA.id, { ...stateA(), courseStatuses: { ...stateA().courseStatuses, "MATH 1720": "inProgress" } });
  const guest = getInitialPlannerState();
  expect(createPlannerStateStore(window.localStorage, null).write({ ...guest, courseStatuses: { ...guest.courseStatuses, "ENGL 1310": "inProgress" } }, 0).ok).toBe(true);
  stampGuestWork("plan");
  setSession(userA);
  const planner = await mountAccountMenu();
  await waitFor(() => planner.get().guestSignIn !== null, "asked about the guest work");

  await chooseSignOut(planner);
  await waitFor(() => document.querySelector('[role="alertdialog"]') !== null, "warning");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("What you did as a guest before signing in hasn't been added to your account yet.");
  expect(pushes).toEqual([]);
  await planner.run(() => dialogButton("Remove and sign out")!.click());
  await waitFor(() => pushes.length === 1, "signed out");
  expect(window.localStorage.getItem(plannerStateKey(null))).toBeNull();
});

test("discarding waiting writes and then removing saved schedules signs out, without asking the first question again", async () => {
  server.seedPlan(userA.id, stateA());
  setSession(userA);
  const planner = await mountAccountMenu();
  await waitFor(() => planner.get().hydrated && planner.get().saveState.label === "Synced", "A loaded");
  expect(createSavedPlanStore().savePlan({ state: stateA(), name: "A copy" }).ok).toBe(true);
  server.sessionValid = false;
  await planner.run((p) => p.setSelectedMajor("math"));
  await waitFor(() => planner.get().saveState.label === "Needs sign-in", "a write waits");

  await chooseSignOut(planner);
  await waitFor(() => dialogButton("Sign out and discard") !== undefined, "unsynced question");
  await planner.run(() => dialogButton("Sign out and discard")!.click());
  await waitFor(() => dialogButton("Remove and sign out") !== undefined, "saved schedules question");
  await planner.run(() => dialogButton("Remove and sign out")!.click());
  await waitFor(() => pushes.length === 1, "signed out");
  expect((await store.stored(userA.id)).documents).toEqual([]);
  expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
});

