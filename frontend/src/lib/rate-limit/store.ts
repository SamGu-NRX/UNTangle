import { lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { apiRateLimits, authRateLimits } from "@/lib/db/schema";
import { windowMs } from "./config";

export interface RateLimitStore {
  /** Adds one request to the caller's count for this route class and window, and returns the new count. */
  hit(route: string, caller: string, window: number): Promise<number>;
}

/** Process-local counts for development and tests. Only the current window is kept. */
export function memoryStore(): RateLimitStore {
  const counts = new Map<string, number>();
  let current = -1;
  return {
    async hit(route, caller, window) {
      if (window !== current) {
        counts.clear();
        current = window;
      }
      const key = `${route} ${caller}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    },
  };
}

/** Counts shared by every instance. The upsert holds the row lock, so concurrent hits never lose a count. */
export function postgresStore(db: Pick<NodePgDatabase, "insert" | "delete">): RateLimitStore {
  let swept = -1;
  return {
    async hit(route, caller, window) {
      if (window > swept) {
        swept = window;
        // Once per window per instance. better-auth's longest window is 60 s, so its older rows are spent too.
        await Promise.all([
          db.delete(apiRateLimits).where(lt(apiRateLimits.windowIndex, window)),
          db.delete(authRateLimits).where(lt(authRateLimits.lastRequest, (window - 1) * windowMs)),
        ]);
      }
      const [row] = await db.insert(apiRateLimits)
        .values({ windowIndex: window, route, caller, count: 1 })
        .onConflictDoUpdate({
          target: [apiRateLimits.windowIndex, apiRateLimits.route, apiRateLimits.caller],
          set: { count: sql`${apiRateLimits.count} + 1` },
        })
        .returning({ count: apiRateLimits.count });
      return row.count;
    },
  };
}
