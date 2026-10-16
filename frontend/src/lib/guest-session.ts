/**
 * Whose guest work is it? The guest stores outlive the browser session, so
 * on a shared computer they can hold an earlier visitor's plan and
 * transcript. A cookie with no expiry, which ends when the browser closes,
 * holds a random token for this browser session, and every write of the
 * guest's plan or preferences by a guest the server confirmed stamps the
 * guest stores with it. (Library entries carry no stamp of their own; they
 * move with the plan.) Signing in carries guest work into the
 * account only when the stamp matches: a guest wrote it in this browser
 * session. Opening the site signed out stamps nothing, so an earlier
 * visitor's untouched work never reaches the next student's account. (A
 * visitor who edits an earlier visitor's work adopts it; asking first is the
 * guest guards' job, docs/architecture/README.md, "Guests".)
 */
const COOKIE = "untangle_guest_session";
const STAMP_KEY = "untangle.guest-session.v1";

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

/** Call after any write to the guest stores. */
export function stampGuestWork(): void {
  const token = sessionToken(true);
  try {
    if (token) window.localStorage.setItem(STAMP_KEY, token);
  } catch {
    // Without storage there is no guest work to stamp.
  }
}

/** True when the guest stores were last written in this browser session. */
export function guestWorkIsThisSession(): boolean {
  const token = sessionToken(false);
  try {
    return token !== null && window.localStorage.getItem(STAMP_KEY) === token;
  } catch {
    return false;
  }
}

/** The guest stores were settled or cleared; their stamp goes with them. */
export function forgetGuestWork(): void {
  try {
    window.localStorage.removeItem(STAMP_KEY);
  } catch {
    // Nothing to forget.
  }
}
