import { beginDeviceSignIn, pollForToken } from "./device-flow";
import type { FetchLike } from "../data/http";

const VERIFIER = "v".repeat(43);
const CHALLENGE = "c".repeat(43);
const TOKEN_200 = {
  accessToken: "a".repeat(43),
  refreshToken: "b".repeat(43),
  tokenType: "Bearer",
  expiresIn: 300,
  scopes: ["documents:read", "documents:write"],
  grantId: "grant-1",
};
const START_200 = {
  deviceCode: "d".repeat(43),
  userCode: "ABCD2345",
  verificationUri: "http://localhost:3000/device",
  expiresIn: 600,
  interval: 5,
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => body } as unknown as Response;
}

function queueFetch(responses: Array<Response | Error>): { fetchLike: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchLike = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("The test ran out of queued responses.");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as FetchLike;
  return { fetchLike, calls };
}

const noSleep = async () => {};
const fixedNow = () => 1_000_000;

describe("beginDeviceSignIn", () => {
  it("posts clientKind mobile with an S256 challenge of the server's shape", async () => {
    const { fetchLike, calls } = queueFetch([jsonResponse(START_200)]);
    const result = await beginDeviceSignIn({
      fetchLike,
      randomBytes: length => new Uint8Array(length).fill(9),
      sha256Base64Url: async () => CHALLENGE,
      now: fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.start.userCode).toBe("ABCD2345");
    expect(result.start.verificationUri).toBe("http://localhost:3000/device");
    expect(result.start.expiresAt).toBe(1_000_000 + 600_000);
    expect(result.intervalSeconds).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:3000/api/v1/device/start");
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.clientKind).toBe("mobile");
    expect(body.codeChallengeMethod).toBe("S256");
    expect(body.codeChallenge).toBe(CHALLENGE);
  });

  it("keeps the verifier in the result and never puts it in the request", async () => {
    const { fetchLike, calls } = queueFetch([jsonResponse(START_200)]);
    const result = await beginDeviceSignIn({
      fetchLike,
      randomBytes: length => new Uint8Array(length).fill(1),
      sha256Base64Url: async () => CHALLENGE,
    });
    if (!result.ok) throw new Error("beginDeviceSignIn failed");
    expect(result.verifier).toHaveLength(43);
    expect(String(calls[0]?.init?.body)).not.toContain(result.verifier);
  });

  it("fails with a typed error when the response does not match the contract", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ deviceCode: "too-short" })]);
    const result = await beginDeviceSignIn({
      fetchLike,
      randomBytes: length => new Uint8Array(length),
      sha256Base64Url: async () => CHALLENGE,
    });
    expect(result).toEqual({ ok: false, error: "invalid_request", message: expect.any(String) });
  });

  it("maps a network failure to a typed failure instead of throwing", async () => {
    const { fetchLike } = queueFetch([new Error("offline")]);
    const result = await beginDeviceSignIn({
      fetchLike,
      randomBytes: length => new Uint8Array(length),
      sha256Base64Url: async () => CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("network");
  });
});

describe("pollForToken", () => {
  const base = { deviceCode: "d".repeat(43), verifier: VERIFIER, intervalSeconds: 5, expiresAt: fixedNow() + 600_000, now: fixedNow, sleep: noSleep };

  it("waits through authorization_pending on the server's interval and returns the tokens", async () => {
    const { fetchLike, calls } = queueFetch([
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse(TOKEN_200),
    ]);
    const result = await pollForToken({ ...base, fetchLike });
    expect(result).toEqual({ ok: true, tokens: TOKEN_200 });
    const tokenCall = calls.find(call => call.url.endsWith("/api/v1/device/token"));
    const tokenBody = JSON.parse(String(tokenCall?.init?.body)) as Record<string, unknown>;
    expect(tokenBody.deviceCode).toBe("d".repeat(43));
    expect(tokenBody.codeVerifier).toBe(VERIFIER);
  });

  it("returns denied on access_denied", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ error: "access_denied" }, 400)]);
    const result = await pollForToken({ ...base, fetchLike });
    expect(result).toEqual({ ok: false, reason: "denied" });
  });

  it("returns expired on expired_token", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ error: "expired_token" }, 400)]);
    const result = await pollForToken({ ...base, fetchLike });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("returns expired when the local deadline passes without approval", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ error: "authorization_pending" }, 400)]);
    const result = await pollForToken({ ...base, fetchLike, expiresAt: fixedNow() - 1 });
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it("backs off permanently after slow_down and keeps polling", async () => {
    const { fetchLike, calls } = queueFetch([
      jsonResponse({ error: "slow_down" }, 400),
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse(TOKEN_200),
    ]);
    const waits: number[] = [];
    const result = await pollForToken({ ...base, fetchLike, sleep: async ms => void waits.push(ms) });
    expect(result).toEqual({ ok: true, tokens: TOKEN_200 });
    expect(waits).toEqual([10_000, 10_000]);
    expect(calls).toHaveLength(3);
  });

  it("treats rate_limited as a slow-down signal", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ error: "rate_limited" }, 429), jsonResponse(TOKEN_200)]);
    const waits: number[] = [];
    const result = await pollForToken({ ...base, fetchLike, sleep: async ms => void waits.push(ms) });
    expect(result).toEqual({ ok: true, tokens: TOKEN_200 });
    expect(waits).toEqual([10_000]);
  });

  it("retries through network failures and unavailable servers", async () => {
    const { fetchLike } = queueFetch([new Error("offline"), jsonResponse({ error: "unavailable" }, 503), jsonResponse(TOKEN_200)]);
    const result = await pollForToken({ ...base, fetchLike });
    expect(result).toEqual({ ok: true, tokens: TOKEN_200 });
  });

  it("stops on refusals the flow cannot recover from", async () => {
    const { fetchLike } = queueFetch([jsonResponse({ error: "invalid_grant" }, 400)]);
    const result = await pollForToken({ ...base, fetchLike });
    expect(result).toEqual({ ok: false, reason: "failed", error: "invalid_grant" });
  });

  it("stops immediately when the caller cancels", async () => {
    const { fetchLike } = queueFetch([]);
    const result = await pollForToken({ ...base, fetchLike, shouldContinue: () => false });
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(fetchLike).not.toHaveBeenCalled();
  });
});
