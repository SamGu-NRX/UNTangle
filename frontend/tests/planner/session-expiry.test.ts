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
import { plannerStateKey } from "@/lib/planner-store";
import { notifySessionRestored, onSessionExpired } from "@/lib/session-events";

// Item 5: a 401 keeps edits in memory and in the local mirror, says
// "Not saved: signed out", tells the account layer, and on restore saves the
// pending edit under the revision rules without overwriting anything.

const user = { id: "u5", email: "expiry@my.unt.edu", name: "Expiry Test" };
let server: FakePlannerServer;
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
  server = new FakePlannerServer();
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

function mirrorOptimization(): string | null {
  const raw = window.localStorage.getItem(plannerStateKey(user.id));
  return raw ? (JSON.parse(raw) as { state: { optimization: string } }).state.optimization : null;
}

async function mountWithStoredPlan() {
  server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterMorning" });
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().saveState.label === "Saved", "stored plan loaded");
  return planner;
}

describe("401 mid-save", () => {
  test("401, then restore: the edit is saved on top of the revision this tab saw", async () => {
    const planner = await mountWithStoredPlan();
    server.sessionValid = false;

    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.label === "Not saved: signed out", "signed out");
    expect(planner.get().saveState.status).toBe("signed-out");
    expect(expiredEvents).toBe(1);
    // The edit is kept in memory and in this browser's mirror.
    expect(planner.get().plannerState.optimization).toBe("compact");
    expect(mirrorOptimization()).toBe("compact");

    // A further edit while signed out: no request, mirror follows.
    const postsWhileSignedOut = server.posts.length;
    await planner.run((p) => p.setActiveDay("Fri"));
    await flushSaves();
    expect(server.posts.length).toBe(postsWhileSignedOut);
    expect(planner.get().saveState.label).toBe("Not saved: signed out");

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().saveState.label === "Saved", "saved after restore");

    const last = server.posts[server.posts.length - 1];
    expect(last.status).toBe(200);
    expect(last.baseRevision).toBe("1");
    expect(server.row?.revision).toBe(2);
    expect(server.row?.state.optimization).toBe("compact");
    expect(server.row?.state.activeDay).toBe("Fri");
    expect(expiredEvents).toBe(1);
  });

  test("401, another device saves meanwhile, then restore: a conflict is shown and nothing is overwritten", async () => {
    const planner = await mountWithStoredPlan();
    server.sessionValid = false;
    await planner.run((p) => p.setOptimization("compact"));
    await waitFor(() => planner.get().saveState.status === "signed-out", "signed out");

    const theirs = { ...getInitialPlannerState(), optimization: "clusterNight" as const };
    server.writeElsewhere(theirs);

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().conflict !== null, "conflict raised");

    // The other device's save is intact.
    expect(server.row?.revision).toBe(2);
    expect(server.row?.state.optimization).toBe("clusterNight");
    const conflict = planner.get().conflict!;
    expect(conflict.source).toBe("server");
    expect(conflict.mine.optimization).toBe("compact");
    expect(conflict.theirs?.optimization).toBe("clusterNight");
    expect(planner.get().saveState.label).not.toBe("Saved");

    // The user chooses to keep their edits: saved on top of revision 2.
    await planner.run((p) => p.resolveConflict("keep-mine"));
    await waitFor(() => planner.get().saveState.label === "Saved", "kept mine");
    expect(server.posts[server.posts.length - 1].baseRevision).toBe("2");
    expect(server.row?.revision).toBe(3);
    expect(server.row?.state.optimization).toBe("compact");
  });
});

describe("401 at load", () => {
  test("restore re-reads the server before writing; unsaved edits meet the stored plan in a conflict", async () => {
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    server.sessionValid = false;
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();
    expect(planner.get().saveState.label).toBe("Not saved: signed out");

    await planner.run((p) => p.setOptimization("compact"));
    await flushSaves();
    expect(server.posts).toHaveLength(0);

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().conflict !== null, "conflict after reload");
    expect(server.posts).toHaveLength(0);
    expect(server.row?.state.optimization).toBe("clusterNight");

    await planner.run((p) => p.resolveConflict("take-theirs"));
    await waitFor(() => planner.get().saveState.label === "Saved", "took theirs");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(server.posts).toHaveLength(0);
  });

  test("restore with no edits adopts the stored plan", async () => {
    server.writeElsewhere({ ...getInitialPlannerState(), optimization: "clusterNight" });
    server.sessionValid = false;
    const planner = await mountPlanner();
    mounted.push(planner.unmount);
    await planner.get().afterHydration();

    server.sessionValid = true;
    notifySessionRestored();
    await waitFor(() => planner.get().saveState.label === "Saved", "adopted");
    expect(planner.get().plannerState.optimization).toBe("clusterNight");
    expect(server.posts).toHaveLength(0);
  });
});
