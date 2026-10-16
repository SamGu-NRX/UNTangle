/**
 * A connected calendar through the planner's real persistence: a signed-in
 * student's preferences document (the real provider, sync engine and /api/v1
 * handlers, with Postgres and IndexedDB stood in as in document-sync.test.ts),
 * and a guest's device storage. The calendar is the one connecting builds:
 * the saved fixture feed read by the same busy pipeline, its address sealed
 * by the server's own sealing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDocumentServer, installDom, mountPlanner, removeDom, resetDocumentStore, setSession, waitFor, type PersistedDocumentStore } from "./test-dom";
import { busyFromFeed } from "@/lib/calendar-feeds/busy";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import { sealFeedUrl } from "@/lib/calendar-feeds/seal";
import { buildOptimizeRequest } from "@/lib/planner";
import { readingOf } from "@/lib/calendar-busy";
import type { ConnectedCalendar, SchedulePreferences } from "@/lib/types";

const user = { id: "student-1", email: "student@my.unt.edu", name: "Student" };
const PREFERENCES = "preferences-unt";
const SECRET = "private-5e1f0c8a9b7d6e4f3a2b1c0d9e8f7a6b";
const WORK_URL = `https://calendar.google.com/calendar/ical/student%40my.unt.edu/${SECRET}/basic.ics`;
const KEY = Buffer.alloc(32, 21);

function workCalendar(owner: { kind: "user" | "guest"; id: string }, countAllDay = false): ConnectedCalendar {
  const raw = readFileSync(join(import.meta.dir, "../calendar-feeds/fixtures/work-shifts-spring-2027.ics"), "utf8");
  const term = { start: "2027-01-11", end: "2027-05-07" };
  const pieces = busyFromFeed(parseCalendarFeed(raw, { start: "2027-01-11T00:00:00", end: "2027-05-08T00:00:00" }), term);
  return {
    id: "cal-work",
    name: "Work",
    sealedUrl: sealFeedUrl(WORK_URL, owner, KEY),
    termId: "spring-2027",
    checkedAt: "2026-10-15T12:00:00.000Z",
    ...readingOf(pieces, term),
    countAllDay,
  };
}

const addCalendar = (calendar: ConnectedCalendar) => (p: SchedulePreferences): SchedulePreferences => ({ ...p, calendars: [...(p.calendars ?? []), calendar] });
const removeCalendar = (id: string) => (p: SchedulePreferences): SchedulePreferences => {
  const calendars = (p.calendars ?? []).filter((calendar) => calendar.id !== id);
  const rest = Object.fromEntries(Object.entries(p).filter(([key]) => key !== "calendars")) as SchedulePreferences;
  return calendars.length ? { ...rest, calendars } : rest;
};

let server: FakeDocumentServer;
let store: PersistedDocumentStore;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

beforeAll(() => installDom());
afterAll(() => removeDom());
beforeEach(() => {
  window.localStorage.clear();
  store = resetDocumentStore();
  server = new FakeDocumentServer();
  previousFetch = globalThis.fetch;
  globalThis.fetch = server.fetch as typeof fetch;
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

const calendarBlocks = (preferences: SchedulePreferences) =>
  buildOptimizeRequest({ courseStatuses: {}, selectedSections: {}, lockedSections: {}, optimization: "compact", activeDay: "Mon", selectedMajor: null, transcriptRecords: [], updatedAt: "" }, preferences).constraints.blocked.filter((block) =>
    block.id.startsWith("calendar-cal-work-"),
  );

describe("a signed-in student", () => {
  test("a calendar saves to the preferences document, sealed, and another device sees it and Auto keeps it free there", async () => {
    setSession(user);
    const laptop = await mount();
    const calendar = workCalendar({ kind: "user", id: user.id });
    await laptop.run((p) => p.setSchedulePreferences(addCalendar(calendar)));
    await waitFor(() => laptop.get().saveState.label === "Synced", "synced");

    const stored = server.document(user.id, PREFERENCES)?.body as { calendars?: ConnectedCalendar[] };
    expect(stored.calendars).toEqual([calendar]);
    // Nothing that syncs or stays on the device holds the address in plaintext.
    expect(JSON.stringify([...server.documents.values()])).not.toContain(SECRET);
    expect(JSON.stringify(server.puts)).not.toContain(SECRET);
    expect(JSON.stringify(await store.stored(user.id))).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);

    // Another device: a fresh browser, the same account.
    resetDocumentStore();
    const phone = await mount();
    await waitFor(() => phone.get().schedulePreferences.calendars?.[0]?.id === "cal-work", "the calendar on the other device");
    expect(phone.get().schedulePreferences.calendars).toEqual([calendar]);
    expect(calendarBlocks(phone.get().schedulePreferences).find((block) => block.day === "Tue" && block.start === 480)?.dates).toEqual([
      { start: "2027-02-16", end: "2027-02-16" },
    ]);
  });

  test("counting all-day events is part of the calendar, so it syncs with it", async () => {
    setSession(user);
    const laptop = await mount();
    await laptop.run((p) => p.setSchedulePreferences(addCalendar(workCalendar({ kind: "user", id: user.id }))));
    await laptop.run((p) =>
      p.setSchedulePreferences((current) => ({ ...current, calendars: current.calendars?.map((c) => ({ ...c, countAllDay: true })) })),
    );
    await waitFor(() => laptop.get().saveState.label === "Synced", "synced");
    expect((server.document(user.id, PREFERENCES)?.body as { calendars: ConnectedCalendar[] }).calendars[0].countAllDay).toBe(true);

    resetDocumentStore();
    const phone = await mount();
    await waitFor(() => phone.get().schedulePreferences.calendars?.[0]?.countAllDay === true, "the choice on the other device");
    const wholeDays = calendarBlocks(phone.get().schedulePreferences).filter((block) => block.start === 0 && block.end === 1440);
    expect(wholeDays.map((block) => block.day)).toEqual(["Wed", "Thu", "Fri"]);
  });

  test("removing the calendar on one device removes its busy time everywhere", async () => {
    setSession(user);
    const laptop = await mount();
    await laptop.run((p) => p.setSchedulePreferences(addCalendar(workCalendar({ kind: "user", id: user.id }))));
    await waitFor(() => laptop.get().saveState.label === "Synced", "synced");

    resetDocumentStore();
    const phone = await mount();
    await waitFor(() => phone.get().schedulePreferences.calendars?.length === 1, "the calendar on the phone");
    await phone.run((p) => p.setSchedulePreferences(removeCalendar("cal-work")));
    await waitFor(() => phone.get().saveState.label === "Synced", "removal synced");
    const body = server.document(user.id, PREFERENCES)?.body as Record<string, unknown>;
    expect("calendars" in body).toBe(false);

    resetDocumentStore();
    const again = await mount();
    await waitFor(() => again.get().preferencesReady, "preferences read");
    expect(again.get().schedulePreferences.calendars).toBeUndefined();
    expect(calendarBlocks(again.get().schedulePreferences)).toEqual([]);
  });
});

describe("a guest", () => {
  test("keeps the calendar on this device across a reload, sealed", async () => {
    const first = await mount();
    await waitFor(() => first.get().preferencesReady, "guest preferences read");
    const calendar = workCalendar({ kind: "guest", id: "AAAAAAAAAAAAAAAAAAAAAA" }, true);
    await first.run((p) => p.setSchedulePreferences(addCalendar(calendar)));
    expect(server.puts).toEqual([]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);

    await first.unmount();
    mounted.splice(mounted.indexOf(first.unmount), 1);
    const reloaded = await mount();
    await waitFor(() => reloaded.get().preferencesReady, "guest preferences read again");
    expect(reloaded.get().schedulePreferences.calendars).toEqual([calendar]);

    await reloaded.run((p) => p.setSchedulePreferences(removeCalendar("cal-work")));
    expect(reloaded.get().schedulePreferences.calendars).toBeUndefined();
    expect(calendarBlocks(reloaded.get().schedulePreferences)).toEqual([]);
  });
});
