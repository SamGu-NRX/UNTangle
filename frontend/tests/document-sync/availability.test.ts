import { describe, expect, mock, test } from "bun:test";
import { DocumentSchema } from "../../../packages/contracts/src/documents";
import { ScheduleAvailabilitySchema } from "../../../packages/contracts/src/schedule-availability";
import { documentHandlers } from "@/lib/document-sync/handlers";
import { SyncError } from "@/lib/document-sync/decision";
import type { DocumentRepository } from "@/lib/document-sync/repository";
import { SectionsProxy } from "@/lib/sections/proxy";
import { ttlMs } from "@/lib/sections/config";
import { createV1Auth } from "@/server/auth/v1-auth";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createRateLimitWrapper, createUserLimit } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import fixture from "../sections/fixtures/spring-2027.json";
import { schedule } from "./fixtures";

const origin = "http://localhost:3000";
const id = "schedule-1";
const context = { params: Promise.resolve({ id }) };
const path = `${origin}/api/v1/documents/${id}/availability`;
const picked = { ...schedule, courses: ["MATH 1680"], selectedSections: { "MATH 1680": "vsb:spring-2027:MATH 1680:6862+6863" } };

const realRateLimitServer = { ...(await import("@/lib/rate-limit/server")) };

function setup() {
  let userId: string | null = "alice";
  let document = DocumentSchema.parse({ documentId: id, kind: "schedule", revision: 7, schemaVersion: 1, body: picked });
  let now = Date.parse("2026-10-22T06:00:00Z");
  let outage = false;
  let upstreamReads = 0;
  let databaseReads = 0;
  let deleted = false;
  const background: Promise<void>[] = [];
  const repository: DocumentRepository = {
    get: async (owner, requestedId) => {
      databaseReads++;
      if (owner !== "alice" || requestedId !== id || deleted) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
      return structuredClone(document);
    },
    write: async () => { throw new Error("Read-only check must not write."); },
    pull: async () => { throw new Error("Read the named schedule only."); },
    listVersions: async () => { throw new Error("Read the named schedule only."); },
  };
  const proxy = new SectionsProxy({
    now: () => now,
    retain: (work) => { background.push(work); },
    fetcher: async (url) => {
      upstreamReads++;
      if (outage) return new Response(null, { status: 503 });
      return url.endsWith("/spring-2027.json") ? Response.json(fixture) : new Response(null, { status: 404 });
    },
  });
  const grants = createDeviceGrants(new MemoryDeviceStore());
  const authorize = createV1Auth(grants, async () => userId ? { user: { id: userId, emailVerified: true }, session: { securityGeneration: 0 } } : null);
  const limits = memoryStore();
  const dependencies = { repository, authorize, origin, available: true, limit: createUserLimit({ store: limits, secret: "test-only", now: () => 1_000 }) };
  const handlers = documentHandlers(dependencies);
  const read = (term: string, code: string) => proxy.getCourseSections(term, code);
  const get = handlers.availability(read);
  async function token(clientKind: "mobile" | "extension") {
    const verifier = "v".repeat(43);
    const common = { codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" as const };
    const pending = await grants.start(clientKind === "mobile" ? { ...common, clientKind } : { ...common, clientKind, scheduleId: id });
    await grants.approve(pending.userCode, "alice", "approve");
    return (await grants.exchange(pending.deviceCode, verifier)).accessToken;
  }
  return { handlers, dependencies, proxy, get, token,
    request: (headers: Record<string, string> = {}) => new Request(path, { headers }),
    setUser: (value: string | null) => { userId = value; },
    setDocument: (value: unknown) => { document = DocumentSchema.parse(value); },
    setSchedule: (body: unknown) => { document = DocumentSchema.parse({ ...document, kind: "schedule", body }); },
    delete: () => { deleted = true; },
    stale: () => { now += ttlMs; outage = true; },
    settle: () => Promise.all(background),
    reads: () => ({ database: databaseReads, upstream: upstreamReads }),
  };
}

describe("availability HTTP and data integration", () => {
  test("checks the saved revision through the real proxy and parser, without writing", async () => {
    const api = setup();
    const response = await api.get(api.request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ScheduleAvailabilitySchema.parse(await response.json())).toMatchObject({ documentId: id, revision: 7, institutionId: "unt", termId: "spring-2027", summary: "open",
      courses: [{ courseCode: "MATH 1680", state: "open", section: { classNumbers: ["6862", "6863"] } }] });
  });

  test("another student cannot inspect the schedule, and signed-out requests do not read storage", async () => {
    const api = setup();
    api.setUser("bob");
    const forbidden = await api.get(api.request(), context);
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(api.reads()).toEqual({ database: 1, upstream: 0 });
    api.setUser(null);
    const signedOut = await api.get(api.request(), context);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(api.reads()).toEqual({ database: 1, upstream: 0 });
  });

  test("a tab for another account and an invalid id fail before storage", async () => {
    const api = setup();
    const switched = await api.get(api.request({ "x-untangle-account": "bob" }), context);
    expect(switched.status).toBe(401);
    expect(await switched.json()).toMatchObject({ code: "ACCOUNT_CHANGED" });
    const invalid = await api.get(api.request(), { params: Promise.resolve({ id: "bad/id" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_ID" });
    expect(api.reads()).toEqual({ database: 0, upstream: 0 });
  });

  test("mobile credentials work, extension credentials and ambiguous credentials do not", async () => {
    const api = setup();
    api.setUser("bob");
    const mobile = await api.token("mobile");
    const response = await api.get(api.request({ authorization: `Bearer ${mobile}` }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ documentId: id, revision: 7, summary: "open" });
    const extension = await api.token("extension");
    const denied = await api.get(api.request({ authorization: `Bearer ${extension}` }), context);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "insufficient_scope" });
    const ambiguous = await api.get(api.request({ authorization: `Bearer ${mobile}`, cookie: "session=x" }), context);
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toMatchObject({ code: "ambiguous_credentials" });
    expect(api.reads().database).toBe(1);
  });

  test("deleted documents and non-schedules cannot reach the section source", async () => {
    const api = setup();
    api.setDocument({ documentId: id, kind: "academic-record", revision: 1, schemaVersion: 1, body: {
      institutionId: "unt", courseStatuses: {}, transcriptRecords: [], manualCredit: [], major: null, catalogId: null,
    } });
    const wrongKind = await api.get(api.request(), context);
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toMatchObject({ code: "NOT_A_SCHEDULE" });
    api.delete();
    const deleted = await api.get(api.request(), context);
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(api.reads().upstream).toBe(0);
  });

  test.each([{ institutionId: "ut-austin" }, { termId: "fall-2028" }])("rejects unsupported schedule metadata %j", async (change) => {
    const api = setup();
    api.setSchedule({ ...picked, ...change });
    const result = await api.get(api.request(), context);
    expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({ code: "UNSUPPORTED_SCHEDULE" });
    expect(api.reads().upstream).toBe(0);
  });

  test("bounds the number of course lookups before fetching any data", async () => {
    const api = setup();
    const courses = Array.from({ length: 31 }, (_, i) => `MATH ${1000 + i}`);
    api.setSchedule({ ...schedule, courses, selectedSections: Object.fromEntries(courses.map((code) => [code, "choice"])) });
    const result = await api.get(api.request(), context);
    expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({ code: "SCHEDULE_TOO_LARGE" });
    expect(api.reads().upstream).toBe(0);
  });

  test("a failed cache refresh returns stale evidence and an unknown summary", async () => {
    const api = setup();
    expect((await api.get(api.request(), context)).status).toBe(200);
    api.stale();
    const response = await api.get(api.request(), context);
    await api.settle();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 7, summary: "unknown", courses: [{ state: "stale", evidence: { checkedAt: "2026-10-22T06:00:00.000Z" } }] });
  });

  test("per-user throttling and missing storage return private, explicit errors", async () => {
    const api = setup();
    const limited = documentHandlers({ ...api.dependencies, limit: async () => 42 }).availability(() => { throw new Error("Must not fetch"); });
    const response = await limited(api.request(), context);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
    const unavailable = documentHandlers({ ...api.dependencies, available: false }).availability(() => { throw new Error("Must not fetch"); });
    const failed = await unavailable(api.request(), context);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(api.reads()).toEqual({ database: 0, upstream: 0 });
  });

  test("the exported Next route wires the document check, section proxy, and flood guard", async () => {
    const api = setup();
    const wrapper = createRateLimitWrapper({ store: memoryStore(), session: async () => null, secret: "test-only", now: () => 1_000 });
    mock.module("@/lib/document-sync/server", () => ({ syncHandlers: api.handlers }));
    mock.module("@/lib/sections/server", () => ({ sectionsProxy: api.proxy }));
    mock.module("@/lib/rate-limit/server", () => ({
      ...realRateLimitServer,
      withRateLimit: ((route: Parameters<typeof realRateLimitServer.withRateLimit>[0], handler: Parameters<typeof realRateLimitServer.withRateLimit>[1]) =>
        (route === "documentFlood" ? wrapper : realRateLimitServer.withRateLimit)(route, handler)) as typeof realRateLimitServer.withRateLimit,
    }));
    const { GET } = await import("@/app/api/v1/documents/[id]/availability/route");
    const response = await GET(api.request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 7, summary: "open", courses: [{ state: "open" }] });
  });
});
