import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { deviceGrants, deviceSecurity, deviceTokens } from "@/lib/db/schema";
import { DeviceGrantError, type DeviceStore } from "./device-grants";

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
        const [row] = await tx.select().from(deviceSecurity).where(eq(deviceSecurity.userId, userId)).for("share");
        if (row.activeTransitions > 0) throw new DeviceGrantError("invalid_token", 401);
        return row.generation;
      },
    })),
    async beginSecurityChange(userId) {
      await db.insert(deviceSecurity).values({ userId, generation: 1, activeTransitions: 1 }).onConflictDoUpdate({ target: deviceSecurity.userId, set: { generation: sql`${deviceSecurity.generation} + 1`, activeTransitions: sql`${deviceSecurity.activeTransitions} + 1` } });
    },
    async finishSecurityChange(userId) {
      const rows = await db.update(deviceSecurity).set({ generation: sql`${deviceSecurity.generation} + 1`, activeTransitions: sql`${deviceSecurity.activeTransitions} - 1` }).where(and(eq(deviceSecurity.userId, userId), gt(deviceSecurity.activeTransitions, 0))).returning({ userId: deviceSecurity.userId });
      if (rows.length !== 1) throw new Error("No active account security change to finish");
    },
    async bumpGeneration(userId) {
      await db.insert(deviceSecurity).values({ userId, generation: 1 }).onConflictDoUpdate({ target: deviceSecurity.userId, set: { generation: sql`${deviceSecurity.generation} + 1` } });
    },
  };
}
