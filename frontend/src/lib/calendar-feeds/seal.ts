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
 * token belongs to (a signed-in account, or any guest), so a token copied
 * out of one student's document is refused for every other account.
 *
 * Token: `cf1.<key id>.<iv>.<ciphertext and tag>`, each part base64url. The
 * key id is the first 6 bytes of the key's SHA-256, so a token sealed under
 * a key the server no longer has fails as "sealed with another key" instead
 * of as a corrupt token.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The environment variable holding the sealing key. */
export const CALENDAR_FEED_KEY_ENV = "CALENDAR_FEED_KEY";

const VERSION = "cf1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Whose token it is. A guest has no account, so every guest shares one owner. */
export type FeedOwner = { kind: "user"; id: string } | { kind: "guest" };

export type SealFailure =
  /** The server has no key; calendars can't be connected here. */
  | "not-configured"
  /** The token isn't one this server wrote, belongs to someone else, or was changed. */
  | "unreadable"
  /** The token was sealed under a key this server no longer has. */
  | "other-key"
  /** A guest's token older than GUEST_TOKEN_MAX_AGE_MS. */
  | "expired";

/**
 * How long a guest's token opens. A guest token opens for any guest, so it
 * is a bearer credential: whoever copies a guest's stored preferences could
 * otherwise watch that calendar's busy times for as long as the address and
 * the key last. Every refresh seals the address again, so a guest who keeps
 * using Week never sees this; one who comes back after 30 days pastes the
 * address again. Account tokens don't expire: only their account opens
 * them. Thirty days is a starting value with nothing measured behind it.
 */
export const GUEST_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
const associatedData = (owner: FeedOwner) =>
  Buffer.from(`untangle calendar feed ${VERSION} ${owner.kind === "user" ? `user:${owner.id}` : "guest"}`, "utf8");

/**
 * Seals `url` for `owner`. Each call uses a fresh IV, so sealing one address
 * twice gives two tokens. The sealed text is the issue time in whole seconds,
 * a space, then the address, so the issue time is as tamper-proof as the
 * address.
 */
export function sealFeedUrl(url: string, owner: FeedOwner, key: Buffer | null, now: number = Date.now()): string {
  if (!key) throw new FeedSealError("not-configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(owner));
  const sealed = Buffer.concat([cipher.update(`${Math.floor(now / 1000)} ${url}`, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, keyId(key), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/**
 * The address inside `token`, if it was sealed for `owner` under `key` (and,
 * for a guest, within GUEST_TOKEN_MAX_AGE_MS of `now`); throws FeedSealError
 * otherwise.
 */
export function openFeedUrl(token: string, owner: FeedOwner, key: Buffer | null, now: number = Date.now()): string {
  if (!key) throw new FeedSealError("not-configured");
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
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
  const match = /^(\d{1,12}) ([^]+)$/.exec(text);
  if (!match) throw new FeedSealError("unreadable");
  if (owner.kind === "guest" && now - Number(match[1]) * 1000 > GUEST_TOKEN_MAX_AGE_MS) throw new FeedSealError("expired");
  return match[2];
}

