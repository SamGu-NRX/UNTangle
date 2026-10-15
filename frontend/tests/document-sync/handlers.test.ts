import { describe, expect, test } from "bun:test";
import { documentHandlers, MAX_WRITE_BYTES } from "@/lib/document-sync/handlers";
import { parseWrite } from "@/lib/document-sync/decision";
import type { DocumentRepository } from "@/lib/document-sync/repository";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { write } from "./fixtures";

const origin = "http://localhost:3000";
const context = { params: Promise.resolve({ id: "schedule-1" }) };
const identity = async () => ({ user: { id: "alice" } });
const fakeRepository: DocumentRepository = {
  write: async (userId, bytes) => {
    const input = parseWrite(bytes);
    return { userId, operationId: input.write.operationId, writeSha256: input.writeSha256, committedRevision: 1 };
  },
  get: async () => { throw new Error("database unavailable"); },
  pull: async () => [{ documentId: write().documentId, kind: "schedule", revision: 1, deleted: false }],
  listVersions: async () => ({ versions: [], nextPage: null }),
};
const handlers = documentHandlers({ repository: fakeRepository, session: identity, origin, available: true });
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
    const signedOut = documentHandlers({ repository: fakeRepository, session: async () => null, origin, available: true });
    for (const response of await Promise.all([signedOut.put(request(), context), signedOut.get(request(), context), signedOut.pull(request()), signedOut.versions(request())])) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect((await handlers.pull(request())).status).toBe(200);
  });
  test("missing storage never acknowledges a write", async () => {
    const unavailable = documentHandlers({ repository: fakeRepository, session: identity, origin, available: false });
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
