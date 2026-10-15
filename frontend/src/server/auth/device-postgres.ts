import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accounts, deviceGrants, deviceSecurity, deviceTokens, sessions } from "@/lib/db/schema";
import { changeNotCurrent, credentialExists, DeviceGrantError, securityChangeInProgress, securityChangeTimeout, staleSession, type DeviceStore } from "./device-grants";

// Database time, so every instance agrees on when a change went stale.
const staleBefore = sql`now() - ${sql.raw(`interval '${securityChangeTimeout} milliseconds'`)}`;
const changeOpen = sql<boolean>`(${deviceSecurity.changeId} IS NOT NULL AND ${deviceSecurity.changeStartedAt} > ${staleBefore})`;

/**
 * The database's error code and constraint from a failed query, never its
 * message: drizzle's message lists the query's parameters (a password hash,
 * a session token), and better-auth logs whole errors. A refusal or an error
 * of our own is rethrown unchanged.
 */
function databaseFailure(error: unknown): { code?: string; constraint?: string } {
  if (error instanceof DeviceGrantError) throw error;
  const failure = error as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
  const database = failure?.cause ?? (failure?.code ? failure : null);
  if (!database) throw error;
  return { code: database.code, constraint: database.constraint };
}

export function postgresDeviceStore(db: Pick<NodePgDatabase<typeof import("@/lib/db/schema").schema>, "transaction" | "insert" | "update" | "select" | "delete">): DeviceStore {
  async function readGeneration(userId: string) {
    const [row] = await db.select({ generation: deviceSecurity.generation, changing: changeOpen }).from(deviceSecurity).where(eq(deviceSecurity.userId, userId));
    return row ?? { generation: 0, changing: false };
  }
  /** The check and the write in one transaction (DeviceStore.writeCredential). */
  async function lockedCredentialWrite(userId: string, changeId: string, passwordHash: string, mode: "update" | "insert") {
    await db.transaction(async tx => {
      // The row lock makes the check and the write one step: a change that
      // replaces this one waits for the write, or the write sees it and stops.
      const [row] = await tx.select({ changeId: deviceSecurity.changeId }).from(deviceSecurity).where(eq(deviceSecurity.userId, userId)).for("update");
      if (row?.changeId !== changeId) throw staleSession();
      const now = new Date();
      const credential = and(eq(accounts.userId, userId), eq(accounts.providerId, "credential"));
      if (mode === "update") {
        const updated = await tx.update(accounts).set({ password: passwordHash, updatedAt: now }).where(credential).returning({ id: accounts.id });
        if (updated.length === 0) throw new Error("No credential to update.");
      } else {
        // Any credential row refuses, even one without a password, as the
        // DeviceStore contract says. account_credential_user_idx (0015) also refuses.
        const [existing] = await tx.select({ id: accounts.id }).from(accounts).where(credential).limit(1);
        if (existing) throw credentialExists();
        await tx.insert(accounts).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: now, updatedAt: now });
      }
    });
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
    async writeCredential(userId, changeId, passwordHash, mode) {
      try { await lockedCredentialWrite(userId, changeId, passwordHash, mode); } catch (error) {
        const database = databaseFailure(error);
        if (mode === "insert" && database.code === "23505" && database.constraint === "account_credential_user_idx") throw credentialExists();
        throw new Error(`Credential write failed: ${[database.code, database.constraint].filter(Boolean).join(" ")}`);
      }
    },
    async endStaleSession(token) {
      const current = sql`coalesce((select ${deviceSecurity.generation} from ${deviceSecurity} where ${deviceSecurity.userId} = ${sessions.userId}), 0)`;
      const changing = sql`exists (select 1 from ${deviceSecurity} where ${deviceSecurity.userId} = ${sessions.userId} and ${changeOpen})`;
      try {
        const deleted = await db.delete(sessions)
          .where(and(eq(sessions.token, token), sql`${sessions.securityGeneration} <> ${current}`, sql`not ${changing}`))
          .returning({ id: sessions.id });
        return deleted.length > 0;
      } catch (error) {
        throw new Error(`Stale-session check failed: ${databaseFailure(error).code ?? "unknown"}`);
      }
    },
    async finishSecurityChange(userId, changeId, keepSession) {
      try {
        return await db.transaction(async tx => {
          const [row] = await tx.update(deviceSecurity)
            .set({ generation: sql`${deviceSecurity.generation} + 1`, changeId: null, changeStartedAt: null })
            .where(and(eq(deviceSecurity.userId, userId), eq(deviceSecurity.changeId, changeId)))
            .returning({ generation: deviceSecurity.generation });
          if (!row) throw changeNotCurrent();
          if (keepSession !== undefined)
            await tx.update(sessions).set({ securityGeneration: row.generation }).where(and(eq(sessions.token, keepSession), eq(sessions.userId, userId)));
          return row.generation;
        });
      } catch (error) {
        // The query parameters include the caller's session token.
        throw new Error(`Security change finish failed: ${databaseFailure(error).code ?? "unknown"}`);
      }
    },
    async bumpGeneration(userId) {
      await db.insert(deviceSecurity).values({ userId, generation: 1 }).onConflictDoUpdate({ target: deviceSecurity.userId, set: { generation: sql`${deviceSecurity.generation} + 1` } });
    },
  };
}
