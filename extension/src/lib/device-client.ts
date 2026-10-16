import { UNTANGLE_ORIGIN } from "../config";
import { isRecord, isTokenResponse, type DeviceTokenResponse } from "../shared/extension-api";
import type { FetchLike } from "./planner-client";
import { StudentError } from "../shared/student-error";

/** The server refused the refresh token: reuse, revocation or a lapsed grant. */
export class GrantRevoked extends Error {
  constructor() { super("The device grant is gone."); }
}
/** The student chose Deny on the approval page. */
export class SignInDenied extends StudentError {
  constructor() { super("You denied this sign-in in UNTangle. Sign in again to continue."); }
}
/** The device code ran out its ten minutes, or the server retired it. */
export class SignInExpired extends StudentError {
  constructor() { super("That sign-in request expired. Sign in again."); }
}
/** The stored sign-in this poll belongs to is gone; not student copy. */
export class SignInCancelled extends Error {
  constructor() { super("Sign-in cancelled."); }
}

export interface SigninHooks {
  /** Opens the approval page in a normal browser tab, never a content script. */
  openTab(url: string): void;
  /** Waits between polls; overridable in tests. The default sleeps. */
  delay?(ms: number): Promise<void>;
  /** The clock, overridable in tests. */
  now?: () => number;
}

/**
 * A started device sign-in. The worker keeps it in chrome.storage.session,
 * so a restarted worker resumes the poll and a reopened panel shows the same
 * code.
 */
export interface PendingSignIn {
  deviceCode: string;
  /** The PKCE verifier; it never leaves the worker except to /device/token. */
  verifier: string;
  userCode: string;
  intervalMs: number;
  /** When the device code expires, in epoch milliseconds. */
  deadline: number;
}

export function isPendingSignIn(x: unknown): x is PendingSignIn {
  return isRecord(x) && Object.keys(x).length === 5
    && typeof x.deviceCode === "string" && x.deviceCode.length > 0 && x.deviceCode.length <= 200
    && typeof x.verifier === "string" && /^[A-Za-z0-9_-]{43}$/.test(x.verifier)
    && typeof x.userCode === "string" && /^[A-Z2-7]{8}$/.test(x.userCode)
    && typeof x.intervalMs === "number" && Number.isSafeInteger(x.intervalMs) && x.intervalMs > 0
    && typeof x.deadline === "number" && Number.isFinite(x.deadline);
}

const SIGNIN_UNREACHABLE = "Couldn't sign in to UNTangle. Check your connection and retry.";
const UNREACHABLE = "Couldn't reach UNTangle. Check your connection and retry.";

