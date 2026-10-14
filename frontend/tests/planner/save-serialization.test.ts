import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakePlannerServer,
  installDom,
  mountPlanner,
  removeDom,
  setSession,
  advanceTime,
  waitFor,
} from "./test-dom";

// Item 2: an acknowledgement for an older save must not show `Saved` while a
// newer edit is queued behind it.

const user = { id: "u2", email: "serial@my.unt.edu", name: "Serial Saver" };
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

describe("serialized server saves", () => {
  test("slow save A, then edit B: Saved is not shown when A resolves, and is shown after B", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    const releaseA = server.holdNextPost();
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => server.posts.length === 0 && planner.get().saveState.label === "Saving…", "A in flight");
    // Let the debounce fire so request A is actually waiting at the gate.
    await advanceTime(350);
    expect(server.postsStarted).toBe(1);

    await planner.run((p) => p.setActiveDay("Wed"));
    // B's debounce fires while A is still in flight: B is queued, not sent.
    await advanceTime(350);
    expect(server.postsStarted).toBe(1);
    expect(server.posts).toHaveLength(0);

    // Hold B at the server too, so the moment between "A acknowledged" and
    // "B acknowledged" can be observed.
    const releaseB = server.holdNextPost();
    releaseA();
    // B reaching the server proves the provider has processed A's response.
    await waitFor(() => server.postsStarted === 2, "A acknowledged and B sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].body.optimization).toBe("compact");
    expect(server.posts[0].body.activeDay).toBe("Mon");
    // A resolved, but B is pending: never Saved here.
    expect(planner.get().saveState.label).toBe("Saving…");

    releaseB();
    await waitFor(() => planner.get().saveState.label === "Saved", "B acknowledged");
    expect(server.posts).toHaveLength(2);
    expect(server.posts[1].body.activeDay).toBe("Wed");
    // B was based on the revision A produced.
    expect(server.posts[1].baseRevision).toBe("1");
    expect(server.row?.revision).toBe(2);
    expect(server.row?.state.activeDay).toBe("Wed");
  });

  test("an edit after the last acknowledgement is never displayed as Saved", async () => {
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Saved", "first save");
    await planner.run((p) => p.setActiveDay("Thu"));
    // Before the debounce fires the state on screen is newer than the ack.
    expect(planner.get().saveState.label).toBe("Saving…");
    await waitFor(() => planner.get().saveState.label === "Saved", "second save");
    expect(server.row?.state.activeDay).toBe("Thu");
  });
});
