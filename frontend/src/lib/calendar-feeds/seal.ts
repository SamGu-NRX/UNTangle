/**
 * Sealing a calendar feed's address so nothing outside the server can read it.
 *
 * A private feed address is a password: anyone holding a Google "secret
 * address" reads the whole calendar. docs/architecture/README.md requires
 * private feed URLs to be encrypted and never logged, so the server hands the
 * browser a sealed token instead of storing the address anywhere. The token
 * is what the preferences document (or a guest's device) keeps; the busy
 * route opens it to refresh the busy times, and nothing else ever can.
 *
 * Sealing is AES-256-GCM with a fresh 96-bit IV per token. The key comes
 * from the CALENDAR_FEED_KEY environment variable: 32 random bytes in
 * base64 (`openssl rand -base64 32`). The associated data names who the
 * token belongs to, so a token opens only for that owner:
 * - an account (`user:<id>`), for a signed-in student;
 * - one browser (`guest:<id>`), for a guest. The id is a random secret in an
 *   HttpOnly cookie the page can't read (GUEST_COOKIE), so a token copied out
 *   of a guest's localStorage opens for nobody; whoever also has the cookie
 *   already has the browser.
 *
 * The sealed text is the issue time, the first issue time, then the address.
 * A guest's token stops opening 30 days after it was issued and 90 days after
 * the first one in its line, however often it was sealed again in between.
 *
 * Token: `<kind>1.<key id>.<iv>.<ciphertext and tag>`, each part base64url,
 * the kind `cf` for an account's and `cg` for a guest's. The kind isn't
 * secret: it lets the server tell "sign in again" from "paste the address
 * again" without opening anything. The key id is the first 6 bytes of the
 * key's SHA-256, so a token sealed under a key the server no longer has fails
 * as "sealed with another key" instead of as a corrupt token.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The environment variable holding the sealing key. */
export const CALENDAR_FEED_KEY_ENV = "CALENDAR_FEED_KEY";

const PREFIX = { user: "cf1", guest: "cg1" } as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whose token it is: an account, or one browser a guest uses (its GUEST_COOKIE id). */
export type FeedOwner = { kind: "user"; id: string } | { kind: "guest"; id: string };

/**
 * The cookie naming a guest's browser. HttpOnly, so the page's scripts and
 * anything copying its storage can't read it; Secure and SameSite=Lax; sent
 * only to the calendar-feed routes.
 */
export const GUEST_COOKIE = "untangle-calendar-guest";
const GUEST_ID = /^[A-Za-z0-9_-]{22,64}$/;

/** A new guest id: 128 random bits. */
export const newGuestId = () => randomBytes(16).toString("base64url");

/** The guest id in a request's cookies, or null. */
export function guestIdFrom(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === GUEST_COOKIE) {
      const id = value.join("=");
      return GUEST_ID.test(id) ? id : null;
    }
  }
  return null;
}

/** The Set-Cookie value for a guest id: the 90-day lifetime of the tokens it opens, renewed on each use. */
export function guestCookie(id: string): string {
  return `${GUEST_COOKIE}=${id}; Path=/api/v1/calendar-feeds; Max-Age=${GUEST_TOKEN_LIFETIME_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
}

/** Which kind of owner a token was sealed for, read from its prefix; null when it isn't a token. */
export function tokenKind(token: string): FeedOwner["kind"] | null {
  return token.startsWith(`${PREFIX.user}.`) ? "user" : token.startsWith(`${PREFIX.guest}.`) ? "guest" : null;
}

export type SealFailure =
  /** The server has no key; calendars can't be connected here. */
  | "not-configured"
  /** The token isn't one this server wrote, belongs to someone else, or was changed. */
  | "unreadable"
  /** The token was sealed under a key this server no longer has. */
  | "other-key"
  /** A guest's token past GUEST_TOKEN_MAX_AGE_MS or GUEST_TOKEN_LIFETIME_MS. */
  | "expired";

/**
 * How long one guest token opens after it was issued, and how long a line of
 * them opens after the first. Every refresh seals the address again with a
 * new issue time and the same first one, so a guest who keeps using Week
 * pastes the address again every 90 days at most. Account tokens don't
 * expire: only their account opens them. Both values are starting points
 * with nothing measured behind them.
 */
export const GUEST_TOKEN_MAX_AGE_MS = 30 * DAY_MS;
export const GUEST_TOKEN_LIFETIME_MS = 90 * DAY_MS;

export class FeedSealError extends Error {
  constructor(readonly kind: SealFailure) {
    super(
      kind === "not-configured"
        ? `${CALENDAR_FEED_KEY_ENV} is not set, so calendar feeds can't be sealed.`
        : kind === "other-key"
          ? "This calendar was connected under a key the server no longer has."
          : kind === "expired"
            ? "This guest calendar was sealed too long ago to open."
            : "This sealed calendar address can't be opened.",
    );
    this.name = "FeedSealError";
  }
}

