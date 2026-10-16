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
/** A different grant: re-sign-in replaces the grant, not just the tokens. */
const TOKENS_GRANT_TWO: DeviceTokens = {
  ...TOKENS_A,
  accessToken: "access-e".padEnd(43, "e"),
  refreshToken: "refresh-f".padEnd(43, "f"),
  grantId: "grant-2",
};
const SYNC_200 = [
  { documentId: "doc-1", kind: "schedule", revision: 1, deleted: false },
  { documentId: "doc-2", kind: "schedule", revision: 2, deleted: false },
];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => body } as unknown as Response;
}

type Step = { status: number; body: unknown } | { reject: string } | { malformed: true };

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
    if ("malformed" in step) {
      // A 200 whose body is not JSON at all: response.json() rejects, and
      // device-api reports the failed guard as invalid_request with a 200.
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => {
          throw new Error("Unexpected token 'n' in JSON");
        },
      } as unknown as Response;
    }
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
    // The grant is lost, so nothing may reschedule behind it.
    expect(harness.timers.every(timer => timer.cleared)).toBe(true);
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

describe("token-store failures during refresh and sign-out", () => {
  it("lands signed out with no unhandled rejection when a timer-driven refresh cannot save", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: TOKENS_B },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    harness.store.save = jest.fn(async () => {
      throw new Error("Keychain write failed");
    });
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    // The refresh fires from the timer's fire-and-forget call: a save
    // rejection escaping there would be an unhandled rejection, and this
    // test fails if one is reported.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      harness.timers[0]?.handler();
      await waitFor(harness.auth, "signed-out");
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    // The rotated tokens exist only in memory (the save failed) and the
    // server has consumed the old refresh token, so the only safe state is
    // signed out with the Keychain cleared.
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.clear).toHaveBeenCalled();
    // Only the fired proactive timer exists: the failure path schedules
    // nothing new behind the sign-out.
    expect(harness.timers).toHaveLength(1);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
  });

  it("resolves signOut without throwing when the refresh inside it cannot save", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: TOKENS_B },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.store.save = jest.fn(async () => {
      throw new Error("Keychain write failed");
    });
    harness.advance(300_000); // the stored access token has expired
    // signOut awaits getAccessToken, which refreshes first: the failed save
    // must land signed out instead of rejecting through signOut.
    await expect(harness.auth.signOut()).resolves.toBeUndefined();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
  });

  it("schedules the 30s backoff when a 200 refresh response is not valid JSON", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { malformed: true },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    // The grant is not lost: the state stays signed in, the tokens are
    // untouched, and the spent timer is replaced by the retry backoff.
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
    expect(harness.store.saved).toHaveLength(0);
    expect(harness.timers.some(timer => timer.ms === 30_000 && !timer.cleared)).toBe(true);
  });

  it("schedules the 30s backoff when a 200 refresh body fails the token guard", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: {} },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.auth.getState().status).toBe("signed-in");
    expect(harness.store.clear).not.toHaveBeenCalled();
    expect(harness.store.saved).toHaveLength(0);
    expect(harness.timers.some(timer => timer.ms === 30_000 && !timer.cleared)).toBe(true);
  });

  it("still signs out when the Keychain clear rejects during sign-out", async () => {
    const harness = makeHarness([{ status: 200, body: { revoked: true } }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    harness.store.clear = jest.fn(async () => {
      throw new Error("Keychain clear failed");
    });
    await expect(harness.auth.signOut()).resolves.toBeUndefined();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    // No in-memory grant survives, and the revoke was still attempted.
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.calls.some(call => call.url.endsWith("/api/v1/device/revoke"))).toBe(true);
  });

  it("still signs out when the Keychain clear rejects during a refused refresh", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 401, body: { error: "invalid_token" } },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.store.clear = jest.fn(async () => {
      throw new Error("Keychain clear failed");
    });
    harness.advance(300_000);
    // handleGrantLost's clear rejection must not escape through the awaited
    // refresh or an unhandled rejection.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(harness.auth.getAccessToken()).resolves.toBeNull();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
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

  it("stays signed out when the Keychain save lands after cancelSignIn", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSave: () => void = () => {};
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
    ]);
    await harness.auth.restore();
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveEntered();
      await saveGate;
      await workingSave(tokens);
    });
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight; // the exchange succeeded and the Keychain write is parked
    // The student backs out while the write is in flight: when the stranded
    // write resolves, the cancelled flow must not resurrect.
    harness.auth.cancelSignIn();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      releaseSave();
      await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(await harness.store.load()).toBeNull();
    // One save went out and the cancelled flow's own clear is the only
    // durable cleanup; nothing may be scheduled behind it.
    expect(harness.store.save).toHaveBeenCalledTimes(1);
    expect(harness.store.clear).toHaveBeenCalledTimes(1);
    expect(harness.timers).toHaveLength(0);
    expect(harness.calls.some(call => call.url.endsWith("/api/v1/sync"))).toBe(false);
  });

  it("keeps the cancelled grant out of getAccessToken while the Keychain save is pending", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSave: () => void = () => {};
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
    ]);
    await harness.auth.restore();
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveEntered();
      await saveGate;
      await workingSave(tokens);
    });
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight; // the exchange succeeded and the Keychain write is parked
    // The grant belongs to the Keychain first: while the write pends,
    // nothing is live in memory — before or after the student backs out.
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    harness.auth.cancelSignIn();
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      releaseSave();
      await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(await harness.store.load()).toBeNull();
  });

  it("lands signed out with a retryable failure when the Keychain save rejects", async () => {
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 200, body: SYNC_200 },
    ]);
    await harness.auth.restore();
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error("Keychain write failed");
      await workingSave(tokens);
    });
    // The exchange succeeds and the Keychain write does not: beginSignIn must
    // resolve with a retryable failure instead of throwing with an
    // un-persisted grant left live in memory.
    await expect(harness.auth.beginSignIn()).resolves.toEqual({ ok: false, reason: "failed", error: "storage_failed" });
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.timers).toHaveLength(0);
    // A retry once the store recovers succeeds end to end.
    await expect(harness.auth.beginSignIn()).resolves.toEqual({ ok: true });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
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

  it("stays signed out when the sign-in's Keychain save lands after signOut", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSave: () => void = () => {};
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
      { status: 200, body: { revoked: true } },
    ]);
    await harness.auth.restore();
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveEntered();
      await saveGate;
      await workingSave(tokens);
    });
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight;
    // Sign-out runs while the sign-in's Keychain write is parked: the write
    // resolving afterwards must not sign the phone back in.
    await harness.auth.signOut();
    releaseSave();
    await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(await harness.store.load()).toBeNull();
    // signOut's own clear plus the stranded apply's durable cleanup.
    expect(harness.store.clear).toHaveBeenCalledTimes(2);
    expect(harness.timers).toHaveLength(0);
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

