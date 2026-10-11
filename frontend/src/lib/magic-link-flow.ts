// Pure state machine for the sign-in page's magic-link flow. Keeping the
// transitions out of the component makes the sending / check-your-inbox /
// error behavior unit-testable without a DOM, and guarantees the submit
// button keeps one stable accessible name in every state.

export type MagicLinkFlowState =
  | { phase: "form"; errorMessage: string | null }
  | { phase: "sending"; sentTo: string; from: "form" | "checkInbox" }
  | { phase: "checkInbox"; sentTo: string };

export type MagicLinkFlowEvent =
  | { type: "sendStart"; email: string }
  | { type: "sendSucceeded"; email: string }
  | { type: "sendFailed"; message: string | null }
  | { type: "restart" };

export const MAGIC_LINK_GENERIC_ERROR =
  "Unable to send a sign-in link right now. Try again in a moment.";
export const MAGIC_LINK_RATE_LIMIT_ERROR =
  "Too many link requests. Wait a minute and try again.";

/**
 * Maps a failed magic-link POST to the message the sign-in page shows.
 * The endpoint rate-limits to five requests per minute; a 429 gets its own
 * honest copy instead of the provider's terse message. Blank or missing
 * server messages fall back to the generic copy.
 */
export function signInErrorMessage(
  status: number,
  payload: { message?: unknown } | null,
): string {
  if (status === 429) {
    return MAGIC_LINK_RATE_LIMIT_ERROR;
  }
  const message = payload?.message;
  return typeof message === "string" && message.trim()
    ? message
    : MAGIC_LINK_GENERIC_ERROR;
}

export function magicLinkFlowReducer(
  state: MagicLinkFlowState,
  event: MagicLinkFlowEvent,
): MagicLinkFlowState {
  switch (event.type) {
    case "sendStart":
      // A resend from the check-your-inbox panel keeps that panel on screen
      // while the request is in flight; a fresh send busy-waits on the form.
      return {
        phase: "sending",
        sentTo: event.email,
        from: state.phase === "checkInbox" ? "checkInbox" : "form",
      };
    case "sendSucceeded":
      return { phase: "checkInbox", sentTo: event.email };
    case "sendFailed":
      return {
        phase: "form",
        errorMessage: event.message ?? MAGIC_LINK_GENERIC_ERROR,
      };
    case "restart":
      return { phase: "form", errorMessage: null };
  }
}

/**
 * Shared request for the existing magic-link endpoint, used by the sign-in
 * page, the session-expiry dialog, and the link-error page. Injectable fetch
 * keeps it unit-testable; the callback route must exist, so it stays /courses.
 */
export async function sendMagicLink(
  fetchLike: typeof fetch,
  email: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchLike("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/courses", errorCallbackURL: "/sign-in/link-error" }),
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    return { ok: response.ok, message: signInErrorMessage(response.status, payload) };
  } catch {
    return { ok: false, message: MAGIC_LINK_GENERIC_ERROR };
  }
}

export const LINK_EXPIRED_ERROR =
  "That sign-in link expired. Links last five minutes — request a fresh one.";
export const LINK_USED_ERROR =
  "That sign-in link was already used. Each link works once — request a fresh one.";
export const LINK_INVALID_ERROR =
  "That sign-in link is not valid. Request a fresh one.";
export const LINK_UNKNOWN_ERROR =
  "That sign-in link did not work. Request a fresh one, or sign in from the start.";

/**
 * Maps better-auth's magic-link verify error param (the plugin redirects to
 * the error callback URL with ?error=<CODE>) to plain-language copy. Codes
 * verified against better-auth 1.5.5's magic-link plugin source.
 */
export function linkErrorMessage(errorParam: string | null): string {
  switch (errorParam) {
    case "EXPIRED_TOKEN":
      return LINK_EXPIRED_ERROR;
    case "ATTEMPTS_EXCEEDED":
      return LINK_USED_ERROR;
    case "INVALID_TOKEN":
      return LINK_INVALID_ERROR;
    default:
      return LINK_UNKNOWN_ERROR;
  }
}
