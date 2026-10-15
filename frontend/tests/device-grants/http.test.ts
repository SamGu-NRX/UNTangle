import { expect, test } from "bun:test";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createDeviceHttp } from "@/server/auth/device-http";
import { createDeviceRouteHandlers } from "@/server/auth/device-handlers";
import { createV1Auth } from "@/server/auth/v1-auth";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { memoryStore } from "@/lib/rate-limit/store";
import { MemoryDeviceStore } from "./memory-store";

const origin = "https://untangle.example";
const extension = `chrome-extension://${"a".repeat(32)}`;
const verifier = "v".repeat(43);
const start = { clientKind: "mobile", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" } as const;
function setup() {
  const grants = createDeviceGrants(new MemoryDeviceStore());
  let account = "alice";
  let generation = 0;
  const session = async () => ({ user: { id: account, emailVerified: true }, session: { securityGeneration: generation } });
  const http = createDeviceHttp({ grants, origin, extensionOrigins: [extension], session });
  const routes = createDeviceRouteHandlers(http, createRateLimitWrapper({ store: memoryStore(), session, secret: "test-only-rate-limit-key" }));
  const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/v1/device`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const browser = (body: unknown, extra: Record<string, string> = {}) => request(body, { origin, "x-untangle-device": "1", cookie: "test-session", ...extra });
  async function issue(userId = "alice") {
    account = userId;
    const pending = await grants.start(start);
    await grants.approve(pending.userCode, userId, "approve");
    return grants.exchange(pending.deviceCode, verifier);
  }
  return { grants, http, routes, request, browser, issue, auth: createV1Auth(grants, session), changeAccount: (id: string) => { account = id; }, changeGeneration: (value: number) => { generation = value; } };
}

test("HTTP grant flow validates PKCE and consumes code once", async () => {
  const h = setup();
  const started = await h.routes.start(h.request(start));
  expect(started.status).toBe(200);
  expect(started.headers.get("cache-control")).toBe("no-store");
  const grant = await started.json();
  expect((await h.routes.inspect(h.browser({ userCode: grant.userCode }))).status).toBe(200);
  expect((await h.routes.approve(h.browser({ userCode: grant.userCode, expectedUserId: "alice", decision: "approve" }))).status).toBe(200);
  const bad = await h.routes.token(h.request({ deviceCode: grant.deviceCode, codeVerifier: "x".repeat(43) }));
  expect(await bad.json()).toEqual({ error: "invalid_grant" });
  expect((await h.routes.token(h.request({ deviceCode: grant.deviceCode, codeVerifier: verifier }))).status).toBe(200);
  expect((await h.routes.token(h.request({ deviceCode: grant.deviceCode, codeVerifier: verifier }))).status).toBe(400);
});

test("approval checks origin, custom header, displayed identity and session generation", async () => {
  const h = setup();
  const grant = await h.grants.start(start);
  const input = { userCode: grant.userCode, expectedUserId: "alice", decision: "approve" };
  expect((await h.routes.approve(h.request(input))).status).toBe(403);
  expect((await h.routes.approve(h.request(input, { origin }))).status).toBe(403);
  expect((await h.routes.approve(h.browser(input, { origin: "https://attacker.example" }))).status).toBe(403);
  h.changeAccount("bob");
  expect((await h.routes.approve(h.browser(input))).status).toBe(409);
  h.changeAccount("alice");
  await h.grants.bumpSecurityGeneration("alice");
  expect((await h.routes.approve(h.browser(input))).status).toBe(401);
  h.changeGeneration(1);
  expect((await h.routes.approve(h.browser(input))).status).toBe(200);
});

test("device calls reject cookie mixing and only allow released extension origins", async () => {
  const h = setup();
  expect((await h.routes.start(h.browser(start))).status).toBe(400);
  expect((await h.routes.start(h.request(start, { origin: "https://my.unt.edu" }))).status).toBe(403);
  const response = await h.routes.start(h.request(start, { origin: extension }));
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(extension);
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("vary")).toBe("Origin");
  const tokens = await h.issue();
  await expect(h.auth(h.browser({}, { authorization: `Bearer ${tokens.accessToken}` }), "documents:read")).rejects.toMatchObject({ code: "ambiguous_credentials" });
});

test("start and approve limits reject excess attempts with extension-readable 429", async () => {
  const h = setup();
  for (let i = 0; i < 10; i++) expect((await h.routes.start(h.request(start, { origin: extension }))).status).toBe(200);
  const limited = await h.routes.start(h.request(start, { origin: extension }));
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(limited.headers.get("access-control-allow-origin")).toBe(extension);
  for (let i = 0; i < 10; i++) expect((await h.routes.approve(h.browser({ userCode: "AAAAAAAA", expectedUserId: "alice", decision: "approve" }))).status).toBe(400);
  expect((await h.routes.approve(h.browser({ userCode: "AAAAAAAA", expectedUserId: "alice", decision: "approve" }))).status).toBe(429);
});

test("v1 handler uses the token owner's rows regardless of a supplied user ID", async () => {
  const h = setup();
  const alice = await h.issue("alice");
  const bob = await h.issue("bob");
  const rows: Record<string, string[]> = { alice: ["Alice private transcript"], bob: ["Bob private schedule"] };
  const read = async (token: string, suppliedUserId: string) => {
    const req = new Request(`${origin}/api/v1/documents?userId=${suppliedUserId}`, { headers: { authorization: `Bearer ${token}` } });
    const identity = await h.auth(req, "documents:read");
    return rows[identity.userId];
  };
  expect(await read(alice.accessToken, "bob")).toEqual(["Alice private transcript"]);
  expect(await read(bob.accessToken, "alice")).toEqual(["Bob private schedule"]);
  const pending = await h.grants.start({ clientKind: "extension", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256", scheduleId: "one" });
  await h.grants.approve(pending.userCode, "alice", "approve");
  const ext = await h.grants.exchange(pending.deviceCode, verifier);
  await expect(read(ext.accessToken, "alice")).rejects.toMatchObject({ code: "insufficient_scope" });
});

test("HTTP refresh rotates, reuse revokes, and explicit revoke ends access", async () => {
  const h = setup();
  const first = await h.issue();
  const response = await h.routes.refresh(h.request({ refreshToken: first.refreshToken }));
  expect(response.status).toBe(200);
  const second = await response.json();
  expect((await h.routes.refresh(h.request({ refreshToken: first.refreshToken }))).status).toBe(401);
  await expect(h.grants.authenticate(second.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
  const another = await h.issue();
  expect((await h.routes.revoke(h.request({}, { authorization: `Bearer ${another.accessToken}` }))).status).toBe(200);
  await expect(h.grants.authenticate(another.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
});

test("invalid shapes and oversized bodies fail at the boundary", async () => {
  const h = setup();
  expect((await h.routes.start(h.request({ ...start, scopes: ["account:delete"] }))).status).toBe(400);
  expect((await h.routes.start(h.request({ ...start, padding: "a".repeat(5000) }))).status).toBe(413);
});
