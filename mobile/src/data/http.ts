import { Platform } from "react-native";

import { API_BASE_URL } from "./api-base";
import { getSessionCookie } from "./session";

/** Minimal fetch shape the data modules accept, so tests can inject a stub. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  fetchLike?: FetchLike;
};

/**
 * One request against the UNTangle API. On native the persisted session
 * cookie is replayed as a header (React Native does not share the browser's
 * cookie jar); on web the browser attaches cookies itself.
 */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, headers = {}, fetchLike = fetch } = options;
  const cookie = await getSessionCookie();
  return fetchLike(`${API_BASE_URL}${path}`, {
    method,
    // Expo web usually serves on a different origin than the API: ask the
    // browser to send and accept cross-origin cookies (the server must allow
    // the web origin with credentials). Native ignores this option and
    // replays the persisted cookie header instead.
    ...(Platform.OS === "web" ? { credentials: "include" as const } : {}),
    headers: {
      Accept: "application/json",
      ...headers,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
