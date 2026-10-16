/**
 * The signed-in planner on synced documents, through the real provider, the
 * real sync engine and the real /api/v1 handlers and write decision. Only
 * Postgres (in-memory tables) and IndexedDB (a store kept as the bytes
 * IndexedDB would hold) are stood in; the Postgres path runs in
 * tests/document-sync/postgres-live.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fixtures from "../../../packages/contracts/tests/fixtures";
import {
  advanceTime,
  failDocumentStore,
  FakeDocumentServer,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  waitFor,
  type PersistedDocumentStore,
  type PlannerValue,
} from "./test-dom";
import { preferencesKey } from "@/components/schedule/preferences-store";
import { createSavedPlanStore } from "@/lib/saved-plans/store";
import { academicQuestions, answerAcademicQuestions, httpSyncIO, PlannerSync } from "@/lib/sync/planner-sync";
import { getInitialPlannerState, defaultSchedulePreferences } from "@/lib/planner";
import type { SyncConflict } from "@/components/planner-provider";

const user = { id: "student-1", email: "student@my.unt.edu", name: "Student" };
const MAIN = "main-unt-spring-2027";
const RECORD = "academic-record-unt";
const PREFERENCES = "preferences-unt";

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

async function mount() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await waitFor(() => planner.get().hydrated, "hydrated");
  return planner;
}

async function reload(previous: Awaited<ReturnType<typeof mount>>) {
  await previous.unmount();
  mounted.splice(mounted.indexOf(previous.unmount), 1);
  return mount();
}

const label = (planner: { get(): PlannerValue }) => planner.get().saveState.label;
const body = <T,>(documentId: string) => server.document(user.id, documentId)?.body as T;
type Schedule = typeof fixtures.schedule;
type Record = typeof fixtures.academicRecord;
type Preferences = typeof fixtures.preferences;
const focus = (planner: Awaited<ReturnType<typeof mount>>) => planner.run(() => window.dispatchEvent(new Event("focus")));
/** The server stops answering writes until `online` is called. */
const offline = () => {
  server.failNextPuts = Array.from({ length: 50 }, () => "drop" as const);
  return () => {
    server.failNextPuts = [];
  };
};

/** A signed-in student whose legacy row has moved: the contract fixture's plan. */
async function migratedStudent() {
  server.legacy.set(user.id, fixtures.savedPlan);
  const planner = await mount();
  await waitFor(() => planner.get().plannerState.selectedMajor === "cs", "migrated plan shown");
  return planner;
}

describe("the legacy row on first sign-in", () => {
  test("moves into three documents once, shows, and an edit then writes only the document it changed, Synced on its receipt", async () => {
    const planner = await migratedStudent();
    expect(planner.get().plannerState.courseStatuses["CSCE 1040"]).toBe("inProgress");
    expect(planner.get().plannerState.selectedSections["CSCE 1040"]).toBe(fixtures.savedPlan.selectedSections["CSCE 1040"]);
    expect(planner.get().plannerState.coursePlan).toEqual(fixtures.savedPlan.coursePlan);
    // Every document matches the revision the server listed in the pull.
    expect(label(planner)).toBe("Synced");
    expect([RECORD, MAIN, PREFERENCES].map((id) => server.document(user.id, id)?.revision)).toEqual([1, 1, 1]);
    expect(body<Schedule>(MAIN).courses).toEqual(["CSCE 1040", "MATH 1720"]);

    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Synced", "synced");
    expect(server.puts.map((put) => [put.write.documentId, put.status])).toEqual([[RECORD, 200]]);
    expect(body<Record>(RECORD).major).toBe("math");
    expect(server.document(user.id, MAIN)?.revision).toBe(1);

    // The marker is per user: a later change to the legacy row is never read again.
    server.legacy.set(user.id, { ...fixtures.savedPlan, selectedMajor: "engl" });
    resetDocumentStore();
    const fresh = await reload(planner);
    await waitFor(() => fresh.get().plannerState.selectedMajor === "math", "documents, not the legacy row");
  });

  test("preferences this browser kept for the account are offered once, as an ordinary write", async () => {
    const local = { ...defaultSchedulePreferences("compact"), constraints: { ...defaultSchedulePreferences("compact").constraints, daysOff: ["Fri" as const] } };
    window.localStorage.setItem(preferencesKey({ kind: "user", id: user.id }), JSON.stringify({ revision: 3, preferences: local }));
    const planner = await migratedStudent();
    await waitFor(() => body<Preferences>(PREFERENCES)?.constraints.daysOff.includes("Fri"), "offered");
    expect(planner.get().schedulePreferences.constraints.daysOff).toEqual(["Fri"]);
    expect(window.localStorage.getItem(preferencesKey({ kind: "user", id: user.id }))).toBeNull();
  });
});

