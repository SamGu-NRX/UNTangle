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

// The shared rate-limit wrapper captured whatever session instance was live
// when server.ts was first instantiated, which in a full run is another test
// file's mock. Re-register the server module with a wrapper whose session
// resolves the auth-server registry at call time, so the wrapper always
// agrees with the handler's own binding. Its store is fresh, so earlier
// files' request counts cannot leak into these tests.
mock.module("@/lib/rate-limit/server", () => ({
  withRateLimit: createRateLimitWrapper({
    store: memoryStore(),
    secret: "untangle calendar-feeds preview tests",
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

let POST: typeof import("@/app/api/calendar-feeds/preview/route").POST;

beforeAll(async () => {
  // Most tests run as an authenticated user; the 401 test opts out.
  setSession({ user: { id: "user-1" } });
  ({ POST } = await import("@/app/api/calendar-feeds/preview/route"));
});

/** A tiny valid feed whose single event is 2026-01-15 14:00-15:00Z. */
const TINY_ICS =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@t\r\nSUMMARY:Tiny event\r\nDTSTART:20260115T140000Z\r\nDTEND:20260115T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

function previewRequest(body: unknown, ip = "192.0.2.77"): Request {
  return new Request("http://localhost:3000/api/calendar-feeds/preview", {
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

test("previews for a guest, who connects calendars on the device", async () => {
  setSession(null);
  const response = await POST(previewRequest(VALID_BODY, "192.0.2.70"));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.events.map((event: { summary: string }) => event.summary)).toEqual(["Tiny event"]);
  expect(fetchStub).toHaveBeenCalledTimes(1);
  // The tests below count calls from zero.
  dnsLookup.mockClear();
  fetchStub.mockClear();
});

test("never takes a sealed address: titles leave only for someone holding the feed's address", async () => {
  setSession({ user: { id: "user-sealed" } });
  const response = await POST(previewRequest({ sealedUrl: "cf1.abc.def.ghi", rangeStart: VALID_BODY.rangeStart, rangeEnd: VALID_BODY.rangeEnd }));
  expect(response.status).toBe(400);
  expect(fetchStub).toHaveBeenCalledTimes(0);
});

test("answers 400 on a malformed body", async () => {
  setSession({ user: { id: "user-malformed" } });
  for (const body of ["not json", null, {}, { url: 42 }, { url: "" }]) {
    const request =
      body === "not json"
        ? new Request("http://localhost:3000/api/calendar-feeds/preview", {
            method: "POST",
            headers: { "content-type": "application/json", "x-real-ip": "192.0.2.77" },
            body: body,
          })
        : previewRequest(body);
    const response = await POST(request);
    expect(response.status).toBe(400);
  }
});

test("answers 400 on a URL that fails validation", async () => {
  setSession({ user: { id: "user-badurl" } });
  for (const url of ["http://calendar.example.com/feed.ics", "https://127.0.0.1/feed.ics", "not a url"]) {
    const response = await POST(previewRequest({ ...VALID_BODY, url }));
    expect(response.status).toBe(400);
  }
  expect(dnsLookup).toHaveBeenCalledTimes(0);
});

test("answers 200 with the parsed shape on success", async () => {
  setSession({ user: { id: "user-success" } });
  const response = await POST(previewRequest(VALID_BODY, "192.0.2.78"));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.url).toBe("https://calendar.example.com/feed.ics");
  expect(payload.range).toEqual({ start: "2026-01-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" });
  // The real parser ran over the mocked feed text.
  expect(payload.events).toEqual([
    { id: 0, uid: "x@t", summary: "Tiny event", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
  ]);
  expect(payload.occurrences).toEqual([
    { eventId: 0, start: "2026-01-15T14:00:00.000Z", end: "2026-01-15T15:00:00.000Z", status: "confirmed" },
  ]);
  expect(payload.weeklyBusyBlocks).toEqual([]);
  expect(payload.skipped).toEqual([]);
  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(fetchStub.mock.calls[0]?.[0].toString()).toBe("https://calendar.example.com/feed.ics");
});

test("a default range of now through now plus 60 days is used when none is given", async () => {
  setSession({ user: { id: "user-range" } });
  const before = Date.now();
  const response = await POST(previewRequest({ url: VALID_BODY.url }, "192.0.2.79"));
  const after = Date.now();
  const payload = await response.json();
  const start = Date.parse(payload.range.start);
  const end = Date.parse(payload.range.end);
  expect(start).toBeGreaterThanOrEqual(before);
  expect(start).toBeLessThanOrEqual(after);
  expect(end).toBe(start + 60 * 86_400_000);
});

test("a response over 1 MiB answers 422 with a specific error instead of a cut-short preview", async () => {
  setSession({ user: { id: "user-too-many" } });
  // One daily event over 54 years: about 19,700 occurrences, near 1.9 MB of
  // JSON, from a feed of a few hundred bytes.
  const daily =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:daily@t\r\nSUMMARY:Daily\r\nDTSTART:20260101T140000Z\r\nDTEND:20260101T150000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  fetchStub.mockImplementation(async () => new Response(daily, { status: 200, headers: { "content-type": "text/calendar" } }));
  try {
    const response = await POST(
      previewRequest({ ...VALID_BODY, rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2080-01-01T00:00:00Z" }, "192.0.2.90"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "This calendar has too many events to preview" });
  } finally {
    fetchStub.mockImplementation(async () => tinyResponse());
  }
});

test("a range value without an offset reads as America/Chicago, whatever the server zone", async () => {
  setSession({ user: { id: "user-floating-range" } });
  const savedZone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    const response = await POST(
      previewRequest({ ...VALID_BODY, rangeStart: "2026-01-15T08:00:00", rangeEnd: "2026-01-15T08:30:00" }, "192.0.2.91"),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    // 08:00 CST is 14:00Z, so the 14:00-15:00Z tiny event overlaps the range.
    expect(payload.range).toEqual({ start: "2026-01-15T14:00:00.000Z", end: "2026-01-15T14:30:00.000Z" });
    expect(payload.occurrences).toHaveLength(1);
  } finally {
    process.env.TZ = savedZone;
  }
});

test("range values that are not ISO 8601 date-times answer 400", async () => {
  setSession({ user: { id: "user-locale-range" } });
  const fetchesBefore = fetchStub.mock.calls.length;
  for (const rangeStart of ["Jan 1 2026", "2026-01-01", "2026-02-30T00:00:00Z", "2026-01-01T00:00:00+25:00"]) {
    const response = await POST(previewRequest({ ...VALID_BODY, rangeStart }, "192.0.2.92"));
    expect(response.status).toBe(400);
  }
  expect(fetchStub.mock.calls.length).toBe(fetchesBefore);
});

test("a feed blocked by SSRF rules answers 400 and an unreachable feed answers 502", async () => {
  setSession({ user: { id: "user-fetch-errors" } });
  // Private DNS answer: the real fetcher throws a blocked error (route 400).
  dnsLookup.mockImplementation(async () => [{ address: "10.1.2.3", family: 4 }]);
  expect((await POST(previewRequest(VALID_BODY, "192.0.2.80"))).status).toBe(400);
  // DNS failure: the fetcher fails closed with an unreachable error (502).
  dnsLookup.mockImplementation(async () => {
    throw new Error("ENOTFOUND: DNS lookup failed");
  });
  expect((await POST(previewRequest(VALID_BODY, "192.0.2.81"))).status).toBe(502);
  // Public DNS but a refusing connection: also unreachable (502). The timeout
  // kind follows the same switch and is covered by the fetcher unit tests.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => {
    throw new TypeError("fetch failed: connection refused");
  });
  expect((await POST(previewRequest(VALID_BODY, "192.0.2.82"))).status).toBe(502);
});

test(`answers 429 once an anonymous caller passes the ${budgets.calendarFeedPreview.ip} request IP budget`, async () => {
  pinClockMidWindow();
  setSession(null);
  // Reset the network stubs: every call fetches the tiny feed.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => tinyResponse());
  // Anonymous calls are previewed, and the wrapper counts them by address.
  const call = () => POST(previewRequest(VALID_BODY, "192.0.2.83"));
  for (let i = 0; i < budgets.calendarFeedPreview.ip; i++) {
    expect((await call()).status).toBe(200);
  }
  const response = await call();
  expect(response.status).toBe(429);
});
