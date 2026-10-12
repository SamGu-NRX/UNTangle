import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakePlannerServer,
  flushSaves,
  installDom,
  mountPlanner,
  removeDom,
  setSession,
  waitFor,
} from "./planner/test-dom";
import { getInitialPlannerState } from "@/lib/planner";
import { onSessionExpired } from "@/lib/session-events";

// Load honesty for registered users: `Saved` appears only when a stored plan
// was actually read; every assertion reads the provider's live value.

const user = { id: "u1", email: "student@my.unt.edu", name: "Test Student" };
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

describe("registered load honesty", () => {
  test("a reachable but non-persistent load reports Not saved, never Saved", async () => {
    server.persistent = false;
    const planner = await mount();
    expect(server.gets).toBe(1);
    expect(planner.get().saveState.status).toBe("not-saved");
    expect(planner.get().saveState.label).toBe("Not saved…");
    expect(planner.get().saveState.reason).toBe("storage");
  });

  test("a stored plan that was read back shows Saved", async () => {
    const stored = { ...getInitialPlannerState(), optimization: "compact" as const };
    server.writeElsewhere(stored);
    const planner = await mount();
    expect(planner.get().plannerState.optimization).toBe("compact");
    expect(planner.get().saveState.label).toBe("Saved");
  });

  test("persistent storage with no plan yet shows a neutral Not saved yet, and writes nothing until an edit", async () => {
    const planner = await mount();
    expect(planner.get().saveState.label).toBe("Not saved yet");
    await flushSaves();
    expect(server.posts).toHaveLength(0);
    expect(planner.get().saveState.label).toBe("Not saved yet");

    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Saved", "first save acknowledged");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].baseRevision).toBe("0");
    expect(server.row?.state.optimization).toBe("compact");
  });

  test("a 401 at load shows Not saved: signed out, never Saved, and never POSTs a default", async () => {
    server.sessionValid = false;
    let expiredEvents = 0;
    const stop = onSessionExpired(() => {
      expiredEvents += 1;
    });
    try {
      const planner = await mount();
      expect(planner.get().saveState.label).toBe("Not saved: signed out");
      expect(planner.get().saveState.status).toBe("signed-out");
      expect(expiredEvents).toBe(1);

      // Even an edit must not POST while signed out.
      await planner.run((p) => p.setOptimization("compact"));
      await flushSaves();
      expect(server.posts).toHaveLength(0);
      expect(planner.get().saveState.label).toBe("Not saved: signed out");
    } finally {
      stop();
    }
  });
});
