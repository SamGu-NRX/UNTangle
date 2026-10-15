import * as SecureStore from "expo-secure-store";

import type { DeviceTokens } from "./device-api";

/**
 * The one place tokens touch storage: the iOS Keychain through
 * expo-secure-store (docs/architecture/README.md, "Sign-in for each client").
 * The rest of the auth code takes a TokenStore as an injected port, so no
 * other module can write a token anywhere else.
 */

export type StoredTokens = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working. */
  accessExpiresAt: number;
  grantId: string;
  scopes: readonly string[];
};

export type TokenStore = {
  load: () => Promise<StoredTokens | null>;
  save: (tokens: StoredTokens) => Promise<void>;
  clear: () => Promise<void>;
};

/** SecureStore keys allow letters, digits, "." "-" and "_" only. */
const DEVICE_TOKENS_KEY = "untangle.deviceTokens";
export { DEVICE_TOKENS_KEY };

/** The access token is refreshed before it expires; the margin is a fifth of its five minutes. */
export const REFRESH_MARGIN_MS = 60_000;

function guardStored(value: unknown): StoredTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const { accessToken, refreshToken, accessExpiresAt, grantId, scopes } = candidate;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return null;
  if (typeof accessExpiresAt !== "number" || !Number.isFinite(accessExpiresAt)) return null;
  if (typeof grantId !== "string" || grantId.length === 0) return null;
  if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string")) return null;
  return { version: 1, accessToken, refreshToken, accessExpiresAt, grantId, scopes };
}

export function storedFromDeviceTokens(tokens: DeviceTokens, now: number): StoredTokens {
  return {
    version: 1,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now + tokens.expiresIn * 1000,
    grantId: tokens.grantId,
    scopes: tokens.scopes,
  };
}

/**
 * Keychain-backed TokenStore. This-device-only so a backup restored onto a
 * new phone never carries a grant with it; the student signs in again there.
 */
export function createSecureTokenStore(): TokenStore {
  return {
    async load() {
      const raw = await SecureStore.getItemAsync(DEVICE_TOKENS_KEY);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        // Content the Keychain mangled is not a shape to keep.
        await SecureStore.deleteItemAsync(DEVICE_TOKENS_KEY);
        return null;
      }
      const stored = guardStored(parsed);
      if (stored === null) {
        // A shape this version cannot read is not a shape to keep.
        await SecureStore.deleteItemAsync(DEVICE_TOKENS_KEY);
        return null;
      }
      return stored;
    },
    async save(tokens) {
      await SecureStore.setItemAsync(DEVICE_TOKENS_KEY, JSON.stringify(tokens), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async clear() {
      await SecureStore.deleteItemAsync(DEVICE_TOKENS_KEY);
    },
  };
}
