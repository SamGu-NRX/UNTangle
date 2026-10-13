import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { postgresClaims } from "@/lib/magic-link-claims";

// Opt-in, like tests/rate-limit/postgres-live.test.ts: point RATE_LIMIT_TEST_DATABASE_URL at a local
// database. The test works in a schema it creates and drops, with migration 0007 applied.
const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;

test.skipIf(!url)("Postgres: concurrent claims of one link from many instances let exactly one through, whatever the time zones", async () => {
  expect(new URL(url!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `magic_link_test_${crypto.randomUUID().replaceAll("-", "")}`;
  // A session time zone far from this process's, so a zone-less timestamp would read every claim as
  // expired (or never expiring) and let a replay through.
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema} -c timezone=Pacific/Kiritimati` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile("drizzle/0007_magic_link_claim.sql", "utf8"));
    const run = (statement: string, params: unknown[]) => pool.query(statement, params);
    const instances = Array.from({ length: 4 }, () => postgresClaims(run));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => instances[i % 4].claim("token-a", expiresAt)));
    expect(results.filter(Boolean)).toHaveLength(1);
    // Still claimed a moment later: the live claim wasn't pruned as expired.
    expect(await instances[0].claim("token-a", expiresAt)).toBe(false);

    // An expired claim is pruned on the next claim, and its row is gone.
    await pool.query("INSERT INTO magic_link_claim (token_hash, expires_at) VALUES ('old', now() - interval '1 minute')");
    expect(await instances[1].claim("token-b", expiresAt)).toBe(true);
    expect((await pool.query("SELECT token_hash FROM magic_link_claim ORDER BY token_hash")).rows).toEqual([
      { token_hash: "token-a" },
      { token_hash: "token-b" },
    ]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test.skipIf(!url)("Postgres: migration 0009 deletes the sessions of never-verified accounts and keeps the rest", async () => {
  expect(new URL(url!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `migration_0009_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    const before = journal.entries.map((entry) => entry.tag).filter((tag) => tag < "0009");
    // 0000's foreign keys name "public"; point them at this test's schema.
    for (const tag of before) await pool.query((await readFile(`drizzle/${tag}.sql`, "utf8")).replaceAll('"public".', `"${schema}".`));
    await pool.query(`INSERT INTO "user" (id, name, email, email_verified) VALUES
      ('verified', 'V', 'v@my.unt.edu', true), ('unverified', 'U', 'u@my.unt.edu', false)`);
    await pool.query(`INSERT INTO "session" (id, expires_at, token, updated_at, user_id) VALUES
      ('s1', now() + interval '1 day', 't1', now(), 'verified'),
      ('s2', now() + interval '1 day', 't2', now(), 'unverified'),
      ('s3', now() + interval '1 day', 't3', now(), 'unverified')`);
    await pool.query(await readFile("drizzle/0009_revoke_unverified_sessions.sql", "utf8"));
    expect((await pool.query(`SELECT id FROM "session" ORDER BY id`)).rows).toEqual([{ id: "s1" }]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "user"`)).rows).toEqual([{ n: 2 }]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
