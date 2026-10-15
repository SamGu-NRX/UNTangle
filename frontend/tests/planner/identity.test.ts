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
} from "./test-dom";
import { createSavedPlanStore } from "@/lib/saved-plans/store";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";

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
  resetDocumentStore();
  previousFetch = globalThis.fetch;
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  globalThis.fetch = previousFetch;
  setSession(null);
});

describe("account switch", () => {
  test("A's late pull never lands on B's account", async () => {
    const serverA = new FakeDocumentServer();
    const serverB = new FakeDocumentServer();
    serverA.seedPlan(userA.id, { ...getInitialPlannerState(), optimization: "clusterNight" });
    serverB.seedPlan(userB.id, { ...getInitialPlannerState(), optimization: "compact" });
    // Each request goes to the server of whoever is signed in when it starts.
    let active: "A" | "B" = "A";
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      (active === "A" ? serverA : serverB).fetch(input, init)) as typeof fetch;

    const releaseA = serverA.holdNextPull();
    setSession(userA);
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    expect(planner.get().hydrated).toBe(false);

    active = "B";
    setSession(userB);
    await waitFor(() => serverB.pulls === 1, "B's pull requested");
    await flushSaves(50);
    releaseA();
    await waitFor(() => planner.get().plannerState.optimization === "compact" && planner.get().hydrated, "B loaded");
    await flushSaves();
    expect(serverA.pulls).toBe(1);
    expect(planner.get().saveState.label).toBe("Saved on this device");
    expect(planner.get().syncConflict).toBeNull();
    expect(serverA.putsStarted + serverB.putsStarted).toBe(0);

    // B's next edit is written on B's revision, to B's server only.
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => planner.get().saveState.label === "Synced", "B edit synced");
    expect(serverB.puts.map((put) => [put.write.documentId, put.write.baseRevision])).toEqual([["academic-record-unt", 1]]);
    expect(serverA.putsStarted).toBe(0);
  });
});

describe("edits made before hydration", () => {
  const user = userA;

  async function mountWithEarlyEdit(server: FakeDocumentServer, edit: Parameters<Awaited<ReturnType<typeof mountPlanner>>["run"]>[0]) {
    globalThis.fetch = server.fetch as typeof fetch;
    const releaseLoad = server.holdNextPull();
    setSession(user);
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    expect(planner.get().hydrated).toBe(false);
    await planner.run(edit);
    releaseLoad();
    await planner.get().afterHydration();
    return planner;
  }

  const storedPlan = () => {
    const plan = getInitialPlannerState();
    return { ...plan, courseStatuses: { ...plan.courseStatuses, "MATH 1710": "inProgress" as const } };
  };

  test("a schedule edit meeting a different stored Main: both are kept, and nothing is written over Main until the student chooses", async () => {
    const server = new FakeDocumentServer();
    server.seedPlan(user.id, storedPlan());
    const planner = await mountWithEarlyEdit(server, (p) => p.setCourseStatus("CSCE 1030", "inProgress"));

    await waitFor(() => planner.get().syncConflict !== null, "conflict");
    expect(planner.get().syncConflict?.kind).toBe("schedule");
    expect(planner.get().plannerState.courseStatuses["CSCE 1030"]).toBe("inProgress");
    await flushSaves();
    expect(server.puts.filter((put) => put.write.kind === "schedule")).toEqual([]);
    expect(server.plan(user.id)?.courseStatuses["MATH 1710"]).toBe("inProgress");

    await planner.get().settleSyncConflict({ kind: "keep-mine" });
    await waitFor(() => planner.get().syncConflict === null, "kept as a copy");
    expect(planner.get().plannerState.courseStatuses["MATH 1710"]).toBe("inProgress");
    const library = createSavedPlanStore().list();
    expect(library.ok && library.doc.plans.map((plan) => plan.state.courseStatuses["CSCE 1030"])).toEqual(["inProgress"]);
  });

  test("choosing the stored Main drops the early schedule edit without a write", async () => {
    const server = new FakeDocumentServer();
    server.seedPlan(user.id, storedPlan());
    const planner = await mountWithEarlyEdit(server, (p) => p.setCourseStatus("CSCE 1030", "inProgress"));
    await waitFor(() => planner.get().syncConflict !== null, "conflict");
    await planner.get().settleSyncConflict({ kind: "use-latest" });
    await waitFor(() => planner.get().syncConflict === null, "took stored");
    expect(planner.get().plannerState.courseStatuses["CSCE 1030"]).toBe("notTaken");
    await flushSaves();
    expect(server.puts.filter((put) => put.write.kind === "schedule")).toEqual([]);
  });

  test("an early preferences edit changes only the group it touched on top of the stored preferences", async () => {
    const server = new FakeDocumentServer();
    const defaults = defaultSchedulePreferences("clusterMorning");
    server.seedPlan(user.id, getInitialPlannerState(), { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri"] } });
    const planner = await mountWithEarlyEdit(server, (p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Synced", "merged");
    expect(planner.get().syncConflict).toBeNull();
    const stored = server.document(user.id, "preferences-unt")?.body as { goal: string; constraints: { daysOff: string[] } };
    expect([stored.goal, stored.constraints.daysOff]).toEqual(["compact", ["Fri"]]);
  });

  test("with no stored plan, early edits are written from revision 0", async () => {
    const server = new FakeDocumentServer();
    const planner = await mountWithEarlyEdit(server, (p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Synced", "synced");
    expect(planner.get().syncConflict).toBeNull();
    expect(server.puts.map((put) => put.write.baseRevision)).toEqual([0]);
    expect(server.plan(user.id)?.optimization).toBe("compact");
  });
});
