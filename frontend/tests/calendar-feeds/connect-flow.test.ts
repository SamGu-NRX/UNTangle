/**
 * Connecting a calendar through the real path: the browser's client
 * (lib/calendar-feeds/client.ts) calls the real preview and busy routes, which
 * fetch a saved fixture feed through the production SSRF-safe fetcher (DNS
 * and HTTPS stubbed, never the network). Then the connected calendar goes
 * through the real preferences schema and the real optimizer request.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { httpsFixture } from "./https-fixture";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { trustRealIp } from "../rate-limit/route-fixtures";

mock.module("server-only", () => ({}));
trustRealIp();

type Session = { user: { id: string } } | null;
const getServerSession = mock(async (): Promise<Session> => null);
mock.module("@/lib/auth-server", () => ({ getServerSession }));
/** The session the routes see from here on. */
const signIn = (session: Session) => getServerSession.mockImplementation(async () => session);
mock.module("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
/** A Google-style secret address: its private token must never reach a log, a response or a document. */
const SECRET = "private-5e1f0c8a9b7d6e4f3a2b1c0d9e8f7a6b";
const WORK_URL = `https://calendar.google.com/calendar/ical/student%40my.unt.edu/${SECRET}/basic.ics`;
const CLUB_URL = "https://calendar.example.edu/robotics.ics";
const feeds: Record<string, string> = { [WORK_URL]: fixture("work-shifts-spring-2027.ics"), [CLUB_URL]: fixture("robotics-club-spring-2027.ics") };
const fetched: string[] = [];
mock.module("node:https", () => ({
  request: httpsFixture((url) => {
    fetched.push(url.toString());
    const body = feeds[url.toString()];
    if (body === undefined) throw new TypeError("connect ECONNREFUSED");
    return new Response(body, { status: 200, headers: { "content-type": "text/calendar" } });
  }),
}));
// As in the route tests: the wrapper resolves the session through the auth-server registry at call
// time, so whichever test file registered last, every file's own session mock is the one asked.
mock.module("@/lib/rate-limit/server", () => ({
  withRateLimit: createRateLimitWrapper({
    store: memoryStore(),
    secret: "calendar connect flow tests",
    session: async () => ((await import("@/lib/auth-server")) as { getServerSession: () => Promise<Session> }).getServerSession(),
  }),
}));

const TERM = { id: "spring-2027", label: "Spring 2027", start: "2027-01-11", end: "2027-05-07" };

let routes: { preview: (request: Request) => Promise<Response>; busy: (request: Request) => Promise<Response> };
let address = 0;
/** The browser's fetch, answered by the real route handlers. Each call gets its own address bucket. */
const browserFetch = async (input: string, init?: RequestInit) => {
  const request = new Request(`http://localhost:3000${input}`, { ...init, headers: { ...init?.headers, "x-real-ip": `192.0.2.${(address += 1) % 250}` } });
  if (input === "/api/calendar-feeds/preview") return routes.preview(request);
  if (input === "/api/v1/calendar-feeds/busy") return routes.busy(request);
  throw new Error(`Unexpected request to ${input}`);
};

const logged: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

beforeAll(async () => {
  routes = {
    preview: (await import("@/app/api/calendar-feeds/preview/route")).POST,
    busy: (await import("@/app/api/v1/calendar-feeds/busy/route")).POST,
  };
});
beforeEach(() => {
  process.env.CALENDAR_FEED_KEY = Buffer.alloc(32, 11).toString("base64");
  signIn({ user: { id: "student-1" } });
  fetched.length = 0;
  logged.length = 0;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    console[method] = (...args: unknown[]) => logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
});
afterEach(() => {
  Object.assign(console, originalConsole);
  delete process.env.CALENDAR_FEED_KEY;
});

const client = () => import("@/lib/calendar-feeds/client");

describe("connecting a calendar", () => {
  test("check reads the feed over the term and counts its busy pieces; connect returns it sealed and title-free", async () => {
    const { checkFeed, connectFeed } = await client();
    const checked = await checkFeed(WORK_URL, TERM, browserFetch);
    if (!checked.ok) throw new Error(checked.problem.message);
    // 17 Tuesdays and 17 Thursdays of 3:00 to 6:00 shifts, the Feb 8 inventory and the Feb 16 early shift.
    // The June shift is after the term and doesn't count.
    expect(checked.value.busyCount).toBe(36);

    const connected = await connectFeed(WORK_URL, "Work", TERM, { fetchImpl: browserFetch, id: "cal-work", now: () => new Date("2026-10-15T12:00:00Z") });
    if (!connected.ok) throw new Error(connected.problem.message);
    const calendar = connected.value;
    expect(calendar).toMatchObject({ id: "cal-work", name: "Work", termId: "spring-2027", checkedAt: "2026-10-15T12:00:00.000Z" });
    expect(calendar.busy.map((slot) => [slot.start, slot.end, slot.dates.length])).toEqual([
      [480, 570, 1], // Feb 16, 8:00 to 9:30
      [540, 720, 1], // Feb 8, 9:00 to noon
      [900, 1080, 34], // every Tuesday and Thursday shift
    ]);
    expect(calendar.busy[0].dates).toEqual(["2027-02-16"]);
    // What the student keeps: no address, no event text, and the document schema accepts it.
    const kept = JSON.stringify(calendar);
    expect(kept).not.toContain(SECRET);
    expect(kept).not.toContain("calendar.google.com");
    expect(kept).not.toContain("Shift at Willis Library");
    const { PreferencesBodySchema } = await import("../../../packages/contracts/src/documents");
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const prefs = defaultSchedulePreferences("compact");
    expect(PreferencesBodySchema.safeParse({ institutionId: "unt", goal: "compact", ...prefs, calendars: [calendar] }).success).toBe(true);
  });

  test("the sealed address refreshes the same feed later, and only for the account that connected it", async () => {
    const { connectFeed, refreshCalendar } = await client();
    const connected = await connectFeed(WORK_URL, "Work", TERM, { fetchImpl: browserFetch });
    if (!connected.ok) throw new Error(connected.problem.message);
    const refreshed = await refreshCalendar(connected.value, TERM, { fetchImpl: browserFetch });
    if (!refreshed.ok) throw new Error(refreshed.problem.message);
    expect(refreshed.value.busy).toEqual(connected.value.busy);
    expect(fetched).toEqual([WORK_URL, WORK_URL]);

    signIn({ user: { id: "student-2" } });
    const stolen = await refreshCalendar(connected.value, TERM, { fetchImpl: browserFetch });
    expect(stolen).toEqual({ ok: false, problem: { kind: "reconnect", message: "Paste this calendar's address again to refresh it." } });
    expect(fetched).toHaveLength(2);
  });

  test("a guest connects too, and a guest's sealed address refreshes for guests", async () => {
    signIn(null);
    const { connectFeed, refreshCalendar } = await client();
    const connected = await connectFeed(WORK_URL, "Work", TERM, { fetchImpl: browserFetch });
    if (!connected.ok) throw new Error(connected.problem.message);
    expect((await refreshCalendar(connected.value, TERM, { fetchImpl: browserFetch })).ok).toBe(true);
  });

  test("an unreachable feed says so in words the student can act on", async () => {
    const { checkFeed } = await client();
    const outcome = await checkFeed("https://calendar.example.edu/missing.ics", TERM, browserFetch);
    expect(outcome).toEqual({
      ok: false,
      problem: { kind: "unreachable", message: "UNTangle couldn't reach that calendar. Check the address, or try again in a minute." },
    });
    expect(await checkFeed("calendar.example.edu/feed.ics", TERM, browserFetch)).toMatchObject({ ok: false, problem: { kind: "address" } });
  });

  test("the feed's address never reaches a log line, whatever happens", async () => {
    const { checkFeed, connectFeed, refreshCalendar } = await client();
    await checkFeed(WORK_URL, TERM, browserFetch);
    const connected = await connectFeed(WORK_URL, "Work", TERM, { fetchImpl: browserFetch });
    if (connected.ok) await refreshCalendar(connected.value, TERM, { fetchImpl: browserFetch });
    // Failures too: a feed that refuses, and a key the server no longer has.
    feeds[`${WORK_URL}?broken`] = "not a calendar";
    await checkFeed(`${WORK_URL}?broken`, TERM, browserFetch);
    await checkFeed(`${WORK_URL}?gone`, TERM, browserFetch);
    process.env.CALENDAR_FEED_KEY = Buffer.alloc(32, 12).toString("base64");
    if (connected.ok) expect((await refreshCalendar(connected.value, TERM, { fetchImpl: browserFetch })).ok).toBe(false);
    expect(logged.filter((line) => line.includes(SECRET))).toEqual([]);
  });
});

describe("one event as a busy time", () => {
  test("the checked feed lists its timed weekday events, and one becomes a named busy time on its date only", async () => {
    const { checkFeed, eventBusyTime } = await client();
    const checked = await checkFeed(CLUB_URL, TERM, browserFetch);
    if (!checked.ok) throw new Error(checked.problem.message);
    // The transparent social is never busy, so it isn't offered.
    expect(checked.value.events.some((event) => event.summary === "Club social")).toBe(false);
    const demo = checked.value.events.find((event) => event.summary === "Robot demo day");
    expect(demo).toBeDefined();
    const block = eventBusyTime(demo!);
    expect(block).toEqual({
      id: "event-2027-03-02-660-750",
      label: "Robot demo day",
      day: "Tue",
      start: 660,
      end: 750,
      dates: [{ start: "2027-03-02", end: "2027-03-02" }],
    });
    const { parseSchedulePreferences, defaultSchedulePreferences } = await import("@/lib/planner");
    const prefs = defaultSchedulePreferences("compact");
    expect(parseSchedulePreferences({ ...prefs, constraints: { ...prefs.constraints, blocked: [block] } })).not.toBeNull();
    // Blocking it again is refused as an existing busy-time id.
    expect(parseSchedulePreferences({ ...prefs, constraints: { ...prefs.constraints, blocked: [block, block] } })).toBeNull();
  });
});

describe("Auto and a connected calendar", () => {
  test("Auto keeps a busy piece free on its date, and a section that doesn't meet that week stays open", async () => {
    const { connectFeed } = await client();
    const connected = await connectFeed(WORK_URL, "Work", TERM, { fetchImpl: browserFetch, id: "cal-work" });
    if (!connected.ok) throw new Error(connected.problem.message);
    const { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState } = await import("@/lib/planner");
    const { optimize } = await import("@/lib/optimizer/optimize");
    const state = { ...getInitialPlannerState(), courseStatuses: { "ENGL 1310": "inProgress" as const }, selectedSections: {} };
    const prefs = { ...defaultSchedulePreferences("compact"), calendars: [connected.value] };

    const request = buildOptimizeRequest(state, prefs);
    const feb16 = request.constraints.blocked.find((block) => block.id === "calendar-cal-work-Tue-480-570");
    expect(feb16).toEqual({
      id: "calendar-cal-work-Tue-480-570",
      label: "Work",
      day: "Tue",
      start: 480,
      end: 570,
      dates: [{ start: "2027-02-16", end: "2027-02-16" }],
    });

    // The real request's busy time over two sections that meet Tuesdays at 8:00: one for the whole
    // term, so it meets on Feb 16, and one for the second eight weeks only, which starts in March.
    const meeting = (dates: { start: string; end: string } | null) => [{ day: "Tue" as const, start: 480, end: 560, buildingId: "LANG", dates }];
    const courses = [
      {
        code: "ENGL 1310",
        credits: 3,
        sections: [
          { id: "full-term", courseCode: "ENGL 1310", rating: 5, meetings: meeting(null) },
          { id: "second-half", courseCode: "ENGL 1310", rating: 1, meetings: meeting({ start: "2027-03-08", end: "2027-05-07" }) },
        ],
      },
    ];
    const picks = (blocked: typeof request.constraints.blocked) =>
      optimize({ ...request, courses, locks: {}, excluded: [], fixedCredits: 0, weights: { ...request.weights, rating: 4 }, constraints: { ...request.constraints, blocked } }).schedules.map(
        (schedule) => schedule.byCourse["ENGL 1310"],
      );
    expect(picks(request.constraints.blocked)).toEqual(["second-half"]);
    // Without the calendar both fit, and the better-rated full-term section comes first: the busy piece was the only reason.
    expect(picks([])[0]).toBe("full-term");
  });
});
