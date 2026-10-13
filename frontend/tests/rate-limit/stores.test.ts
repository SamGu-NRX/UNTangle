import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { storeChoice } from "@/lib/rate-limit/config";
import { MemoryRateLimitStore } from "@/lib/rate-limit/store";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres";

const budget = { maxRequests: 2, windowMs: 1500 };
describe("sliding windows", () => {
  test("math, exact expiration, ceiling Retry-After and denial without extension", async () => {
    let now = 1000;
    const store = new MemoryRateLimitStore(() => now);
    expect(await store.consume("a", budget)).toEqual({ allowed: true, remaining: 1, retryAfter: 0, resetAfter: 2 });
    now = 1200;
    expect(await store.consume("a", budget)).toEqual({ allowed: true, remaining: 0, retryAfter: 0, resetAfter: 2 });
    now = 1600;
    expect(await store.consume("a", budget)).toEqual({ allowed: false, remaining: 0, retryAfter: 1, resetAfter: 1 });
    now = 2500;
    expect(await store.consume("a", budget)).toEqual({ allowed: true, remaining: 0, retryAfter: 0, resetAfter: 1 });
    expect((await store.consume("b", budget)).remaining).toBe(1);
  });
  test("simultaneous consumers cannot overspend", async () => {
    const store = new MemoryRateLimitStore(() => 1000);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consume("a", budget)));
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.filter((result) => !result.allowed).map((result) => result.retryAfter)).toEqual(Array(18).fill(2));
  });
  test("memory exhaustion refuses new keys instead of dropping live limits", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now, 1);
    await store.consume("a", budget);
    await expect(store.consume("b", budget)).rejects.toThrow("full");
    now = 1500;
    expect((await store.consume("b", budget)).remaining).toBe(1);
  });
  test("production configuration never falls back to memory", () => {
    expect(() => storeChoice({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
    expect(() => storeChoice({ NODE_ENV: "production", RATE_LIMIT_STORE: "memory" })).toThrow("require");
    expect(storeChoice({ NODE_ENV: "production", DATABASE_URL: "postgres://configured" })).toBe("postgres");
    expect(storeChoice({ NODE_ENV: "test" })).toBe("memory");
    expect(() => storeChoice({ RATE_LIMIT_STORE: "typo" })).toThrow("memory or postgres");
  });
});

describe("Postgres query boundary with mocked returned rows", () => {
  test("atomic query binds hostile keys and maps allowed and denied rows", async () => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    let allowed = true;
    const store = new PostgresRateLimitStore(async (query) => {
      const compiled = new PgDialect().sqlToQuery(query);
      queries.push(compiled);
      if (compiled.sql.startsWith("DELETE")) return { rows: [] };
      return { rows: [{ hits: ["1000", "1200"], allowed, now: "1600" }] };
    });
    const key = "key'; DROP TABLE user;--";
    expect(await store.consume(key, budget)).toEqual({ allowed: true, remaining: 0, retryAfter: 0, resetAfter: 1 });
    allowed = false;
    expect(await store.consume(key, budget)).toEqual({ allowed: false, remaining: 0, retryAfter: 1, resetAfter: 1 });
    expect(queries[1].sql).toContain("ON CONFLICT (key) DO UPDATE");
    expect(queries[1].sql).not.toContain(key);
    expect(queries[1].params).toContain(key);
    expect(queries.filter((query) => query.sql.startsWith("DELETE"))).toHaveLength(1);
  });
  test("storage errors and malformed result rows fail closed", async () => {
    const failed = new PostgresRateLimitStore(async () => { throw new Error("database offline"); });
    await expect(failed.consume("a", budget)).rejects.toThrow("database offline");
    const invalid = new PostgresRateLimitStore(async () => ({ rows: [] }));
    await expect(invalid.consume("a", budget)).rejects.toThrow("invalid row");
  });
});
