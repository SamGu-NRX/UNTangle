import { describe, expect, test } from "bun:test";
import { clientIp, resolveIdentity, signingSecret, trustedIpHeader } from "@/lib/rate-limit/identity";
const secret = "test-secret-with-at-least-thirty-two-bytes";
const env = { NODE_ENV: "production", RATE_LIMIT_TRUSTED_PROXY: "reverse-proxy" } satisfies NodeJS.ProcessEnv;
const now = 1_800_000_000_000;
function request(cookie?: string, ip = "203.0.113.8") {
  return new Request("https://untangle.test/api", { headers: { "x-real-ip": ip, ...(cookie ? { cookie } : {}) } });
}

describe("API identity", () => {
  test("sessions determine identity independently of spoofed headers and guest cookies", () => {
    const a = resolveIdentity(request(), { user: { id: "student-a" } }, { secret, now, env });
    const b = resolveIdentity(request("untangle_guest=forged", "203.0.113.9"), { user: { id: "student-a" } }, { secret, now, env });
    const c = resolveIdentity(request(), { user: { id: "student-b" } }, { secret, now, env });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
    expect(a.ipKey).not.toBe(b.ipKey);
    expect(a.setCookie).toBeUndefined();
  });
  test("signed guests persist and cookies carry browser security attributes", () => {
    const a = resolveIdentity(request(), null, { secret, now, env });
    expect(a.setCookie).toContain("HttpOnly; SameSite=Lax; Secure");
    const b = resolveIdentity(request(a.setCookie!.split(";")[0]), null, { secret, now: now + 1000, env });
    expect(b.key).toBe(a.key);
    expect(b.setCookie).toBeUndefined();
  });
  test("tampering, expiry, and secret rotation issue a new identity", () => {
    const original = resolveIdentity(request(), null, { secret, now, env });
    const cookie = original.setCookie!.split(";")[0];
    for (const [value, options] of [
      [cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a"), { secret, now, env }],
      [cookie, { secret, now: now + 30 * 24 * 60 * 60 * 1000, env }],
      [cookie, { secret: secret + "rotated", now, env }],
    ] as const) {
      const identity = resolveIdentity(request(value), null, options);
      expect(identity.key).not.toBe(original.key);
      expect(identity.setCookie).toContain("untangle_guest=");
      expect(identity.ipKey).toBe(resolveIdentity(request(), null, options).ipKey);
    }
  });
  test("untrusted, absent, invalid and chained headers share the unknown bucket", () => {
    expect(clientIp(request(), { RATE_LIMIT_TRUSTED_PROXY: "none" })).toBe("unknown");
    for (const ip of ["invalid", "203.0.113.8, 10.0.0.1", ""]) expect(clientIp(request(undefined, ip), env)).toBe("unknown");
    expect(clientIp(new Request("https://test/"), env)).toBe("unknown");
    expect(clientIp(request(), env)).toBe("203.0.113.8");
    expect(trustedIpHeader({ VERCEL: "1" })).toBe("x-vercel-forwarded-for");
  });
  test("equivalent IPv6 spellings, subnet cycling and mapped IPv4 cannot create new buckets", () => {
    expect(clientIp(request(undefined, "2001:db8::1"), env)).toBe("2001:db8:0:0:0:0:0:0/64");
    expect(clientIp(request(undefined, "2001:0db8:0000:0000::ffff"), env)).toBe("2001:db8:0:0:0:0:0:0/64");
    expect(clientIp(request(undefined, "::ffff:203.0.113.8"), env)).toBe("203.0.113.8");
  });
  test("production requires an adequate runtime secret and known proxy mode", () => {
    expect(() => signingSecret({ NODE_ENV: "production" })).toThrow("RATE_LIMIT_SECRET");
    expect(() => signingSecret({ RATE_LIMIT_SECRET: "short" })).toThrow("32 bytes");
    expect(signingSecret({ RATE_LIMIT_SECRET: secret, NODE_ENV: "production" })).toBe(secret);
    expect(() => trustedIpHeader({ RATE_LIMIT_TRUSTED_PROXY: "guess" })).toThrow("RATE_LIMIT_TRUSTED_PROXY");
  });
});
