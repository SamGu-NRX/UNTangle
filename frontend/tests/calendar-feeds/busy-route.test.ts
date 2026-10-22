import { beforeAll, describe, expect, mock, test, type Mock } from "bun:test";
import { httpsFixture } from "./https-fixture";
import { budgets } from "@/lib/rate-limit/config";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { pinClockMidWindow, trustRealIp } from "../rate-limit/route-fixtures";

mock.module("server-only", () => ({}));
trustRealIp();

type SessionFn = () => Promise<{ user: { id: string } } | null>;
type SessionMock = Mock<SessionFn>;
type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const getServerSession = mock<SessionFn>(async () => null);
const dnsLookup = mock<DnsLookupFn>(async () => [{ address: "93.184.216.34", family: 4 }]);

mock.module("@/lib/auth-server", () => ({ getServerSession }));
// Exercise the production fetcher with DNS and HTTPS stubs, not a mocked fetcher module.
mock.module("node:dns/promises", () => ({ lookup: dnsLookup }));
const fetchStub = mock<(url: URL) => Promise<Response>>(async () => tinyResponse());
mock.module("node:https", () => ({ request: httpsFixture((url) => fetchStub(url)) }));

// Same re-registration as the preview route tests: the wrapper's session must
// resolve the auth-server registry at call time, and its store must be fresh.
const realRateLimitServer = { ...(await import("@/lib/rate-limit/server")) };
// Bun keeps this mock.module override for later test files. Routes this file
// doesn't test get a fresh store each time a route module wraps a handler, so
// a later file never inherits this file's request counts (CI run 39764102800).
const isolatedRateLimit: typeof realRateLimitServer.withRateLimit = (route, handler) =>
  createRateLimitWrapper({
    store: memoryStore(),
    secret: "isolated test rate limit",
    session: async () => ((await import("@/lib/auth-server")) as { getServerSession: () => Promise<never> }).getServerSession(),
  })(route, handler);

const fakeRateLimit = createRateLimitWrapper({
    store: memoryStore(),
    secret: "untangle calendar-feeds busy tests",
    session: async () => {
      const mod = (await import("@/lib/auth-server")) as { getServerSession: SessionFn };
      return mod.getServerSession();
    },
  });

mock.module("@/lib/rate-limit/server", () => ({
  ...realRateLimitServer,
  withRateLimit: ((route: Parameters<typeof realRateLimitServer.withRateLimit>[0], handler: Parameters<typeof realRateLimitServer.withRateLimit>[1]) =>
    (route === "calendarFeedPreview" || route === "calendarFeedBusy"
      ? fakeRateLimit
      : isolatedRateLimit)(route, handler)) as typeof realRateLimitServer.withRateLimit,
}));

const sessionMock: SessionMock = getServerSession;

/** Sets the session the route sees for the rest of the calling test. */
function setSession(session: { user: { id: string } } | null) {
  sessionMock.mockImplementation(async () => session);
}

let POST: typeof import("@/app/api/v1/calendar-feeds/busy/route").POST;

beforeAll(async () => {
  // Most tests run as an authenticated user; the 401 test opts out.
  setSession({ user: { id: "user-1" } });
  ({ POST } = await import("@/app/api/v1/calendar-feeds/busy/route"));
});

/** A tiny valid feed whose single event is 2026-01-15 14:00-15:00Z. */
const TINY_ICS =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@t\r\nSUMMARY:Tiny event\r\nDTSTART:20260115T140000Z\r\nDTEND:20260115T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

