import { expect, test } from "bun:test";
import { checkProductionEnv, trustedIpHeader } from "@/lib/rate-limit/config";

const database = { DATABASE_URL: "postgres://localhost/untangle" };

test("production refuses to start without a trusted proxy or the shared store", () => {
  expect(() => checkProductionEnv(database)).toThrow("RATE_LIMIT_TRUSTED_PROXY");
  expect(() => checkProductionEnv({ ...database, RATE_LIMIT_TRUSTED_PROXY: "none" })).toThrow("RATE_LIMIT_TRUSTED_PROXY");
  expect(() => checkProductionEnv({ VERCEL: "1" })).toThrow("DATABASE_URL");
  expect(() => checkProductionEnv({ ...database, VERCEL: "1" })).not.toThrow();
  expect(() => checkProductionEnv({ ...database, RATE_LIMIT_TRUSTED_PROXY: "cloudflare" })).not.toThrow();
});

test("each proxy setting names the one header that proxy overwrites", () => {
  expect(trustedIpHeader({})).toBeNull();
  expect(trustedIpHeader({ VERCEL: "1" })).toBe("x-vercel-forwarded-for");
  expect(trustedIpHeader({ RATE_LIMIT_TRUSTED_PROXY: "cloudflare" })).toBe("cf-connecting-ip");
  expect(trustedIpHeader({ RATE_LIMIT_TRUSTED_PROXY: "reverse-proxy", VERCEL: "1" })).toBe("x-real-ip");
  for (const typo of ["guess", "toString"]) {
    expect(() => trustedIpHeader({ RATE_LIMIT_TRUSTED_PROXY: typo })).toThrow("must be one of");
  }
});
