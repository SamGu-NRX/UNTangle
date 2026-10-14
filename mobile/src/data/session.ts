import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_COOKIE_KEY = "untangle.session-cookie";

/**
 * The Set-Cookie header values from a verify response, reduced to the
 * `name=value` pairs a Cookie request header carries. Returns null when the
 * response sets no session cookie.
 */
export function parseSessionCookie(setCookieValues: readonly string[]): string | null {
  const pairs: string[] = [];
  for (const value of setCookieValues) {
    const firstPair = value.split(";")[0]?.trim();
    if (!firstPair || !firstPair.includes("=")) continue;
    const separator = firstPair.indexOf("=");
    const name = firstPair.slice(0, separator).trim();
    const sessionValue = firstPair.slice(separator + 1);
    if (!name || !sessionValue) continue;
    pairs.push(`${name}=${sessionValue}`);
  }
  return pairs.length ? pairs.join("; ") : null;
}

function responseSetCookieValues(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Persist the session cookie from a verify response. On web this is a no-op:
 * the browser cookie jar already holds the cookie for the same-origin API.
 */
export async function storeSessionCookie(response: Response): Promise<void> {
  if (Platform.OS === "web") return;
  const cookie = parseSessionCookie(responseSetCookieValues(response));
  if (cookie) await SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookie);
}

/**
 * The persisted session cookie, or null. Always null on web, where the
 * browser cookie jar governs and requests are same-origin.
 */
export async function getSessionCookie(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(SESSION_COOKIE_KEY);
}

/** Forget the session cookie (sign-out). No-op on web; the site's cookie governs there. */
export async function clearSessionCookie(): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(SESSION_COOKIE_KEY);
}
