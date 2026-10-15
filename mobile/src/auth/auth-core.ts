import {
  DEVICE_REVOKE_PATH,
  DEVICE_REFRESH_PATH,
  guardDeviceTokens,
  postDeviceEndpoint,
  type DeviceTokens,
} from "./device-api";
import { beginDeviceSignIn, pollForToken, type SignInStart } from "./device-flow";
import type { RandomBytes, Sha256Base64Url } from "./pkce";
import { REFRESH_MARGIN_MS, storedFromDeviceTokens, type StoredTokens, type TokenStore } from "./secure-token-store";
import { fetchSyncList } from "./sync-documents";
import type { FetchLike } from "../data/http";

/**
 * The one auth module. The app shell reads the state from here, API callers
 * get their bearer token from here, and every token write goes through the
 * injected TokenStore (the Keychain). Nothing else in the app signs in,
 * refreshes, or revokes.
 */

export type AuthState =
  | { status: "restoring" }
  | { status: "signed-out" }
  | { status: "awaiting-approval"; start: SignInStart }
  | { status: "signed-in"; grantId: string; scopes: readonly string[]; documentCount: number | null };

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "expired" | "cancelled" }
  | { ok: false; reason: "failed"; error: string; message?: string };

export type AuthDeps = {
  tokenStore: TokenStore;
  randomBytes: RandomBytes;
  sha256Base64Url: Sha256Base64Url;
  fetchLike?: FetchLike;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  setTimer?: (handler: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** How long before expiry a refresh happens; the token lives five minutes. */
  refreshMarginMs?: number;
};

const defaultSetTimer = (handler: () => void, milliseconds: number): unknown => setTimeout(handler, milliseconds);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const clearTimer = deps.clearTimer ?? defaultClearTimer;
  const marginMs = deps.refreshMarginMs ?? REFRESH_MARGIN_MS;

  let state: AuthState = { status: "restoring" };
  const listeners = new Set<() => void>();
  let stored: StoredTokens | null = null;
  let refreshHandle: unknown = null;
  let refreshInFlight: Promise<string | null> | null = null;
  let signInGeneration = 0;

  function notify() {
    for (const listener of listeners) listener();
  }

  function replaceState(next: AuthState) {
    state = next;
    notify();
  }

  function cancelRefreshTimer() {
    if (refreshHandle !== null) {
      clearTimer(refreshHandle);
      refreshHandle = null;
    }
  }

  function scheduleRefresh() {
    cancelRefreshTimer();
    if (!stored) return;
    const delay = Math.max(stored.accessExpiresAt - marginMs - now(), 0);
    refreshHandle = setTimer(() => {
      refreshHandle = null;
      // Fire and forget: the outcome lands in the state either way.
      void getAccessToken();
    }, delay);
  }

  /**
   * The bearer token for API calls. Hands back the access token while it
   * still has margin to live, refreshes first when it is close to expiry,
   * and returns null when there is no live grant.
   */
  async function getAccessToken(): Promise<string | null> {
    if (!stored) return null;
    if (stored.accessExpiresAt - marginMs > now()) return stored.accessToken;
    // Single-flight: two callers near expiry share one refresh, so the
    // first refresh token is used exactly once.
    refreshInFlight = refreshInFlight ?? refreshTokens();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function handleGrantLost() {
    // A refresh token the server refuses means this grant is finished: the
    // token was reused, the grant was revoked, or the account's security
    // generation moved. The only safe state is signed out.
    stored = null;
    cancelRefreshTimer();
    await deps.tokenStore.clear();
    replaceState({ status: "signed-out" });
  }

  async function refreshTokens(): Promise<string | null> {
    if (!stored) return null;
    const outcome = await postDeviceEndpoint<DeviceTokens>(
      DEVICE_REFRESH_PATH,
      { refreshToken: stored.refreshToken },
      guardDeviceTokens,
      { fetchLike: deps.fetchLike },
    );
    if (!outcome.ok) {
      if (outcome.error === "network" || outcome.error === "unavailable" || outcome.error === "rate_limited") {
        // The grant is not lost; the server just cannot answer right now. No
        // reschedule: a zero-delay timer would retry in a hot loop, so the
        // next call or timer does the retrying instead.
        return null;
      }
      await handleGrantLost();
      return null;
    }
    stored = storedFromDeviceTokens(outcome.value, now());
    await deps.tokenStore.save(stored);
    if (state.status === "signed-in") {
      replaceState({ status: "signed-in", grantId: stored.grantId, scopes: stored.scopes, documentCount: state.documentCount });
      scheduleRefresh();
    }
    return stored.accessToken;
  }

  function applyTokens(tokens: DeviceTokens) {
    stored = storedFromDeviceTokens(tokens, now());
    return deps.tokenStore.save(stored);
  }

  async function loadDocumentCount(): Promise<void> {
    const accessToken = await getAccessToken();
    if (!accessToken || !stored) return;
    const result = await fetchSyncList(accessToken, deps.fetchLike);
    if (result.ok) {
      if (state.status === "signed-in") replaceState({ ...state, documentCount: result.entries.length });
      return;
    }
    if (result.reason === "unauthorized") {
      await handleGrantLost();
      return;
    }
    // Unavailable: leave the count null; the sign-in screen offers a retry.
  }

  async function runSignInPolling(generation: number, deviceCode: string, verifier: string, intervalSeconds: number, start: SignInStart): Promise<SignInResult> {
    const outcome = await pollForToken({
      deviceCode,
      verifier,
      intervalSeconds,
      expiresAt: start.expiresAt,
      fetchLike: deps.fetchLike,
      now,
      sleep: deps.sleep,
      shouldContinue: () => generation === signInGeneration && state.status === "awaiting-approval",
    });
    if (generation !== signInGeneration) return { ok: false, reason: "cancelled" };
    if (outcome.ok) {
      await applyTokens(outcome.tokens);
      replaceState({ status: "signed-in", grantId: outcome.tokens.grantId, scopes: outcome.tokens.scopes, documentCount: null });
      scheduleRefresh();
      // One read so the screen can say what the account holds; real sync is
      // the next task. Not awaited to the result: the state updates when it
      // lands.
      void loadDocumentCount();
      return { ok: true };
    }
    replaceState({ status: "signed-out" });
    return outcome.reason === "failed" ? { ok: false, reason: "failed", error: outcome.error, message: outcome.message } : { ok: false, reason: outcome.reason };
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getState(): AuthState {
      return state;
    },

    /** Reads the Keychain once at startup and lands in the stored state. */
    async restore(): Promise<void> {
      stored = await deps.tokenStore.load();
      if (!stored) {
        replaceState({ status: "signed-out" });
        return;
      }
      replaceState({ status: "signed-in", grantId: stored.grantId, scopes: stored.scopes, documentCount: null });
      scheduleRefresh();
    },

    /**
     * The bearer token for API calls: see getAccessToken above. Part of the
     * returned surface so screens and data calls never read the store.
     */
    getAccessToken,

    /**
     * Starts the device flow. The screen shows the user code and opens the
     * verification URI in the system browser; the returned promise settles
     * when the flow ends, one way or another.
     */
    async beginSignIn(): Promise<SignInResult> {
      if (state.status !== "signed-out") return { ok: false, reason: "failed", error: "not_signable" };
      const generation = ++signInGeneration;
      const begun = await beginDeviceSignIn({ randomBytes: deps.randomBytes, sha256Base64Url: deps.sha256Base64Url, fetchLike: deps.fetchLike, now });
      if (generation !== signInGeneration) return { ok: false, reason: "cancelled" };
      if (!begun.ok) return { ok: false, reason: "failed", error: begun.error, message: begun.message };
      replaceState({ status: "awaiting-approval", start: begun.start });
      return runSignInPolling(generation, begun.deviceCode, begun.verifier, begun.intervalSeconds, begun.start);
    },

    /** Stops an in-flight flow and goes back to signed out. */
    cancelSignIn(): void {
      if (state.status !== "awaiting-approval") return;
      signInGeneration += 1;
      replaceState({ status: "signed-out" });
    },

    /**
     * Signs out: revokes the grant on the server (best effort, so sign-out
     * works offline) and clears the Keychain either way.
     */
    async signOut(): Promise<void> {
      signInGeneration += 1;
      cancelRefreshTimer();
      const accessToken = stored?.accessToken ?? null;
      if (accessToken) {
        // Best effort: a refused token means the grant is already gone, and a
        // network failure leaves the grant to die on its idle limit. Either
        // way this phone signs out.
        await postDeviceEndpoint<{ revoked: boolean }>(
          DEVICE_REVOKE_PATH,
          {},
          (value: unknown) => (typeof value === "object" && value !== null && (value as Record<string, unknown>).revoked === true ? { revoked: true } : null),
          { fetchLike: deps.fetchLike, headers: { Authorization: `Bearer ${accessToken}` } },
        ).catch(() => null);
      }
      stored = null;
      await deps.tokenStore.clear();
      replaceState({ status: "signed-out" });
    },

    /** The count read behind sign-in's document line; the screen offers a retry. */
    async refreshDocumentCount(): Promise<void> {
      if (state.status !== "signed-in") return;
      await loadDocumentCount();
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
