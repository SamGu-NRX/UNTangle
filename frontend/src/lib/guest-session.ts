/**
 * Whose guest work is it? The guest stores outlive the browser session, so
 * on a shared computer they can hold an earlier visitor's plan and
 * transcript. A cookie with no expiry, which ends when the browser closes,
 * holds a random token for this browser session. A guest the server
 * confirmed stamps the plan, the preferences or the saved-schedule library
 * with it on each write, each part on its own. Signing in carries a part into
 * the account only when its stamp matches: a guest wrote it in this browser
 * session. (The library also moves with a stamped plan.) Opening the site signed out stamps nothing, so an earlier
 * visitor's untouched work never reaches the next student's account. (A
 * visitor who edits an earlier visitor's work adopts it; asking first is the
 * guest guards' job, docs/architecture/README.md, "Guests".)
 */
const COOKIE = "untangle_guest_session";
/** An unmeasured starting value matching the README's 30-minute idle lock. */
export const GUEST_HANDOVER_MS = 30 * 60 * 1000;
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
export type GuestPart = "plan" | "preferences" | "library";
const PARTS: readonly GuestPart[] = ["plan", "preferences", "library"];
const stampKey = (part: GuestPart) => `${STAMP_PREFIX}${part}`;

/** Call after a guest the server confirmed writes this part of the guest stores. */
export function stampGuestWork(part: GuestPart): void {
  const token = sessionToken(true);
  try {
    if (token) window.localStorage.setItem(stampKey(part), `${token}.${Date.now()}`);
  } catch {
    // Without storage there is no guest work to stamp.
  }
}

type GuestStamp = { token: string; writtenAt: number | null };

function readStamp(part: GuestPart): GuestStamp | null {
  try {
    const value = window.localStorage.getItem(stampKey(part));
    if (!value) return null;
    const separator = value.lastIndexOf(".");
    if (separator < 1) return { token: value, writtenAt: null };
    const writtenAt = Number(value.slice(separator + 1));
    return { token: value.slice(0, separator), writtenAt: Number.isFinite(writtenAt) ? writtenAt : null };
  } catch {
    return null;
  }
}

/** The matching stamp's age, without reading the guest stores themselves. */
export function guestWorkHandover(part?: GuestPart, now = Date.now()): { needsConfirmation: boolean; writtenAt: number | null } {
  const token = sessionToken(false);
  if (!token) return { needsConfirmation: false, writtenAt: null };
  const matching = (part ? [part] : PARTS).map(readStamp).filter((stamp): stamp is GuestStamp => stamp?.token === token);
  if (matching.length === 0) return { needsConfirmation: false, writtenAt: null };
  const hasUnknownTime = matching.some((stamp) => stamp.writtenAt === null);
  const knownTimes = matching.flatMap((stamp) => (stamp.writtenAt === null ? [] : [stamp.writtenAt]));
  const oldest = knownTimes.length > 0 ? Math.min(...knownTimes) : null;
  return { needsConfirmation: hasUnknownTime || oldest === null || now - oldest > GUEST_HANDOVER_MS, writtenAt: hasUnknownTime ? null : oldest };
}

/** True when this part (or, with none named, any part) was last written in this browser session. */
export function guestWorkIsThisSession(part?: GuestPart): boolean {
  const token = sessionToken(false);
  try {
    return token !== null && (part ? [part] : PARTS).some((each) => readStamp(each)?.token === token);
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
