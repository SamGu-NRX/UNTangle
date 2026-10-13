import { expect, test } from "bun:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres";

const testUrl = process.env.RATE_LIMIT_TEST_DATABASE_URL;
test.skipIf(!testUrl)("live Postgres migration, competing instances, expiry and cleanup", async () => {
  const url = new URL(testUrl!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/untangle_rate_limit_test") {
    throw new Error("RATE_LIMIT_TEST_DATABASE_URL must target the local untangle_rate_limit_test database.");
  }
  const schema = `abuse_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: testUrl, max: 10, options: `-c search_path=${schema}` });
  let created = false;
  try {
    // The generated identifier contains only letters, digits and underscores; it belongs only to this test.
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await pool.query(await readFile("drizzle/0006_abuse_limits.sql", "utf8"));
    const db = drizzle(pool);
    const instances = Array.from({ length: 4 }, () => new PostgresRateLimitStore((query) => db.execute(query)));
    const key = crypto.randomUUID();
    const budget = { maxRequests: 5, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 4].consume(key, budget)));
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(35);
    expect(results.filter((result) => !result.allowed).every((result) => result.retryAfter >= 1 && result.retryAfter <= 60)).toBe(true);
    // Age only this test's row instead of waiting on a wall-clock sleep.
    await pool.query("UPDATE api_rate_limit SET hits = ARRAY[0::bigint], expires_at = 0 WHERE key = $1", [key]);
    const newInstance = new PostgresRateLimitStore((query) => db.execute(query));
    expect((await newInstance.consume(key, budget)).remaining).toBe(4);
    const rows = await pool.query<{ count: number }>("SELECT cardinality(hits) AS count FROM api_rate_limit WHERE key = $1", [key]);
    expect(rows.rows[0].count).toBe(1);
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
