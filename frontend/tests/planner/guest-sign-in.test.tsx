/**
 * A guest's work on this browser meeting their account on sign-in
 * (docs/architecture/guest-sync.md), one test per row of its table and per
 * case it names, through the real provider, sheet and /api/v1 handlers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fixtures from "../../../packages/contracts/tests/fixtures";
import { FakeDocumentServer, flushSaves, installDom, type PersistedDocumentStore, mountPlanner, removeDom, resetDocumentStore, setSession, waitFor } from "./test-dom";
import { GUEST_ID_KEY, preferencesKey } from "@/components/schedule/preferences-store";
import { GUEST_HANDOVER_MS, guestWorkIsThisSession, stampGuestWork, STAMP_PREFIX } from "@/lib/guest-session";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import { createPlannerStateStore, PLANNER_STATE_STORE_KEY } from "@/lib/planner-store";
import { createSavedPlanStore, SAVED_PLANS_STORE_KEY, setSavedPlanIdentity } from "@/lib/saved-plans/store";
import type { PlannerState, SchedulePreferences } from "@/lib/types";

const user = { id: "student-1", email: "student@my.unt.edu", name: "Student" };
const MAIN = "main-unt-spring-2027";
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
  // A fresh page load: no identity prepared yet.
  setSavedPlanIdentity(undefined);
  document.body.innerHTML = "";
  store = resetDocumentStore();
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

/** What a guest wrote on this browser earlier in this browser session. */
function guestLeft(state: PlannerState | null, preferences?: SchedulePreferences) {
  if (state) expect(createPlannerStateStore(window.localStorage, null).write(state, 0).ok).toBe(true);
  if (preferences) {
    window.localStorage.setItem(GUEST_ID_KEY, "guest-0001");
    window.localStorage.setItem(preferencesKey({ kind: "guest", id: "guest-0001" }), JSON.stringify({ revision: 1, preferences }));
  }
  if (state) stampGuestWork("plan");
  if (preferences) stampGuestWork("preferences");
}

/** The browser closed and opened again: session cookies are gone, local storage isn't. */
const closeBrowser = () => {
  document.cookie = "untangle_guest_session=; path=/; Max-Age=0";
};

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
    expect(sheet()?.textContent).toContain("You made a schedule before signing in");
    expect(sheet()?.textContent).toContain("2 courses differ from your saved schedule.");
    // Like a sheet, it opens on its heading, so the student reads the question before reaching a button.
    expect(document.activeElement?.textContent).toBe("You made a schedule before signing in");
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
    expect(sheet()?.textContent).toContain("You made changes before signing in");
    expect([...document.querySelectorAll(".sync-question legend")].map((legend) => legend.textContent)).toEqual(["CSCE 1030", "Major"]);
    // Both sides are done; each says where its "done" comes from.
    const options = [...document.querySelectorAll(".sync-question")][0].querySelectorAll(".sync-question__option");
    expect([...options].map((option) => option.textContent)).toEqual([`DoneYour account`, `Done in ${row.term} with an ${row.grade}This browser`]);
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

