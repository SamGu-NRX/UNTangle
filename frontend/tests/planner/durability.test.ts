import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakeDocumentServer,
  advanceTime,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  waitFor,
} from "./test-dom";
import { getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, PLANNER_STATE_STORE_KEY } from "@/lib/planner-store";

// The planner's five durability rules, each asserted against the real
// provider. Signed-in rules run against the real /api/v1 handlers over
// in-memory tables (test-dom.ts); Postgres is covered by the live tests.

const user = { id: "u6", email: "durable@my.unt.edu", name: "Durable Test" };
let server: FakeDocumentServer;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  resetDocumentStore();
  server = new FakeDocumentServer();
  previousFetch = globalThis.fetch;
  globalThis.fetch = server.fetch as typeof fetch;
  setSession(null);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  globalThis.fetch = previousFetch;
  setSession(null);
});

async function mount(extra?: () => React.ReactNode) {
  const planner = await mountPlanner(extra);
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

async function remount(previous: Awaited<ReturnType<typeof mount>>) {
  await previous.unmount();
  mounted.splice(mounted.indexOf(previous.unmount), 1);
  return mount();
}

describe("rule 1: a save shown as Saved survives a reload", () => {
  test("guest", async () => {
    const first = await mount();
    await first.run((p) => p.setOptimization("compact"));
    await waitFor(() => first.get().saveState.label === "Saved", "guest saved");

    const second = await remount(first);
    expect(second.get().plannerState.optimization).toBe("compact");
    expect(second.get().saveState.label).toBe("Saved");
  });

  test("registered: reload, then sign-out and sign-in on a fresh browser", async () => {
    setSession(user);
    const first = await mount();
    await first.run((p) => p.setOptimization("compact"));
    await waitFor(() => first.get().saveState.label === "Synced", "registered synced");

    const second = await remount(first);
    expect(second.get().plannerState.optimization).toBe("compact");
    await waitFor(() => second.get().saveState.label === "Synced", "synced after reload");

    setSession(null);
    await waitFor(() => !second.get().isRegistered && second.get().hydrated, "signed out");
    // Signing out deleted this account's documents from the browser; the server still has them.
    resetDocumentStore();
    setSession(user);
    await waitFor(() => second.get().isRegistered && second.get().hydrated, "signed in");
    await waitFor(() => second.get().plannerState.optimization === "compact", "loaded from the server");
    expect(second.get().saveState.label).toBe("Synced");
    expect(server.plan(user.id)?.optimization).toBe("compact");
  });
});

test("guest save waits for the full 350 ms debounce, independent of React settling", async () => {
  const planner = await mount();
  await planner.run((p) => p.setOptimization("compact"));
  await advanceTime(349);
  expect(window.localStorage.getItem(PLANNER_STATE_STORE_KEY)).toBeNull();
  expect(planner.get().saveState.label).not.toBe("Saved");
  await advanceTime(1);
  expect(planner.get().saveState.label).toBe("Saved");
  expect(JSON.parse(window.localStorage.getItem(PLANNER_STATE_STORE_KEY)!).state.optimization).toBe("compact");
});

describe("rule 1: an edit is not lost when the page goes away before its save", () => {
  test("guest: pagehide writes the pending edit synchronously", async () => {
    const first = await mount();
    await first.run((p) => p.setOptimization("compact"));
    // Before the 350 ms debounce: nothing stored yet.
    expect(window.localStorage.getItem(PLANNER_STATE_STORE_KEY)).toBeNull();
    window.dispatchEvent(new window.Event("pagehide"));
    const stored = JSON.parse(window.localStorage.getItem(PLANNER_STATE_STORE_KEY) ?? "{}");
    expect(stored.state?.optimization).toBe("compact");

    const second = await remount(first);
    expect(second.get().plannerState.optimization).toBe("compact");
    expect(second.get().saveState.label).toBe("Saved");
  });

  test("registered: pagehide puts the pending edit into the outbox, and the next load sends it", async () => {
    setSession(user);
    server.seedPlan(user.id, { ...getInitialPlannerState(), optimization: "clusterMorning" });
    const first = await mount();
    await waitFor(() => first.get().saveState.label === "Synced", "loaded");
    const release = server.holdNextPut();
    await first.run((p) => p.setOptimization("compact"));
    window.dispatchEvent(new window.Event("pagehide"));
    await waitFor(() => server.putsStarted === 1, "the outbox write is on its way");
    // The page is gone before the response.
    const second = await remount(first);
    release();
    await waitFor(() => second.get().saveState.label === "Synced", "sent by the next load");
    expect(second.get().plannerState.optimization).toBe("compact");
    expect(server.plan(user.id)?.optimization).toBe("compact");
    expect(new Set(server.puts.map((put) => put.write.operationId)).size).toBe(1);
  });
});

describe("rule 2: a failed save is never Synced and can be retried", () => {
  for (const failure of [500, "drop"] as const) {
    test(`server ${failure === "drop" ? "dropped connection" : "500"}`, async () => {
      setSession(user);
      const planner = await mount();
      server.failNextPuts = [failure];
      await planner.run((p) => p.setOptimization("compact"));
      await waitFor(() => planner.get().saveState.status === "failed", "failed");
      expect(planner.get().saveState.label).toBe("Save not confirmed (retrying)");
      expect(planner.get().saveState.reason).toBe("network");
      expect(server.plan(user.id)).toBeNull();

      await planner.run((p) => p.retrySave());
      await waitFor(() => planner.get().saveState.label === "Synced", "retried");
      expect(server.plan(user.id)?.optimization).toBe("compact");
    });
  }

  test("expired session", async () => {
    setSession(user);
    const planner = await mount();
    server.sessionValid = false;
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.status === "signed-out", "signed out");
    await flushSaves();
    expect(planner.get().saveState.label).toBe("Needs sign-in");

    // Signed in again elsewhere (another tab); Retry goes through.
    server.sessionValid = true;
    await planner.run((p) => p.retrySave());
    await waitFor(() => planner.get().saveState.label === "Synced", "retried");
    expect(server.plan(user.id)?.optimization).toBe("compact");
  });
});

