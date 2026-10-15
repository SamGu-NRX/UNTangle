import { createAuth, type Auth } from "./auth-core";
import type { DeviceTokens } from "./device-api";
import type { StoredTokens, TokenStore } from "./secure-token-store";
import type { FetchLike } from "../data/http";

const START_200 = {
  deviceCode: "d".repeat(43),
  userCode: "ABCD2345",
  verificationUri: "http://localhost:3000/device",
  expiresIn: 600,
  interval: 5,
};
const TOKENS_A: DeviceTokens = {
  accessToken: "access-a".padEnd(43, "a"),
  refreshToken: "refresh-b".padEnd(43, "b"),
  tokenType: "Bearer",
  expiresIn: 300,
  scopes: ["documents:read", "documents:write"],
  grantId: "grant-1",
};
const TOKENS_B: DeviceTokens = {
  ...TOKENS_A,
  accessToken: "access-c".padEnd(43, "c"),
  refreshToken: "refresh-d".padEnd(43, "d"),
  grantId: "grant-1",
};
const SYNC_200 = [
  { documentId: "doc-1", kind: "schedule", revision: 1, deleted: false },
  { documentId: "doc-2", kind: "schedule", revision: 2, deleted: false },
];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => body } as unknown as Response;
}

type Step = { status: number; body: unknown } | { reject: string };

/**
 * The queue answers each call in order and, once empty, keeps answering with
 * authorization_pending so a poll loop never outruns its steps. Sleep yields a
 * real macrotask, so one loop iteration happens per macrotask tick and flush()
 * stays a deterministic bound.
 */
function queueFetch(steps: Step[]): { fetchLike: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const pending = () => jsonResponse({ error: "authorization_pending" }, 400);
  const fetchLike = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = steps.shift();
    if (!step) return pending();
    if ("reject" in step) throw new Error(step.reject);
    return jsonResponse(step.body, step.status);
  }) as unknown as FetchLike;
  return { fetchLike, calls };
}

function memoryStore() {
  let current: StoredTokens | null = null;
  const saved: StoredTokens[] = [];
  const store: TokenStore & { saved: StoredTokens[] } = {
    load: jest.fn(async () => current),
    save: jest.fn(async (tokens: StoredTokens) => {
      current = tokens;
      saved.push(tokens);
    }),
    clear: jest.fn(async () => {
      current = null;
    }),
    saved,
  };
  return store;
}

type Harness = {
  auth: Auth;
  store: ReturnType<typeof memoryStore>;
  calls: Array<{ url: string; init?: RequestInit }>;
  timers: Array<{ handler: () => void; ms: number; cleared: boolean }>;
  time: () => number;
  advance: (ms: number) => void;
};

