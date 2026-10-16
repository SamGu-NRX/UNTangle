/**
 * A guest's work on this browser meeting their account on sign-in
 * (docs/architecture/guest-sync.md), one test per row of its table and per
 * case it names, through the real provider, sheet and /api/v1 handlers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fixtures from "../../../packages/contracts/tests/fixtures";
import { FakeDocumentServer, installDom, mountPlanner, removeDom, resetDocumentStore, setSession, waitFor } from "./test-dom";
import { GUEST_ID_KEY, preferencesKey } from "@/components/schedule/preferences-store";
import { forgetGuestHere, markGuestHere } from "@/lib/guest-sign-in";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, PLANNER_STATE_STORE_KEY } from "@/lib/planner-store";
import { createSavedPlanStore, SAVED_PLANS_STORE_KEY } from "@/lib/saved-plans/store";
import type { PlannerState, SchedulePreferences } from "@/lib/types";

const user = { id: "student-1", email: "student@my.unt.edu", name: "Student" };
const MAIN = "main-unt-spring-2027";
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
  forgetGuestHere();
  document.body.innerHTML = "";
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

const initial = getInitialPlannerState();
/** A plan with these courses planned for Spring 2027 and, optionally, these marked done. */
const plan = (planned: string[], done: string[] = []): PlannerState => ({
  ...initial,
  courseStatuses: {
    ...initial.courseStatuses,
    ...Object.fromEntries(planned.map((code) => [code, "inProgress" as const])),
    ...Object.fromEntries(done.map((code) => [code, "completed" as const])),
  },
});

/** What a confirmed guest left on this browser earlier in this browser session. */
function guestLeft(state: PlannerState | null, preferences?: SchedulePreferences) {
  markGuestHere();
  if (state) expect(createPlannerStateStore(window.localStorage, null).write(state, 0).ok).toBe(true);
  if (preferences) {
    window.localStorage.setItem(GUEST_ID_KEY, "guest-0001");
    window.localStorage.setItem(preferencesKey({ kind: "guest", id: "guest-0001" }), JSON.stringify({ revision: 1, preferences }));
  }
}

