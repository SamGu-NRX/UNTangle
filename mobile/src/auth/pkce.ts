/**
 * PKCE S256, in two injected pieces so the flow never depends on a native
 * module directly. The server's contract (packages/contracts/src/device-grant.ts)
 * fixes both shapes: the verifier and the challenge are 43 characters of
 * base64url, which is exactly a 32-byte value with the padding removed.
 */

/** Characters the server accepts for the verifier and the challenge. */
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The shape both the verifier and the challenge must have. */
export const PKCE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Cryptographically strong randomness, provided by the native binding. */
export type RandomBytes = (length: number) => Uint8Array;

/** SHA-256 of a string, base64url-encoded and unpadded, per S256. */
export type Sha256Base64Url = (value: string) => Promise<string>;

/** 32 bytes to 43 base64url characters, no padding, no btoa. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const b0 = bytes[index];
    const b1 = remaining > 1 ? bytes[index + 1] : 0;
    const b2 = remaining > 2 ? bytes[index + 2] : 0;
    out += BASE64URL[b0 >> 2];
    out += BASE64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (remaining > 1) out += BASE64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (remaining > 2) out += BASE64URL[b2 & 0x3f];
  }
  return out;
}

/** Base64 (padded or not) to base64url, for digests that arrive as base64. */
export function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PkcePair = { verifier: string; challenge: string };

/**
 * A fresh verifier and its S256 challenge. Throws when the injected pieces
 * produce a value the server would refuse, so a broken binding fails loudly
 * instead of starting a flow that can never exchange.
 */
export async function createPkcePair(randomBytes: RandomBytes, sha256Base64Url: Sha256Base64Url): Promise<PkcePair> {
  const verifier = bytesToBase64Url(randomBytes(32));
  if (!PKCE_VALUE_PATTERN.test(verifier)) throw new Error("The PKCE verifier does not match the server's shape.");
  const challenge = base64ToBase64Url(await sha256Base64Url(verifier));
  if (!PKCE_VALUE_PATTERN.test(challenge)) throw new Error("The PKCE challenge does not match the server's shape.");
  return { verifier, challenge };
}
