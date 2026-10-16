import { API_BASE_URL } from "./api-base";

/** Minimal fetch shape the data modules accept, so tests can inject a stub. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  fetchLike?: FetchLike;
};

/**
 * One request against the UNTangle API, unauthenticated. The app holds no
 * sign-in credential: the session cookie it once kept in SecureStore, and
 * the magic-link token it took over the untangle:// scheme, were removed,
 * because any app can register a custom scheme and receive that token.
 * Device sign-in (a device-grant flow the server issues and the student
 * approves on the web) will add the credential here when it ships.
 */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, headers = {}, fetchLike = fetch } = options;
  return fetchLike(`${API_BASE_URL}${path}`, {
    method,
    // Credential selection is never implicit: the server refuses a device
    // token that arrives with any cookie (ambiguous_credentials), so no
    // request here may carry ambient browser or webview credentials.
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...headers,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
