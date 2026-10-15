import { apiFetch, type FetchLike } from "../data/http";

/**
 * Wire shapes of the device-grant API, mirroring
 * packages/contracts/src/device-grant.ts as local types. Mobile cannot import
 * @untangle/contracts today (it is not one of this workspace's dependencies),
 * so every response is validated against the same shapes by hand. The
 * proposed change to publish those schemas for mobile lives in the PR body.
 */

export const DEVICE_START_PATH = "/api/v1/device/start";
export const DEVICE_TOKEN_PATH = "/api/v1/device/token";
export const DEVICE_REFRESH_PATH = "/api/v1/device/refresh";
export const DEVICE_REVOKE_PATH = "/api/v1/device/revoke";
export const SYNC_PULL_PATH = "/api/v1/sync";

/** The error codes the server returns for device-grant calls. */
export type DeviceGrantErrorCode =
  | "invalid_request"
  | "invalid_grant"
  | "authorization_pending"
  | "access_denied"
  | "expired_token"
  | "invalid_token"
  | "insufficient_scope"
  | "ambiguous_credentials"
  | "forbidden_origin"
  | "unauthorized"
  | "account_changed"
  | "rate_limited"
  | "unavailable"
  | "slow_down";

/** Opaque server-minted secrets: 32 bytes of base64url. */
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DeviceStartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the device code and user code expire. */
  expiresIn: number;
  /** Seconds to wait between token polls. */
  interval: number;
};

export type DeviceTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  /** Seconds the access token lives; the server starts at 300. */
  expiresIn: number;
  scopes: readonly string[];
  grantId: string;
};

export type DeviceRequestOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: DeviceGrantErrorCode | "network"; status: number | null; message?: string };

const USER_CODE_PATTERN = /^[A-Z2-7]{8}$/;
const SCOPE_NAMES = ["documents:read", "documents:write", "schedule:read", "schedule:add-option"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function opaque(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_TOKEN_PATTERN.test(value);
}

function isScopes(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(scope => SCOPE_NAMES.includes(scope));
}

/**
 * One POST to a device-grant endpoint. Returns the parsed JSON on 200 and a
 * typed failure otherwise; network errors become { error: "network" } so the
 * callers never see a throw across the module boundary.
 */
export async function postDeviceEndpoint<T>(
  path: string,
  body: Record<string, unknown>,
  guard: (value: unknown) => T | null,
  options: { fetchLike?: FetchLike; headers?: Record<string, string> } = {},
): Promise<DeviceRequestOutcome<T>> {
  let response: Response;
  try {
    response = await apiFetch(path, { method: "POST", body, headers: options.headers, fetchLike: options.fetchLike });
  } catch (error) {
    return { ok: false, error: "network", status: null, message: error instanceof Error ? error.message : "Network request failed" };
  }
  if (response.status !== 200) {
    const payload = (await response.json().catch(() => null)) as unknown;
    const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : "unavailable";
    return { ok: false, error: code as DeviceGrantErrorCode, status: response.status };
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  const value = guard(payload);
  if (value === null) return { ok: false, error: "invalid_request", status: response.status, message: "The response did not match the device-grant contract." };
  return { ok: true, value };
}

/** Validates a start response; null when it does not match the contract. */
export function guardDeviceStart(value: unknown): DeviceStartResponse | null {
  if (!isRecord(value)) return null;
  const { deviceCode, userCode, verificationUri, expiresIn, interval } = value;
  if (!opaque(deviceCode) || typeof userCode !== "string" || !USER_CODE_PATTERN.test(userCode)) return null;
  if (typeof verificationUri !== "string" || !/^https?:\/\//.test(verificationUri)) return null;
  if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) return null;
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval <= 0) return null;
  return { deviceCode, userCode, verificationUri, expiresIn, interval };
}

/** Validates a token or refresh response; null when it does not match. */
export function guardDeviceTokens(value: unknown): DeviceTokens | null {
  if (!isRecord(value)) return null;
  const { accessToken, refreshToken, tokenType, expiresIn, scopes, grantId } = value;
  if (!opaque(accessToken) || !opaque(refreshToken)) return null;
  if (tokenType !== "Bearer") return null;
  if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) return null;
  if (!isScopes(scopes) || typeof grantId !== "string" || grantId.length === 0) return null;
  return { accessToken, refreshToken, tokenType, expiresIn, scopes, grantId };
}

export function deviceErrorLabel(error: DeviceGrantErrorCode | "network"): string {
  switch (error) {
    case "network":
      return "The UNTangle server could not be reached.";
    case "unavailable":
      return "The UNTangle server is temporarily unavailable.";
    case "rate_limited":
      return "The UNTangle server is busy. Try again shortly.";
    case "invalid_request":
      return "The app sent a request the server refused.";
    default:
      return "Sign-in failed.";
  }
}