describe("the outbox", () => {
  test("an unsent edit survives a reload, shows before the network answers, and goes out with its first operation id", async () => {
    const planner = await migratedStudent();
    const online = offline();
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "retrying");
    const operationId = server.puts[0].write.operationId;

    const release = server.holdNextPull();
    const after = await reload(planner);
    // Shown from this device's store while the pull is still held.
    expect(after.get().plannerState.selectedMajor).toBe("math");
    expect(label(after)).toBe("Save not confirmed (retrying)");
    online();
    release();
    await waitFor(() => label(after) === "Synced", "synced after reload");
    const delivered = server.puts.filter((put) => put.status === 200);
    expect(delivered.map((put) => put.write.operationId)).toEqual([operationId]);
    expect(body<Record>(RECORD).major).toBe("math");
  });

  test("a dropped response after the commit: the retry sends the same bytes and gets the same receipt", async () => {
    const planner = await migratedStudent();
    server.failNextPuts = ["lost"];
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "unconfirmed");
    expect(server.document(user.id, RECORD)?.revision).toBe(2);
    await advanceTime(2500);
    await waitFor(() => label(planner) === "Synced", "receipt on retry");
    expect(server.puts.map((put) => put.write.operationId)).toEqual([server.puts[0].write.operationId, server.puts[0].write.operationId]);
    expect([...server.receipts.values()]).toHaveLength(1);
    expect(server.document(user.id, RECORD)?.revision).toBe(2);
  });

  test("signing out with a waiting write asks first, and forgetting the account clears it from the browser", async () => {
    const planner = await migratedStudent();
    offline();
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "waiting");
    const prepared = await planner.get().prepareSignOut();
    expect(prepared.unsynced).toBe(true);
    await expect(prepared.forget(false)).rejects.toThrow("explicit discard");
    expect((await store.stored(user.id)).documents).toHaveLength(3);
    await prepared.forget(true);
    expect((await store.stored(user.id)).documents).toEqual([]);
  });

  test("an edit held by an open conflict counts as unsynced at sign-out, though the outbox is empty", async () => {
    const planner = await migratedStudent();
    // Another tab of this browser changes Main and syncs it, so the outbox ends empty.
    const other = new PlannerSync(store, user.id, "spring-2027", httpSyncIO(user.id, () => server.fetch as typeof fetch), {
      state: getInitialPlannerState(),
      preferences: defaultSchedulePreferences("clusterMorning"),
    });
    const seen = (await other.adopt(() => ({ state: getInitialPlannerState(), preferences: defaultSchedulePreferences("clusterMorning") })))!;
    await other.save(() => ({ state: { ...seen.state, courseStatuses: { ...seen.state.courseStatuses, "CSCE 2100": "inProgress" } }, preferences: seen.preferences }));
    await other.drain();
    // This tab edits Main on its older read: a conflict only this tab knows of.
    await planner.run((p) => p.setCourseStatus("MATH 1720", "notTaken"));
    await waitFor(() => planner.get().syncConflict?.source === "local", "local conflict");
    expect((await store.stored(user.id)).documents.every((document) => document.pending.length === 0)).toBe(true);
    expect((await planner.get().prepareSignOut()).unsynced).toBe(true);
  });

  test("signed in without a document store, sign-out counts the tab's edits as unsynced", async () => {
    failDocumentStore();
    const planner = await mount();
    expect(planner.get().saveState.detail).toContain("can't store your schedule");
    await planner.run((p) => p.setSelectedMajor("math"));
    expect((await planner.get().prepareSignOut()).unsynced).toBe(true);
  });
});

