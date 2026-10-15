import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { GradesPostgresCache, GradesPostgresLimiter } from "@/lib/grades-history/postgres";
import { GradesMcpClient } from "@/lib/grades-history/client";
import { GradesError } from "@/lib/grades-history/errors";
import { GradesLimiter } from "@/lib/grades-history/limiter";
import { GradesHistoryService } from "@/lib/grades-history/service";
import type { HistoryResult } from "@/lib/grades-history/types";
import { startFakeMcp } from "./fake-mcp";

// Opt-in, localhost only. Each test applies the migration in its own schema.
const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
async function withDatabase(run: (pool: Pool) => Promise<void>) {
  if (!url) throw new Error("RATE_LIMIT_TEST_DATABASE_URL is required");
  expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `grades_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}`, connectionTimeoutMillis: 1_000, query_timeout: 1_000, statement_timeout: 1_000 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile("drizzle/0010_grades_history_postgres.sql", "utf8"));
    await run(pool);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
}

function replayClient(endpoint: string) {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  return new GradesMcpClient({ endpoint, limiter: new GradesLimiter(clock), now: clock.now });
}

test.skipIf(!url)("Postgres preserves complete histories, instructor lists, search, absence, single-flight and expiry", async () => {
  await withDatabase(async (pool) => {
    const fake = startFakeMcp({ pageSize: 2, instructorCourseOnly: true });
    try {
      const db = drizzle(pool);
      const cache = new GradesPostgresCache(db);
      const client = replayClient(fake.endpoint);
      const service = new GradesHistoryService(client, cache);
      const replies = await Promise.all(Array.from({ length: 8 }, () => service.getCourseHistory("CSCE", "1030")));
      for (const reply of replies) expect(reply).toMatchObject({ status: "ok", data: { total: 861, sectionCount: 11 } });
      expect(fake.requests.length).toBe(6);
      const freshService = new GradesHistoryService(client, new GradesPostgresCache(drizzle(pool)));
      expect(await freshService.getCourseHistory("CSCE", "1030")).toEqual(replies[0]);
      expect(fake.requests.length).toBe(6);
      expect(await service.getInstructorHistory("Pradhumna Lal", "Shrestha")).toMatchObject({ status: "ok", data: { total: 394 } });
      expect(await cache.get('v2:instructor:{"firstName":"Pradhumna Lal","lastName":"Shrestha"}')).toMatchObject([{ totalCourses: 1 }]);
      expect(await service.searchGrades("CSCE 1030")).toMatchObject({ status: "ok", data: { courses: [{ subject: "CSCE", number: "1030" }] } });
      const absent = { status: "no-history", source: "untgrades.app", data: null } satisfies HistoryResult<never>;
      expect(await service.getCourseHistory("NONE", "9999")).toEqual(absent);
      expect(await cache.get("v2:course:NONE:9999")).toBeNull();
      const calls = fake.requests.length;
      expect(await freshService.getCourseHistory("NONE", "9999")).toEqual(absent);
      expect(fake.requests.length).toBe(calls);

      const ttl = await pool.query("SELECT extract(epoch FROM (expires_at - clock_timestamp()))::int AS seconds FROM grades_history_cache");
      for (const row of ttl.rows) expect(row.seconds).toBeWithin(86_390, 86_401);
      await pool.query("UPDATE grades_history_cache SET expires_at = clock_timestamp() WHERE key = 'v2:course:NONE:9999'");
      expect(await cache.get("v2:course:NONE:9999")).toBeUndefined();
      expect(await freshService.getCourseHistory("NONE", "9999")).toEqual(absent);
      expect(fake.requests.length).toBe(calls + 1);
      await cache.remove("v2:course:NONE:9999");
      expect(await cache.get("v2:course:NONE:9999")).toBeUndefined();
    } finally { fake.stop(); }
  });
});

test.skipIf(!url)("Postgres atomic replacement exposes only complete records", async () => {
  await withDatabase(async (pool) => {
    const a = new GradesPostgresCache(drizzle(pool));
    const b = new GradesPostgresCache(drizzle(pool));
    const first = { pages: [1, 2], generation: "first" };
    const second = { pages: [3, 4], generation: "second" };
    await a.set("generation", first);
    const reads = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      await (i % 2 ? a : b).set("generation", i % 2 ? first : second);
      return b.get("generation");
    }));
    for (const value of reads) expect(Bun.deepEquals(value, first) || Bun.deepEquals(value, second)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM grades_history_cache")).rows).toEqual([{ count: 1 }]);
  });
});

test.skipIf(!url)("Postgres never caches unavailable and reports storage failures for reads, writes and invalidation", async () => {
  await withDatabase(async (pool) => {
    const fake = startFakeMcp({ replies: [{ status: 500 }] });
    try {
      const cache = new GradesPostgresCache(drizzle(pool));
      const service = new GradesHistoryService(replayClient(fake.endpoint), cache);
      expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "upstream" } });
      expect(await cache.get("v2:course:CSCE:1030")).toBeUndefined();
      expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "ok", data: { total: 861 } });
      expect(fake.requests.length).toBe(2);
      await pool.query("UPDATE grades_history_cache SET record = '{}'::jsonb");
      expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage" } });
      await pool.query("DROP TABLE grades_history_cache");
      expect(await service.getCourseHistory("CSCE", "1030")).toMatchObject({ status: "unavailable", error: { reason: "storage" } });
      await expect(cache.set("key", null)).rejects.toMatchObject({ reason: "storage" });
      await expect(cache.remove("key")).rejects.toMatchObject({ reason: "storage" });
      expect(fake.requests.length).toBe(2);
    } finally { fake.stop(); }
  });
});

