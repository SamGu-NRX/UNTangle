/**
 * Whose guest work is it? The guest stores outlive the browser session, so
 * on a shared computer they can hold an earlier visitor's plan and
 * transcript. A cookie with no expiry, which ends when the browser closes,
 * holds a random token for this browser session. A guest the server
 * confirmed stamps the plan or the preferences with it on each write, each
 * part on its own. Signing in carries a part into the account only when its
 * stamp matches: a guest wrote it in this browser session. (Library entries
 * carry no stamp; they move with a stamped plan.) Opening the site signed out stamps nothing, so an earlier
 * visitor's untouched work never reaches the next student's account. (A
 * visitor who edits an earlier visitor's work adopts it; asking first is the
 * guest guards' job, docs/architecture/README.md, "Guests".)
 */
const COOKIE = "untangle_guest_session";
/** Followed by the part: "untangle.guest-session.v1:plan". */
export const STAMP_PREFIX = "untangle.guest-session.v1:";

function sessionToken(create: boolean): string | null {
  if (typeof document === "undefined") return null;
  const found = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (found) return found;
  if (!create) return null;
  const token = crypto.randomUUID();
  document.cookie = `${COOKIE}=${token}; path=/; SameSite=Lax`;
  return token;
}

/** The guest stores, each stamped on its own, so editing one doesn't vouch for another. */
export type GuestPart = "plan" | "preferences";
const PARTS: readonly GuestPart[] = ["plan", "preferences"];
const stampKey = (part: GuestPart) => `${STAMP_PREFIX}${part}`;

/** Call after a guest the server confirmed writes this part of the guest stores. */
export function stampGuestWork(part: GuestPart): void {
  const token = sessionToken(true);
  try {
    if (token) window.localStorage.setItem(stampKey(part), token);
  } catch {
    // Without storage there is no guest work to stamp.
  }
}

/** True when this part (or, with none named, any part) was last written in this browser session. */
export function guestWorkIsThisSession(part?: GuestPart): boolean {
  const token = sessionToken(false);
  try {
    return token !== null && (part ? [part] : PARTS).some((each) => window.localStorage.getItem(stampKey(each)) === token);
  } catch {
    return false;
  }
}

/** These parts were settled or cleared; their stamps go with them. */
export function forgetGuestWork(parts: readonly GuestPart[] = PARTS): void {
  try {
    for (const part of parts) window.localStorage.removeItem(stampKey(part));
  } catch {
    // Nothing to forget.
  }
}