function makeHarness(steps: Step[], overrides: Partial<Parameters<typeof createAuth>[0]> = {}): Harness {
  let time = 1_000_000;
  const { fetchLike, calls } = queueFetch(steps);
  const timers: Harness["timers"] = [];
  const store = memoryStore();
  const auth = createAuth({
    tokenStore: store,
    randomBytes: length => new Uint8Array(length).fill(7),
    sha256Base64Url: async () => "challenge".padEnd(43, "c"),
    fetchLike,
    now: () => time,
    sleep: async ms => {
      time += ms;
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    setTimer: (handler, ms) => {
      timers.push({ handler, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: handle => {
      const timer = timers[handle as number];
      if (timer) timer.cleared = true;
    },
    ...overrides,
  });
  return {
    auth,
    store,
    calls,
    timers,
    time: () => time,
    advance: ms => {
      time += ms;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

function waitFor(auth: Auth, status: "restoring" | "signed-out" | "awaiting-approval" | "signed-in"): Promise<void> {
  if (auth.getState().status === status) return Promise.resolve();
  return new Promise(resolve => {
    const unsubscribe = auth.subscribe(() => {
      if (auth.getState().status === status) {
        unsubscribe();
        resolve();
      }
    });
  });
}

const activeTokens = (): StoredTokens => ({
  version: 1,
  ...TOKENS_A,
  accessExpiresAt: 1_000_000 + 300_000,
});

describe("restore", () => {
  it("lands signed out when nothing is stored", async () => {
    const harness = makeHarness([]);
    await harness.auth.restore();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
  });

  it("lands signed in with a proactive refresh timer at the margin and loads the count", async () => {
    const harness = makeHarness([{ status: 200, body: SYNC_200 }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
    expect(harness.timers).toHaveLength(1);
    // 300s of life minus the 60s refresh margin.
    expect(harness.timers[0]?.ms).toBe(240_000);
  });

  it("offers the retry when the restored count load fails", async () => {
    const harness = makeHarness([{ status: 503, body: { error: "Abuse prevention unavailable. Try again later." } }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: null, countFailed: true });
  });

  it("lands signed out when the Keychain read throws", async () => {
    const harness = makeHarness([]);
    harness.store.load = jest.fn(async () => {
      throw new Error("Keychain unavailable");
    });
    await harness.auth.restore();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.calls).toHaveLength(0);
  });
});

describe("getAccessToken", () => {
  it("returns the live token without a refresh", async () => {
    const harness = makeHarness([{ status: 200, body: SYNC_200 }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_A.accessToken);
    // Only the restore's count read happened; the live token never refreshes.
    expect(harness.calls.filter(call => call.url.endsWith("/api/v1/device/refresh"))).toHaveLength(0);
  });

  it("returns null with no grant and makes no request", async () => {
    const harness = makeHarness([]);
    await harness.auth.restore();
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.calls).toHaveLength(0);
  });

  it("refreshes first inside the margin, once for overlapping callers", async () => {
    const stored = activeTokens();
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: TOKENS_B },
    ]);
    harness.store.load = jest.fn(async () => stored);
    await harness.auth.restore();
    await flush();
    harness.advance(300_000 - 30_000); // 30s left: inside the 60s margin.
    const [first, second] = await Promise.all([harness.auth.getAccessToken(), harness.auth.getAccessToken()]);
    expect(first).toBe(TOKENS_B.accessToken);
    expect(second).toBe(TOKENS_B.accessToken);
    const tokenCall = harness.calls.find(call => call.url.endsWith("/api/v1/device/refresh"));
    expect(JSON.parse(String(tokenCall?.init?.body))).toEqual({ refreshToken: TOKENS_A.refreshToken });
    expect(harness.store.saved).toHaveLength(1);
    expect(harness.store.saved[0]?.accessToken).toBe(TOKENS_B.accessToken);
    // A fresh proactive timer is scheduled for the new expiry.
    expect(harness.timers.filter(timer => !timer.cleared)).toHaveLength(1);
  });

  it("signs out and clears the Keychain when the refresh token is refused", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 400, body: { error: "invalid_token" } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.clear).toHaveBeenCalled();
  });

  it("keeps the grant when the refresh hits the rate limiter's real 429", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 429, body: { error: "Too many requests" } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
    // A backoff timer keeps the refresh alive when nothing else calls.
    expect(harness.timers.some(timer => timer.ms === 30_000 && !timer.cleared)).toBe(true);
  });

  it("keeps the grant when the refresh gets the limiter's 503", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 503, body: { error: "Abuse prevention unavailable. Try again later." } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
    expect(harness.timers.some(timer => timer.ms === 30_000 && !timer.cleared)).toBe(true);
  });

  it("recovers the grant once the limiter lets the refresh through", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 429, body: { error: "Too many requests" } },
      { status: 200, body: TOKENS_B },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_B.accessToken);
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
  });

  it("keeps the grant on a 401 whose body is not a grant refusal", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 401, body: { error: "unauthorized" } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
  });

  it("keeps the grant when the refresh fails on a network error", async () => {
    const harness = makeHarness([{ reject: "offline" }, { reject: "offline" }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
  });
});

