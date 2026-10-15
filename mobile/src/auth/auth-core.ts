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
  | {
      status: "signed-in";
      grantId: string;
      scopes: readonly string[];
      documentCount: number | null;
      /** The last count load failed; the screen offers a retry until one lands. */
      countFailed: boolean;
    };

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

/**
 * How long a transiently failed refresh waits before retrying on its own:
 * short enough to refresh inside the margin on a blip, far enough apart that
 * an outage never becomes a hot loop.
 */
const REFRESH_RETRY_MS = 30_000;

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
      // Fire and forget: the outcome lands in the state either way. The catch
      // is belt-and-suspenders so no future rejection path goes unhandled.
      void getAccessToken().catch(() => undefined);
    }, delay);
  }

  function scheduleRefreshRetry() {
    cancelRefreshTimer();
    if (!stored) return;
    // A refresh the server could not answer must not leave the access token
    // to cross its margin silently: retry on a fixed backoff so the margin
    // never reaches zero while the grant itself is still live.
    refreshHandle = setTimer(() => {
      refreshHandle = null;
      void getAccessToken().catch(() => undefined);
    }, REFRESH_RETRY_MS);
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
    const promise = refreshInFlight ?? refreshTokens();
    refreshInFlight = promise;
    try {
      return await promise;
    } finally {
      // Clear the slot only if it still holds the promise this caller
      // awaited; a refresh started meanwhile owns it now.
      if (refreshInFlight === promise) refreshInFlight = null;
    }
  }

  async function handleGrantLost() {
    // A refresh token the server refuses means this grant is finished: the
    // token was reused, the grant was revoked, or the account's security
    // generation moved. The only safe state is signed out.
    const generation = signInGeneration;
    stored = null;
    cancelRefreshTimer();
    // Durable cleanup is best-effort: a store that cannot clear must not stop
    // the signed-out state from publishing, or the screen would show
    // signed-in with no tokens behind it.
    await deps.tokenStore.clear().catch(() => undefined);
    // An async result must not touch state or durable storage for a world
    // that moved while it was in flight: a sign-out (or a newer sign-in it
    // admitted) landed during the clear and owns the phone now, and this
    // stray clear can have erased that newer grant's Keychain entry. Repair
    // the mirror from memory and publish nothing — the newer world speaks
    // for itself.
    if (generation !== signInGeneration) {
      if (stored) await deps.tokenStore.save(stored).catch(() => undefined);
      return;
    }
    replaceState({ status: "signed-out" });
  }

  async function refreshTokens(): Promise<string | null> {
    if (!stored) return null;
    const grantAtStart = stored;
    const outcome = await postDeviceEndpoint<DeviceTokens>(
      DEVICE_REFRESH_PATH,
      { refreshToken: stored.refreshToken },
      guardDeviceTokens,
      { fetchLike: deps.fetchLike },
    );
    // A refresh that resolves after the world changed — sign-out cleared the
    // grant, or a new sign-in replaced it — must save nothing and touch no
    // state: the answer belongs to a grant this phone no longer holds.
    if (stored !== grantAtStart) return null;
    if (!outcome.ok) {
      if (outcome.error === "network" || outcome.error === "unavailable" || outcome.error === "rate_limited") {
        // The grant is not lost; the server just cannot answer right now.
        // A backoff timer keeps the retry alive when nothing else calls.
        scheduleRefreshRetry();
        return null;
      }
      // Only the contract's own refusals end the grant: a 400 or 401 naming
      // invalid_token or invalid_grant.
      const refused = outcome.status === 400 || outcome.status === 401;
      if (refused && (outcome.error === "invalid_token" || outcome.error === "invalid_grant")) {
        await handleGrantLost();
        return null;
      }
      // A 200 whose body failed the guard (device-api reports it as
      // invalid_request with status 200), and any other shape this client
      // does not know, did not consume the grant. The timer that led here is
      // spent, so without a reschedule the refresh loop would die silently:
      // keep the backoff alive for a later try.
      scheduleRefreshRetry();
      return null;
    }
    stored = storedFromDeviceTokens(outcome.value, now());
    try {
      await deps.tokenStore.save(stored);
    } catch {
      // The server has already consumed the old refresh token, so a failed
      // Keychain write must not leave that used token as the only copy: the
      // next restart would refresh with it and the server would revoke the
      // grant. Drop the grant everywhere — memory now, the Keychain
      // best-effort — and land signed out; signing in again is the recovery.
      cancelRefreshTimer();
      stored = null;
      await deps.tokenStore.clear().catch(() => undefined);
      replaceState({ status: "signed-out" });
      return null;
    }
    if (state.status === "signed-in") {
      replaceState({ ...state, grantId: stored.grantId, scopes: stored.scopes });
      scheduleRefresh();
    }
    return stored.accessToken;
  }

  async function applyTokens(tokens: DeviceTokens): Promise<StoredTokens | null> {
    // The candidate stays local until the Keychain write lands: assigning it
    // to the live grant first would let getAccessToken hand out this flow's
    // bearer token while the save — and the caller's generation re-check — is
    // still in flight, even after a cancel or sign-out gave the phone a
    // newer world.
    const candidate = storedFromDeviceTokens(tokens, now());
    try {
      await deps.tokenStore.save(candidate);
      return candidate;
    } catch {
      // A Keychain write that fails must not leave the un-persisted grant
      // live in memory, where cancelSignIn would only reset the UI around
      // it. Drop the grant and land signed-out so the caller can surface a
      // retryable failure; the clear is best-effort because a store that
      // cannot save may not clear either. Defensive: this flow never
      // assigned the live grant, but clear it all the same.
      stored = null;
      await deps.tokenStore.clear().catch(() => undefined);
      replaceState({ status: "signed-out" });
      return null;
    }
  }

  async function loadDocumentCount(): Promise<void> {
    // The read belongs to the grant it started for: a sign-out (or a fresh
    // sign-in) while it flies makes the answer stale, and applying it — or
    // treating its 401 as a lost grant — would touch the wrong account. The
    // grant id is the identity here, not the tokens object: this read's own
    // refresh legitimately rotates tokens for the same grant.
    const grantAtStart = stored?.grantId;
    const accessToken = await getAccessToken();
    if (stored?.grantId !== grantAtStart) return;
    if (!accessToken || !stored) {
      // No live token, no count this round: the screen's retry stays on.
      if (state.status === "signed-in") replaceState({ ...state, countFailed: true });
      return;
    }
    // A retry counts as loading again, not as another failure, while it runs.
    if (state.status === "signed-in" && state.countFailed) replaceState({ ...state, countFailed: false });
    const result = await fetchSyncList(accessToken, deps.fetchLike);
    if (stored?.grantId !== grantAtStart) return;
    if (result.ok) {
      // Tombstoned entries are deleted documents, not documents to count.
      const active = result.entries.filter(entry => !entry.deleted).length;
      if (state.status === "signed-in") replaceState({ ...state, documentCount: active, countFailed: false });
      return;
    }
    if (result.reason === "unauthorized") {
      await handleGrantLost();
      return;
    }
    // Unavailable: the count did not load, and the sign-in screen offers a
    // retry until one lands.
    if (state.status === "signed-in") replaceState({ ...state, countFailed: true });
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
      const saved = await applyTokens(outcome.tokens);
      if (!saved) {
        // Nothing was persisted and nothing is live: the flow failed, and
        // starting it again is safe once the store recovers.
        return { ok: false, reason: "failed", error: "storage_failed" };
      }
      // The save can resolve after the flow that started it is gone: a
      // cancel or sign-out during the Keychain write bumps the generation
      // while applyTokens is still awaiting it. Nothing was ever live in
      // memory — the candidate stays local to applyTokens until this check
      // passes — but the just-saved token is durable, and cancelSignIn never
      // touches the store, so this clear is the only durable cleanup the
      // stray save gets. Publish nothing: the state already says signed-out,
      // or a newer flow owns it.
      if (generation !== signInGeneration) {
        await deps.tokenStore.clear().catch(() => undefined);
        return { ok: false, reason: "cancelled" };
      }
      stored = saved;
      replaceState({ status: "signed-in", grantId: outcome.tokens.grantId, scopes: outcome.tokens.scopes, documentCount: null, countFailed: false });
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
      try {
        stored = await deps.tokenStore.load();
      } catch {
        // An unreadable Keychain must not wedge the app in "restoring": the
        // student signs in again and the store rewrites the envelope.
        stored = null;
      }
      if (!stored) {
        replaceState({ status: "signed-out" });
        return;
      }
      replaceState({ status: "signed-in", grantId: stored.grantId, scopes: stored.scopes, documentCount: null, countFailed: false });
      scheduleRefresh();
      // One read so the restored screen can say what the account holds; not
      // awaited: the state updates when the count lands.
      void loadDocumentCount();
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
      const generation = signInGeneration;
      cancelRefreshTimer();
      // Revoke with a live token: the server refuses an expired one, and a
      // refused revoke leaves the grant live for its idle limit. When a
      // refresh is in flight the token is past its margin, so getAccessToken
      // waits for it and hands back the fresh token it lands.
      const accessToken = await getAccessToken();
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
      // A refresh that landed during the revoke scheduled a new timer; none
      // may outlive the sign-out.
      cancelRefreshTimer();
      stored = null;
      // Best-effort like the revoke: the signed-out state must publish even
      // when the durable cleanup fails.
      await deps.tokenStore.clear().catch(() => undefined);
      // An async result must not touch state or durable storage for a world
      // that moved while it was in flight: a grant-loss cleanup publishing
      // mid-sign-out can admit a newer sign-in before this clear resolves,
      // and the stray clear can have erased that newer grant's Keychain
      // entry. Repair the mirror from memory and publish nothing — the newer
      // world speaks for itself.
      if (generation !== signInGeneration) {
        if (stored) await deps.tokenStore.save(stored).catch(() => undefined);
        return;
      }
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