describe("grant identity", () => {
  const list = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ documentId: `doc-${i + 1}`, kind: "schedule", revision: 1, deleted: false }));

  /**
   * Answers the device endpoints immediately and parks each count read on its
   * own gate, so the world can move on before an answer lands. `entered[i]`
   * resolves when read i is in flight; `release[i]` lets its answer through.
   * The token endpoint grants A first, then B.
   */
  function gatedSyncFetch(syncResponses: Array<{ status: number; body: unknown }>): {
    fetchLike: FetchLike;
    entered: Array<Promise<void>>;
    release: Array<() => void>;
  } {
    const entered: Array<Promise<void>> = [];
    const enteredResolvers: Array<() => void> = [];
    const release: Array<() => void> = [];
    const released: Array<Promise<void>> = [];
    for (let i = 0; i < syncResponses.length; i += 1) {
      entered.push(new Promise<void>(resolve => enteredResolvers.push(resolve)));
      released.push(new Promise<void>(resolve => release.push(resolve)));
    }
    let tokenCalls = 0;
    let syncCalls = 0;
    const grants = [TOKENS_A, TOKENS_GRANT_TWO];
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/start")) return jsonResponse(START_200, 200);
      if (url.endsWith("/api/v1/device/token")) {
        const grant = grants[Math.min(tokenCalls, grants.length - 1)];
        tokenCalls += 1;
        return jsonResponse(grant, 200);
      }
      if (url.endsWith("/api/v1/sync")) {
        const step = syncResponses[syncCalls] ?? { status: 200, body: [] };
        const index = syncCalls;
        syncCalls += 1;
        enteredResolvers[index]?.();
        if (index < released.length) await released[index];
        return jsonResponse(step.body, step.status);
      }
      return jsonResponse({ revoked: true }, 200);
    };
    return { fetchLike, entered, release };
  }

  it("applies nothing to the new grant when a stale count lands after re-sign-in", async () => {
    const { fetchLike, entered, release } = gatedSyncFetch([
      { status: 200, body: list(2) }, // grant A's answer, held in flight
      { status: 200, body: list(5) }, // grant B's own answer
    ]);
    const harness = makeHarness([], { fetchLike });
    await harness.auth.restore();
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(first).resolves.toEqual({ ok: true });
    await entered[0];
    // The world moves on while A's count flies: sign out, sign in as grant B.
    await harness.auth.signOut();
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(second).resolves.toEqual({ ok: true });
    await entered[1];
    // A's stale answer resolves into B's session and must not touch it.
    release[0]();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: null, countFailed: false });
    // B's own answer still lands normally.
    release[1]();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
  });

  it("does not clear the new grant when the old grant's 401 lands after re-sign-in", async () => {
    const { fetchLike, entered, release } = gatedSyncFetch([
      { status: 401, body: { error: "unauthorized" } }, // grant A's stale answer
      { status: 200, body: list(5) },
    ]);
    const harness = makeHarness([], { fetchLike });
    await harness.auth.restore();
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(first).resolves.toEqual({ ok: true });
    await entered[0];
    await harness.auth.signOut();
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await expect(second).resolves.toEqual({ ok: true });
    await entered[1];
    // The 401 names a grant this phone replaced: it may not sign B out.
    release[0]();
    await flush();
    expect(harness.store.clear).toHaveBeenCalledTimes(1); // sign-out's own clear
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: null, countFailed: false });
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
    release[1]();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
    expect(harness.store.clear).toHaveBeenCalledTimes(1);
  });

  it("still signs out when the count load gets a 401 for the active grant", async () => {
    const harness = makeHarness([{ status: 401, body: { error: "unauthorized" } }]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    // The same grant is still active, so the 401 means the grant is gone.
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.store.clear).toHaveBeenCalled();
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
  });

  it("loads the count even when the read triggers its own refresh", async () => {
    const harness = makeHarness([
      { status: 200, body: SYNC_200 }, // restore's count read
      { status: 200, body: TOKENS_B }, // the retry refreshes: same grant, rotated tokens
      { status: 200, body: list(7) },
    ]);
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    harness.advance(300_000 - 30_000); // inside the refresh margin
    await harness.auth.refreshDocumentCount();
    // The refresh rotates the tokens object for the same grant; the guard is
    // grant identity, not object identity, so the count still lands.
    expect(harness.store.saved[0]?.accessToken).toBe(TOKENS_B.accessToken);
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-1", scopes: TOKENS_A.scopes, documentCount: 7, countFailed: false });
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

describe("stale cleanup", () => {
  const list = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ documentId: `doc-${i + 1}`, kind: "schedule", revision: 1, deleted: false }));

  it("does not let a stale grant-loss cleanup erase a newer grant or return the UI to signed-out", async () => {
    let releaseSync: () => void = () => {};
    const syncGate = new Promise<void>(resolve => {
      releaseSync = resolve;
    });
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSave: () => void = () => {};
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    // Both clear calls stall on their own gate: the first belongs to
    // handleGrantLost (released last, after a newer grant is live), the
    // second to signOut (released first, so signed-out publishes and a new
    // sign-in becomes possible).
    const clearLanded: Array<Promise<void>> = [];
    const clearResolvers: Array<() => void> = [];
    const clearGates: Array<Promise<void>> = [];
    const clearReleases: Array<() => void> = [];
    for (let i = 0; i < 2; i += 1) {
      clearLanded.push(new Promise<void>(resolve => clearResolvers.push(resolve)));
      clearGates.push(new Promise<void>(resolve => clearReleases.push(resolve)));
    }
    let syncCalls = 0;
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/start")) return jsonResponse(START_200, 200);
      if (url.endsWith("/api/v1/device/token")) return jsonResponse(TOKENS_GRANT_TWO, 200);
      if (url.endsWith("/api/v1/sync")) {
        const index = syncCalls;
        syncCalls += 1;
        if (index === 0) {
          await syncGate;
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        return jsonResponse(list(5), 200);
      }
      return jsonResponse({ revoked: true }, 200);
    };
    const harness = makeHarness([], { fetchLike });
    // restore() needs a persisted grant to find; the real loader answers the
    // persisted-content assertions at the end of the test.
    const realLoad = harness.store.load;
    harness.store.load = jest.fn(async () => activeTokens());
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        saveEntered();
        await saveGate;
      }
      await workingSave(tokens);
    });
    let clearCount = 0;
    const workingClear = harness.store.clear;
    harness.store.clear = jest.fn(async () => {
      const index = clearCount;
      clearCount += 1;
      clearResolvers[index]?.();
      if (index < clearGates.length) await clearGates[index];
      await workingClear();
    });
    await harness.auth.restore();
    harness.store.load = realLoad;
    // The count read answers 401 for the live grant: handleGrantLost starts
    // and stalls on its Keychain clear.
    releaseSync();
    await clearLanded[0];
    // Sign-out runs concurrently and stalls on its own clear.
    const signingOut = harness.auth.signOut();
    await clearLanded[1];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // signOut's clear resolves first: it publishes signed-out, which
      // admits a full new sign-in while the grant-loss clear still pends.
      clearReleases[1]?.();
      await signingOut;
      expect(harness.auth.getState()).toEqual({ status: "signed-out" });
      const second = harness.auth.beginSignIn();
      await waitFor(harness.auth, "awaiting-approval");
      await saveInFlight; // grant-2's Keychain write is parked
      releaseSave();
      await expect(second).resolves.toEqual({ ok: true });
      await flush();
      expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
      // The stalled grant-loss clear finally resolves: it must not return
      // the UI to signed-out, and the repair re-save must restore the new
      // grant's Keychain entry.
      clearReleases[0]?.();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
    const persisted = await harness.store.load();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
  });

  it("does not let a stalled sign-out clear erase a newer grant or return the UI to signed-out", async () => {
    let releaseSync: () => void = () => {};
    const syncGate = new Promise<void>(resolve => {
      releaseSync = resolve;
    });
    let refreshEntered: () => void = () => {};
    const refreshInFlight = new Promise<void>(resolve => {
      refreshEntered = resolve;
    });
    let releaseRefresh: () => void = () => {};
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let secondClearEntered: () => void = () => {};
    const secondClearInFlight = new Promise<void>(resolve => {
      secondClearEntered = resolve;
    });
    let releaseSecondClear: () => void = () => {};
    const secondClearGate = new Promise<void>(resolve => {
      releaseSecondClear = resolve;
    });
    let syncCalls = 0;
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/start")) return jsonResponse(START_200, 200);
      if (url.endsWith("/api/v1/device/token")) return jsonResponse(TOKENS_GRANT_TWO, 200);
      if (url.endsWith("/api/v1/device/refresh")) {
        refreshEntered();
        await refreshGate;
        return jsonResponse({ error: "invalid_token" }, 400);
      }
      if (url.endsWith("/api/v1/sync")) {
        const index = syncCalls;
        syncCalls += 1;
        if (index === 0) {
          await syncGate;
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        return jsonResponse(list(5), 200);
      }
      return jsonResponse({ revoked: true }, 200);
    };
    const harness = makeHarness([], { fetchLike });
    // Same loader split as the grant-loss variant above.
    const realLoad = harness.store.load;
    harness.store.load = jest.fn(async () => activeTokens());
    // handleGrantLost's clear resolves normally; signOut's clear stalls.
    let clearCount = 0;
    const workingClear = harness.store.clear;
    harness.store.clear = jest.fn(async () => {
      clearCount += 1;
      if (clearCount === 2) {
        secondClearEntered();
        await secondClearGate;
      }
      await workingClear();
    });
    await harness.auth.restore();
    harness.store.load = realLoad;
    await flush(); // the count read parks on its gate
    harness.advance(300_000); // past the refresh margin
    harness.timers[0]?.handler(); // the proactive refresh parks on its gate
    await refreshInFlight;
    // Sign-out joins the in-flight refresh and parks behind it.
    const signingOut = harness.auth.signOut();
    await flush();
    // The 401 lands for the still-live grant: handleGrantLost clears and
    // publishes signed-out mid-sign-out.
    releaseSync();
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    // The refused refresh resumes into the grant-identity guard and touches
    // nothing; signOut proceeds to its own clear, which stalls.
    releaseRefresh();
    await secondClearInFlight;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // A full new sign-in completes while signOut's clear is stalled.
      const second = harness.auth.beginSignIn();
      await waitFor(harness.auth, "awaiting-approval");
      await expect(second).resolves.toEqual({ ok: true });
      await flush();
      expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
      // The stalled sign-out clear resolves into a moved generation: it must
      // not return the UI to signed-out, and the repair re-save must restore
      // the new grant's Keychain entry.
      releaseSecondClear();
      await signingOut;
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 5, countFailed: false });
    const persisted = await harness.store.load();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
  });

  it("keeps a newer grant's Keychain entry when a cancelled flow's slow save resolves after it", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSlowSave: () => void = () => {};
    const slowSaveGate = new Promise<void>(resolve => {
      releaseSlowSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 }, // flow A: start
      { status: 200, body: TOKENS_A }, // flow A: exchange, its save parks below
      { status: 200, body: START_200 }, // flow B: start
      { status: 200, body: TOKENS_GRANT_TWO }, // flow B: exchange
      { status: 200, body: SYNC_200 }, // flow B's count read
    ]);
    await harness.auth.restore();
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        saveEntered();
        await slowSaveGate;
      }
      await workingSave(tokens);
    });
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight; // flow A's Keychain write is parked mid-save
    harness.auth.cancelSignIn();
    // The world moves on while flow A's write is slow: a newer sign-in starts
    // and its grant is the one the phone lives on now. The flush lets flow B
    // finish whatever the store lets it finish before flow A's write lands.
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await flush();
    releaseSlowSave();
    await expect(first).resolves.toEqual({ ok: false, reason: "cancelled" });
    await expect(second).resolves.toEqual({ ok: true });
    await flush();
    // The UI stays signed in as the newer grant, in memory ...
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
    // ... and on disk: the cancelled flow's cleanup must not have erased the
    // newer grant's Keychain entry, or the session dies at the next restart.
    const persisted = await harness.store.load();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
  });

  it("still cleans the store when a plain cancel has no newer sign-in behind it", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSlowSave: () => void = () => {};
    const slowSaveGate = new Promise<void>(resolve => {
      releaseSlowSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 },
      { status: 200, body: TOKENS_A },
    ]);
    await harness.auth.restore();
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        saveEntered();
        await slowSaveGate;
      }
      await workingSave(tokens);
    });
    const pending = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight;
    harness.auth.cancelSignIn();
    releaseSlowSave();
    await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
    await flush();
    // The grant-identity guard must stay a cleanup: with no newer grant to
    // protect, the cancelled flow's stray entry is still wiped and nothing
    // is live behind it.
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(await harness.store.load()).toBeNull();
    expect(harness.store.save).toHaveBeenCalledTimes(1);
    expect(harness.store.clear).toHaveBeenCalledTimes(1);
    expect(harness.timers).toHaveLength(0);
  });

  it("lands a save injected mid-cleanup after the whole conditional-clear unit", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseSlowSave: () => void = () => {};
    const slowSaveGate = new Promise<void>(resolve => {
      releaseSlowSave = resolve;
    });
    let clearEntered: () => void = () => {};
    const clearInFlight = new Promise<void>(resolve => {
      clearEntered = resolve;
    });
    let releaseStaleClear: () => void = () => {};
    const staleClearGate = new Promise<void>(resolve => {
      releaseStaleClear = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 }, // flow A: start
      { status: 200, body: TOKENS_A }, // flow A: exchange, its save parks below
      { status: 200, body: START_200 }, // flow B: start
      { status: 200, body: TOKENS_GRANT_TWO }, // flow B: exchange
      { status: 200, body: SYNC_200 }, // flow B's count read
    ]);
    await harness.auth.restore();
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        saveEntered();
        await slowSaveGate;
      }
      await workingSave(tokens);
    });
    // The stale cleanup's clear parks before its erase lands: the wipe takes
    // effect when the gate releases, so a write that beats it survives and a
    // write it overtakes does not. That completion-time erase is the race.
    let clearCalls = 0;
    const workingClear = harness.store.clear;
    harness.store.clear = jest.fn(async () => {
      clearCalls += 1;
      if (clearCalls === 1) {
        clearEntered();
        await staleClearGate;
      }
      await workingClear();
    });
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight;
    harness.auth.cancelSignIn();
    releaseSlowSave();
    await clearInFlight; // the stale cleanup is parked between read-back and clear
    // A newer sign-in starts while the cleanup's clear is still in flight: its
    // save joins the durable writes behind the whole conditional-clear unit.
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await flush();
    releaseStaleClear();
    await expect(first).resolves.toEqual({ ok: false, reason: "cancelled" });
    await expect(second).resolves.toEqual({ ok: true });
    await flush();
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
    // The injected save survived: it landed after the whole cleanup unit, so
    // the newer grant's Keychain entry outlives the stale flow's erase.
    const persisted = await harness.store.load();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
  });

  it("skips the failed-save clear when a newer grant already owns the store", async () => {
    let saveEntered: () => void = () => {};
    const saveInFlight = new Promise<void>(resolve => {
      saveEntered = resolve;
    });
    let releaseFailedSave: () => void = () => {};
    const failedSaveGate = new Promise<void>(resolve => {
      releaseFailedSave = resolve;
    });
    const harness = makeHarness([
      { status: 200, body: START_200 }, // flow A: start
      { status: 200, body: TOKENS_A }, // flow A: exchange, its save fails below
      { status: 200, body: START_200 }, // flow B: start
      { status: 200, body: TOKENS_GRANT_TWO }, // flow B: exchange
      { status: 200, body: SYNC_200 }, // flow B's count read
    ]);
    await harness.auth.restore();
    let saveCalls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        saveEntered();
        await failedSaveGate;
        throw new Error("Keychain write failed");
      }
      await workingSave(tokens);
    });
    const first = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await saveInFlight; // flow A's Keychain write is parked mid-save
    harness.auth.cancelSignIn();
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await flush(); // flow B finishes everything the store lets it finish
    // Flow A's slow write fails now: applyTokens' defensive clear fires while
    // the newer grant is the durable world, not just the in-memory one.
    releaseFailedSave();
    await expect(first).resolves.toEqual({ ok: false, reason: "failed", error: "storage_failed" });
    await expect(second).resolves.toEqual({ ok: true });
    await flush();
    // The newer grant's Keychain entry survives the failed-save cleanup.
    const persisted = await harness.store.load();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
  });
});