describe("guest preferences that signing in replaces are kept in Schedules", () => {
  const defaults = defaultSchedulePreferences(initial.optimization);
  const fridays = { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri" as const] } };
  const mornings = { ...defaults, constraints: { ...defaults.constraints, earliestStart: 600 } };
  const keptDaysOff = () => library().map((entry) => entry.preferences?.constraints.daysOff ?? null);
  const guestPrefsCleared = () => window.localStorage.getItem(preferencesKey({ kind: "guest", id: "guest-0001" })) === null;

  const ways: Record<string, () => void> = {
    "Save choices": () => button("Save choices").click(),
    Escape: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    "the scrim": () => document.querySelector<HTMLElement>(".ui-dialog-scrim")!.click(),
  };
  for (const [way, close] of Object.entries(ways)) {
    test(`keeping the account's set with ${way} saves this browser's set on a copy`, async () => {
      server.seedPlan(user.id, initial, mornings);
      guestLeft(null, fridays);
      const planner = await signIn();
      await waitFor(() => sheet() !== null, "asked");
      expect(sheet()?.textContent).toContain("This browser's set is kept in Schedules if you don't choose it.");
      await planner.run(close);
      await waitFor(() => guestPrefsCleared() && planner.get().guestSignIn === null, "settled");
      expect(planner.get().schedulePreferences.constraints.earliestStart).toBe(600);
      expect(library().map((entry) => entry.name.startsWith("From this browser"))).toEqual([true]);
      expect(keptDaysOff()).toEqual([["Fri"]]);
    });
  }

  test("Undo after carrying preferences over saves this browser's set on a copy", async () => {
    guestLeft(null, fridays);
    const planner = await signIn();
    await waitFor(() => toastText() === "Saved your preferences to your account", "carried");
    await planner.run(() => button("Undo").click());
    await waitFor(() => library().length === 1, "copy kept");
    expect(keptDaysOff()).toEqual([["Fri"]]);
    expect(planner.get().schedulePreferences.constraints.daysOff).toEqual([]);
    const said = `Your account's preferences are back to how they were. This browser's are in Schedules as "${library()[0].name}"`;
    await waitFor(() => toastText() === said, "the Undo toast names the copy");
  });

  test("Undo after carrying a schedule and preferences over keeps both on one copy", async () => {
    guestLeft(plan(["CSCE 1040"]), fridays);
    const planner = await signIn();
    await waitFor(() => toastText() === "Saved your schedule and preferences to your account", "carried");
    await planner.run(() => button("Undo").click());
    await waitFor(() => library().length === 1, "copy kept");
    expect(planned(library()[0].state, "CSCE 1040")).toBe(true);
    expect(keptDaysOff()).toEqual([["Fri"]]);
  });

  test("choosing this browser's set keeps no preferences on the copy", async () => {
    server.seedPlan(user.id, plan(["MATH 1720"]), mornings);
    guestLeft(plan(["CSCE 1040"]), fridays);
    const planner = await signIn();
    await waitFor(() => sheet() !== null, "asked");
    const guestSide = document.querySelectorAll<HTMLInputElement>(".sync-question input[type=radio]")[1];
    await planner.run(() => guestSide.click());
    await planner.run(() => button("Keep my saved schedule").click());
    await waitFor(() => guestCleared() && planner.get().guestSignIn === null, "settled");
    expect(library().map((entry) => [planned(entry.state, "CSCE 1040"), entry.preferences])).toEqual([[true, undefined]]);
  });
});

test("guest library entries arrive with this session's plan, every field intact", async () => {
  guestLeft(plan(["CSCE 1040"]));
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

test("an earlier visitor's guest work isn't carried into the next student's account, even after they open the site signed out", async () => {
  guestLeft(plan(["CSCE 1040"]));
  closeBrowser();
  // The next student opens the site signed out, then signs in.
  const visit = await mountPlanner();
  mounted.push(visit.unmount);
  await waitFor(() => visit.get().hydrated && !visit.get().isRegistered, "signed-out visit");
  expect(guestWorkIsThisSession()).toBe(false);
  await visit.unmount();
  mounted.splice(mounted.indexOf(visit.unmount), 1);
  const planner = await signIn();
  await waitFor(() => planner.get().saveState.label === "Not saved yet", "account loaded");
  await flushSaves();
  expect(sheet()).toBeNull();
  expect(server.putsStarted).toBe(0);
  expect(guestCleared()).toBe(false);
  expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
});

test("old stamped guest work asks before reading it, and Leave it here keeps every guest store untouched", async () => {
  server.seedPlan(user.id, plan(["MATH 1720"]));
  guestLeft(plan(["CSCE 1040"]));
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("untangle_guest_session="))?.split("=")[1];
  expect(token).toBeTruthy();
  window.localStorage.setItem(`${STAMP_PREFIX}plan`, `${token}.${Date.now() - GUEST_HANDOVER_MS - 1}`);
  const planner = await signIn();
  await waitFor(() => sheet() !== null, "handover question");
  expect(sheet()?.textContent).toContain("Bring this browser's guest work into your account?");
  expect(sheet()?.textContent).toContain("Someone used UNTangle as a guest here");
  expect(server.putsStarted).toBe(0);
  expect(guestCleared()).toBe(false);
  await planner.run(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitFor(() => sheet() === null, "handover dismissed");
  expect(server.putsStarted).toBe(0);
  expect(guestCleared()).toBe(false);
  expect(window.localStorage.getItem(PLANNER_STATE_STORE_KEY)).not.toBeNull();
});

test("a token-only guest stamp asks and Bring it in continues the existing sign-in flow", async () => {
  guestLeft(plan(["CSCE 1040"]));
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("untangle_guest_session="))?.split("=")[1];
  expect(token).toBeTruthy();
  window.localStorage.setItem(`${STAMP_PREFIX}plan`, token!);
  const planner = await signIn();
  await waitFor(() => sheet() !== null, "handover question");
  expect(sheet()?.textContent).toContain("at an unknown time");
  await planner.run(() => button("Bring it in").click());
  await waitFor(() => toastText() === "Saved your schedule to your account", "existing flow");
  expect(planned(server.plan(user.id), "CSCE 1040")).toBe(true);
});

/** Stamps this browser session's guest plan as written longer ago than the handover window, so sign-in asks first. */
function stampPlanOld() {
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("untangle_guest_session="))?.split("=")[1];
  expect(token).toBeTruthy();
  window.localStorage.setItem(`${STAMP_PREFIX}plan`, `${token}.${Date.now() - GUEST_HANDOVER_MS - 1}`);
}

test("a guest stamp written after the current time (the clock was set back) asks at an unknown time", async () => {
  guestLeft(plan(["CSCE 1040"]));
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("untangle_guest_session="))?.split("=")[1];
  expect(token).toBeTruthy();
  window.localStorage.setItem(`${STAMP_PREFIX}plan`, `${token}.${Date.now() + 60 * 60 * 1000}`);
  await signIn();
  await waitFor(() => sheet() !== null, "handover question");
  expect(sheet()?.textContent).toContain("at an unknown time");
  expect(server.putsStarted).toBe(0);
  expect(guestCleared()).toBe(false);
});