describe("conflicts, per document kind", () => {
  test("schedule, clean: this device adopts the other device's copy and says so", async () => {
    const planner = await migratedStudent();
    server.writeElsewhere(user.id, MAIN, "schedule", { ...body<Schedule>(MAIN), courses: [...body<Schedule>(MAIN).courses, "CSCE 2100"] });
    await focus(planner);
    await waitFor(() => planner.get().plannerState.courseStatuses["CSCE 2100"] === "inProgress", "adopted");
    expect(planner.get().tookNewerVersion).toBe(true);
    expect(planner.get().syncConflict).toBeNull();
  });

  async function scheduleConflict() {
    const planner = await migratedStudent();
    const online = offline();
    await planner.run((p) => p.setCourseStatus("MATH 1720", "notTaken"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "waiting");
    server.writeElsewhere(user.id, MAIN, "schedule", { ...body<Schedule>(MAIN), courses: [...body<Schedule>(MAIN).courses, "CSCE 2100"] });
    online();
    await focus(planner);
    await waitFor(() => planner.get().syncConflict !== null, "conflict");
    return planner;
  }

  test("schedule, dirty: the draft stays on screen, and Keep mine as a copy keeps it in Schedules and shows the latest", async () => {
    const planner = await scheduleConflict();
    const conflict = planner.get().syncConflict as SyncConflict;
    expect([conflict.kind, conflict.source]).toEqual(["schedule", "server"]);
    expect(label(planner)).toBe("Resolve conflict");
    expect(planner.get().plannerState.courseStatuses["MATH 1720"]).toBe("notTaken");
    expect(planner.get().plannerState.courseStatuses["CSCE 2100"]).toBe("notTaken");

    await planner.get().settleSyncConflict({ kind: "keep-mine" });
    await waitFor(() => planner.get().syncConflict === null, "settled");
    expect(planner.get().plannerState.courseStatuses["CSCE 2100"]).toBe("inProgress");
    expect(planner.get().plannerState.courseStatuses["MATH 1720"]).toBe("inProgress");
    const library = createSavedPlanStore().list();
    expect(library.ok && library.doc.plans.map((plan) => plan.state.courseStatuses["MATH 1720"])).toEqual(["notTaken"]);
    // Nothing was written over the other device's schedule.
    expect(body<Schedule>(MAIN).courses).toContain("CSCE 2100");
  });

  test("schedule, dirty: Use the latest drops this device's edit to Main", async () => {
    const planner = await scheduleConflict();
    await planner.get().settleSyncConflict({ kind: "use-latest" });
    await waitFor(() => planner.get().syncConflict === null, "settled");
    expect(planner.get().plannerState.courseStatuses["MATH 1720"]).toBe("inProgress");
    expect(planner.get().plannerState.courseStatuses["CSCE 2100"]).toBe("inProgress");
    const library = createSavedPlanStore().list();
    expect(library.ok && library.doc.plans).toEqual([]);
  });

  test("preferences merge per field group, with no conflict to show", async () => {
    const planner = await migratedStudent();
    const online = offline();
    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, daysOff: ["Fri"] } })));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "waiting");
    const theirs = body<Preferences>(PREFERENCES);
    server.writeElsewhere(user.id, PREFERENCES, "preferences", { ...theirs, constraints: { ...theirs.constraints, earliestStart: 540, latestEnd: 1020 } });
    online();
    await focus(planner);
    await waitFor(() => label(planner) === "Synced", "merged and synced");
    expect(planner.get().syncConflict).toBeNull();
    const merged = body<Preferences>(PREFERENCES).constraints;
    expect([merged.daysOff, merged.earliestStart, merged.latestEnd]).toEqual([["Fri"], 540, 1020]);
    await waitFor(() => planner.get().schedulePreferences.constraints.earliestStart === 540, "merged on screen");
  });

  test("preferences edited on a new device before its first pull merge with another device's, group by group", async () => {
    const start = defaultSchedulePreferences(getInitialPlannerState().optimization);
    server.seedPlan(user.id, getInitialPlannerState(), { ...start, constraints: { ...start.constraints, earliestStart: 540, latestEnd: 1020 } });
    // This browser has never stored the account's documents, and the server can't be reached.
    server.available = false;
    const planner = await mount();
    await planner.run((p) => p.setSchedulePreferences((current) => ({ ...current, constraints: { ...current.constraints, daysOff: ["Fri"] } })));
    await waitFor(() => server.putsStarted > 0, "first write tried");
    server.available = true;
    await focus(planner);
    await waitFor(() => label(planner) === "Synced", "merged and synced");
    const merged = body<Preferences>(PREFERENCES).constraints;
    expect([merged.daysOff, merged.earliestStart, merged.latestEnd]).toEqual([["Fri"], 540, 1020]);
  });

  test("academic record: courses one side changed merge; a course both changed is one question, answered by the student", async () => {
    const planner = await migratedStudent();
    const online = offline();
    await planner.run((p) => p.setCourseStatus("CSCE 2100", "completed"));
    await planner.run((p) => p.setSelectedMajor("ce"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "waiting");
    const theirs = body<Record>(RECORD);
    server.writeElsewhere(user.id, RECORD, "academic-record", {
      ...theirs,
      major: "math",
      courseStatuses: { ...theirs.courseStatuses, "CSCE 2100": "inProgress", "ENGL 1320": "completed" },
    });
    online();
    await focus(planner);
    await waitFor(() => planner.get().syncConflict?.kind === "academic-record", "questions");
    const conflict = planner.get().syncConflict as SyncConflict;
    const questions = academicQuestions(conflict);
    expect(questions.map((question) => (question.kind === "course" ? question.course : question.kind))).toEqual(["CSCE 2100", "major"]);

    // This device's CSCE 2100, the other device's major.
    await planner.get().settleSyncConflict({ kind: "answers", body: answerAcademicQuestions(conflict, ["mine", "latest"]) });
    await waitFor(() => label(planner) === "Synced", "answered and synced");
    const record = body<Record>(RECORD);
    expect([record.courseStatuses["CSCE 2100"], record.courseStatuses["ENGL 1320"], record.major]).toEqual(["completed", "completed", "math"]);
    expect(planner.get().plannerState.courseStatuses["ENGL 1320"]).toBe("completed");
  });

  test("delete versus edit: Keep mine saves this device's schedule as a new Main; the deleted id is never written again", async () => {
    const planner = await migratedStudent();
    const online = offline();
    await planner.run((p) => p.setCourseStatus("MATH 1720", "notTaken"));
    await waitFor(() => label(planner) === "Save not confirmed (retrying)", "waiting");
    server.deleteElsewhere(user.id, MAIN);
    online();
    await focus(planner);
    await waitFor(() => planner.get().syncConflict !== null, "conflict");
    expect(planner.get().syncConflict?.latest).toBeNull();

    await planner.get().settleSyncConflict({ kind: "keep-mine" });
    await waitFor(() => label(planner) === "Synced", "kept as a new document");
    expect(server.document(user.id, MAIN)?.deleted).toBe(true);
    expect(body<Schedule>(`${MAIN}-2`).courses).toEqual(["CSCE 1040"]);
    expect(planner.get().plannerState.courseStatuses["CSCE 1040"]).toBe("inProgress");
  });
});

