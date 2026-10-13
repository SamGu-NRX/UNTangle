import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { postgresStore } from "@/lib/rate-limit/store";

// Opt-in: point RATE_LIMIT_TEST_DATABASE_URL at a local database. The test works in a schema it creates and drops.
const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
test.skipIf(!url)("Postgres counts concurrent hits from many instances exactly, and sweeps spent rows", async () => {
  expect(new URL(url!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `rate_limit_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile("drizzle/0006_abuse_limits.sql", "utf8"));
    const db = drizzle(pool);
    const instances = Array.from({ length: 4 }, () => postgresStore(db));
    const counts = await Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 4].hit("grades", "caller", 100)));
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

    // Window 101 starts at 6,060,000 ms; better-auth rows from a minute before that are spent.
    await pool.query(`INSERT INTO auth_rate_limit (id, key, count, last_request)
      VALUES ('spent', 'a', 3, $1), ('live', 'b', 3, $2)`, [100 * 60_000 - 1, 100 * 60_000]);
    expect(await postgresStore(db).hit("grades", "caller", 101)).toBe(1);
    const windows = await pool.query("SELECT window_index, count FROM api_rate_limit");
    expect(windows.rows).toEqual([{ window_index: 101, count: 1 }]);
    expect((await pool.query("SELECT id FROM auth_rate_limit")).rows).toEqual([{ id: "live" }]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
