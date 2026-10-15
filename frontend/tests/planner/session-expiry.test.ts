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
  type PersistedDocumentStore,
} from "./test-dom";
import { getInitialPlannerState } from "@/lib/planner";
import { notifySessionRestored, onSessionExpired } from "@/lib/session-events";

// A 401 keeps every edit in this device's outbox, says "Needs sign-in",
// tells the account layer once, and on restore sends the waiting writes with
// their first operation ids, without overwriting anything.

const user = { id: "u5", email: "expiry@my.unt.edu", name: "Expiry Test" };
const MAIN = "main-unt-spring-2027";
let server: FakeDocumentServer;
let store: PersistedDocumentStore;
let previousFetch: typeof fetch;
let expiredEvents = 0;
let stopExpired = () => {};
const mounted: Array<() => Promise<void>> = [];

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  store = resetDocumentStore();
  server = new FakeDocumentServer();
  previousFetch = globalThis.fetch;
  globalThis.fetch = server.fetch as typeof fetch;
  expiredEvents = 0;
  stopExpired = onSessionExpired(() => {
    expiredEvents += 1;
  });
  setSession(user);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  stopExpired();
  globalThis.fetch = previousFetch;
  setSession(null);
});

const stored = { ...getInitialPlannerState(), optimization: "clusterMorning" as const };

async function mountWithStoredPlan() {
  server.seedPlan(user.id, stored);
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().saveState.label === "Saved on this device", "stored plan loaded");
  return planner;
}

describe("401 mid-save", () => {
  test("401, then restore: the waiting writes go out with their first operation ids, on top of the revision this tab saw", async () => {
    const planner = await mountWithStoredPlan();
    server.sessionValid = false;

    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Needs sign-in", "signed out");
    expect(planner.get().saveState.status).toBe("signed-out");
    expect(expiredEvents).toBe(1);
    const firstOperation = server.puts[0].write.operationId;
    // Kept on screen and in this device's outbox.
    expect(planner.get().plannerState.optimization).toBe("compact");
    const outbox = (await store.stored(user.id)).documents.find((document) => document.documentId === "preferences-unt");
    expect(outbox?.pending.map((pending) => (pending.write.body as { goal: string }).goal)).toEqual(["compact"]);

    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, daysOff: ["Fri"] } })));
    await flushSaves();
    expect(planner.get().saveState.label).toBe("Needs sign-in");
    expect(server.puts.every((put) => put.status === 401)).toBe(true);

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().saveState.label === "Synced", "synced after restore");

    const delivered = server.puts.filter((put) => put.status === 200);
    expect(delivered.map((put) => put.write.baseRevision)).toEqual([1, 2]);
    expect(delivered[0].write.operationId).toBe(firstOperation);
    expect(server.document(user.id, "preferences-unt")?.revision).toBe(3);
    expect(server.plan(user.id)?.optimization).toBe("compact");
    expect(expiredEvents).toBe(1);
  });

  test("401, another device changes Main meanwhile, then restore: a conflict is shown and nothing is overwritten", async () => {
    const planner = await mountWithStoredPlan();
    server.sessionValid = false;
    await planner.run((p) => p.setCourseStatus("CSCE 1030", "inProgress"));
    await waitFor(() => planner.get().saveState.status === "signed-out", "signed out");

    server.seedPlan(user.id, { ...stored, courseStatuses: { ...stored.courseStatuses, "MATH 1710": "inProgress" } });

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().syncConflict !== null, "conflict raised");

    // The other device's schedule is intact.
    expect(server.document(user.id, MAIN)?.revision).toBe(2);
    expect(server.plan(user.id)?.courseStatuses["MATH 1710"]).toBe("inProgress");
    expect(server.plan(user.id)?.courseStatuses["CSCE 1030"]).toBe("notTaken");
    expect(planner.get().syncConflict?.kind).toBe("schedule");
    expect(planner.get().plannerState.courseStatuses["CSCE 1030"]).toBe("inProgress");
    expect(planner.get().saveState.label).toBe("Resolve conflict");
  });
});

describe("401 at load", () => {
  test("restore reads the server before writing over it: an edit made before then meets the stored Main in a conflict", async () => {
    server.seedPlan(user.id, { ...stored, courseStatuses: { ...stored.courseStatuses, "MATH 1710": "inProgress" } });
    server.sessionValid = false;
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();
    expect(planner.get().saveState.label).toBe("Needs sign-in");

    await planner.run((p) => p.setCourseStatus("CSCE 1030", "inProgress"));
    await flushSaves();
    expect(server.puts.every((put) => put.status === 401)).toBe(true);

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().syncConflict !== null, "conflict after the read");
    expect(server.document(user.id, MAIN)?.revision).toBe(1);

    await planner.get().settleSyncConflict({ kind: "use-latest" });
    await waitFor(() => planner.get().syncConflict === null, "took the stored plan");
    expect(planner.get().plannerState.courseStatuses["MATH 1710"]).toBe("inProgress");
    expect(planner.get().plannerState.courseStatuses["CSCE 1030"]).toBe("notTaken");
    expect(server.document(user.id, MAIN)?.revision).toBe(1);
  });

  test("restore with no edits adopts the stored plan and writes nothing", async () => {
    server.seedPlan(user.id, { ...stored, optimization: "clusterNight" });
    server.sessionValid = false;
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().saveState.label === "Saved on this device", "adopted");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(server.putsStarted).toBe(0);
  });
});
