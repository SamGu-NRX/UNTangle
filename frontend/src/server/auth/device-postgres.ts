import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { deviceGrants, deviceSecurity, deviceTokens } from "@/lib/db/schema";
import { DeviceGrantError, securityChangeTimeout, type DeviceStore } from "./device-grants";

// Database time, so every instance agrees on when a change went stale.
const staleBefore = sql`now() - ${sql.raw(`interval '${securityChangeTimeout} milliseconds'`)}`;
const changeOpen = sql<boolean>`(${deviceSecurity.changeId} IS NOT NULL AND ${deviceSecurity.changeStartedAt} > ${staleBefore})`;

export function postgresDeviceStore(db: Pick<NodePgDatabase<typeof import("@/lib/db/schema").schema>, "transaction" | "insert" | "update">): DeviceStore {
  return {
    transaction: work => db.transaction(async tx => work({
      async grantBy(field, value) {
        const [grant] = await tx.select().from(deviceGrants).where(eq(deviceGrants[field], value)).for("update");
        return grant ?? null;
      },
      async saveGrant(grant) {
        await tx.insert(deviceGrants).values(grant).onConflictDoUpdate({ target: deviceGrants.id, set: grant });
      },
      async token(hash) {
        const [token] = await tx.select().from(deviceTokens).where(eq(deviceTokens.hash, hash));
        return token ?? null;
      },
      async saveToken(token) {
        await tx.insert(deviceTokens).values(token).onConflictDoUpdate({ target: deviceTokens.hash, set: { usedAt: token.usedAt } });
      },
      async generation(userId) {
        await tx.insert(deviceSecurity).values({ userId }).onConflictDoNothing();
        // A bump waits for token issuance to commit; issuance after the bump sees
        // the new generation. Bumps never lock grants, so lock order cannot cycle.
        const [row] = await tx.select({ generation: deviceSecurity.generation, open: changeOpen }).from(deviceSecurity).where(eq(deviceSecurity.userId, userId)).for("share");
        if (row.open) throw new DeviceGrantError("invalid_token", 401);
        return row.generation;
      },
    })),
    async beginSecurityChange(userId, expectedGeneration) {
      const id = randomUUID();
      await db.insert(deviceSecurity).values({ userId }).onConflictDoNothing();
      // One statement checks and opens, so two changes can't both pass the check.
      const rows = await db.update(deviceSecurity)
        .set({ generation: sql`${deviceSecurity.generation} + 1`, changeId: id, changeStartedAt: sql`now()` })
        .where(and(
          eq(deviceSecurity.userId, userId),
          or(isNull(deviceSecurity.changeId), lte(deviceSecurity.changeStartedAt, staleBefore)),
          expectedGeneration === undefined ? undefined : eq(deviceSecurity.generation, expectedGeneration),
        ))
        .returning({ userId: deviceSecurity.userId });
      if (rows.length !== 1) throw new DeviceGrantError("account_changed", 409);
      return id;
    },
    async finishSecurityChange(userId, changeId) {
      const mine = sql`${deviceSecurity.changeId} IS NOT DISTINCT FROM ${changeId}`;
      const rows = await db.update(deviceSecurity)
        .set({
          generation: sql`${deviceSecurity.generation} + 1`,
          changeId: sql`CASE WHEN ${mine} THEN NULL ELSE ${deviceSecurity.changeId} END`,
          changeStartedAt: sql`CASE WHEN ${mine} THEN NULL ELSE ${deviceSecurity.changeStartedAt} END`,
        })
        .where(eq(deviceSecurity.userId, userId))
        .returning({ userId: deviceSecurity.userId });
      if (rows.length !== 1) throw new Error("No account security change to finish");
    },
    async bumpGeneration(userId) {
      await db.insert(deviceSecurity).values({ userId, generation: 1 }).onConflictDoUpdate({ target: deviceSecurity.userId, set: { generation: sql`${deviceSecurity.generation} + 1` } });
    },
  };
}