test.skipIf(!url)("two concurrent Postgres limiters never spend more than 20 permits in one minute", async () => {
  await withDatabase(async (pool) => {
    const instances = [new GradesPostgresLimiter(drizzle(pool), undefined, 58_500), new GradesPostgresLimiter(drizzle(pool), undefined, 58_500)];
    const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => instances[i % 2].acquire()));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled").length).toBe(20);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ reason: "throttled" });
    const { rows } = await pool.query("SELECT sent_at FROM grades_history_budget");
    const sent: number[] = rows[0].sent_at.map(Number);
    expect(sent.length).toBe(20);
    expect(sent[19] - sent[0]).toBeWithin(57_000, 60_000);
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(3_000);
  });
}, 70_000);

test.skipIf(!url)("two Postgres limiters enforce the rolling hour and expire old permits using database time", async () => {
  await withDatabase(async (pool) => {
    const a = new GradesPostgresLimiter(drizzle(pool), { now: () => 0, sleep: async () => { throw new Error("Must not sleep"); } }, 0);
    const b = new GradesPostgresLimiter(drizzle(pool), { now: () => 9e12, sleep: async () => { throw new Error("Must not sleep"); } }, 0);
    await a.acquire();
    await pool.query(`UPDATE grades_history_budget SET next_permit_at = to_timestamp(0),
      sent_at = ARRAY(SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 30000 + n FROM generate_series(1, 299) n)`);
    const outcomes = await Promise.allSettled([a.acquire(), b.acquire()]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled").length).toBe(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toMatchObject({ reason: "throttled" });
    expect((await pool.query("SELECT cardinality(sent_at) AS count FROM grades_history_budget")).rows).toEqual([{ count: 300 }]);
    await pool.query(`UPDATE grades_history_budget SET next_permit_at = to_timestamp(0),
      sent_at = ARRAY(SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 3600000 FROM generate_series(1, 300))`);
    await b.acquire();
    expect((await pool.query("SELECT cardinality(sent_at) AS count FROM grades_history_budget")).rows).toEqual([{ count: 1 }]);
  });
});

test.skipIf(!url)("a permit completed after the 15-second deadline cannot send upstream", async () => {
  await withDatabase(async (pool) => {
    const fake = startFakeMcp();
    try {
      // The first two clock reads precede the permit transaction; the next
      // read simulates its reply arriving after the caller's wait deadline.
      let reads = 0;
      const clock = { now: () => ++reads <= 2 ? 0 : 15_001, sleep: async () => { throw new Error("Must not sleep"); } };
      const limiter = new GradesPostgresLimiter(drizzle(pool), clock);
      const client = new GradesMcpClient({ endpoint: fake.endpoint, limiter });
      await expect(client.call("search_grades", { query: "CSCE 1030" })).rejects.toMatchObject({ reason: "throttled", retryAfterSeconds: 1 });
      expect((await pool.query("SELECT cardinality(sent_at) AS count FROM grades_history_budget")).rows).toEqual([{ count: 1 }]);
      expect(fake.requests.length).toBe(0);
    } finally { fake.stop(); }
  });
});

test.skipIf(!url)("the permit deadline includes time queued for a database connection", async () => {
  await withDatabase(async (pool) => {
    const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    try {
      const limiter = new GradesPostgresLimiter(drizzle(pool), undefined, 50);
      await expect(limiter.acquire()).rejects.toMatchObject({ reason: "throttled", retryAfterSeconds: 1 });
    } finally { for (const client of clients) client.release(); }
    // Let the abandoned transaction finish before the test schema is removed.
    // Its permit remains charged, so a timeout cannot increase the budget.
    await expect(new GradesPostgresLimiter(drizzle(pool)).acquire()).resolves.toBeUndefined();
    expect((await pool.query("SELECT cardinality(sent_at) AS count FROM grades_history_budget")).rows).toEqual([{ count: 2 }]);
  });
});

test.skipIf(!url).each([429, 503])("HTTP %d cooldown is shared, cannot be shortened and fails closed on storage errors", async (status) => {
  await withDatabase(async (pool) => {
    const fake = startFakeMcp({ replies: [{ status, retryAfter: "120" }] });
    try {
      const a = new GradesPostgresLimiter(drizzle(pool));
      const b = new GradesPostgresLimiter(drizzle(pool));
      const client = new GradesMcpClient({ endpoint: fake.endpoint, limiter: a });
      await expect(client.call("search_grades", { query: "CSCE 1030" })).rejects.toMatchObject({ reason: status === 429 ? "throttled" : "upstream", retryAfterSeconds: 120 });
      await b.cooldown(1_000);
      await expect(new GradesMcpClient({ endpoint: fake.endpoint, limiter: b }).call("search_grades", { query: "CSCE 1030" })).rejects.toMatchObject({ reason: "throttled", retryAfterSeconds: 120 });
      expect(fake.requests.length).toBe(1);
      await pool.query("DROP TABLE grades_history_budget");
      await expect(a.acquire()).rejects.toMatchObject({ reason: "storage" });
      await expect(a.cooldown(1_000)).rejects.toMatchObject({ reason: "storage" });
      await expect(client.call("search_grades", { query: "CSCE 1030" })).rejects.toBeInstanceOf(GradesError);
      expect(fake.requests.length).toBe(1);
    } finally { fake.stop(); }
  });
});