describe("refresh rotation liveness", () => {
  // The rotation's Keychain write flies after the rotated tokens went live in
  // memory: grant loss, sign-out, or a newer sign-in can land inside it. The
  // refresh promise must settle gracefully (null) and leave the moved world
  // untouched instead of dereferencing a nulled grant — a rejection would
  // surface an error to callers and leave the rotation timer dead for the
  // session.

  function parkFirstSave(harness: Harness, behavior: "resolve" | "throw"): { entered: Promise<void>; release: () => void } {
    let signalEntered: () => void = () => {};
    const entered = new Promise<void>(resolve => {
      signalEntered = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let calls = 0;
    const workingSave = harness.store.save;
    harness.store.save = jest.fn(async (tokens: StoredTokens) => {
      calls += 1;
      if (calls === 1) {
        signalEntered();
        await gate;
        if (behavior === "throw") throw new Error("Keychain write failed");
      }
      await workingSave(tokens);
    });
    return { entered, release };
  }

  function startTimerRefresh(harness: Harness): Promise<string | null> {
    harness.advance(300_000); // the stored access token is past its margin
    harness.timers[0]?.handler();
    // Single-flight: a direct caller shares the refresh the timer started.
    return harness.auth.getAccessToken();
  }

  it("returns null gracefully when grant loss lands while the rotation save is in flight", async () => {
    let syncCalls = 0;
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) return jsonResponse(TOKENS_B, 200);
      syncCalls += 1;
      return syncCalls === 1 ? jsonResponse(SYNC_200, 200) : jsonResponse({ error: "invalid_token" }, 401);
    };
    const harness = makeHarness([], { fetchLike });
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    const { entered, release } = parkFirstSave(harness, "resolve");
    const refresh = startTimerRefresh(harness);
    await entered;
    // A document request that went out with the pre-rotation token gets its
    // 401 while the save flies: handleGrantLost drops the live grant and
    // publishes signed-out mid-save.
    await harness.auth.refreshDocumentCount();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    release();
    await flush();
    // The save resolves into a dropped world: the rotation returns null
    // instead of dereferencing the nulled grant.
    await expect(refresh).resolves.toBeNull();
    // The grant-loss transition owns the state, and the stale rotation
    // schedules nothing behind it.
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    expect(harness.timers).toHaveLength(1);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
  });

  it("returns null gracefully when sign-out lands while the rotation save is in flight", async () => {
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) return jsonResponse(TOKENS_B, 200);
      if (url.endsWith("/api/v1/device/revoke")) return jsonResponse({ revoked: true }, 200);
      return jsonResponse(SYNC_200, 200);
    };
    const harness = makeHarness([], { fetchLike });
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    const { entered, release } = parkFirstSave(harness, "resolve");
    const refresh = startTimerRefresh(harness);
    await entered;
    // signOut's live-token read takes the fresh rotated token without the
    // single-flight slot, so sign-out completes mid-save: the grant leaves
    // memory and signed-out publishes while the save flies.
    await harness.auth.signOut();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    release();
    await flush();
    await expect(refresh).resolves.toBeNull();
    expect(harness.timers).toHaveLength(1);
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
  });

  it("still publishes, schedules, and returns the rotated token when nothing interferes", async () => {
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) return jsonResponse(TOKENS_B, 200);
      return jsonResponse(SYNC_200, 200);
    };
    const harness = makeHarness([], { fetchLike });
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    const refresh = startTimerRefresh(harness);
    await expect(refresh).resolves.toBe(TOKENS_B.accessToken);
    // The liveness guard must not over-correct into never-publishing: a
    // rotation that lands live still updates the grant in state, persists the
    // rotated tokens, and arms the next proactive timer.
    expect(harness.auth.getState()).toEqual({
      status: "signed-in",
      grantId: "grant-1",
      scopes: TOKENS_A.scopes,
      documentCount: 2,
      countFailed: false,
    });
    expect(harness.store.saved).toEqual([expect.objectContaining({ grantId: "grant-1", accessToken: TOKENS_B.accessToken })]);
    expect(harness.timers).toHaveLength(2);
    expect(harness.timers[1]).toMatchObject({ ms: 240_000, cleared: false });
  });

  it("keeps a newer grant's memory and store when the rotation save fails after a newer sign-in took over", async () => {
    let syncCalls = 0;
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) return jsonResponse(TOKENS_B, 200);
      if (url.endsWith("/api/v1/device/start")) return jsonResponse(START_200, 200);
      if (url.endsWith("/api/v1/device/token")) return jsonResponse(TOKENS_GRANT_TWO, 200);
      syncCalls += 1;
      return syncCalls === 2 ? jsonResponse({ error: "invalid_token" }, 401) : jsonResponse(SYNC_200, 200);
    };
    const harness = makeHarness([], { fetchLike });
    const durableLoad = harness.store.load;
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    const { entered, release } = parkFirstSave(harness, "throw");
    const refresh = startTimerRefresh(harness);
    await entered;
    // Mid-save grant loss signs the phone out and admits a newer sign-in;
    // its save queues behind the parked one on the single-writer store.
    await harness.auth.refreshDocumentCount();
    const second = harness.auth.beginSignIn();
    await waitFor(harness.auth, "awaiting-approval");
    await flush();
    release();
    await expect(refresh).resolves.toBeNull();
    await expect(second).resolves.toEqual({ ok: true });
    await flush();
    // The failed-save recovery must not null the newer world's live grant,
    // publish signed-out over it, or erase its durable entry.
    expect(harness.auth.getState()).toEqual({ status: "signed-in", grantId: "grant-2", scopes: TOKENS_A.scopes, documentCount: 2, countFailed: false });
    await expect(harness.auth.getAccessToken()).resolves.toBe(TOKENS_GRANT_TWO.accessToken);
    const persisted = await durableLoad();
    expect(persisted?.grantId).toBe("grant-2");
    expect(persisted?.accessToken).toBe(TOKENS_GRANT_TWO.accessToken);
    expect(harness.timers).toHaveLength(2);
  });

  it("still drops the grant everywhere when the failed save's rotation owns the world", async () => {
    const fetchLike: FetchLike = async url => {
      if (url.endsWith("/api/v1/device/refresh")) return jsonResponse(TOKENS_B, 200);
      return jsonResponse(SYNC_200, 200);
    };
    const harness = makeHarness([], { fetchLike });
    const durableLoad = harness.store.load;
    harness.store.load = jest.fn(async () => activeTokens());
    await harness.auth.restore();
    await flush();
    const { entered, release } = parkFirstSave(harness, "throw");
    const refresh = startTimerRefresh(harness);
    await entered;
    release();
    // No world moved during the failed save: the recovery still lands signed
    // out with the store cleared and hands the caller the graceful null.
    await expect(refresh).resolves.toBeNull();
    expect(harness.auth.getState()).toEqual({ status: "signed-out" });
    await expect(harness.auth.getAccessToken()).resolves.toBeNull();
    expect(await durableLoad()).toBeNull();
    expect(harness.store.clear).toHaveBeenCalled();
    expect(harness.timers).toHaveLength(1);
  });
});
