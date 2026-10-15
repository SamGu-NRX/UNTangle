import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema as tables } from "@/lib/db/schema";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { postgresDeviceStore } from "@/server/auth/device-postgres";

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
test.skipIf(!url)("Postgres device grants: concurrent consumption, refresh reuse, generation revocation, isolation and security changes", async () => {
  expect(new URL(url!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const schema = `device_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema} -c timezone=Pacific/Kiritimati` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) await pool.query((await readFile(`drizzle/${tag}.sql`, "utf8")).replaceAll('"public".', `"${schema}".`));
    await pool.query(`INSERT INTO "user" (id,name,email,email_verified) VALUES ('alice','Alice','alice@my.unt.edu',true),('bob','Bob','bob@my.unt.edu',true)`);
    const db = drizzle(pool, { schema: tables });
    let time = Date.now();
    const clients = Array.from({ length: 4 }, () => createDeviceGrants(postgresDeviceStore(db), () => time));
    const service = clients[0];
    const verifier = "v".repeat(43);
    async function approved(userId: string, clientKind: "mobile" | "extension" = "mobile") {
      const grant = await service.start(clientKind === "mobile"
        ? { clientKind, codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" }
        : { clientKind, codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256", scheduleId: "schedule-a" });
      await service.approve(grant.userCode, userId, "approve", await service.readSecurityGeneration(userId));
      return grant;
    }
    const grant = await approved("alice");
    const exchanges = await Promise.allSettled(clients.map(client => client.exchange(grant.deviceCode, verifier)));
    expect(exchanges.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const winner = exchanges.find(result => result.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") throw new Error("Expected one exchange winner");
    expect((await service.authenticate(winner.value.accessToken, "documents:read")).userId).toBe("alice");
    const rotations = await Promise.allSettled(clients.map(client => client.refresh(winner.value.refreshToken)));
    expect(rotations.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of rotations) if (result.status === "fulfilled") {
      await expect(service.authenticate(result.value.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
      await expect(service.refresh(result.value.refreshToken)).rejects.toMatchObject({ code: "invalid_token" });
    }
    const alice = await approved("alice", "extension");
    const bob = await approved("bob");
    const aliceTokens = await service.exchange(alice.deviceCode, verifier);
    const bobTokens = await service.exchange(bob.deviceCode, verifier);
    await expect(service.authenticate(aliceTokens.accessToken, "schedule:read", "schedule-b")).rejects.toMatchObject({ code: "insufficient_scope" });
    await service.bumpSecurityGeneration("alice");
    await expect(service.authenticate(aliceTokens.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(service.refresh(aliceTokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token" });
    expect((await service.authenticate(bobTokens.accessToken, "documents:read")).userId).toBe("bob");
    const stale = await service.start({ clientKind: "mobile", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
    await expect(service.approve(stale.userCode, "alice", "approve", 0)).rejects.toMatchObject({ code: "unauthorized" });
    const expiring = await approved("bob");
    time += 60_000;
    await expect(service.exchange(expiring.deviceCode, verifier)).rejects.toMatchObject({ code: "expired_token" });
    const hashes = (await pool.query("SELECT hash FROM device_token")).rows as { hash: string }[];
    expect(hashes.length).toBe(8);
    expect(hashes.every(row => /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    const stored = JSON.stringify((await pool.query("SELECT * FROM device_grant")).rows);
    expect(stored.includes(grant.deviceCode)).toBe(false);
    expect(stored.includes(grant.userCode)).toBe(false);

    // Security changes: one at a time across instances, refused on a moved
    // generation, and stale after the timeout by the database's clock.
    time = Date.now();
    const bobDevice = await service.exchange((await approved("bob")).deviceCode, verifier);
    const generation = await service.readSecurityGeneration("bob");
    await expect(service.beginSecurityChange("bob", generation - 1)).rejects.toMatchObject({ code: "stale_session", status: 401 });
    expect(await service.readSecurityGeneration("bob")).toBe(generation);
    const begins = await Promise.allSettled(clients.map(client => client.beginSecurityChange("bob", generation)));
    expect(begins.filter(result => result.status === "fulfilled")).toHaveLength(1);
    // The losers see the winner's bump or its open change; either way, refused.
    expect(begins.filter(result => result.status === "rejected").every(result => ["security_change_in_progress", "stale_session"].includes((result as PromiseRejectedResult).reason.code))).toBe(true);
    const opened = begins.find(result => result.status === "fulfilled");
    if (!opened || opened.status !== "fulfilled") throw new Error("Expected one change to open");
    expect(opened.value.generation).toBe(generation + 1);
    await expect(clients[1].beginSecurityChange("bob")).rejects.toMatchObject({ code: "security_change_in_progress", status: 409 });
    await expect(service.readSecurityGeneration("bob")).rejects.toMatchObject({ code: "security_change_in_progress" });
    await expect(service.authenticate(bobDevice.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(pool.query("UPDATE device_security SET change_id = NULL WHERE user_id = 'bob'")).rejects.toThrow("device_security_change_check");
    await pool.query("UPDATE device_security SET change_started_at = now() - interval '15 minutes 1 second' WHERE user_id = 'bob'");
    expect(await service.readSecurityGeneration("bob")).toBe(generation + 1);
    await expect(service.authenticate(bobDevice.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
    // A timed-out change that nobody replaced still writes; once replaced, its write is refused in the same locked step.
    await service.writeCredential("bob", opened.value.changeId, "stalled-hash", "insert");
    const replacement = await service.beginSecurityChange("bob");
    await expect(service.writeCredential("bob", opened.value.changeId, "late-hash", "update")).rejects.toMatchObject({ code: "stale_session", status: 401 });
    await service.writeCredential("bob", replacement.changeId, "reset-hash", "update");
    await expect(service.writeCredential("bob", replacement.changeId, "second-hash", "insert")).rejects.toThrow("account_credential_user_idx");
    expect((await pool.query("SELECT password FROM account WHERE user_id = 'bob' AND provider_id = 'credential'")).rows).toEqual([{ password: "reset-hash" }]);
    await expect(service.finishSecurityChange("bob", opened.value.changeId)).rejects.toThrow("no longer the open one");
    await expect(service.readSecurityGeneration("bob")).rejects.toMatchObject({ code: "security_change_in_progress" });
    expect(await service.finishSecurityChange("bob", replacement.changeId)).toBe(generation + 3);
    expect((await pool.query("SELECT change_id, change_started_at FROM device_security WHERE user_id = 'bob'")).rows).toEqual([{ change_id: null, change_started_at: null }]);
    await expect(service.finishSecurityChange("nobody", replacement.changeId)).rejects.toThrow("no longer the open one");
    expect(await service.readSecurityGeneration("nobody")).toBe(0);

    // Stale sessions: one conditional delete, which spares current sessions and sessions during a change.
    const current = await service.readSecurityGeneration("bob");
    await pool.query(`INSERT INTO "session" (id, expires_at, token, updated_at, user_id, security_generation) VALUES
      ('s-old', now() + interval '1 day', 't-old', now(), 'bob', $1), ('s-now', now() + interval '1 day', 't-now', now(), 'bob', $2)`, [current - 1, current]);
    const during = await service.beginSecurityChange("bob");
    expect(await service.endStaleSession("t-old")).toBe(false);
    await service.finishSecurityChange("bob", during.changeId);
    await pool.query(`UPDATE "session" SET security_generation = $1 WHERE token = 't-now'`, [current + 2]);
    expect(await service.endStaleSession("t-now")).toBe(false);
    expect(await service.endStaleSession("t-old")).toBe(true);
    expect(await service.endStaleSession("t-missing")).toBe(false);
    expect((await pool.query(`SELECT token FROM "session" WHERE user_id = 'bob'`)).rows).toEqual([{ token: "t-now" }]);
    const fresh = await service.exchange((await approved("bob")).deviceCode, verifier);
    expect((await service.authenticate(fresh.accessToken, "documents:read")).userId).toBe("bob");
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
