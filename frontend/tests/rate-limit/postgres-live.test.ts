import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { trustRealIp } from "./route-fixtures";
import { postgresStore } from "@/lib/rate-limit/store";

// Opt-in: point RATE_LIMIT_TEST_DATABASE_URL at a local database. The test works in a schema it creates and drops,
// with the rate-store migrations applied, including the auth cleanup index.
trustRealIp();

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
test.skipIf(!url)("Postgres counts concurrent hits from many instances exactly, and sweeps spent rows", async () => {
  expect(new URL(url!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `rate_limit_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const file of ["0006_abuse_limits", "0007_magic_link_claim", "0008_rate_limit_window_expiry", "0010_auth_rate_limit_cleanup_index"]) {
      await pool.query(await readFile(`drizzle/${file}.sql`, "utf8"));
    }
    const db = drizzle(pool);
    const instances = Array.from({ length: 4 }, () => postgresStore(db));
    let time = 9_999;
    let entered = 0;
    const release = Promise.withResolvers<void>();
    const firstEntered = Promise.withResolvers<void>();
    const routes = instances.map(store => createRateLimitWrapper({ store, secret: "test", now: () => time, session: async () => null })("auth", async () => {
      if (++entered === 3) firstEntered.resolve();
      await release.promise;
      return new Response("ok");
    }));
    const req = () => new Request("http://localhost/api/auth/sign-in/email", { headers: { "x-real-ip": "203.0.113.1" } });
    const first = routes.slice(0, 3).map(route => route(req()));
    try {
      await firstEntered.promise;
      time = 10_000;
      const denied = await Promise.all(routes.map(route => route(req())));
      expect(denied.map(response => response.status)).toEqual([429, 429, 429, 429]);
      expect(entered).toBe(3);
      const delayed = await instances[0].hitLastRequest("auth:/sign-in/email", "delayed", 10_000, 10_000);
      expect(delayed).toEqual({ count: 1, expiresAt: 20_000 });
      expect(await instances[1].hitLastRequest("auth:/sign-in/email", "delayed", 9_999, 10_000)).toEqual({ count: 2, expiresAt: 20_000 });
      expect(await instances[2].hitLastRequest("auth:/sign-in/email", "delayed", 20_000, 10_000)).toEqual({ count: 1, expiresAt: 30_000 });
    } finally {
      release.resolve();
    }
    expect((await Promise.all(first)).map(response => response.status)).toEqual([200, 200, 200]);
    await pool.query("DELETE FROM api_rate_limit");
    const counts = await Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 4].hit("grades", "caller", 100, 60_000)));
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

    // Window 101 starts at 6,060,000 ms; better-auth rows from a minute before that are spent.
    await pool.query(`INSERT INTO auth_rate_limit (id, key, count, last_request)
      VALUES ('spent', 'a', 3, $1), ('live', 'b', 3, $2)`, [100 * 60_000 - 1, 100 * 60_000]);
    expect(await postgresStore(db).hit("grades", "caller", 101, 60_000)).toBe(1);
    const windows = await pool.query("SELECT window_index, count, expires_at FROM api_rate_limit");
    expect(windows.rows.sort((a, b) => a.window_index - b.window_index)).toEqual([
      { window_index: 100, count: 40, expires_at: String(101 * 60_000) },
      { window_index: 101, count: 1, expires_at: String(102 * 60_000) },
    ]);
    expect(await postgresStore(db).hit("grades", "caller", 100, 60_000)).toBe(41);
    expect((await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'auth_rate_limit_last_request_idx'", [schema])).rows[0].indexdef).toContain("(last_request)");

    expect((await pool.query("SELECT id FROM auth_rate_limit")).rows).toEqual([{ id: "live" }]);

    // A 10-minute row outlives the minute rows around it, and is swept once its own window ends.
    // (After the check above: these later windows correctly sweep the "live" row too.)
    expect(await postgresStore(db).hit("authEmail", "inbox", 10, 600_000)).toBe(1);
    expect(await postgresStore(db).hit("grades", "caller", 102, 60_000)).toBe(1);
    expect((await pool.query("SELECT route FROM api_rate_limit WHERE route = 'authEmail'")).rowCount).toBe(1);
    expect(await postgresStore(db).hit("grades", "caller", 112, 60_000)).toBe(1);
    expect((await pool.query("SELECT route FROM api_rate_limit WHERE route = 'authEmail'")).rowCount).toBe(0);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
