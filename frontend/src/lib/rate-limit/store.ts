import { and, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { apiRateLimits, authRateLimits } from "@/lib/db/schema";
import { windowMs as defaultWindowMs } from "./config";

export interface RateLimitStore {
  /**
   * Adds one request to the caller's count for this route class and window, and returns the new count.
   * `window` is `floor(now / windowMs)` for the route's own window length.
   */
  hit(route: string, caller: string, window: number, windowMs: number): Promise<number>;
  /** Atomically admits up to limit; only admitted requests advance expiry. */
  hitLastRequest(route: string, caller: string, time: number, windowMs: number, limit: number): Promise<{ allowed: boolean; expiresAt: number }>;
}

/** Process-local counts for development and tests. Spent counts are retained for one minute for in-flight hits. */
export function memoryStore(): RateLimitStore {
  const counts = new Map<string, { count: number; expiresAt: number }>();
  return {
    async hitLastRequest(route, caller, time, windowMs, limit) {
      const key = `${route} ${caller} -1`;
      const previous = counts.get(key);
      if (previous && previous.expiresAt > time && previous.count >= limit) {
        return { allowed: false, expiresAt: previous.expiresAt };
      }
      const entry = {
        count: previous && previous.expiresAt > time ? previous.count + 1 : 1,
        expiresAt: Math.max(previous?.expiresAt ?? 0, time + windowMs),
      };
      counts.set(key, entry);
      return { allowed: true, expiresAt: entry.expiresAt };
    },
    async hit(route, caller, window, windowMs) {
      const start = window * windowMs;
      for (const [key, entry] of counts) if (entry.expiresAt < start - defaultWindowMs) counts.delete(key);
      const key = `${route} ${caller} ${window}`;
      const entry = counts.get(key) ?? { count: 0, expiresAt: start + windowMs };
      entry.count += 1;
      counts.set(key, entry);
      return entry.count;
    },
  };
}

/** Counts shared by every instance. The upsert holds the row lock, so concurrent hits never lose a count. */
export function postgresStore(db: Pick<NodePgDatabase, "insert" | "delete" | "select">): RateLimitStore {
  let swept = -Infinity;
  return {
    async hitLastRequest(route, caller, time, windowMs, limit) {
      // -1 separates last-request counters from epoch windows in the existing table.
      // The conflict predicate admits under the row lock; denials leave both fields unchanged.
      const [row] = await db.insert(apiRateLimits)
        .values({ windowIndex: -1, route, caller, count: 1, expiresAt: time + windowMs })
        .onConflictDoUpdate({
          target: [apiRateLimits.windowIndex, apiRateLimits.route, apiRateLimits.caller],
          set: {
            count: sql`CASE WHEN ${apiRateLimits.expiresAt} <= ${time} THEN 1 ELSE ${apiRateLimits.count} + 1 END`,
            expiresAt: sql`GREATEST(${apiRateLimits.expiresAt}, ${time + windowMs})`,
          },
          setWhere: sql`${apiRateLimits.expiresAt} <= ${time} OR ${apiRateLimits.count} < ${limit}`,
        })
        .returning({ expiresAt: apiRateLimits.expiresAt });
      if (row) return { allowed: true, expiresAt: row.expiresAt };
      const [denied] = await db.select({ expiresAt: apiRateLimits.expiresAt }).from(apiRateLimits)
        .where(and(eq(apiRateLimits.windowIndex, -1), eq(apiRateLimits.route, route), eq(apiRateLimits.caller, caller)));
      if (!denied) throw new Error("Sensitive rate counter disappeared after denying admission");
      return { allowed: false, expiresAt: denied.expiresAt };
    },
    async hit(route, caller, window, windowMs) {
      const start = window * windowMs;
      if (start >= swept + defaultWindowMs) {
        swept = start;
        // About once a minute per instance. Each row carries its own expiry, so windows of any length are
        // retained for another minute so a hit already in flight cannot recreate a spent counter.
        await Promise.all([
          db.delete(apiRateLimits).where(lt(apiRateLimits.expiresAt, start - defaultWindowMs)),
          db.delete(authRateLimits).where(lt(authRateLimits.lastRequest, start - defaultWindowMs)),
        ]);
      }
      const [row] = await db.insert(apiRateLimits)
        .values({ windowIndex: window, route, caller, count: 1, expiresAt: start + windowMs })
        .onConflictDoUpdate({
          target: [apiRateLimits.windowIndex, apiRateLimits.route, apiRateLimits.caller],
          set: { count: sql`${apiRateLimits.count} + 1` },
        })
        .returning({ count: apiRateLimits.count });
      return row.count;
    },
  };
}
