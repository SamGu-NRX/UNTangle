import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakeDocumentServer,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  waitFor,
} from "./planner/test-dom";
import { getInitialPlannerState } from "@/lib/planner";
import { onSessionExpired } from "@/lib/session-events";

// Load honesty for signed-in students: "Synced" appears only once a write's
// receipt arrives, and a load that didn't happen never claims to be saved.
// Every assertion reads the provider's live value.

const user = { id: "u1", email: "student@my.unt.edu", name: "Test Student" };
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
  setSession(user);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  globalThis.fetch = previousFetch;
  setSession(null);
});

async function mount() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

describe("signed-in load honesty", () => {
  test("a server without document storage reports Not saved, never Saved or Synced", async () => {
    server.available = false;
    const planner = await mount();
    expect(server.pulls).toBe(1);
    expect(planner.get().saveState.status).toBe("not-saved");
    expect(planner.get().saveState.label).toBe("Not saved…");
  });

  test("a plan read from the server is Synced; the same plan loaded offline from this device is Saved on this device", async () => {
    server.seedPlan(user.id, { ...getInitialPlannerState(), optimization: "compact" });
    const online = await mount();
    expect(online.get().plannerState.optimization).toBe("compact");
    expect(online.get().saveState.label).toBe("Synced");
    await online.unmount();
    mounted.splice(mounted.indexOf(online.unmount), 1);

    // The server can't be reached: the plan shows from this device's store, and nothing claims it matches the server.
    server.available = false;
    const offline = await mount();
    expect(offline.get().plannerState.optimization).toBe("compact");
    expect(offline.get().saveState.label).toBe("Saved on this device");
  });

  test("one confirmed write doesn't stand for documents only read from this device", async () => {
    server.seedPlan(user.id, getInitialPlannerState());
    const first = await mount();
    await first.unmount();
    mounted.splice(mounted.indexOf(first.unmount), 1);
    server.available = false;
    const planner = await mount();
    server.available = true;
    // Only the record is written; the schedule and preferences were last read from the device's store.
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => server.puts.some((put) => put.status === 200), "record written");
    await flushSaves();
    expect(planner.get().saveState.label).toBe("Saved on this device");
  });

  test("an account with no documents shows a neutral Not saved yet, and writes nothing until an edit", async () => {
    const planner = await mount();
    expect(planner.get().saveState.label).toBe("Not saved yet");
    await flushSaves();
    expect(server.putsStarted).toBe(0);
    expect(planner.get().saveState.label).toBe("Not saved yet");

    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Synced", "first write confirmed");
    // The goal and its weights live in preferences; nothing else changed.
    expect(server.puts.map((put) => [put.write.documentId, put.write.baseRevision, put.status])).toEqual([["preferences-unt", 0, 200]]);
    expect(server.plan(user.id)?.optimization).toBe("compact");
  });

  test("a 401 at load shows Needs sign-in, never Saved, and no write lands", async () => {
    server.sessionValid = false;
    let expiredEvents = 0;
    const stop = onSessionExpired(() => {
      expiredEvents += 1;
    });
    try {
      const planner = await mount();
      expect(planner.get().saveState.label).toBe("Needs sign-in");
      expect(planner.get().saveState.status).toBe("signed-out");
      expect(expiredEvents).toBe(1);

      await planner.run((p) => p.setOptimization("compact"));
      await flushSaves();
      expect(server.puts.every((put) => put.status === 401)).toBe(true);
      expect(server.plan(user.id)).toBeNull();
      expect(planner.get().saveState.label).toBe("Needs sign-in");
      expect(expiredEvents).toBe(1);
    } finally {
      stop();
    }
  });
});
