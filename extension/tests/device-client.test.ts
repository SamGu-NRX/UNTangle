import { expect, test } from "bun:test";
import { deviceGrantStarted, deviceTokenResponse, startDeviceGrant } from "../../../packages/contracts/src/device-grant";
import { DeviceClient, GrantRevoked, SignInCancelled, SignInDenied, SignInExpired } from "../src/lib/device-client";
import { isTokenResponse } from "../src/shared/extension-api";
import { StudentError } from "../src/shared/student-error";
import type { FetchLike } from "../src/lib/planner-client";
import { fakeFetch, jsonResponse } from "./helpers";

const started = deviceGrantStarted.parse({
  deviceCode: "d".repeat(43),
  userCode: "ABCD2345",
  verificationUri: "http://127.0.0.1:3217/device",
  expiresIn: 600,
  interval: 5,
});
const tokens = deviceTokenResponse.parse({
  accessToken: "a".repeat(43),
  refreshToken: "r".repeat(43),
  tokenType: "Bearer",
  expiresIn: 300,
  scopes: ["schedule:read", "schedule:add-option"],
  grantId: "grant-1",
});

function makeClient(fetchImpl: FetchLike, panelOpen: () => boolean = () => true) {
  let now = 1_000_000;
  const opened: string[] = [];
  const waits: number[] = [];
  const client = new DeviceClient(fetchImpl, {
    openTab: url => opened.push(url),
    panelOpen,
    // The injected delay advances the fake clock, so expiry tests stay instant.
    delay: async ms => { waits.push(ms); now += ms; },
    now: () => now,
  });
  return { client, opened, waits };
}

test("start follows the contract, opens the approval page with the user code, and exchanges with S256", async () => {
  let challenge = "";
  const codes: string[] = [];
  const f = fakeFetch((index, request) => {
    expect(request.init?.credentials).toBe("omit");
    const body = JSON.parse(String(request.init?.body));
    if (index === 0) {
      // The start body must satisfy the contract's own schema, schedule id included.
      const parsed = startDeviceGrant.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.clientKind === "extension") {
        expect(parsed.data.scheduleId).toBe("main");
        challenge = parsed.data.codeChallenge;
      }
      expect(body).not.toHaveProperty("codeVerifier");
      return jsonResponse(started);
    }
    expect(body.deviceCode).toBe(started.deviceCode);
    // sha256(verifier), base64url, must equal the challenge sent at start.
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.codeVerifier)));
    const hash = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(hash).toBe(challenge);
    return jsonResponse(tokens);
  });
  const h = makeClient(f.fetchImpl);
  const result = await h.client.signIn({ scheduleId: "main", onUserCode: code => codes.push(code) });
  expect(result).toEqual(tokens);
  expect(codes).toEqual([started.userCode]);
  // The page is a normal tab on the server's own /device route, code in the query.
  expect(h.opened).toEqual(["http://127.0.0.1:3217/device?user_code=ABCD2345"]);
  expect(f.requests.map(r => new URL(r.url).pathname)).toEqual(["/api/v1/device/start", "/api/v1/device/token"]);
});

test("polling honours the server interval and backs off on slow_down", async () => {
  const f = fakeFetch(index => jsonResponse(index === 0 ? { error: "authorization_pending" } : index === 1 ? { error: "slow_down" } : index === 2 ? { error: "authorization_pending" } : tokens));
  const h = makeClient(f.fetchImpl);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).resolves.toEqual(tokens);
  expect(h.waits).toEqual([5000, 5000, 10000, 10000]);
});

test("a denied approval stops after one poll with the denied error", async () => {
  const f = fakeFetch(() => jsonResponse({ error: "access_denied" }, 400));
  const h = makeClient(f.fetchImpl);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toBeInstanceOf(SignInDenied);
  expect(f.requests.filter(r => new URL(r.url).pathname === "/api/v1/device/token")).toHaveLength(1);
});

test("polling stops at the deadline even while the server says pending", async () => {
  const expiring = deviceGrantStarted.parse({ ...started, expiresIn: 3, interval: 1 });
  const f = fakeFetch(index => jsonResponse(index === 0 ? expiring : { error: "authorization_pending" }, index === 0 ? 200 : 400));
  const h = makeClient(f.fetchImpl);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toBeInstanceOf(SignInExpired);
  expect(h.waits).toEqual([1000, 1000, 1000]);
  expect(f.requests.filter(r => new URL(r.url).pathname === "/api/v1/device/token")).toHaveLength(3);
});

