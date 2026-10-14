import { afterAll, beforeAll, expect, mock, test, type Mock } from "bun:test";
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
// The route exercises the production fetcher defaults: DNS through the dns
// module (resolved lazily per call) and HTTP through globalThis. Stubbing
// those seams instead of re-registering the fetcher module keeps these mocks
// out of the other calendar-feeds test files, which import the real fetcher
// with injected deps.
mock.module("node:dns/promises", () => ({ lookup: dnsLookup }));
const realFetch = globalThis.fetch;
// Bun's typeof fetch carries a preconnect property; the stub only needs the
// callable surface.
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const fetchStub = mock<FetchFn>(async () => tinyResponse());
globalThis.fetch = fetchStub as unknown as typeof globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

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

test("answers 401 without a session", async () => {
  setSession(null);
  const response = await POST(previewRequest(VALID_BODY));
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
  expect(payload.occurrences).toEqual([
    {
      uid: "x@t",
      summary: "Tiny event",
      start: "2026-01-15T14:00:00.000Z",
      end: "2026-01-15T15:00:00.000Z",
      isAllDay: false,
      location: "",
      description: "",
    },
  ]);
  expect(payload.weeklyBusyBlocks).toEqual([]);
  expect(payload.skipped).toEqual([]);
  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(fetchStub.mock.calls[0]?.[0]).toBe("https://calendar.example.com/feed.ics");
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

test(`answers 429 once an anonymous caller passes the ${budgets.calendarFeedsPreview.ip} request IP budget`, async () => {
  pinClockMidWindow();
  setSession(null);
  // Reset the network stubs: these calls answer 401 before any fetch happens.
  dnsLookup.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
  fetchStub.mockImplementation(async () => tinyResponse());
  // Anonymous calls answer 401 (no session) - but the wrapper still counts them.
  const call = () => POST(previewRequest(VALID_BODY, "192.0.2.83"));
  for (let i = 0; i < budgets.calendarFeedsPreview.ip; i++) {
    expect((await call()).status).toBe(401);
  }
  const response = await call();
  expect(response.status).toBe(429);
});
