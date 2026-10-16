import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakeDocumentServer,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  advanceTime,
  waitFor,
  type PersistedDocumentStore,
} from "./test-dom";

// One write per document at a time: an edit made while an earlier write is
// in flight goes into this device's outbox at once, is sent only after the
// earlier receipt, on the revision that receipt confirmed, and "Synced" waits
// for the last receipt.

const user = { id: "u2", email: "serial@my.unt.edu", name: "Serial Saver" };
let server: FakeDocumentServer;
let store: PersistedDocumentStore;
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
  store = resetDocumentStore();
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

const pending = async () =>
  (await store.stored(user.id)).documents.find((document) => document.documentId === "preferences-unt")?.pending.length ?? 0;

describe("one write per document at a time", () => {
  test("slow write A, then edit B: B waits on this device, goes out on A's revision, and Synced waits for B", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    const releaseA = server.holdNextPut();
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => server.putsStarted === 1, "A in flight");
    expect(planner.get().saveState.label).toBe("Waiting to sync");

    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, daysOff: ["Wed"] } })));
    // B reaches the outbox while A is still in flight, behind it, and is not sent.
    for (let waited = 0; (await pending()) < 2 && waited < 2000; waited += 20) await advanceTime(20);
    expect(await pending()).toBe(2);
    expect(planner.get().saveState.label).toBe("Waiting to sync");
    expect(server.putsStarted).toBe(1);

    const releaseB = server.holdNextPut();
    releaseA();
    await waitFor(() => server.putsStarted === 2, "A confirmed and B sent");
    expect(server.puts.map((put) => (put.write.body as { goal: string }).goal)).toEqual(["compact"]);
    expect(planner.get().saveState.label).not.toBe("Synced");

    releaseB();
    await waitFor(() => planner.get().saveState.label === "Synced", "B confirmed");
    expect(server.puts.map((put) => put.write.baseRevision)).toEqual([0, 1]);
    expect(server.document(user.id, "preferences-unt")?.revision).toBe(2);
    expect(await pending()).toBe(0);
  });

  test("an edit after the last receipt is never displayed as Synced", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    await planner.run((p) => p.setSelectedMajor("cs"));
    await waitFor(() => planner.get().saveState.label === "Synced", "first write");
    await planner.run((p) => p.setSelectedMajor("math"));
    // Before the debounce fires the plan on screen is newer than the receipt.
    expect(planner.get().saveState.label).toBe("Saving…");
    await waitFor(() => planner.get().saveState.label === "Synced", "second write");
    expect(server.plan(user.id)?.selectedMajor).toBe("math");
  });
});
