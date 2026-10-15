import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema as tables } from "@/lib/db/schema";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { postgresDeviceStore } from "@/server/auth/device-postgres";

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
test.skipIf(!url)("Postgres device grants: concurrent consumption, refresh reuse, generation revocation and isolation", async () => {
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
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