/** Reads the contract's deviceGrantError body code without trusting the body. */
function errorCode(body: unknown): string | null {
  return isRecord(body) && typeof body.error === "string" ? body.error : null;
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

/**
 * Signs the extension in through UNTangle's device-code flow: a PKCE start,
 * the student approving /device in a normal browser tab, and a token poll
 * that runs until the code expires. Tokens are returned once, validated, and
 * never logged; the caller owns storing the pending sign-in and the tokens.
 */
export class DeviceClient {
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;
  constructor(private readonly fetchImpl: FetchLike, private readonly hooks: SigninHooks, private readonly base = UNTANGLE_ORIGIN) {
    this.now = hooks.now ?? Date.now;
    this.delay = hooks.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  /** Starts a sign-in for the schedule and opens its approval page. */
  async start(scheduleId: string): Promise<PendingSignIn> {
    const verifier = randomSecret();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const response = await this.fetchImpl(`${this.base}/api/v1/device/start`, {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKind: "extension", codeChallenge: challenge, codeChallengeMethod: "S256", scheduleId }),
    }).catch(() => { throw new StudentError(SIGNIN_UNREACHABLE); });
    if (!response.ok)
      throw new StudentError(SIGNIN_UNREACHABLE);
    const started: unknown = await response.json().catch(() => null);
    // The server returns the contract's deviceGrantStarted: a device code for
    // this client, an 8-character user code for the student, the /device page,
    // a 10-minute expiry and a polling interval in seconds.
    if (!isRecord(started) || typeof started.deviceCode !== "string" || started.deviceCode.length > 200
      || typeof started.userCode !== "string" || !/^[A-Z2-7]{8}$/.test(started.userCode)
      || typeof started.verificationUri !== "string" || typeof started.expiresIn !== "number"
      || !Number.isSafeInteger(started.expiresIn) || started.expiresIn <= 0
      || typeof started.interval !== "number" || !Number.isSafeInteger(started.interval) || started.interval <= 0)
      throw new Error("Invalid device authorization response");
    const page = new URL(started.verificationUri);
    const base = new URL(this.base);
    if (page.origin !== base.origin || page.username || page.password || page.pathname !== "/device")
      throw new Error("Untrusted verification URL");
    // The page fills the code in from the query (docs/architecture, /device?user_code=).
    this.hooks.openTab(`${page.origin}${page.pathname}?user_code=${encodeURIComponent(started.userCode)}`);
    return {
      deviceCode: started.deviceCode,
      verifier,
      userCode: started.userCode,
      intervalMs: started.interval * 1000,
      deadline: this.now() + started.expiresIn * 1000,
    };
  }
  async refresh(refreshToken: string): Promise<DeviceTokenResponse> {
    const response = await this.fetchImpl(`${this.base}/api/v1/device/refresh`, {
      method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => { throw new StudentError(UNREACHABLE); });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      if (isTokenResponse(body))
        return body;
      throw new Error("Invalid device grant response");
    }
    // A reused refresh token revokes the whole grant server-side; so do a
    // revoked grant and any security-generation mismatch. All sign the
    // extension out.
    if (response.status === 401 || errorCode(body) === "invalid_token" || errorCode(body) === "invalid_grant")
      throw new GrantRevoked();
    throw new StudentError(UNREACHABLE);
  }
  async revoke(accessToken: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/api/v1/device/revoke`, {
        method: "POST", credentials: "omit", headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    catch {
      throw new StudentError(UNREACHABLE);
    }
    // 401 means the grant is already gone, which is the sign-out the student asked for.
    if (response.ok || response.status === 401)
      return;
    throw new StudentError(UNREACHABLE);
  }
  /**
   * Polls for the tokens until the student approves or denies, or the code
   * expires. `current` is asked after every wait; once it says the sign-in is
   * no longer the stored one, polling stops with SignInCancelled.
   */
  async poll(pending: PendingSignIn, current: () => Promise<boolean>): Promise<DeviceTokenResponse> {
    let wait = pending.intervalMs;
    for (;;) {
      const remaining = pending.deadline - this.now();
      if (remaining <= 0)
        throw new SignInExpired();
      await this.delay(Math.min(wait, remaining));
      if (this.now() >= pending.deadline)
        throw new SignInExpired();
      if (!await current())
        throw new SignInCancelled();
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.base}/api/v1/device/token`, {
          method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: pending.deviceCode, codeVerifier: pending.verifier }),
        });
      }
      catch {
        continue; // A transport hiccup keeps polling until the deadline.
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        if (isTokenResponse(body))
          return body;
        throw new Error("Invalid device grant response");
      }
      const code = errorCode(body);
      if (response.status === 429 || code === "slow_down") {
        // Back off: the contract has no slow_down today, but honouring it and
        // the rate limit's Retry-After keeps a busy server out of the loop.
        const retry = retryAfterSeconds(response);
        wait = Math.max(wait + (code === "slow_down" ? 5000 : 0), (retry ?? 0) * 1000, pending.intervalMs);
        continue;
      }
      if (code === "authorization_pending")
        continue;
      if (code === "access_denied")
        throw new SignInDenied();
      if (code === "expired_token" || code === "invalid_grant")
        throw new SignInExpired();
      if (response.status >= 500)
        continue; // The server says unavailable; the deadline bounds the retries.
      throw new StudentError(SIGNIN_UNREACHABLE);
    }
  }
}

function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
