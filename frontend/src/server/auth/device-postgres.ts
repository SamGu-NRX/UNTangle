import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { deviceGrants, deviceSecurity, deviceTokens } from "@/lib/db/schema";
import { changeNotCurrent, DeviceGrantError, securityChangeInProgress, securityChangeTimeout, staleSession, type DeviceStore } from "./device-grants";

// Database time, so every instance agrees on when a change went stale.
const staleBefore = sql`now() - ${sql.raw(`interval '${securityChangeTimeout} milliseconds'`)}`;
const changeOpen = sql<boolean>`(${deviceSecurity.changeId} IS NOT NULL AND ${deviceSecurity.changeStartedAt} > ${staleBefore})`;

export function postgresDeviceStore(db: Pick<NodePgDatabase<typeof import("@/lib/db/schema").schema>, "transaction" | "insert" | "update" | "select">): DeviceStore {
  async function readGeneration(userId: string) {
    const [row] = await db.select({ generation: deviceSecurity.generation, changing: changeOpen }).from(deviceSecurity).where(eq(deviceSecurity.userId, userId));
    return row ?? { generation: 0, changing: false };
  }
  return {
    readGeneration,
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
      const changeId = randomUUID();
      await db.insert(deviceSecurity).values({ userId }).onConflictDoNothing();
      // One statement checks and opens, so two changes can't both pass the check.
      const [row] = await db.update(deviceSecurity)
        .set({ generation: sql`${deviceSecurity.generation} + 1`, changeId, changeStartedAt: sql`now()` })
        .where(and(
          eq(deviceSecurity.userId, userId),
          or(isNull(deviceSecurity.changeId), lte(deviceSecurity.changeStartedAt, staleBefore)),
          expectedGeneration === undefined ? undefined : eq(deviceSecurity.generation, expectedGeneration),
        ))
        .returning({ generation: deviceSecurity.generation });
      if (row) return { changeId, generation: row.generation };
      // Refused. Read again only to say why.
      throw (await readGeneration(userId)).changing ? securityChangeInProgress() : staleSession();
    },
    async holdsSecurityChange(userId, changeId) {
      const [row] = await db.select({ userId: deviceSecurity.userId }).from(deviceSecurity)
        .where(and(eq(deviceSecurity.userId, userId), eq(deviceSecurity.changeId, changeId)));
      return row !== undefined;
    },
    async finishSecurityChange(userId, changeId) {
      const [row] = await db.update(deviceSecurity)
        .set({ generation: sql`${deviceSecurity.generation} + 1`, changeId: null, changeStartedAt: null })
        .where(and(eq(deviceSecurity.userId, userId), eq(deviceSecurity.changeId, changeId)))
        .returning({ generation: deviceSecurity.generation });
      if (!row) throw changeNotCurrent();
      return row.generation;
    },
    async bumpGeneration(userId) {
      await db.insert(deviceSecurity).values({ userId, generation: 1 }).onConflictDoUpdate({ target: deviceSecurity.userId, set: { generation: sql`${deviceSecurity.generation} + 1` } });
    },
  };
}