test("a transport hiccup keeps polling until the deadline", async () => {
  const expiring = deviceGrantStarted.parse({ ...started, expiresIn: 3, interval: 1 });
  const f = fakeFetch(index => {
    if (index === 0)
      return jsonResponse(expiring);
    throw new Error("offline");
  });
  const h = makeClient(f.fetchImpl);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toBeInstanceOf(SignInExpired);
  expect(f.requests.filter(r => new URL(r.url).pathname === "/api/v1/device/token")).toHaveLength(3);
});

test("closing the trusted panel stops the poll", async () => {
  let open = true;
  const f = fakeFetch(index => {
    if (index === 1)
      open = false; // The panel closes while the first poll is in flight.
    return jsonResponse(index === 0 ? started : { error: "authorization_pending" }, index === 0 ? 200 : 400);
  });
  const h = makeClient(f.fetchImpl, () => open);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toBeInstanceOf(SignInCancelled);
  expect(f.requests.filter(r => new URL(r.url).pathname === "/api/v1/device/token")).toHaveLength(1);
});

test("a malformed token payload never signs in", async () => {
  expect(isTokenResponse(tokens)).toBe(true);
  expect(isTokenResponse({ ...tokens, accessToken: "short" })).toBe(false);
  expect(isTokenResponse({ ...tokens, tokenType: "bearer" })).toBe(false);
  expect(isTokenResponse({ ...tokens, scopes: ["documents:read"] })).toBe(false);
  const f = fakeFetch(index => jsonResponse(index === 0 ? started : { ...tokens, accessToken: "short" }));
  const h = makeClient(f.fetchImpl);
  await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toThrow("Invalid device grant response");
  expect(h.opened).toHaveLength(1); // The page opened, but no tokens were returned.
});

test("an approval page on another origin or path is never opened", async () => {
  for (const verificationUri of ["https://evil.test/device", "http://127.0.0.1:3217/device/approve", "http://127.0.0.1:3217/"]) {
    const f = fakeFetch(() => jsonResponse(deviceGrantStarted.parse({ ...started, verificationUri })));
    const h = makeClient(f.fetchImpl);
    await expect(h.client.signIn({ scheduleId: "main", onUserCode: () => { } })).rejects.toThrow("Untrusted verification URL");
    expect(h.opened).toHaveLength(0);
    expect(f.requests).toHaveLength(1);
  }
});

test("refresh sends only the refresh token, validates the pair, and maps a rejected grant to sign-out", async () => {
  const ok = fakeFetch(request => {
    expect(request.init?.credentials).toBe("omit");
    expect(JSON.parse(String(request.init?.body))).toEqual({ refreshToken: tokens.refreshToken });
    return jsonResponse(tokens);
  });
  await expect(makeClient(ok.fetchImpl).client.refresh(tokens.refreshToken)).resolves.toEqual(tokens);
  expect(ok.requests.map(r => new URL(r.url).pathname)).toEqual(["/api/v1/device/refresh"]);
  const reused = fakeFetch(() => jsonResponse({ error: "invalid_token" }, 401));
  await expect(makeClient(reused.fetchImpl).client.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(GrantRevoked);
  const down = fakeFetch(() => { throw new Error("offline"); });
  await expect(makeClient(down.fetchImpl).client.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(StudentError);
});

test("revoke presents the access token as a bearer credential and treats a dead grant as done", async () => {
  const f = fakeFetch(request => {
    expect(request.init?.method).toBe("POST");
    expect(request.init?.credentials).toBe("omit");
    expect(new Headers(request.init?.headers).get("Authorization")).toBe(`Bearer ${tokens.accessToken}`);
    return jsonResponse({ revoked: true });
  });
  await expect(makeClient(f.fetchImpl).client.revoke(tokens.accessToken)).resolves.toBeUndefined();
  const alreadyGone = fakeFetch(() => jsonResponse({ error: "invalid_token" }, 401));
  await expect(makeClient(alreadyGone.fetchImpl).client.revoke(tokens.accessToken)).resolves.toBeUndefined();
  const down = fakeFetch(() => jsonResponse({ error: "unavailable" }, 503));
  await expect(makeClient(down.fetchImpl).client.revoke(tokens.accessToken)).rejects.toBeInstanceOf(StudentError);
});