describe("an old client can't erase new fields", () => {
  test("an edit writes back what the planner never read: a catalog year and a course outside its catalog", async () => {
    server.writeElsewhere(user.id, RECORD, "academic-record", {
      ...fixtures.academicRecord,
      catalogId: "unt-2026-27",
      courseStatuses: { ...fixtures.academicRecord.courseStatuses, "ZZZZ 9999": "completed" },
    });
    const planner = await mount();
    await waitFor(() => planner.get().plannerState.selectedMajor === "cs", "loaded");
    expect(planner.get().plannerState.courseStatuses["ZZZZ 9999"]).toBeUndefined();
    await planner.run((p) => p.setSelectedMajor("math"));
    await waitFor(() => label(planner) === "Synced", "synced");
    const record = body<Record>(RECORD);
    expect([record.major, record.catalogId, record.courseStatuses["ZZZZ 9999"]]).toEqual(["math", "unt-2026-27", "completed"]);
  });

  test("a field this build doesn't know stops syncing: no write is sent, and the student is asked to reload", async () => {
    server.writeElsewhere(user.id, RECORD, "academic-record", { ...fixtures.academicRecord, futureField: { kept: true } });
    const planner = await mount();
    await waitFor(() => planner.get().clientOutdated, "outdated");
    expect(planner.get().saveState.detail).toBe("UNTangle was updated. Reload to keep editing.");
    await planner.run((p) => p.setSelectedMajor("math"));
    await advanceTime(1000);
    expect(server.putsStarted).toBe(0);
    expect(body<{ futureField: unknown }>(RECORD).futureField).toEqual({ kept: true });
  });
});