function busyRequest(body: unknown, ip = "192.0.2.77", cookie?: string): Request {
  return new Request("http://localhost:3000/api/v1/calendar-feeds/busy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** The guest cookie a response set, as the browser sends it back ("name=value"). */
function cookieFrom(response: Response): string {
  const set = response.headers.get("set-cookie");
  if (!set) throw new Error("The response set no cookie.");
  return set.split(";")[0];
}

const VALID_BODY = {
  url: "https://calendar.example.com/feed.ics",
  rangeStart: "2026-01-01T00:00:00Z",
  rangeEnd: "2026-03-01T00:00:00Z",
};

/** A fresh 200 response carrying the tiny feed. */
function tinyResponse(): Response {
  return new Response(TINY_ICS, { status: 200, headers: { "content-type": "text/calendar" } });
}

/** A fake Google secret-address URL: the private token must never leak anywhere. */
const SECRET_TOKEN = "9f2c7f6a1d84b0e3a51c02bb77d4e5f1";
const SECRET_URL = `https://calendar.google.com/calendar/ical/student%40unt.edu/private-${SECRET_TOKEN}/basic.ics`;

test("answers a guest too, who keeps calendars on the device", async () => {
  setSession(null);
  const response = await POST(busyRequest(VALID_BODY, "192.0.2.70"));
  expect(response.status).toBe(200);
  expect((await response.json()).occurrences).toEqual([{ date: "2026-01-15", startMinutes: 480, endMinutes: 540, allDay: false }]);
  // The tests below count calls from zero.
  dnsLookup.mockClear();
  fetchStub.mockClear();
});

test("answers 400 on a malformed body", async () => {
  setSession({ user: { id: "user-malformed" } });
  for (const body of ["not json", null, {}, { url: 42 }, { url: "" }]) {
    const request =
      body === "not json"
        ? new Request("http://localhost:3000/api/v1/calendar-feeds/busy", {
            method: "POST",
            headers: { "content-type": "application/json", "x-real-ip": "192.0.2.77" },
            body: body,
          })
        : busyRequest(body);
    const response = await POST(request);
    expect(response.status).toBe(400);
  }
});

test("answers 400 on a URL that fails validation", async () => {
  setSession({ user: { id: "user-badurl" } });
  for (const url of ["http://calendar.example.com/feed.ics", "https://127.0.0.1/feed.ics", "not a url"]) {
    const response = await POST(busyRequest({ ...VALID_BODY, url }));
    expect(response.status).toBe(400);
  }
  expect(dnsLookup).toHaveBeenCalledTimes(0);
});

test("answers 200 with title-free dated pieces on success", async () => {
  setSession({ user: { id: "user-success" } });
  const response = await POST(busyRequest(VALID_BODY, "192.0.2.78"));
  expect(response.status).toBe(200);
  // The tests exercise the exact versioned URL the client ships against.
  expect(busyRequest(VALID_BODY).url).toBe("http://localhost:3000/api/v1/calendar-feeds/busy");
  const payload = await response.json();
  // The requested URL is never echoed back: a Google secret-address URL
  // would carry its private token into the response body.
  expect(payload.url).toBeUndefined();
  expect(JSON.stringify(payload)).not.toContain("calendar.example.com");
  expect(payload.range).toEqual({ start: "2026-01-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" });
  // The real parser ran over the mocked feed text: one busy piece, weekday
  // and minutes derivable from the date, and no id or event fields.
  expect(payload.occurrences).toEqual([{ date: "2026-01-15", startMinutes: 480, endMinutes: 540, allDay: false }]);
  expect(payload.skipped).toEqual([]);
  expect(JSON.stringify(payload)).not.toContain("Tiny event");
  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(fetchStub.mock.calls[0]?.[0].toString()).toBe("https://calendar.example.com/feed.ics");
});

test("skipped entries carry an index and a reason, never event text", async () => {
  setSession({ user: { id: "user-skipped" } });
  // An override whose recurring master is missing is skipped; the parser
  // records the event's summary and UID internally.
  const orphan =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:orphan@t\r\nSUMMARY:Internal reorg plans\r\nRECURRENCE-ID:20260120T140000Z\r\nDTSTART:20260120T140000Z\r\nDTEND:20260120T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  fetchStub.mockImplementation(async () => new Response(orphan, { status: 200, headers: { "content-type": "text/calendar" } }));
  try {
    const response = await POST(busyRequest(VALID_BODY, "192.0.2.91"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.skipped).toEqual([{ index: 0, reason: "unmatched-override" }]);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("Internal reorg plans");
    expect(text).not.toContain("orphan@t");
    expect(text).not.toContain("summary");
    expect(text).not.toContain("uid");
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("the secret-address URL never appears in a body, error body, or captured log", async () => {
  setSession({ user: { id: "user-privacy" } });
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => tinyResponse());
  // Capture every console method by direct assignment: bun:test's mock()
  // wraps a bare function, not an object method.
  const originalConsole = [console.log, console.warn, console.error, console.info];
  const captured: unknown[][] = [];
  const capture = (...args: unknown[]) => {
    captured.push(args);
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  console.info = capture;
  try {
    // Success: the requested URL is not echoed back at all.
    const ok = await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL }, "192.0.2.87"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain(SECRET_TOKEN);

    // Fetch failure: the fetcher's internal error text (which can name the
    // URL) never reaches the response body.
    fetchStub.mockImplementation(async () => {
      throw new TypeError(`fetch failed for ${SECRET_URL}`);
    });
    const unreachable = await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL }, "192.0.2.88"));
    expect(unreachable.status).toBe(502);
    expect(await unreachable.text()).not.toContain(SECRET_TOKEN);

    // Parse failure: the complaint is generic too.
    fetchStub.mockImplementation(async () => new Response("not an iCalendar file", { status: 200, headers: { "content-type": "text/calendar" } }));
    const unparseable = await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL }, "192.0.2.89"));
    expect(unparseable.status).toBe(400);
    expect(await unparseable.text()).not.toContain(SECRET_TOKEN);

    // And no captured log line carries the secret.
    for (const args of captured) {
      expect(JSON.stringify(args)).not.toContain(SECRET_TOKEN);
    }
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
    console.log = originalConsole[0];
    console.warn = originalConsole[1];
    console.error = originalConsole[2];
    console.info = originalConsole[3];
  }
});