describe("beginSignIn", () => {
  it("runs start, shows the code, stores the grant on approval, and counts documents", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: TOKENS_A },
      { status: 200, body: SYNC_200 },
    ]);
    await harness.auth.restore();
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    // The screen sees the code, the browser URI, and the deadline; the device
    // code and polling interval stay inside the auth module.
    expect(harness.auth.getState()).toEqual({
      status: "awaiting-approval",
      start: { userCode: "ABCD2345", verificationUri: "http://localhost:3000/device", expiresAt: 1_000_000 + 600_000 },
    });
    await expect(pending).resolves.toEqual({ ok: true });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
    expect(harness.store.saved).toHaveLength(1);
    expect(harness.store.saved[0]?.refreshToken).toBe(TOKENS_A.refreshToken);
    const startCall = harness.calls.find(call => call.url.endsWith("/api/v1/device/start"));
    const startBody = JSON.parse(String(startCall?.init?.body)) as Record<string, unknown>;
    expect(startBody.clientKind).toBe("mobile");
    const syncCall = harness.calls.find(call => call.url.endsWith("/api/v1/sync"));
    expect((syncCall?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKENS_A.accessToken}`);
  });

  it("surfaces a denial and signs out", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 400, body: { error: "access_denied" } },
    ]);
    await harness.auth.restore();
    await expect(harness.auth.beginSignIn()).resolves.toEqual({ ok: false, reason: "denied" });
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.save).not.toHaveBeenCalled();
  });

  it("surfaces an expiry after the deadline", async () => {
    // interval 5s, window 6s: two pending polls push the clock past the end.
    const harness = makeHarness([{ status: 200, body: { ...START_200, expiresIn: 6, interval: 5 } }]);
    await harness.auth.restore();
    await expect(harness.auth.beginSignIn()).resolves.toEqual({ ok: false, reason: "expired" });
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.save).not.toHaveBeenCalled();
  });

  it("refuses to start a second flow while one is waiting", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 400, body: { error: "authorization_pending" } },
    ]);
    await harness.auth.restore();
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(harness.auth.beginSignIn()).resolves.toEqual({ ok: false, reason: "failed", error: "not_signable" });
    harness.auth.cancelSignIn();
    await expect(first).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("drops an in-flight flow on cancel without storing anything", async () => {
    const harness = makeHarness([{ status: 200, body: START_200 }, { status: 400, body: { error: "authorization_pending" } }]);
    await harness.auth.restore();
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    harness.auth.cancelSignIn();
    await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.save).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("revokes with the bearer token, clears the Keychain, and signs out", async () => {
    const harness = makeHarness([{ status: 200, body: { revoked: true } }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await harness.auth.signOut();
    const revokeCall = harness.calls.find(call => call.url.endsWith("/api/v1/device/revoke"));
    expect((revokeCall?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKENS_A.accessToken}`);
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.timers.every(timer => timer.cleared)).toBe(true);
  });

  it("still clears the Keychain when the revoke cannot reach the server", async () => {
    const harness = makeHarness([{ reject: "offline" }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await harness.auth.signOut();
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
  });

  it("signs out locally when there is nothing to revoke", async () => {
    const harness = makeHarness([]);
    await harness.auth.restore();
    await harness.auth.signOut();
    expect(harness.calls).toHaveLength(0);
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
  });

  it("refreshes an expired access token first, then revokes with the live one", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: TOKENS_B },
      { status: 200, body: { revoked: true } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000); // the stored access token has expired
    await harness.auth.signOut();
    const revokeCall = harness.calls.find(call => call.url.endsWith("/api/v1/device/revoke"));
    expect((revokeCall?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKENS_B.accessToken}`);
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    // No timer outlives the sign-out, including the one the refresh scheduled.
    expect(harness.timers.every(timer => timer.cleared)).toBe(true);
  });

  it("saves nothing when a refresh resolves after sign-out", async () => {
    let releaseRefresh: () => void = () => {};
    const gated = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) {
        await gated;
        return jsonResponse(TOKENS_B, 200);
      }
      return jsonResponse({ revoked: true }, 200);
    };
    const harness = makeHarness([], { fetchLike });
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    // A refresh starts at the margin and is held in flight.
    harness.advance(250_000);
    harness.timers[0]?.handler();
    await flush();
    // The world moves on while it flies: a fresh grant comes back from the
    // Keychain, so sign-out takes the live-token path without waiting.
    harness.store.load = jest.fn(async () => ({ ...activeTokens(), accessExpiresAt: harness.time() + 300_000 }));
    await harness.auth.restore();
    await harness.auth.signOut();
    expect(harness.store.clear).toHaveBeenCalledTimes(1);
    // The stranded refresh lands afterwards and must save nothing.
    releaseRefresh();
    await flush();
    expect(harness.store.saved).toHaveLength(0);
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
  });
});

describe("document count", () => {
  it("counts only entries with deleted false", async () => {
    const withTombstone = [
      { documentId: "doc-1", kind: "schedule", revision: 1, deleted: false },
      { documentId: "doc-2", kind: "schedule", revision: 2, deleted: true },
      { documentId: "doc-3", kind: "schedule", revision: 3, deleted: false },
    ];
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 200, body: withTombstone },
    ]);
    await harness.auth.restore();
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(pending).resolves.toEqual({ ok: true });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
  });

  it("offers the retry after a failed load and clears it when a retry lands", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 429, body: { error: "Too many requests" } },
      { status: 200, body: SYNC_200 },
    ]);
    await harness.auth.restore();
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(pending).resolves.toEqual({ ok: true });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: null, countFailed: true });
    await harness.auth.refreshDocumentCount();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
  });
});

describe("token containment", () => {
  it("keeps tokens out of app state and puts both in the Keychain envelope", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 200, body: SYNC_200 },
    ]);
    await harness.auth.restore();
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(pending).resolves.toEqual({ ok: true });
    await flush();
    const stateJson = JSON.stringify(harness.auth.getState());
    expect(stateJson).not.toContain(TOKENS_A.accessToken);
    expect(stateJson).not.toContain(TOKENS_A.refreshToken);
    expect(harness.store.saved).toHaveLength(1);
    expect(harness.store.saved[0]?.accessToken).toBe(TOKENS_A.accessToken);
    expect(harness.store.saved[0]?.refreshToken).toBe(TOKENS_A.refreshToken);
    // API traffic carries only the short-lived access token, never the refresh token.
    for (const call of harness.calls) {
      if (call.url.endsWith("/api/v1/device/token")) continue;
      const headers = (call.init?.headers as Record<string, string> | undefined) ?? {};
      if (headers.Authorization) expect(headers.Authorization).not.toContain(TOKENS_A.refreshToken);
    }
  });
});
