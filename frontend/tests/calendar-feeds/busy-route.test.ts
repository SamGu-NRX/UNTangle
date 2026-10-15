import { beforeAll, expect, mock, test, type Mock } from "bun:test";
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
mock.module("@/lib/rate-limit/server", () => ({
  withRateLimit: createRateLimitWrapper({
    store: memoryStore(),
    secret: "untangle calendar-feeds busy tests",
    session: async () => {
      const mod = (await import("@/lib/auth-server")) as { getServerSession: SessionFn };
      return mod.getServerSession();
    },
  }),
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

function busyRequest(body: unknown, ip = "192.0.2.77"): Request {
  return new Request("http://localhost:3000/api/v1/calendar-feeds/busy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
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

test("answers 401 without a session", async () => {
  setSession(null);
  const response = await POST(busyRequest(VALID_BODY));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(dnsLookup).toHaveBeenCalledTimes(0);
  expect(fetchStub).toHaveBeenCalledTimes(0);
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
  expect(payload.occurrences).toEqual([{ date: "2026-01-15", startMinutes: 480, endMinutes: 540 }]);
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
    expect(payload.skipped).toEqual([{ index: 0, reason: "RECURRENCE-ID override has no matching recurring event" }]);
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
  const covering = await POST(busyRequest({ ...VALID_BODY, termStart: "2026-01-12", termEnd: "2026-05-08" }, "192.0.2.84"));
  expect(covering.status).toBe(200);
  expect((await covering.json()).occurrences).toEqual([{ date: "2026-01-15", startMinutes: 480, endMinutes: 540 }]);
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
    const body = (await response.json()) as { occurrences: Array<{ date: string; startMinutes: number; endMinutes: number }> };
    // The fallback window starts 2026-01-15 in America/Chicago (02:00Z is
    // 20:00 on the 15th), so the 02:30Z event keeps its local date and is not
    // clipped out by a window that started a day late.
    expect(body.occurrences).toEqual([{ date: "2026-01-15", startMinutes: 1230, endMinutes: 1290 }]);
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

test("a response over 1 MiB answers 422 with a specific error instead of a cut-short body", async () => {
  setSession({ user: { id: "user-too-many" } });
  // One daily event over 54 years: about 19,700 busy pieces, near 1 MB of
  // JSON, from a feed of a few hundred bytes.
  const daily =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:daily@t\r\nSUMMARY:Daily\r\nDTSTART:20260101T140000Z\r\nDTEND:20260101T150000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  fetchStub.mockImplementation(async () => new Response(daily, { status: 200, headers: { "content-type": "text/calendar" } }));
  try {
    const response = await POST(
      busyRequest({ ...VALID_BODY, rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2080-01-01T00:00:00Z" }, "192.0.2.90"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "This calendar has too many events to preview" });
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
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

test(`answers 429 once an anonymous caller passes the ${budgets.calendarFeedBusy.ip} request IP budget`, async () => {
  pinClockMidWindow();
  setSession(null);
  // Reset the network stubs: these calls answer 401 before any fetch happens.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => tinyResponse());
  // Anonymous calls answer 401 (no session) - but the wrapper still counts them.
  const call = () => POST(busyRequest(VALID_BODY, "192.0.2.86"));
  for (let i = 0; i < budgets.calendarFeedBusy.ip; i++) {
    expect((await call()).status).toBe(401);
  }
  expect((await call()).status).toBe(429);
});
