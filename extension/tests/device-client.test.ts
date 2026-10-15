import { expect, test } from "bun:test";
import { DeviceClient } from "../src/lib/device-client";
import { fakeFetch, jsonResponse } from "./helpers";
const redirectUri = "https://extension-id.chromiumapp.org/device";
test("S256 binds the code exchange to the verifier and exact callback state", async () => {
  let state = "";
  let challenge = "";
  const f = fakeFetch((index, request) => {
    expect(request.init?.credentials).toBe("omit");
    const body = JSON.parse(String(request.init?.body));
    if (index === 0) {
      state = body.state;
      challenge = body.codeChallenge;
      expect(body.kind).toBe("extension");
      expect(body.redirectUri).toBe(redirectUri);
      expect(body.codeChallengeMethod).toBe("S256");
      expect(body).not.toHaveProperty("codeVerifier");
      return jsonResponse({ authorizationUrl: "http://127.0.0.1:3217/device/approve" });
    }
    const hash = new Bun.CryptoHasher("sha256").update(body.codeVerifier).digest("base64url");
    expect(hash).toBe(challenge);
    expect(body.code).toBe("one-time-code");
    return jsonResponse({ accessToken: "device-token", grantId: "grant-1", accountId: "account-a", expiresAt: Date.now() + 60000 });
  });
  const client = new DeviceClient(f.fetchImpl, { redirectUri, launch: async () => `${redirectUri}?state=${state}&code=one-time-code` });
  expect((await client.signIn()).accessToken).toBe("device-token");
  expect(f.requests.map(r => new URL(r.url).pathname)).toEqual(["/api/v1/devices/authorize", "/api/v1/devices/token"]);
});
test("wrong state or callback origin never exchanges a code", async () => {
  for (const returned of [`${redirectUri}?state=forged&code=code`, "https://evil.test/device?state=forged&code=code"]) {
    const f = fakeFetch(() => jsonResponse({ authorizationUrl: "http://127.0.0.1:3217/device/approve" }));
    await expect(new DeviceClient(f.fetchImpl, { redirectUri, launch: async () => returned }).signIn()).rejects.toThrow("Invalid sign-in");
    expect(f.requests).toHaveLength(1);
  }
});
test("authorization cannot navigate to an untrusted origin", async () => {
  let launched = false;
  const f = fakeFetch(() => jsonResponse({ authorizationUrl: "https://evil.test/approval" }));
  await expect(new DeviceClient(f.fetchImpl, { redirectUri, launch: async () => { launched = true; return redirectUri; } }).signIn()).rejects.toThrow("Untrusted authorization");
  expect(launched).toBe(false);
});
