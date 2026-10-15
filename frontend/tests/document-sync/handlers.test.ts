import { describe, expect, test } from "bun:test";
import { documentHandlers, MAX_WRITE_BYTES } from "@/lib/document-sync/handlers";
import { parseWrite } from "@/lib/document-sync/decision";
import type { DocumentRepository } from "@/lib/document-sync/repository";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createV1Auth } from "@/server/auth/v1-auth";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { write } from "./fixtures";

const origin = "http://localhost:3000";
const context = { params: Promise.resolve({ id: "schedule-1" }) };
const identity = async () => ({ user: { id: "alice", emailVerified: true } });
const fakeRepository: DocumentRepository = {
  write: async (userId, bytes) => {
    const input = parseWrite(bytes);
    return { userId, operationId: input.write.operationId, writeSha256: input.writeSha256, committedRevision: 1 };
  },
  get: async () => { throw new Error("database unavailable"); },
  pull: async () => [{ documentId: write().documentId, kind: "schedule", revision: 1, deleted: false }],
  listVersions: async () => ({ versions: [], nextPage: null }),
};
const cookieAuth = (session: () => Promise<{ user: { id: string; emailVerified: boolean } } | null>) => createV1Auth(createDeviceGrants(new MemoryDeviceStore()), session);
const handlers = documentHandlers({ repository: fakeRepository, authorize: cookieAuth(identity), origin, available: true });
function request(body = JSON.stringify(write()), headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/v1/documents/schedule-1`, { method: "PUT", headers: { origin, "content-type": "application/json", ...headers }, body });
}

describe("document HTTP boundaries", () => {
  test("the authenticated user owns the receipt, with no cacheable private response", async () => {
    const result = await handlers.put(request(), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ userId: "alice", committedRevision: 1, operationId: "operation-1" });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  test("every handler refuses missing sessions", async () => {
    const signedOut = documentHandlers({ repository: fakeRepository, authorize: cookieAuth(async () => null), origin, available: true });
    for (const response of await Promise.all([signedOut.put(request(), context), signedOut.get(request(), context), signedOut.pull(request()), signedOut.versions(request())])) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect((await handlers.pull(request())).status).toBe(200);
  });
  test("missing storage never acknowledges a write", async () => {
    const unavailable = documentHandlers({ repository: fakeRepository, authorize: cookieAuth(identity), origin, available: false });
    const response = await unavailable.put(request(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((await handlers.put(request(), context)).status).toBe(200);
  });
  test("cookie writes require the app origin and JSON", async () => {
    for (const invalidOrigin of ["https://evil.example", "null", ""]) {
      const response = await handlers.put(request(undefined, { origin: invalidOrigin }), context);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    }
    const missing = new Request(`${origin}/api/v1/documents/schedule-1`, { method: "PUT", headers: { "content-type": "application/json", cookie: "better-auth.session_token=x" }, body: JSON.stringify(write()) });
    const noOrigin = await handlers.put(missing, context);
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect((await handlers.put(request(undefined, { "content-type": "text/plain" }), context)).status).toBe(415);
    expect((await handlers.put(request(undefined, { "content-type": "application/json; charset=utf-8" }), context)).status).toBe(200);
  });
  test("oversized, malformed, and unknown-field writes are rejected", async () => {
    const oversized = await handlers.put(request(" ".repeat(MAX_WRITE_BYTES + 1)), context);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "WRITE_TOO_LARGE" });
    expect((await handlers.put(request("{"), context)).status).toBe(400);
    expect((await handlers.put(request(JSON.stringify({ ...write(), futureField: true })), context)).status).toBe(400);
    expect((await handlers.put(request(), context)).status).toBe(200);
  });
  test("route ids and query parameters are validated", async () => {
    expect((await handlers.get(request(), { params: Promise.resolve({ id: "bad/id" }) })).status).toBe(400);
    for (const query of ["scheduleId=bad%2Fid", "scheduleId=a&scheduleId=b", "page=a&page=b", "typo=x"]) {
      expect((await handlers.versions(new Request(`${origin}/api/v1/versions?${query}`))).status).toBe(400);
    }
    expect(await (await handlers.versions(new Request(`${origin}/api/v1/versions?scheduleId=valid`))).json()).toEqual({ versions: [], nextPage: null });
  });
  test("database errors return a generic error without internal messages", async () => {
    const response = await handlers.get(request(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Document storage is unavailable.", code: "STORAGE_UNAVAILABLE" });
    expect(await (await handlers.pull(request())).json()).toEqual([{ documentId: "schedule-1", kind: "schedule", revision: 1, deleted: false }]);
  });
  test("existing planner save budget limits writes before the handler runs", async () => {
    const limited = createRateLimitWrapper({ store: memoryStore(), session: identity, secret: "test-secret", now: () => 1_000 })("plannerSave", handlers.put);
    for (let i = 0; i < 60; i++) expect((await limited(request(), context)).status).toBe(200);
    const blocked = await limited(request(), context);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("59");
  });
});

describe("device bearer tokens on document routes", () => {
  const verifier = "v".repeat(43);
  async function setup() {
    let time = 1_000_000;
    const grants = createDeviceGrants(new MemoryDeviceStore(), () => time);
    const seen: string[] = [];
    const repository: DocumentRepository = {
      ...fakeRepository,
      get: async (userId, id) => { seen.push(`get:${userId}`); return { documentId: id, kind: "schedule", revision: 1, schemaVersion: 1, body: {} } as never; },
      pull: async (userId) => { seen.push(`pull:${userId}`); return []; },
      listVersions: async (userId) => { seen.push(`versions:${userId}`); return { versions: [], nextPage: null }; },
    };
    // The browser session belongs to someone else, so a response for "alice"
    // proves the bearer token chose the user.
    const authorize = createV1Auth(grants, async () => ({ user: { id: "mallory", emailVerified: true } }));
    const device = documentHandlers({ repository, authorize, origin, available: true });
    async function issue(clientKind: "mobile" | "extension", userId = "alice") {
      const common = { codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" as const };
      const pending = await grants.start(clientKind === "mobile" ? { ...common, clientKind } : { ...common, clientKind, scheduleId: "schedule-1" });
      await grants.approve(pending.userCode, userId, "approve");
      return grants.exchange(pending.deviceCode, verifier);
    }
    const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
    const put = (headers: Record<string, string>) => new Request(`${origin}/api/v1/documents/schedule-1`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(write()) });
    const get = (path: string, headers: Record<string, string>) => new Request(`${origin}${path}`, { headers });
    async function all(headers: Record<string, string>) {
      return Promise.all([
        device.put(put(headers), context),
        device.get(get("/api/v1/documents/schedule-1", headers), context),
        device.pull(get("/api/v1/sync", headers)),
        device.versions(get("/api/v1/versions", headers)),
      ]);
    }
    return { grants, device, issue, bearer, put, all, seen, advance: (ms: number) => { time += ms; } };
  }
  async function expectRefused(responses: Response[], status: number, code: string, token: string) {
    for (const response of responses) {
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ code });
      expect(text).not.toContain(token);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }

  test("a mobile token reads and writes as its own user, and a bearer PUT needs no Origin", async () => {
    const { issue, bearer, all, seen } = await setup();
    const tokens = await issue("mobile");
    const [put, get, pull, versions] = await all(bearer(tokens.accessToken));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ userId: "alice", committedRevision: 1 });
    for (const response of [get, pull, versions]) expect(response.status).toBe(200);
    expect(seen.sort()).toEqual(["get:alice", "pull:alice", "versions:alice"]);
  });

  test("a bearer PUT still requires JSON", async () => {
    const { issue, bearer, device, put } = await setup();
    const tokens = await issue("mobile");
    const response = await device.put(put(bearer(tokens.accessToken, { "content-type": "text/plain" })), context);
    expect(response.status).toBe(415);
  });

  test("an extension token is refused on every document route", async () => {
    const { issue, bearer, all } = await setup();
    const tokens = await issue("extension");
    await expectRefused(await all(bearer(tokens.accessToken)), 403, "insufficient_scope", tokens.accessToken);
  });

  test("a bearer token with a session cookie is rejected", async () => {
    const { issue, bearer, all } = await setup();
    const tokens = await issue("mobile");
    await expectRefused(await all(bearer(tokens.accessToken, { cookie: "better-auth.session_token=x", origin })), 400, "ambiguous_credentials", tokens.accessToken);
  });

  test("revoked, expired, generation-ended and malformed tokens get 401", async () => {
    const { grants, issue, bearer, all, advance } = await setup();
    const revoked = await issue("mobile");
    await grants.revoke(revoked.accessToken);
    await expectRefused(await all(bearer(revoked.accessToken)), 401, "invalid_token", revoked.accessToken);
    const expiring = await issue("mobile");
    advance(5 * 60_000);
    await expectRefused(await all(bearer(expiring.accessToken)), 401, "invalid_token", expiring.accessToken);
    const generation = await issue("mobile");
    await grants.bumpSecurityGeneration("alice");
    await expectRefused(await all(bearer(generation.accessToken)), 401, "invalid_token", generation.accessToken);
    await expectRefused(await all(bearer("not-a-token")), 401, "invalid_token", "not-a-token");
    await expectRefused(await all({ authorization: "Basic YWxpY2U6cGFzcw==" }), 401, "invalid_token", "YWxpY2U6cGFzcw==");
  });
});