describe("another tab of this browser", () => {
  const read = (state = getInitialPlannerState()) => () => ({ state, preferences: defaultSchedulePreferences(state.optimization) });
  const tab = () =>
    new PlannerSync(store, user.id, "spring-2027", httpSyncIO(user.id, () => server.fetch as typeof fetch), read()());

  test("a preferences edit made on an older read merges per group; a schedule edit asks", async () => {
    server.legacy.set(user.id, fixtures.savedPlan);
    const a = tab(), b = tab();
    await a.refresh();
    const seenA = (await a.adopt(read()))!, seenB = (await b.adopt(read()))!;

    const withDays = { ...seenA.preferences, constraints: { ...seenA.preferences.constraints, daysOff: ["Fri" as const] } };
    await a.save(() => ({ state: seenA.state, preferences: withDays }));
    const withCredits = { ...seenB.preferences, constraints: { ...seenB.preferences.constraints, maxCredits: 12 } };
    await b.save(() => ({ state: seenB.state, preferences: withCredits }));
    const stored = (await store.stored(user.id)).documents.find((document) => document.documentId === PREFERENCES)!.draft as Preferences;
    expect([stored.constraints.daysOff, stored.constraints.maxCredits]).toEqual([["Fri"], 12]);

    await a.save(() => ({ state: { ...seenA.state, courseStatuses: { ...seenA.state.courseStatuses, "CSCE 2100": "inProgress" } }, preferences: withDays }));
    await b.save(() => ({ state: { ...seenB.state, courseStatuses: { ...seenB.state.courseStatuses, "MATH 1720": "notTaken" } }, preferences: withCredits }));
    const status = await b.status(read(seenB.state));
    expect([status.status, status.conflict?.kind, status.conflict?.source]).toEqual(["Resolve conflict", "schedule", "local"]);
  });

  test("a tab still syncing for one student reads and writes nothing once the browser's session is another's", async () => {
    const other = { id: "student-2", email: "other@my.unt.edu", name: "Other" };
    server.seedPlan(other.id, { ...getInitialPlannerState(), selectedMajor: "math" });
    const stale = tab();
    setSession(other);
    expect(await stale.refresh()).toBe("signed-out");
    expect((await store.stored(user.id)).documents).toEqual([]);
    await stale.save(() => ({ state: { ...getInitialPlannerState(), selectedMajor: "engl" }, preferences: defaultSchedulePreferences("clusterMorning") }));
    await stale.drain();
    expect(server.puts.map((put) => put.status)).toEqual([401]);
    expect(server.plan(other.id)?.selectedMajor).toBe("math");
  });
});
