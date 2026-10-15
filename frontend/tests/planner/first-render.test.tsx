/**
 * What a page load and the account menu do before and around the first
 * session answer: planner views render from the server HTML on, read and
 * write no stored data until an identity is prepared, and stay mounted when
 * the answer arrives. The account menu follows the account the planner
 * confirmed, and a failed sign-out says so and keeps the account's data.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { useEffect, type ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, LEGACY_PLANNER_STATE_STORE_KEY, plannerStateKey } from "@/lib/planner-store";
import { createSavedPlanStore, savedPlansKey, setSavedPlanIdentity } from "@/lib/saved-plans/store";
import type { PlannerState } from "@/lib/types";
import {
  advanceTime,
  FakePlannerServer,
  failSessionLookup,
  installDom,
  mountPlanner,
  pendSessionLookup,
  removeDom,
  resetSignOut,
  setSession,
  setSignOut,
  waitFor,
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
let server: FakePlannerServer;
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
  previousFetch = globalThis.fetch;
  server = new FakePlannerServer();
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

function legacyPlanner(state: PlannerState) {
  const raw = JSON.stringify({ storeSchemaVersion: 1, revision: 7, savedAt: "2026-10-14T12:00:00Z", state });
  window.localStorage.setItem(LEGACY_PLANNER_STATE_STORE_KEY, raw);
  return raw;
}

for (const answer of ["signed in as A", "no session"] as const) {
  test(`a page load renders planner views from the server HTML, touches no stored data while the first lookup is pending, and keeps them mounted when it answers ${answer}`, async () => {
    const { usePlanner } = await import("@/components/planner-provider");
    const { PlansClient } = await import("@/components/saved-plans/plans-client");
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
    server.writeElsewhere(stateA());
    createPlannerStateStore(window.localStorage, null).writeMirror({ ...getInitialPlannerState(), activeDay: "Thu" });
    expect(createSavedPlanStore(window.localStorage, null).savePlan({ state: getInitialPlannerState(), name: "Guest copy" }).ok).toBe(true);
    // Written last: a guest store quarantines a legacy planner on any access.
    const raw = legacyPlanner(stateA());
    pendSessionLookup();

    const storage = observeStorage();
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
    } finally {
      storage.restore();
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
    }
    await waitFor(() => planner.container.textContent?.includes(answer === "no session" ? "Guest copy" : "No saved") ?? false, "library read");
    expect(mounts).toBe(1);
  });
}

test("a pending first lookup leaves the legacy planner for the account it belongs to", async () => {
  const raw = legacyPlanner(stateA());
  server.writeElsewhere(stateA());
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
  server.writeElsewhere(stateA());
  setSession(userA);
  const planner = await mountPlanner(() => <NoteView />);
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "A loaded");
  globalThis.fetch = new FakePlannerServer().fetch as typeof fetch;
  await planner.run(() => setSession({ id: "first-render-b", email: "b@my.unt.edu", name: "B" }));
  await waitFor(() => planner.get().hydrated && planner.get().planStamp.identity === "user:first-render-b", "B loaded");
  const seenByB = held.filter((frame) => frame.identity === "user:first-render-b");
  expect(seenByB.length).toBeGreaterThan(0);
  for (const frame of seenByB) expect(frame.note).toBe("kept since user:first-render-b");
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
  server.writeElsewhere(stateA());
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

async function chooseSignOut(planner: Awaited<ReturnType<typeof mountPlanner>>) {
  await planner.run(() => avatar()!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Sign out");
  expect(item).toBeDefined();
  await planner.run(() => item!.click());
}

const toastText = () => document.querySelector(".ui-toast__message")?.textContent ?? null;

for (const failure of ["rejects", "returns an error"] as const) {
  test(`a sign-out that ${failure} says so, keeps the account's local data, and Try again signs out`, async () => {
    server.writeElsewhere(stateA());
    setSession(userA);
    const planner = await mountAccountMenu();
    await waitFor(() => planner.get().hydrated && planner.get().saveState.label === "Saved", "A loaded");
    await planner.run((p) => p.setActiveDay("Thu"));
    await waitFor(() => window.localStorage.getItem(plannerStateKey(userA.id)) !== null, "A backup written");
    expect(createSavedPlanStore().savePlan({ state: stateA(), name: "A copy" }).ok).toBe(true);
    const backup = window.localStorage.getItem(plannerStateKey(userA.id));
    const library = window.localStorage.getItem(savedPlansKey(userA.id));

    setSignOut(failure === "rejects"
      ? async () => { throw new TypeError("Failed to fetch"); }
      : async () => ({ data: null, error: { message: "Server error", status: 500 } }));
    await chooseSignOut(planner);
    await waitFor(() => toastText() !== null, "failure toast");
    expect(toastText()).toBe("Couldn't sign out. You're still signed in on this device.");
    expect(document.querySelector(".ui-toast")?.getAttribute("data-tone")).toBe("error");
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBe(backup);
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBe(library);
    expect(pushes).toEqual([]);
    expect(planner.get().isRegistered).toBe(true);

    resetSignOut();
    const retry = [...document.querySelectorAll<HTMLButtonElement>(".ui-toast__action")].find((el) => el.textContent === "Try again");
    expect(retry).toBeDefined();
    await planner.run(() => retry!.click());
    await waitFor(() => pushes.length === 1, "signed out");
    expect(pushes).toEqual(["/"]);
    expect(window.localStorage.getItem(plannerStateKey(userA.id))).toBeNull();
    expect(window.localStorage.getItem(savedPlansKey(userA.id))).toBeNull();
  });
}
