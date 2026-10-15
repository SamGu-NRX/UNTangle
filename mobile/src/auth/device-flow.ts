import {
  DEVICE_START_PATH,
  DEVICE_TOKEN_PATH,
  guardDeviceStart,
  guardDeviceTokens,
  postDeviceEndpoint,
  type DeviceStartResponse,
  type DeviceTokens,
} from "./device-api";
import { createPkcePair, type RandomBytes, type Sha256Base64Url } from "./pkce";
import type { FetchLike } from "../data/http";

/**
 * The client half of the device grant (docs/architecture/README.md, "Sign-in
 * for each client"): start a flow with an S256 challenge, show the user code,
 * and poll for the token. The verification page opens in the system browser;
 * nothing here ever receives a token from a URL, a scheme, or a redirect.
 */

export type SignInStart = {
  /** The 8-character code the student matches on the approval page. */
  userCode: string;
  /** The approval page's address, opened in the system browser. */
  verificationUri: string;
  /** Epoch ms when the device code expires. */
  expiresAt: number;
};

export type PollOutcome =
  | { ok: true; tokens: DeviceTokens }
  | { ok: false; reason: "denied" | "expired" | "cancelled" }
  | { ok: false; reason: "failed"; error: string; message?: string };

export type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export type BeginDeps = {
  randomBytes: RandomBytes;
  sha256Base64Url: Sha256Base64Url;
  fetchLike?: FetchLike;
  now?: () => number;
};

export type BeginResult =
  | { ok: true; start: SignInStart; /** Secret; kept in memory for the exchange only. */ deviceCode: string; verifier: string; intervalSeconds: number }
  | { ok: false; error: string; message?: string };

/**
 * POST /api/v1/device/start as clientKind "mobile" with a fresh S256
 * challenge. The verifier stays in memory for the exchange and is never
 * persisted.
 */
export async function beginDeviceSignIn(deps: BeginDeps): Promise<BeginResult> {
  const now = deps.now ?? Date.now;
  let pair: { verifier: string; challenge: string };
  try {
    pair = await createPkcePair(deps.randomBytes, deps.sha256Base64Url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "PKCE generation failed." };
  }
  const outcome = await postDeviceEndpoint<DeviceStartResponse>(
    DEVICE_START_PATH,
    { clientKind: "mobile", codeChallenge: pair.challenge, codeChallengeMethod: "S256" },
    guardDeviceStart,
    { fetchLike: deps.fetchLike },
  );
  if (!outcome.ok) return { ok: false, error: outcome.error, message: outcome.message };
  return {
    ok: true,
    deviceCode: outcome.value.deviceCode,
    verifier: pair.verifier,
    intervalSeconds: outcome.value.interval,
    start: { userCode: outcome.value.userCode, verificationUri: outcome.value.verificationUri, expiresAt: now() + outcome.value.expiresIn * 1000 },
  };
}

export type PollDeps = {
  deviceCode: string;
  verifier: string;
  /** Seconds between polls, from the start response. */
  intervalSeconds: number;
  /** Epoch ms deadline from the start response. */
  expiresAt: number;
  fetchLike?: FetchLike;
  now?: () => number;
  sleep?: Sleep;
  /** The UI's cancel: checked between every wait. */
  shouldContinue?: () => boolean;
};

/**
 * POST /api/v1/device/token on the server's interval until it hands out
 * tokens, the student decides, or the code expires.
 *
 * Handling per code, following RFC 8628 with this server's names:
 * - authorization_pending: keep waiting on the interval;
 * - slow_down (or the rate limiter's rate_limited): back off harder, then
 *   resume on a longer interval;
 * - access_denied: the student denied this phone;
 * - expired_token (or the local deadline passing): the code expired;
 * - invalid_grant and other refusals: the flow cannot recover; stop.
 * A network error or an unavailable server is worth retrying until the
 * deadline; the approval page may be reachable even when the API blips.
 */
export async function pollForToken(deps: PollDeps): Promise<PollOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const shouldContinue = deps.shouldContinue ?? (() => true);
  let intervalMs = deps.intervalSeconds * 1000;
  let backoffMs = 0;

  while (now() < deps.expiresAt) {
    if (!shouldContinue()) return { ok: false, reason: "cancelled" };
    const outcome = await postDeviceEndpoint<DeviceTokens>(
      DEVICE_TOKEN_PATH,
      { deviceCode: deps.deviceCode, codeVerifier: deps.verifier },
      guardDeviceTokens,
      { fetchLike: deps.fetchLike },
    );
    if (outcome.ok) return { ok: true, tokens: outcome.value };
    switch (outcome.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        backoffMs = 5000;
        break;
      case "rate_limited":
        backoffMs = Math.max(backoffMs, 5000);
        break;
      case "access_denied":
        return { ok: false, reason: "denied" };
      case "expired_token":
        return { ok: false, reason: "expired" };
      case "network":
      case "unavailable":
        break;
      default:
        return { ok: false, reason: "failed", error: outcome.error, message: outcome.message };
    }
    await sleep(intervalMs + backoffMs);
    if (backoffMs > 0) {
      // A slow_down or rate_limited response raises the floor permanently:
      // once told to slow down, the client never returns to the faster rate.
      intervalMs += backoffMs;
      backoffMs = 0;
    }
  }
  return { ok: false, reason: "expired" };
}
