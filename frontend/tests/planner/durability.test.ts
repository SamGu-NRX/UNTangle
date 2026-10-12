import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakePlannerServer,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  setSession,
  waitFor,
} from "./test-dom";
import { getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, PLANNER_STATE_STORE_KEY } from "@/lib/planner-store";

// The planner's five durability rules, each asserted against the real
// provider. Registered-user rules run against a fake /api/planner with the
// route's revision contract; the real route and Postgres are covered by the
// API tests and the M6 browser journey.

const user = { id: "u6", email: "durable@my.unt.edu", name: "Durable Test" };
let server: FakePlannerServer;
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
  server = new FakePlannerServer();
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

  test("registered: reload, then sign-out and sign-in", async () => {
    setSession(user);
    const first = await mount();
    await first.run((p) => p.setOptimization("compact"));
    await waitFor(() => first.get().saveState.label === "Saved", "registered saved");

    const second = await remount(first);
    expect(second.get().plannerState.optimization).toBe("compact");
    expect(second.get().saveState.label).toBe("Saved");

    setSession(null);
    await waitFor(() => !second.get().isRegistered && second.get().hydrated, "signed out");
    setSession(user);
    await waitFor(() => second.get().isRegistered && second.get().hydrated, "signed in");
    await waitFor(() => second.get().saveState.label === "Saved", "saved after sign-in");
    expect(second.get().plannerState.optimization).toBe("compact");
    expect(server.row?.state.optimization).toBe("compact");
  });
});

describe("rule 2: a failed save is never Saved and can be retried", () => {
  for (const failure of [500, "drop"] as const) {
    test(`server ${failure === "drop" ? "dropped connection" : "500"}`, async () => {
      setSession(user);
      const planner = await mount();
      server.failNextPosts = [failure];
      await planner.run((p) => p.setOptimization("compact"));
      await waitFor(() => planner.get().saveState.status === "failed", "failed");
      expect(planner.get().saveState.label).toBe("Saving failed…");
      expect(planner.get().saveState.reason).toBe(failure === "drop" ? "network" : "server");
      await flushSaves();
      expect(planner.get().saveState.label).not.toBe("Saved");
      expect(server.row).toBeNull();

      await planner.run((p) => p.retrySave());
      await waitFor(() => planner.get().saveState.label === "Saved", "retried");
      expect(server.row?.state.optimization).toBe("compact");
    });
  }

  test("expired session", async () => {
    setSession(user);
    const planner = await mount();
    server.sessionValid = false;
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.status === "signed-out", "signed out");
    await flushSaves();
    expect(planner.get().saveState.label).toBe("Not saved: signed out");

    // Signed in again elsewhere (another tab); Retry goes through.
    server.sessionValid = true;
    await planner.run((p) => p.retrySave());
    await waitFor(() => planner.get().saveState.label === "Saved", "retried");
    expect(server.row?.state.optimization).toBe("compact");
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

  test("registered with unsaved edits: the server's 409 shows both versions", async () => {
    setSession(user);
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterMorning" });
    const planner = await mount();
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().conflict !== null, "conflict");
    expect(planner.get().conflict?.theirs?.optimization).toBe("clusterNight");
    expect(server.row?.state.optimization).toBe("clusterNight");
  });

  test("registered without unsaved edits: a newer server revision is adopted with a notice", async () => {
    setSession(user);
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterMorning" });
    const planner = await mount();
    await waitFor(() => planner.get().saveState.label === "Saved", "loaded");
    // Another tab saves: the server moves on and that tab's mirror write
    // fires a storage event here.
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    window.dispatchEvent(new window.StorageEvent("storage", { key: PLANNER_STATE_STORE_KEY }));
    await waitFor(() => planner.get().tookNewerVersion, "adopted");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(planner.get().saveState.label).toBe("Saved");
    expect(server.posts).toHaveLength(0);
  });
});