test("termStart and termEnd scope the pieces to the term's real dates", async () => {
  setSession({ user: { id: "user-term" } });
  // The event is on 2026-01-15; a term ending before it sees nothing.
  const before = await POST(busyRequest({ ...VALID_BODY, termStart: "2026-01-01", termEnd: "2026-01-14" }, "192.0.2.83"));
  expect(before.status).toBe(200);
  expect((await before.json()).occurrences).toEqual([]);
  // A term covering the date keeps the piece.
  const covering = await POST(busyRequest({ ...VALID_BODY, termStart: "2026-01-12", termEnd: "2026-02-27" }, "192.0.2.84"));
  expect(covering.status).toBe(200);
  expect((await covering.json()).occurrences).toEqual([{ date: "2026-01-15", startMinutes: 480, endMinutes: 540, allDay: false }]);
});

test("a term without a range reads the whole term in America/Chicago, however far ahead it is", async () => {
  setSession({ user: { id: "user-term-window" } });
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  // 2027-04-20 14:00Z is 09:00 in Denton (CDT), more than 60 days after any
  // date this suite runs on before the term.
  fetchStub.mockImplementation(
    async () =>
      new Response(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:w@t\r\nSUMMARY:Shift\r\nDTSTART:20270420T140000Z\r\nDTEND:20270420T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        { status: 200, headers: { "content-type": "text/calendar" } },
      ),
  );
  try {
    const response = await POST(busyRequest({ url: VALID_BODY.url, termStart: "2027-01-11", termEnd: "2027-05-07" }, "192.0.2.138"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    // Midnight CST on the first day to midnight CDT after the last.
    expect(payload.range).toEqual({ start: "2027-01-11T06:00:00.000Z", end: "2027-05-08T05:00:00.000Z" });
    expect(payload.occurrences).toEqual([{ date: "2027-04-20", startMinutes: 540, endMinutes: 600, allDay: false }]);
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("a range that does not cover the term answers 400 before any fetch", async () => {
  setSession({ user: { id: "user-term-uncovered" } });
  const fetchesBefore = fetchStub.mock.calls.length;
  // VALID_BODY's range ends 2026-03-01; the term runs to May.
  const response = await POST(busyRequest({ ...VALID_BODY, termStart: "2026-01-12", termEnd: "2026-05-08" }, "192.0.2.139"));
  expect(response.status).toBe(400);
  expect(fetchStub.mock.calls.length).toBe(fetchesBefore);
});

test("term values that are not real inclusive ISO dates answer 400", async () => {
  setSession({ user: { id: "user-term-bad" } });
  const fetchesBefore = fetchStub.mock.calls.length;
  for (const term of [
    { termStart: "2026-1-1", termEnd: "2026-05-08" },
    { termStart: "2026-01-01", termEnd: "2026-02-30" },
    { termStart: "2026-05-08", termEnd: "2026-01-01" },
    { termStart: "2026-01-01" },
    { termEnd: "2026-05-08" },
    { termStart: 42, termEnd: "2026-05-08" },
  ]) {
    const response = await POST(busyRequest({ ...VALID_BODY, ...term }, "192.0.2.85"));
    expect(response.status).toBe(400);
  }
  // A real last day whose following midnight the range parser can't read, with no range given.
  const farEnd = await POST(busyRequest({ url: VALID_BODY.url, termStart: "2026-01-01", termEnd: "9999-12-31" }, "192.0.2.85"));
  expect(farEnd.status).toBe(400);
  expect(fetchStub.mock.calls.length).toBe(fetchesBefore);
});

test("without a term, the fallback term window reads the range in America/Chicago", async () => {
  setSession({ user: { id: "user-chicago" } });
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  // One event at 2026-01-16 02:30Z — 20:30 on January 15 in Denton (CST).
  fetchStub.mockImplementation(
    async () =>
      new Response(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:z@t\r\nSUMMARY:Late night\r\nDTSTART:20260116T023000Z\r\nDTEND:20260116T033000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        { status: 200, headers: { "content-type": "text/calendar" } },
      ),
  );
  try {
    const response = await POST(
      busyRequest({
        url: VALID_BODY.url,
        rangeStart: "2026-01-16T02:00:00Z",
        rangeEnd: "2026-01-23T02:00:00Z",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { occurrences: Array<{ date: string; startMinutes: number; endMinutes: number; allDay: boolean }> };
    // The fallback window starts 2026-01-15 in America/Chicago (02:00Z is
    // 20:00 on the 15th), so the 02:30Z event keeps its local date and is not
    // clipped out by a window that started a day late.
    expect(body.occurrences).toEqual([{ date: "2026-01-15", startMinutes: 1230, endMinutes: 1290, allDay: false }]);
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("pieces are cut to the half-open range, and a piece wholly after it is left out", async () => {
  setSession({ user: { id: "user-clip" } });
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  // 14:30-16:00Z straddles the range's end; 15:30-16:30Z starts after it.
  fetchStub.mockImplementation(
    async () =>
      new Response(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a@t\r\nSUMMARY:Straddles\r\nDTSTART:20260115T143000Z\r\nDTEND:20260115T160000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b@t\r\nSUMMARY:After\r\nDTSTART:20260115T153000Z\r\nDTEND:20260115T163000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        { status: 200, headers: { "content-type": "text/calendar" } },
      ),
  );
  try {
    const response = await POST(
      busyRequest({ url: VALID_BODY.url, rangeStart: "2026-01-15T14:00:00Z", rangeEnd: "2026-01-15T15:00:00Z" }, "192.0.2.140"),
    );
    expect(response.status).toBe(200);
    // 14:30-15:00Z is 08:30-09:00 in Denton (CST).
    expect((await response.json()).occurrences).toEqual([{ date: "2026-01-15", startMinutes: 510, endMinutes: 540, allDay: false }]);
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("a default range of now through now plus 60 days is used when none is given", async () => {
  setSession({ user: { id: "user-range" } });
  const before = Date.now();
  const response = await POST(busyRequest({ url: VALID_BODY.url }, "192.0.2.79"));
  const after = Date.now();
  const payload = await response.json();
  const start = Date.parse(payload.range.start);
  const end = Date.parse(payload.range.end);
  expect(start).toBeGreaterThanOrEqual(before);
  expect(start).toBeLessThanOrEqual(after);
  expect(end).toBe(start + 60 * 86_400_000);
});

test("the route's parsed response feeds buildOptimizeRequest as a dated calendar block", async () => {
  setSession({ user: { id: "user-into-planner" } });
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  // One Tuesday event inside the planner's spring 2027 term: 2027-02-09
  // 20:00-21:00Z is 14:00-15:00 in Denton (CST).
  fetchStub.mockImplementation(
    async () =>
      new Response(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:p@t\r\nSUMMARY:Shift\r\nDTSTART:20270209T200000Z\r\nDTEND:20270209T210000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        { status: 200, headers: { "content-type": "text/calendar" } },
      ),
  );
  try {
    const response = await POST(
      busyRequest(
        { url: VALID_BODY.url, rangeStart: "2027-02-01T00:00:00Z", rangeEnd: "2027-03-01T00:00:00Z" },
        "192.0.2.137",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { occurrences: Array<{ date: string; startMinutes: number; endMinutes: number; allDay: boolean }> };
    const { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState, normalizePlannerState } = await import(
      "@/lib/planner"
    );
    const state = normalizePlannerState({ ...getInitialPlannerState(), courseStatuses: { "SPAN 2040": "inProgress" } });
    const request = buildOptimizeRequest(state, defaultSchedulePreferences("compact"), {
      courseCodes: ["SPAN 2040"],
      busyOccurrences: body.occurrences,
    });
    expect(request.constraints.blocked).toContainEqual({
      id: "cal-0",
      label: "Calendar busy",
      day: "Tue",
      start: 840,
      end: 900,
      dates: [{ start: "2027-02-09", end: "2027-02-09" }],
    });
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("a feed past the piece budget answers 422 with a specific error instead of a cut-short body", async () => {
  setSession({ user: { id: "user-too-many" } });
  // Forty daily half-hour events over the term: about 4,700 busy pieces, past the 4,000 budget, from a feed of a few KB.
  const events = Array.from({ length: 40 }, (_, i) => {
    const minutes = String((i % 2) * 30).padStart(2, "0");
    const hour = String(Math.floor(i / 2)).padStart(2, "0");
    return `BEGIN:VEVENT\r\nUID:daily-${i}@t\r\nSUMMARY:Daily\r\nDTSTART:20270101T${hour}${minutes}00Z\r\nDTEND:20270101T${hour}${minutes === "00" ? "29" : "59"}00Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n`;
  }).join("");
  const daily = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
  fetchStub.mockImplementation(async () => new Response(daily, { status: 200, headers: { "content-type": "text/calendar" } }));
  try {
    const response = await POST(busyRequest({ url: VALID_BODY.url, termStart: "2027-01-11", termEnd: "2027-05-07" }, "192.0.2.90"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "This calendar has too many events to preview" });
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("a busy body over 1 MiB is refused whole, never cut short", async () => {
  const { serializeBusy } = await import("@/lib/calendar-feeds/busy-serialize");
  const piece = { date: "2027-01-12", startMinutes: 900, endMinutes: 1080, allDay: false };
  const range = { start: "2027-01-11T06:00:00.000Z", end: "2027-05-08T05:00:00.000Z" };
  expect(serializeBusy({ range, occurrences: Array.from({ length: 1_000 }, () => piece), skipped: [] })).not.toBeNull();
  expect(serializeBusy({ range, occurrences: Array.from({ length: 20_000 }, () => piece), skipped: [] })).toBeNull();
});

test("a feed blocked by SSRF rules answers 400 and an unreachable feed answers 502", async () => {
  setSession({ user: { id: "user-fetch-errors" } });
  // Private DNS answer: the real fetcher throws a blocked error (route 400).
  dnsLookup.mockImplementation(async () => [{ address: "10.1.2.3", family: 4 }]);
  expect((await POST(busyRequest(VALID_BODY, "192.0.2.80"))).status).toBe(400);
  // DNS failure: the fetcher fails closed with an unreachable error (502).
  dnsLookup.mockImplementation(async () => {
    throw new Error("ENOTFOUND: DNS lookup failed");
  });
  expect((await POST(busyRequest(VALID_BODY, "192.0.2.81"))).status).toBe(502);
  // Public DNS but a refusing connection: also unreachable (502). The timeout
  // kind follows the same switch and is covered by the fetcher unit tests.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => {
    throw new TypeError("fetch failed: connection refused");
  });
  expect((await POST(busyRequest(VALID_BODY, "192.0.2.82"))).status).toBe(502);
  fetchStub.mockImplementation(async () => tinyResponse());
});

describe("a feed built to cost the server", () => {
  const feed = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
  const serve = (body: string) => fetchStub.mockImplementation(async () => new Response(body, { status: 200, headers: { "content-type": "text/calendar" } }));
  const term = { url: VALID_BODY.url, termStart: "2027-01-11", termEnd: "2027-05-07" };

  test("a range or term over 400 days is refused before anything is fetched", async () => {
    setSession({ user: { id: "user-wide" } });
    fetchStub.mockClear();
    const wide = await POST(busyRequest({ url: VALID_BODY.url, rangeStart: "1900-01-01T00:00:00Z", rangeEnd: "2200-01-01T00:00:00Z" }, "192.0.2.110"));
    expect(wide.status).toBe(400);
    const longTerm = await POST(busyRequest({ url: VALID_BODY.url, termStart: "2027-01-01", termEnd: "2028-03-01" }, "192.0.2.110"));
    expect(longTerm.status).toBe(400);
    expect(fetchStub).toHaveBeenCalledTimes(0);
  });

  test("one event lasting centuries yields only the term's days", async () => {
    setSession({ user: { id: "user-long-event" } });
    serve(feed("BEGIN:VEVENT\r\nUID:long@t\r\nDTSTART;VALUE=DATE:19000101\r\nDTEND;VALUE=DATE:22000101\r\nEND:VEVENT\r\n"));
    const started = performance.now();
    const response = await POST(busyRequest(term, "192.0.2.111"));
    expect(response.status).toBe(200);
    expect((await response.json()).occurrences).toHaveLength(117);
    expect(performance.now() - started).toBeLessThan(2000);
    fetchStub.mockImplementation(async () => tinyResponse());
  });

  test("many overlapping multi-day events are refused once they pass the piece budget, without building the rest", async () => {
    setSession({ user: { id: "user-overlap" } });
    // 300 all-day events, each covering the whole term: 35,100 pieces, past the 4,000 budget.
    const events = Array.from({ length: 300 }, (_, i) => `BEGIN:VEVENT\r\nUID:wide-${i}@t\r\nDTSTART;VALUE=DATE:20270101\r\nDTEND;VALUE=DATE:20270601\r\nEND:VEVENT\r\n`).join("");
    serve(feed(events));
    const started = performance.now();
    const response = await POST(busyRequest(term, "192.0.2.112"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "This calendar has too many events to preview" });
    expect(performance.now() - started).toBeLessThan(2000);
    fetchStub.mockImplementation(async () => tinyResponse());
  });

  test("warnings are fixed codes: a TZID or VALUE carrying a secret never comes back", async () => {
    setSession({ user: { id: "user-warnings" } });
    const secret = "private-0d6f2a9e7c4b1385a2f9e0c7d6b5a4f3";
    serve(
      feed(
        `BEGIN:VEVENT\r\nUID:tz@t\r\nDTSTART;TZID="https://calendar.google.com/calendar/ical/x/${secret}/basic.ics":20270112T150000\r\nDTEND;TZID="https://calendar.google.com/calendar/ical/x/${secret}/basic.ics":20270112T160000\r\nEND:VEVENT\r\n` +
          `BEGIN:VEVENT\r\nUID:value@t\r\nDTSTART;VALUE=${secret.toUpperCase()}:20270113T150000\r\nDTEND:20270113T160000Z\r\nEND:VEVENT\r\n`,
      ),
    );
    const response = await POST(busyRequest(term, "192.0.2.113"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).not.toContain(secret);
    expect(JSON.parse(text).skipped).toEqual([
      { index: 0, reason: "unknown-time-zone" },
      { index: 1, reason: "invalid-date" },
    ]);
    fetchStub.mockImplementation(async () => tinyResponse());
  });
});

describe("sealed addresses", () => {
  const KEY = Buffer.alloc(32, 3).toString("base64");
  const withKey = async (key: string | undefined, run: () => Promise<void>) => {
    const before = process.env.CALENDAR_FEED_KEY;
    if (key === undefined) delete process.env.CALENDAR_FEED_KEY;
    else process.env.CALENDAR_FEED_KEY = key;
    try {
      await run();
    } finally {
      if (before === undefined) delete process.env.CALENDAR_FEED_KEY;
      else process.env.CALENDAR_FEED_KEY = before;
    }
  };
  const fetchedUrls = () => fetchStub.mock.calls.map(([url]) => String(url));

  test("seal: true returns the address sealed for the caller, and the token refreshes the same feed", async () =>
    withKey(KEY, async () => {
      setSession({ user: { id: "user-seal" } });
      dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
      fetchStub.mockImplementation(async () => tinyResponse());
      fetchStub.mockClear();
      const connected = await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL, seal: true }, "192.0.2.90"));
      expect(connected.status).toBe(200);
      const text = await connected.text();
      expect(text).not.toContain(SECRET_TOKEN);
      const { sealedUrl, occurrences } = JSON.parse(text);
      expect(sealedUrl).toMatch(/^cf1\./);
      const refreshed = await POST(busyRequest({ sealedUrl, rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd }, "192.0.2.90"));
      expect(refreshed.status).toBe(200);
      const body = await refreshed.json();
      expect(body.occurrences).toEqual(occurrences);
      expect(body.sealedUrl).toBeUndefined();
      expect(fetchedUrls()).toEqual([SECRET_URL, SECRET_URL]);
    }));

  test("another account's token, or a guest's, asks to reconnect and fetches nothing", async () =>
    withKey(KEY, async () => {
      setSession({ user: { id: "user-owner" } });
      const { sealedUrl } = await (await POST(busyRequest({ ...VALID_BODY, seal: true }, "192.0.2.91"))).json();
      fetchStub.mockClear();
      setSession({ user: { id: "user-thief" } });
      const stolen = await POST(busyRequest({ sealedUrl, rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd }, "192.0.2.91"));
      expect(stolen.status).toBe(422);
      expect(await stolen.json()).toEqual({ error: "Connect this calendar again", code: "CALENDAR_RECONNECT" });
      // Without a session, an account's token most likely means the session ended: sign in, don't paste it again.
      setSession(null);
      const asGuest = await POST(busyRequest({ sealedUrl, rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd }, "192.0.2.91"));
      expect(asGuest.status).toBe(401);
      expect(await asGuest.json()).toEqual({ error: "Sign in to refresh this calendar", code: "CALENDAR_SIGN_IN" });
      expect(fetchStub).toHaveBeenCalledTimes(0);
    }));

  const refresh = (sealedUrl: string) => ({ sealedUrl, rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd });

  test("sealing also returns a feed id: the same for one address however it is sealed, and saying nothing of it", async () =>
    withKey(KEY, async () => {
      setSession({ user: { id: "user-feed-id" } });
      const first = await (await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL, seal: true }, "192.0.2.98"))).json();
      const again = await (await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL, seal: true }, "192.0.2.98"))).json();
      setSession(null);
      const asGuest = await (await POST(busyRequest({ ...VALID_BODY, url: SECRET_URL, seal: true }, "192.0.2.98"))).json();
      const other = await (await POST(busyRequest({ ...VALID_BODY, seal: true }, "192.0.2.98"))).json();
      expect(first.feedId).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(first.sealedUrl).not.toBe(again.sealedUrl);
      expect([again.feedId, asGuest.feedId]).toEqual([first.feedId, first.feedId]);
      expect(other.feedId).not.toBe(first.feedId);
      expect(first.feedId).not.toContain(SECRET_TOKEN.slice(0, 8));
      // A refresh returns no feed id: the calendar keeps the one it was connected with.
      const refreshed = await (await POST(busyRequest({ sealedUrl: other.sealedUrl, rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd }, "192.0.2.98"))).json();
      expect(refreshed.feedId).toBeUndefined();
    }));

  test("a guest's token is sealed to the browser's HttpOnly cookie, and refreshes on that browser only", async () =>
    withKey(KEY, async () => {
      setSession(null);
      const connected = await POST(busyRequest({ ...VALID_BODY, seal: true }, "192.0.2.92"));
      const setCookie = connected.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(/^__Host-untangle-calendar-guest=[A-Za-z0-9_-]{22,}; Path=\/; Max-Age=7776000; HttpOnly; Secure; SameSite=Lax$/);
      const cookie = cookieFrom(connected);
      const { sealedUrl } = await connected.json();
      expect(sealedUrl).toMatch(/^cg1\./);

      // The same browser: a fresh token comes back, and the cookie's lifetime is renewed.
      const refreshed = await POST(busyRequest(refresh(sealedUrl), "192.0.2.92", cookie));
      expect(refreshed.status).toBe(200);
      expect(cookieFrom(refreshed)).toBe(cookie);
      const fresh = (await refreshed.json()).sealedUrl;
      expect(fresh).toMatch(/^cg1\./);
      expect(fresh).not.toBe(sealedUrl);

      // A copy of the token from the browser's storage, sent without the cookie or with another browser's.
      fetchStub.mockClear();
      for (const copied of [undefined, "__Host-untangle-calendar-guest=BBBBBBBBBBBBBBBBBBBBBB"]) {
        const stolen = await POST(busyRequest(refresh(sealedUrl), "192.0.2.92", copied));
        expect(stolen.status).toBe(422);
        expect((await stolen.json()).code).toBe("CALENDAR_RECONNECT");
      }
      expect(fetchStub).toHaveBeenCalledTimes(0);
    }));

  test("a guest who signs in on the same browser gets the token sealed for the account; a copy elsewhere doesn't", async () =>
    withKey(KEY, async () => {
      setSession(null);
      const connected = await POST(busyRequest({ ...VALID_BODY, seal: true }, "192.0.2.95"));
      const cookie = cookieFrom(connected);
      const { sealedUrl: guestToken } = await connected.json();

      setSession({ user: { id: "user-signed-in-later" } });
      const elsewhere = await POST(busyRequest(refresh(guestToken), "192.0.2.95"));
      expect(elsewhere.status).toBe(422);
      const converted = await POST(busyRequest(refresh(guestToken), "192.0.2.95", cookie));
      expect(converted.status).toBe(200);
      const { sealedUrl: accountToken } = await converted.json();
      expect(accountToken).toMatch(/^cf1\./);
      // The converted token keeps the guest line: it ends 90 days after the guest first connected.
      const { openFeedToken } = await import("@/lib/calendar-feeds/seal");
      const guestLine = openFeedToken(guestToken, { kind: "guest", id: cookie.split("=")[1] }, Buffer.from(KEY, "base64"));
      expect(openFeedToken(accountToken, { kind: "user", id: "user-signed-in-later" }, Buffer.from(KEY, "base64"))).toMatchObject({
        limited: true,
        firstIssued: guestLine.firstIssued,
      });
      // The account's token opens for the account, and without a session asks to sign in.
      expect((await POST(busyRequest(refresh(accountToken), "192.0.2.95"))).status).toBe(200);
      setSession(null);
      expect((await POST(busyRequest(refresh(accountToken), "192.0.2.95", cookie))).status).toBe(401);
    }));

  test("a converted account token past the guest line's 90 days asks to reconnect; a pasted one has no end", async () =>
    withKey(KEY, async () => {
      const { sealFeedUrl, GUEST_TOKEN_LIFETIME_MS } = await import("@/lib/calendar-feeds/seal");
      const key = Buffer.from(KEY, "base64");
      const user = { kind: "user" as const, id: "user-converted" };
      setSession({ user: { id: user.id } });
      const now = Date.now();
      const converted = sealFeedUrl(VALID_BODY.url, user, key, { now: now - 5 * 24 * 3600_000, firstIssued: now - GUEST_TOKEN_LIFETIME_MS - 60_000, limited: true });
      const pasted = sealFeedUrl(VALID_BODY.url, user, key, { now: now - 400 * 24 * 3600_000 });
      const expired = await POST(busyRequest(refresh(converted), "192.0.2.97"));
      expect(expired.status).toBe(422);
      expect((await expired.json()).code).toBe("CALENDAR_RECONNECT");
      expect((await POST(busyRequest(refresh(pasted), "192.0.2.97"))).status).toBe(200);
    }));

  test("a guest token past 30 days, or a line of them past 90, asks to reconnect, and neither converts", async () =>
    withKey(KEY, async () => {
      const { sealFeedUrl, openFeedToken, GUEST_TOKEN_MAX_AGE_MS, GUEST_TOKEN_LIFETIME_MS } = await import("@/lib/calendar-feeds/seal");
      const key = Buffer.from(KEY, "base64");
      const id = "CCCCCCCCCCCCCCCCCCCCCC";
      const cookie = `__Host-untangle-calendar-guest=${id}`;
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const stale = sealFeedUrl(VALID_BODY.url, { kind: "guest", id }, key, { now: now - GUEST_TOKEN_MAX_AGE_MS - 60_000 });
      const old = sealFeedUrl(VALID_BODY.url, { kind: "guest", id }, key, { now: now - day, firstIssued: now - GUEST_TOKEN_LIFETIME_MS - 60_000 });
      const late = sealFeedUrl(VALID_BODY.url, { kind: "guest", id }, key, { now: now - day, firstIssued: now - GUEST_TOKEN_LIFETIME_MS + 10 * day });
      fetchStub.mockClear();
      for (const session of [null, { user: { id: "user-late" } }]) {
        setSession(session);
        for (const token of [stale, old]) {
          const response = await POST(busyRequest(refresh(token), "192.0.2.96", cookie));
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe("CALENDAR_RECONNECT");
        }
      }
      expect(fetchStub).toHaveBeenCalledTimes(0);
      // Inside both limits, a guest refresh keeps the first issue time, so the 90 days still run from it.
      setSession(null);
      const refreshed = await POST(busyRequest(refresh(late), "192.0.2.96", cookie));
      expect(refreshed.status).toBe(200);
      const { sealedUrl } = await refreshed.json();
      expect(openFeedToken(sealedUrl, { kind: "guest", id }, key).firstIssued).toBe(openFeedToken(late, { kind: "guest", id }, key).firstIssued);
    }));

  test("without a key, sealing answers 503 and fetches nothing", async () =>
    withKey(undefined, async () => {
      setSession({ user: { id: "user-nokey" } });
      fetchStub.mockClear();
      const response = await POST(busyRequest({ ...VALID_BODY, seal: true }, "192.0.2.93"));
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("CALENDARS_UNAVAILABLE");
      expect(fetchStub).toHaveBeenCalledTimes(0);
    }));

  test("a body naming both forms, neither, or sealing a token is refused", async () =>
    withKey(KEY, async () => {
      setSession({ user: { id: "user-both" } });
      for (const body of [
        { ...VALID_BODY, sealedUrl: "cf1.a.b.c" },
        { rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd },
        { sealedUrl: "cf1.a.b.c", seal: true },
        { ...VALID_BODY, seal: "yes" },
      ]) {
        expect((await POST(busyRequest(body, "192.0.2.94"))).status).toBe(400);
      }
    }));
});

test(`answers 429 once an anonymous caller passes the ${budgets.calendarFeedBusy.ip} request IP budget`, async () => {
  pinClockMidWindow();
  setSession(null);
  // Reset the network stubs: every call fetches the tiny feed.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => tinyResponse());
  // Anonymous calls are answered, and the wrapper counts them by address.
  const call = () => POST(busyRequest(VALID_BODY, "192.0.2.86"));
  for (let i = 0; i < budgets.calendarFeedBusy.ip; i++) {
    expect((await call()).status).toBe(200);
  }
  expect((await call()).status).toBe(429);
});
