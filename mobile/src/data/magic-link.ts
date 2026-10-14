import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";

import { apiFetch, type FetchLike } from "./http";

/** Ask the API to email a magic link; the link lands on the web landing page. */
export type MagicLinkSendResult =
  | { ok: true }
  | { ok: false; reason: "invalid-email"; message: string }
  | { ok: false; reason: "rejected"; message: string };

/**
 * POST /api/auth/sign-in/magic-link with the callbackURL pointing at the web
 * landing page, exactly as the web sign-in form does. The gate stays on the
 * server; the local check only spares the round trip the web also spares.
 */
export async function requestMagicLink(
  email: string,
  fetchLike: FetchLike,
): Promise<MagicLinkSendResult> {
  if (!isUntEmail(email)) {
    return { ok: false, reason: "invalid-email", message: untEmailRequirementMessage() };
  }
  try {
    const response = await apiFetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: { email: email.trim(), callbackURL: "/auth/link" },
      fetchLike,
    });
    if (response.ok) return { ok: true };
    return { ok: false, reason: "rejected", message: `Sign-in request failed: ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      reason: "rejected",
      message: error instanceof Error ? error.message : "Network request failed",
    };
  }
}

export type VerifyResult =
  | { ok: true; response: Response }
  | { ok: false; reason: "invalid-or-expired" }
  | { ok: false; reason: "network"; message: string };

/**
 * Verify a magic-link token: GET /api/auth/magic-link/verify?token=... with
 * Accept: application/json. That endpoint is GET-only in the installed
 * better-auth (frontend/node_modules/better-auth/dist/plugins/magic-link),
 * and without a callbackURL a success returns a JSON body carrying the
 * Set-Cookie session instead of a redirect, which is what the app needs to
 * persist. The web landing page keeps its own POST path unchanged.
 */
export async function verifyMagicLink(token: string, fetchLike: FetchLike): Promise<VerifyResult> {
  try {
    const response = await apiFetch(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      fetchLike,
    });
    if (response.ok) return { ok: true, response };
    return { ok: false, reason: "invalid-or-expired" };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "Network request failed",
    };
  }
}

/**
 * The `token` parameter of an auth-callback fragment ("#token=...&"), or
 * null. A mobile-local mirror of frontend/src/lib/magic-link-url.ts's
 * fragment parsing: that helper leans on URLSearchParams, which the Hermes
 * runtime does not provide, and only the token is carried here.
 */
export function tokenFromFragment(fragment: string): string | null {
  const bare = fragment.replace(/^#/, "");
  for (const pair of bare.split("&")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    if (pair.slice(0, separator) !== "token") continue;
    const value = pair.slice(separator + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
