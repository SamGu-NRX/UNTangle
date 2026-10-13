import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const guestCookieName = "untangle_guest";
const guestLifetimeSeconds = 30 * 24 * 60 * 60;
export type ApiSession = { user: { id: string } } | null;
export type Identity = { key: string; ipKey: string; setCookie?: string };

export function signingSecret(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const secret = env.RATE_LIMIT_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32) return secret;
  if (env.NODE_ENV === "production" || secret) {
    throw new Error("RATE_LIMIT_SECRET must contain at least 32 bytes.");
  }
  return "untangle-rate-limit-development-only-secret";
}

export function trustedIpHeader(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const proxy = env.RATE_LIMIT_TRUSTED_PROXY ?? (env.VERCEL === "1" ? "vercel" : "none");
  switch (proxy) {
    case "vercel": return "x-vercel-forwarded-for";
    case "cloudflare": return "cf-connecting-ip";
    case "reverse-proxy": return "x-real-ip";
    case "none": return null;
    default: throw new Error("RATE_LIMIT_TRUSTED_PROXY must be vercel, cloudflare, reverse-proxy or none.");
  }
}

export function clientIp(request: Request, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const header = trustedIpHeader(env);
  const raw = header ? request.headers.get(header)?.trim() : undefined;
  if (!raw || !isIP(raw)) return "unknown";
  if (isIP(raw) === 4) return raw;
  const normalized = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  // Collapse IPv4-mapped addresses and IPv6 /64s to prevent address-format and subnet cycling.
  if (normalized.startsWith("::ffff:")) {
    const [high, low] = normalized.slice(7).split(":").map((part) => parseInt(part, 16));
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  const [left, right = ""] = normalized.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = normalized.includes("::") ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return `${words.slice(0, 4).join(":")}:0:0:0:0/64`;
}

export function hashKey(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function resolveIdentity(request: Request, session: ApiSession, options: {
  secret: string; now?: number; env?: Partial<NodeJS.ProcessEnv>;
}): Identity {
  const { secret } = options;
  const now = options.now ?? Date.now();
  const ipKey = hashKey(`ip:${clientIp(request, options.env)}`, secret);
  if (session?.user.id) return { key: hashKey(`user:${session.user.id}`, secret), ipKey };
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${guestCookieName}=`))?.slice(guestCookieName.length + 1);
  if (cookie) {
    const match = /^([a-f0-9-]{36})\.(\d{10,13})\.([a-f0-9]{64})$/.exec(cookie);
    if (match) {
      const [, id, expiry, signature] = match;
      const expected = hashKey(`guest:${id}.${expiry}`, secret);
      if (Number(expiry) > now && Number(expiry) <= now + guestLifetimeSeconds * 1000 &&
          timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
        return { key: hashKey(`guest:${id}`, secret), ipKey };
      }
    }
  }
  const id = randomUUID();
  const expiry = now + guestLifetimeSeconds * 1000;
  const value = `${id}.${expiry}.${hashKey(`guest:${id}.${expiry}`, secret)}`;
  const secure = (options.env ?? process.env).NODE_ENV === "production" ? "; Secure" : "";
  return {
    key: hashKey(`guest:${id}`, secret), ipKey,
    setCookie: `${guestCookieName}=${value}; Path=/; Max-Age=${guestLifetimeSeconds}; HttpOnly; SameSite=Lax${secure}`,
  };
}
