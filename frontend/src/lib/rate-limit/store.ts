import { lt, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { apiRateLimits, authRateLimits } from "@/lib/db/schema";
import { windowMs as defaultWindowMs } from "./config";

export interface RateLimitStore {
  /**
   * Adds one request to the caller's count for this route class and window, and returns the new count.
   * `window` is `floor(now / windowMs)` for the route's own window length.
   */
  hit(route: string, caller: string, window: number, windowMs: number): Promise<number>;
}

/** Process-local counts for development and tests. A count is dropped once its window has ended. */
export function memoryStore(): RateLimitStore {
  const counts = new Map<string, { count: number; expiresAt: number }>();
  return {
    async hit(route, caller, window, windowMs) {
      const start = window * windowMs;
      for (const [key, entry] of counts) if (entry.expiresAt <= start) counts.delete(key);
      const key = `${route} ${caller} ${window}`;
      const entry = counts.get(key) ?? { count: 0, expiresAt: start + windowMs };
      entry.count += 1;
      counts.set(key, entry);
      return entry.count;
    },
  };
}

/** Counts shared by every instance. The upsert holds the row lock, so concurrent hits never lose a count. */
export function postgresStore(db: Pick<NodePgDatabase, "insert" | "delete">): RateLimitStore {
  let swept = -Infinity;
  return {
    async hit(route, caller, window, windowMs) {
      const start = window * windowMs;
      if (start >= swept + defaultWindowMs) {
        swept = start;
        // About once a minute per instance. Each row carries its own expiry, so windows of any length are
        // swept when they end; better-auth's longest window is 60 s, so its older rows are spent too.
        await Promise.all([
          db.delete(apiRateLimits).where(lte(apiRateLimits.expiresAt, start)),
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
