/**
 * Base URL of the UNTangle API. Expo inlines EXPO_PUBLIC_* variables at
 * bundle time; the default matches the local development server.
 */
export const API_BASE_URL_ENV_VAR = "EXPO_PUBLIC_UNTANGLE_API_URL";

/** The default matches the local development server. */
export const API_BASE_DEFAULT = "http://localhost:3000";

/** Resolves the API base from an override: blank falls back, slashes are trimmed. */
export function resolveApiBase(override: string | undefined): string {
  const trimmed = override?.trim();
  return (trimmed ? trimmed : API_BASE_DEFAULT).replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBase(process.env.EXPO_PUBLIC_UNTANGLE_API_URL);