test("two signed-in tabs: bringing old guest work in from one closes the other's handover question", async () => {
  guestLeft(plan(["CSCE 1040"]));
  stampPlanOld();
  const first = await signIn();
  const second = await mountPlanner();
  mounted.push(second.unmount);
  await waitFor(() => first.get().guestHandover !== null && second.get().guestHandover !== null, "asked in both tabs");
  // A storage change that leaves the old stamp in place keeps the question open.
  await second.run(() => window.dispatchEvent(new window.StorageEvent("storage", { key: PLANNER_STATE_STORE_KEY })));
  expect(second.get().guestHandover).not.toBeNull();
  await first.run((p) => p.settleGuestHandover("bring"));
  await waitFor(() => guestCleared() && planned(server.plan(user.id), "CSCE 1040"), "first tab brought it in");
  await second.run(() => window.dispatchEvent(new window.StorageEvent("storage", { key: `${STAMP_PREFIX}plan` })));
  await waitFor(() => second.get().guestHandover === null, "second tab's question closed");
});

test("leaving old guest work still applies account-kept browser settings", async () => {
  const defaults = defaultSchedulePreferences(initial.optimization);
  const fridays = { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri" as const] } };
  window.localStorage.setItem(preferencesKey({ kind: "user", id: user.id }), JSON.stringify({ revision: 1, preferences: fridays }));
  guestLeft(plan(["CSCE 1040"]));
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("untangle_guest_session="))?.split("=")[1];
  expect(token).toBeTruthy();
  window.localStorage.setItem(`${STAMP_PREFIX}plan`, `${token}.${Date.now() - GUEST_HANDOVER_MS - 1}`);
  const planner = await signIn();
  await waitFor(() => sheet() !== null, "handover question");
  await planner.run(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitFor(
    () => (server.document(user.id, "preferences-unt")?.body as SchedulePreferences | undefined)?.constraints.daysOff[0] === "Fri",
    "account-kept settings applied",
  );
  expect(window.localStorage.getItem(PLANNER_STATE_STORE_KEY)).not.toBeNull();
  expect(planned(server.plan(user.id), "CSCE 1040")).toBe(false);
});

test("a guest's own edits in this browser session are carried in on sign-in", async () => {
  const guest = await mountPlanner();
  mounted.push(guest.unmount);
  await waitFor(() => guest.get().hydrated, "guest");
  expect(guestWorkIsThisSession()).toBe(false);
  await guest.run((p) => p.setCourseStatus("CSCE 1040", "inProgress"));
  await waitFor(() => guestWorkIsThisSession(), "guest edit stamped");
  await guest.unmount();
  mounted.splice(mounted.indexOf(guest.unmount), 1);
  await signIn();
  await waitFor(() => toastText() === "Saved your schedule to your account", "carried");
  expect(planned(server.plan(user.id), "CSCE 1040")).toBe(true);
});

test("an answer is applied to the account as it is then: another device's edit made while the sheet was open stays", async () => {
  server.seedPlan(user.id, plan(["MATH 1720"]));
  guestLeft(plan(["CSCE 1040"]));
  const planner = await signIn();
  await waitFor(() => sheet() !== null, "the sheet");
  server.seedPlan(user.id, plan(["MATH 1720", "ENGL 1310"]));
  await planner.run(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => planned(planner.get().plannerState, "ENGL 1310"), "the newer Main shown behind the sheet");
  await planner.run(() => button("Keep my saved schedule").click());
  await waitFor(() => guestCleared(), "settled");
  expect([planned(server.plan(user.id), "MATH 1720"), planned(server.plan(user.id), "ENGL 1310"), planned(server.plan(user.id), "CSCE 1040")]).toEqual([true, true, false]);
});

test("two signed-in tabs: the first answer settles the guest work once, and the other tab's answer changes nothing", async () => {
  server.seedPlan(user.id, plan(["MATH 1720"]));
  guestLeft(plan(["CSCE 1040"]));
  const first = await signIn();
  const second = await mountPlanner();
  mounted.push(second.unmount);
  await waitFor(() => first.get().guestSignIn !== null && second.get().guestSignIn !== null, "asked in both tabs");
  await first.run((p) => p.settleGuestSignIn({ schedule: "guest", answers: {}, preferences: "account" }));
  await waitFor(() => guestCleared() && planned(server.plan(user.id), "CSCE 1040"), "first tab's answer");
  await second.run((p) => p.settleGuestSignIn({ schedule: "account", answers: {}, preferences: "account" }));
  await waitFor(() => second.get().guestSignIn === null, "second tab closed");
  expect(planned(server.plan(user.id), "CSCE 1040")).toBe(true);
  expect(library().map((entry) => entry.name.startsWith("Main from your account"))).toEqual([true]);
});

test("editing preferences on an earlier visitor's work carries the preferences, not their plan or courses", async () => {
  guestLeft({ ...plan(["CSCE 1040"]), selectedMajor: "math" });
  closeBrowser();
  const defaults = defaultSchedulePreferences(initial.optimization);
  guestLeft(null, { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri" as const] } });
  const planner = await signIn();
  await waitFor(() => toastText() === "Saved your preferences to your account", "preferences carried");
  expect(server.plan(user.id)?.courseStatuses["CSCE 1040"]).toBe("notTaken");
  expect(server.plan(user.id)?.selectedMajor).toBeNull();
  expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
  // The earlier visitor's plan stays where it was; signing out clears it.
  expect(guestCleared()).toBe(false);
});

test("a guest who only saved a schedule in this session has it moved into the account's library", async () => {
  const guest = await mountPlanner();
  mounted.push(guest.unmount);
  await waitFor(() => guest.get().hydrated, "guest");
  await guest.run(() => {
    expect(createSavedPlanStore().savePlan({ state: plan(["CSCE 1040"]), name: "Guest idea" }).ok).toBe(true);
  });
  await waitFor(() => guestWorkIsThisSession("library"), "library write stamped");
  await guest.unmount();
  mounted.splice(mounted.indexOf(guest.unmount), 1);
  await signIn();
  await waitFor(() => library().map((entry) => entry.name).includes("Guest idea"), "moved");
  expect(window.localStorage.getItem(SAVED_PLANS_STORE_KEY)).toBeNull();
  expect(guestWorkIsThisSession()).toBe(false);
});

// PR #172 review (discussion_r4305797781): the merge kept every guest name, so two rows were called "Plan A".
test("a guest copy named like one the account has comes in numbered; the account's keeps its name", async () => {
  expect(createSavedPlanStore(window.localStorage, user.id).savePlan({ state: plan(["MATH 1720"]), name: "Plan A" }).ok).toBe(true);
  const guest = await mountPlanner();
  mounted.push(guest.unmount);
  await waitFor(() => guest.get().hydrated, "guest");
  await guest.run(() => {
    expect(createSavedPlanStore().savePlan({ state: plan(["CSCE 1040"]), name: "plan a" }).ok).toBe(true);
  });
  await waitFor(() => guestWorkIsThisSession("library"), "library write stamped");
  await guest.unmount();
  mounted.splice(mounted.indexOf(guest.unmount), 1);
  await signIn();
  await waitFor(() => library().length === 2, "moved");
  expect(library().map((entry) => [entry.name, planned(entry.state, "CSCE 1040")])).toEqual([
    ["plan a 2", true],
    ["Plan A", false],
  ]);
});

test("when the answer can't be stored, the account stays on screen and the question opens again", async () => {
  server.seedPlan(user.id, plan(["MATH 1720"]));
  guestLeft(plan(["CSCE 1040"]));
  const planner = await signIn();
  await waitFor(() => sheet() !== null, "the sheet");
  store.refuseWrites = true;
  await planner.run(() => button("Use this one").click());
  await waitFor(() => toastText().startsWith("Couldn't save your choice"), "failure said");
  await waitFor(() => planner.get().guestSignIn !== null, "asked again");
  expect(planned(planner.get().plannerState, "CSCE 1040")).toBe(false);
  expect(planned(planner.get().plannerState, "MATH 1720")).toBe(true);
  expect(guestCleared()).toBe(false);

  store.refuseWrites = false;
  await waitFor(() => button("Use this one") !== undefined, "sheet back");
  await planner.run(() => button("Use this one").click());
  await waitFor(() => guestCleared() && planned(server.plan(user.id), "CSCE 1040"), "applied on retry");
  // The account's Main was copied once, not once per attempt.
  expect(library().filter((entry) => entry.name.startsWith("Main from your account"))).toHaveLength(1);
});