async function signIn() {
  const React = await import("react");
  const { GuestSignInSheet } = await import("@/components/guest-sign-in-sheet");
  const { Toaster } = await import("@/components/ui/Toast");
  setSession(user);
  const planner = await mountPlanner(() => [React.createElement(GuestSignInSheet, { key: "sheet" }), React.createElement(Toaster, { key: "toasts" })]);
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

const toastText = () => document.querySelector(".ui-toast__message")?.textContent ?? "";
const sheet = () => document.querySelector('[role="dialog"]');
const button = (name: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)!;
const library = () => {
  const read = createSavedPlanStore(window.localStorage, user.id).list();
  return read.ok ? read.doc.plans : [];
};
const guestCleared = () => window.localStorage.getItem(PLANNER_STATE_STORE_KEY) === null;
const planned = (state: PlannerState | null, code: string) => state?.courseStatuses[code] === "inProgress";

describe("the plan, by guest-sync.md's table", () => {
  test("empty or untouched guest plan: the account loads, nothing is asked or written", async () => {
    server.seedPlan(user.id, plan(["CSCE 1040"]));
    guestLeft(initial);
    const planner = await signIn();
    await waitFor(() => planned(planner.get().plannerState, "CSCE 1040") && guestCleared(), "account shown, guest cleared");
    expect(sheet()).toBeNull();
    expect(server.putsStarted).toBe(0);
  });

  test("guest work, empty account: the work is saved to the account, and Undo puts the account back and keeps the work in Schedules", async () => {
    guestLeft(plan(["CSCE 1040"]));
    const planner = await signIn();
    await waitFor(() => toastText() === "Saved your schedule to your account", "saved toast");
    await waitFor(() => planned(server.plan(user.id), "CSCE 1040"), "written to the account");
    expect(guestCleared()).toBe(true);

    await planner.run(() => button("Undo").click());
    await waitFor(() => server.plan(user.id)?.courseStatuses["CSCE 1040"] === "notTaken", "account back to empty");
    expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
    expect(library().map((entry) => [entry.name.startsWith("From this browser"), planned(entry.state, "CSCE 1040")])).toEqual([[true, true]]);
  });

  test("guest work the same as the account's: the account loads and the guest key is cleared, with no write", async () => {
    server.seedPlan(user.id, plan(["CSCE 1040"]));
    guestLeft(plan(["CSCE 1040"]));
    await signIn();
    await waitFor(() => guestCleared(), "guest cleared");
    expect(sheet()).toBeNull();
    expect(server.putsStarted).toBe(0);
  });

  async function different() {
    server.seedPlan(user.id, plan(["MATH 1720"]));
    guestLeft(plan(["CSCE 1040"]));
    const planner = await signIn();
    await waitFor(() => sheet() !== null, "the sheet");
    expect(sheet()?.textContent).toContain("You made a schedule before signing in.");
    expect(sheet()?.textContent).toContain("2 courses differ from your saved schedule.");
    // Nothing is written or cleared while the student decides.
    expect(server.putsStarted).toBe(0);
    expect(guestCleared()).toBe(false);
    return planner;
  }

  test("different work: Use this one makes the guest plan Main, and the account's Main stays in Schedules", async () => {
    const planner = await different();
    await planner.run(() => button("Use this one").click());
    await waitFor(() => planned(server.plan(user.id), "CSCE 1040"), "guest plan is Main");
    expect(planned(server.plan(user.id), "MATH 1720")).toBe(false);
    expect(library().map((entry) => [entry.name.startsWith("Main from your account"), planned(entry.state, "MATH 1720")])).toEqual([[true, true]]);
    expect(guestCleared()).toBe(true);
  });

  test("different work: Keep my saved schedule keeps Main, and the guest plan goes to Schedules", async () => {
    const planner = await different();
    await planner.run(() => button("Keep my saved schedule").click());
    await waitFor(() => guestCleared(), "settled");
    expect(planned(server.plan(user.id), "MATH 1720")).toBe(true);
    expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
    expect(library().map((entry) => [entry.name.startsWith("From this browser"), planned(entry.state, "CSCE 1040")])).toEqual([[true, true]]);
  });

  test("different work: Escape keeps the account's Main and saves the guest copy", async () => {
    const planner = await different();
    await planner.run(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await waitFor(() => guestCleared(), "settled");
    expect(planned(server.plan(user.id), "MATH 1720")).toBe(true);
    expect(library().map((entry) => planned(entry.state, "CSCE 1040"))).toEqual([true]);
  });
});

describe("the academic record and preferences", () => {
  test("a guest who only imported a transcript keeps it: courses only one side has merge, a course both have differently is asked", async () => {
    const [row] = fixtures.savedPlan.transcriptRecords;
    server.seedPlan(user.id, { ...plan([], ["MATH 1650", "CSCE 1030"]), selectedMajor: "cs" });
    guestLeft({ ...initial, transcriptRecords: [row], courseStatuses: { ...initial.courseStatuses, "CSCE 1030": "completed", "ENGL 1310": "completed" }, selectedMajor: "math" });
    const planner = await signIn();
    // CSCE 1030 has different facts on each side (only the guest has its transcript row), and so does the major.
    await waitFor(() => sheet() !== null, "the sheet");
    expect(sheet()?.textContent).toContain("You made changes before signing in.");
    expect([...document.querySelectorAll(".sync-question legend")].map((legend) => legend.textContent)).toEqual(["CSCE 1030", "Major"]);
    expect(guestCleared()).toBe(false);

    // This browser's CSCE 1030 (with its transcript row); the account's major.
    const course = document.querySelectorAll(".sync-question")[0].querySelectorAll<HTMLInputElement>("input[type=radio]")[1];
    await planner.run(() => course.click());
    await planner.run(() => button("Save choices").click());
    await waitFor(() => guestCleared() && planner.get().saveState.label === "Synced", "settled");
    const record = server.plan(user.id)!;
    expect([record.courseStatuses["ENGL 1310"], record.courseStatuses["MATH 1650"], record.transcriptRecords.map((r) => r.id), record.selectedMajor]).toEqual([
      "completed",
      "completed",
      [row.id],
      "cs",
    ]);
    // The guest's major wasn't chosen, so its whole work is kept.
    expect(library().map((entry) => entry.state.selectedMajor)).toEqual(["math"]);
  });

  test("guest preferences go to an account with only defaults; two different sets are asked about", async () => {
    const defaults = defaultSchedulePreferences(initial.optimization);
    const fridays = { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri" as const] } };
    guestLeft(null, fridays);
    const planner = await signIn();
    await waitFor(() => toastText() === "Saved your preferences to your account", "saved");
    await waitFor(() => (server.document(user.id, "preferences-unt")?.body as SchedulePreferences | undefined)?.constraints.daysOff[0] === "Fri", "written");
    await planner.unmount();
    mounted.splice(mounted.indexOf(planner.unmount), 1);

    setSession(null);
    resetDocumentStore();
    window.localStorage.clear();
    const mornings = { ...defaults, constraints: { ...defaults.constraints, earliestStart: 600 } };
    guestLeft(null, mornings);
    const again = await signIn();
    await waitFor(() => sheet() !== null, "asked");
    expect([...document.querySelectorAll(".sync-question legend")].map((legend) => legend.textContent)).toEqual(["Preferences"]);
    const guestSide = document.querySelectorAll<HTMLInputElement>(".sync-question input[type=radio]")[1];
    await again.run(() => guestSide.click());
    await again.run(() => button("Save choices").click());
    await waitFor(() => (server.document(user.id, "preferences-unt")?.body as SchedulePreferences).constraints.earliestStart === 600, "guest's chosen");
  });
});

test("guest library entries arrive in the account's library with every field intact", async () => {
  guestLeft(null);
  const guestLibrary = createSavedPlanStore(window.localStorage, null);
  const saved = guestLibrary.savePlan({ state: plan(["CSCE 1040"]), name: "Guest idea" });
  expect(saved.ok).toBe(true);
  const archived = guestLibrary.setPlanArchived(saved.ok ? saved.value.planId : "", true);
  await signIn();
  await waitFor(() => window.localStorage.getItem(SAVED_PLANS_STORE_KEY) === null, "guest library moved");
  expect(archived.ok).toBe(true);
  expect(library()).toEqual(archived.ok ? [archived.value] : []);
});

test("a guest plan the student never chose is asked about again on the next sign-in, not cleared unseen", async () => {
  server.seedPlan(user.id, plan(["MATH 1720"]));
  guestLeft(plan(["CSCE 1040"]));
  const first = await signIn();
  await waitFor(() => sheet() !== null, "asked");
  await first.unmount();
  mounted.splice(mounted.indexOf(first.unmount), 1);
  expect(guestCleared()).toBe(false);
  await signIn();
  await waitFor(() => sheet() !== null, "asked again");
});

test("guest work from an earlier browser session isn't carried into the account: it may be someone else's", async () => {
  guestLeft(plan(["CSCE 1040"]));
  // The browser closed since: the session cookie is gone, the guest store isn't.
  forgetGuestHere();
  const planner = await signIn();
  await waitFor(() => planner.get().saveState.label === "Not saved yet", "account loaded");
  expect(sheet()).toBeNull();
  expect(server.putsStarted).toBe(0);
  expect(guestCleared()).toBe(false);
  expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
});

test("a guest who used the planner in this browser session marks it, and only a confirmed guest does", async () => {
  const React = await import("react");
  const { guestWasHere } = await import("@/lib/guest-sign-in");
  const { failSessionLookup } = await import("./test-dom");
  failSessionLookup(0);
  const unknown = await mountPlanner(() => React.createElement("span"));
  mounted.push(unknown.unmount);
  await waitFor(() => unknown.get().hydrated, "unknown session as guest");
  expect(guestWasHere()).toBe(false);
  await unknown.run(() => setSession(null));
  await waitFor(() => guestWasHere(), "confirmed guest");
});