describe("rule 3: storage denied keeps edits in memory with a persistent warning and export", () => {
  test("guest with localStorage refusing writes", async () => {
    // Browsers with storage disabled throw on access to window.localStorage.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      const { PlannerPersistencePanel } = await import("@/components/planner-persistence-panel");
      const React = await import("react");
      const planner = await mount(() => React.createElement(PlannerPersistencePanel));
      expect(planner.get().saveState.status).toBe("not-saved");
      expect(planner.get().guestStorageAvailable).toBe(false);

      await planner.run((p) => p.setOptimization("compact"));
      await flushSaves();
      expect(planner.get().plannerState.optimization).toBe("compact");
      expect(planner.get().saveState.status).toBe("not-saved");
      expect(planner.get().saveState.label).not.toBe("Saved");

      const statusText = planner.container.querySelector('[aria-label="Save state"]')?.textContent ?? "";
      expect(statusText).toContain("Not saved");
      const buttons = [...planner.container.querySelectorAll("button")].map((b) => b.textContent);
      expect(buttons).toContain("Export schedule");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    }
  });
});

describe("rule 4: corrupt stored bytes are quarantined intact and never claimed as recovered", () => {
  test("guest store with unreadable bytes", async () => {
    const corrupt = '{"storeSchemaVersion":1,"revision":4,"state":{"optimization":"compact"';
    window.localStorage.setItem(PLANNER_STATE_STORE_KEY, corrupt);
    const planner = await mount();

    const notices = planner.get().storeNotices;
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("nothing was recovered");
    expect(notices[0].message).not.toMatch(/restored|recovered your/i);
    const key = notices[0].quarantinedTo!;
    expect(window.localStorage.getItem(key)).toBe(corrupt);
    expect(planner.get().saveState.label).toBe("Not saved yet");
    expect(planner.get().plannerState.optimization).toBe(getInitialPlannerState().optimization);
  });
});

describe("rule 5: another tab saves newer data", () => {
  function writeFromOtherTab(optimization: "clusterNight" | "compact") {
    const other = createPlannerStateStore(window.localStorage);
    const read = other.read();
    if (!read.ok) throw new Error("other tab cannot read");
    const result = other.write({ ...getInitialPlannerState(), optimization }, read.revision);
    if (!result.ok) throw new Error("other tab write failed");
    window.dispatchEvent(new window.StorageEvent("storage", { key: PLANNER_STATE_STORE_KEY }));
  }

  test("guest with unsaved edits: both versions are shown and the user chooses", async () => {
    const planner = await mount();
    await planner.run((p) => p.setOptimization("compact"));
    // The other tab writes before this tab's debounced save fires.
    writeFromOtherTab("clusterNight");
    await waitFor(() => planner.get().conflict !== null, "conflict");
    const conflict = planner.get().conflict!;
    expect(conflict.mine.optimization).toBe("compact");
    expect(conflict.theirs?.optimization).toBe("clusterNight");
    expect(planner.get().saveState.label).not.toBe("Saved");

    await planner.run((p) => p.resolveConflict("take-theirs"));
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    await waitFor(() => planner.get().saveState.label === "Saved", "took theirs");
  });

  test("guest without unsaved edits: the tab adopts the newer data and says so", async () => {
    const planner = await mount();
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Saved", "saved");
    writeFromOtherTab("clusterNight");
    await waitFor(() => planner.get().tookNewerVersion, "adopted");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(planner.get().conflict).toBeNull();
    expect(planner.get().saveState.label).toBe("Saved");
  });

  test("registered with unsaved edits: a write over a newer Main shows both and overwrites nothing", async () => {
    setSession(user);
    server.seedPlan(user.id, getInitialPlannerState());
    const planner = await mount();
    const theirs = getInitialPlannerState();
    server.seedPlan(user.id, { ...theirs, courseStatuses: { ...theirs.courseStatuses, "MATH 1710": "inProgress" } });
    await planner.run((p) => p.setCourseStatus("CSCE 1030", "inProgress"));
    await waitFor(() => planner.get().syncConflict !== null, "conflict");
    expect(planner.get().syncConflict?.kind).toBe("schedule");
    expect(planner.get().plannerState.courseStatuses["CSCE 1030"]).toBe("inProgress");
    expect(server.plan(user.id)?.courseStatuses["CSCE 1030"]).toBe("notTaken");
    expect(server.plan(user.id)?.courseStatuses["MATH 1710"]).toBe("inProgress");
  });

  test("registered without unsaved edits: another device's newer documents are adopted with a notice", async () => {
    setSession(user);
    server.seedPlan(user.id, { ...getInitialPlannerState(), optimization: "clusterMorning" });
    const planner = await mount();
    await waitFor(() => planner.get().saveState.label === "Synced", "loaded");
    server.seedPlan(user.id, { ...getInitialPlannerState(), optimization: "clusterNight" });
    // Polling: coming back to the tab pulls.
    await planner.run(() => window.dispatchEvent(new window.Event("focus")));
    await waitFor(() => planner.get().tookNewerVersion, "adopted");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(planner.get().saveState.label).toBe("Synced");
    expect(server.putsStarted).toBe(0);
  });
});