/**
 * The sealing key from the environment, or null when it isn't set. A value
 * that is set but isn't 32 bytes of base64 throws: a mistyped key must fail
 * loudly at the first request, not seal tokens nobody can open later.
 */
export function feedKeyFromEnv(
  // Read by name, so `grep process.env.` (frontend/README.md, Environment variables) finds it.
  env: Partial<Record<string, string | undefined>> = { [CALENDAR_FEED_KEY_ENV]: process.env.CALENDAR_FEED_KEY },
): Buffer | null {
  const raw = env[CALENDAR_FEED_KEY_ENV]?.trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error(`${CALENDAR_FEED_KEY_ENV} must be base64 (openssl rand -base64 32).`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${CALENDAR_FEED_KEY_ENV} must decode to 32 bytes; it decodes to ${key.length}.`);
  }
  return key;
}

const keyId = (key: Buffer) => createHash("sha256").update(key).digest().subarray(0, 6).toString("base64url");
const associatedData = (owner: FeedOwner) => Buffer.from(`untangle calendar feed v1 ${owner.kind}:${owner.id}`, "utf8");

/**
 * Seals `url` for `owner`. Each call uses a fresh IV, so sealing one address
 * twice gives two tokens. `firstIssued` carries a guest token's line through
 * a reseal; a new connection starts it at `now`.
 */
export function sealFeedUrl(url: string, owner: FeedOwner, key: Buffer | null, now: number = Date.now(), firstIssued: number = now): string {
  if (!key) throw new FeedSealError("not-configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(owner));
  const text = `${Math.floor(now / 1000)} ${Math.floor(firstIssued / 1000)} ${url}`;
  const sealed = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [PREFIX[owner.kind], keyId(key), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/** What a token holds: the address and its issue times (epoch ms). */
export type OpenedFeed = { url: string; issued: number; firstIssued: number };

/**
 * The address inside `token`, if it was sealed for `owner` under `key` (and,
 * for a guest, is within both lifetimes at `now`); throws FeedSealError
 * otherwise.
 */
export function openFeedToken(token: string, owner: FeedOwner, key: Buffer | null, now: number = Date.now()): OpenedFeed {
  if (!key) throw new FeedSealError("not-configured");
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX[owner.kind] || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new FeedSealError("unreadable");
  }
  if (parts[1] !== keyId(key)) throw new FeedSealError("other-key");
  const iv = Buffer.from(parts[2], "base64url");
  const sealed = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) throw new FeedSealError("unreadable");
  let text: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData(owner));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    text = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    // GCM refuses a changed token or another owner's alike; the reason isn't recoverable from here.
    throw new FeedSealError("unreadable");
  }
  const match = /^(\d{1,12}) (\d{1,12}) ([^]+)$/.exec(text);
  if (!match) throw new FeedSealError("unreadable");
  const opened = { url: match[3], issued: Number(match[1]) * 1000, firstIssued: Number(match[2]) * 1000 };
  if (owner.kind === "guest" && (now - opened.issued > GUEST_TOKEN_MAX_AGE_MS || now - opened.firstIssued > GUEST_TOKEN_LIFETIME_MS)) {
    throw new FeedSealError("expired");
  }
  return opened;
}

/** The address inside `token`; see openFeedToken. */
export function openFeedUrl(token: string, owner: FeedOwner, key: Buffer | null, now: number = Date.now()): string {
  return openFeedToken(token, owner, key, now).url;
}
