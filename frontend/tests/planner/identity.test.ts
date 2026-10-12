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

// Bootstrap belongs to one identity: a late response from a previous user is
// dropped, and edits made before hydration never silently replace a stored
// plan.

const userA = { id: "user-a", email: "a@my.unt.edu", name: "User A" };
const userB = { id: "user-b", email: "b@my.unt.edu", name: "User B" };
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
  previousFetch = globalThis.fetch;
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  globalThis.fetch = previousFetch;
  setSession(null);
});

describe("account switch", () => {
  test("A's late load never lands on B's account", async () => {
    const serverA = new FakePlannerServer();
    const serverB = new FakePlannerServer();
    serverA.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    serverB.writeElsewhere({ ...getInitialPlannerState(), optimization: "compact" });
    // Each request goes to the server of whoever is signed in when it starts.
    let active: "A" | "B" = "A";
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      (active === "A" ? serverA : serverB).fetch(input, init)) as typeof fetch;

    const releaseA = serverA.holdNextGet();
    setSession(userA);
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    expect(planner.get().hydrated).toBe(false);

    active = "B";
    setSession(userB);
    // B's load is answered first; A's answer arrives after it. (React may hold
    // B's render until A's transition settles, so the outcome is asserted
    // once both have answered.)
    await waitFor(() => serverB.gets === 1, "B's load requested");
    await flushSaves(50);
    releaseA();
    await waitFor(() => planner.get().saveState.label === "Saved", "B loaded");
    await flushSaves();
    expect(serverA.gets).toBe(1);
    expect(planner.get().plannerState.optimization).toBe("compact");
    expect(planner.get().saveState.label).toBe("Saved");
    expect(planner.get().conflict).toBeNull();
    expect(serverA.posts).toHaveLength(0);
    expect(serverB.posts).toHaveLength(0);
    expect(serverB.row?.state.optimization).toBe("compact");

    // B's next edit is saved on B's revision, not A's.
    await planner.run((p) => p.setActiveDay("Thu"));
    await waitFor(() => planner.get().saveState.label === "Saved", "B edit saved");
    expect(serverB.posts[0].baseRevision).toBe("1");
    expect(serverA.posts).toHaveLength(0);
  });
});

describe("edits made before hydration", () => {
  async function mountWithEarlyEdit(server: FakePlannerServer) {
    globalThis.fetch = server.fetch as typeof fetch;
    const releaseLoad = server.holdNextGet();
    setSession(userA);
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    expect(planner.get().hydrated).toBe(false);
    await planner.run((p) => p.setOptimization("compact"));
    releaseLoad();
    await planner.get().afterHydration();
    return planner;
  }

  test("meeting a different stored plan: both versions are shown, and nothing is written until the user chooses", async () => {
    const server = new FakePlannerServer();
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    const planner = await mountWithEarlyEdit(server);

    await waitFor(() => planner.get().conflict !== null, "conflict");
    expect(planner.get().conflict?.mine.optimization).toBe("compact");
    expect(planner.get().conflict?.theirs?.optimization).toBe("clusterNight");
    await flushSaves();
    expect(server.posts).toHaveLength(0);
    expect(server.row?.state.optimization).toBe("clusterNight");
    expect(planner.get().saveState.label).not.toBe("Saved");

    await planner.run((p) => p.resolveConflict("keep-mine"));
    await waitFor(() => planner.get().saveState.label === "Saved", "kept mine");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].baseRevision).toBe("1");
    expect(server.row).toMatchObject({ revision: 2 });
    expect(server.row?.state.optimization).toBe("compact");
  });

  test("choosing the stored plan discards the early edits without a write", async () => {
    const server = new FakePlannerServer();
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    const planner = await mountWithEarlyEdit(server);
    await waitFor(() => planner.get().conflict !== null, "conflict");
    await planner.run((p) => p.resolveConflict("take-theirs"));
    await waitFor(() => planner.get().saveState.label === "Saved", "took stored");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    await flushSaves();
    expect(server.posts).toHaveLength(0);
  });

  test("with no stored plan, early edits are saved from revision 0", async () => {
    const server = new FakePlannerServer();
    const planner = await mountWithEarlyEdit(server);
    await waitFor(() => planner.get().saveState.label === "Saved", "saved");
    expect(planner.get().conflict).toBeNull();
    expect(server.posts[0].baseRevision).toBe("0");
    expect(server.row?.state.optimization).toBe("compact");
  });
});
