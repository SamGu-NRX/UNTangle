import { sql, type SQL } from "drizzle-orm";
import type { Budget } from "./config";
import { windowResult, type RateLimitStore, type LimitResult } from "./store";

export type QueryExecutor = (query: SQL) => Promise<{ rows: unknown[] }>;

export class PostgresRateLimitStore implements RateLimitStore {
  private nextCleanup = 0;
  constructor(private readonly execute: QueryExecutor) {}

  async consume(key: string, budget: Budget): Promise<LimitResult> {
    if (Date.now() >= this.nextCleanup) {
      this.nextCleanup = Date.now() + 60_000;
      // Only expired rows can be deleted; no live allowance is evicted during a flood.
      await this.execute(sql`DELETE FROM api_rate_limit WHERE expires_at <= floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AND key IN (
        SELECT key FROM api_rate_limit WHERE expires_at <= floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint
        LIMIT 1000
      )`);
    }
    const now = sql`floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint`;
    const live = sql`ARRAY(SELECT hit FROM unnest(api_rate_limit.hits) AS hit WHERE hit > ${now} - ${budget.windowMs} ORDER BY hit)`;
    // ON CONFLICT holds the row lock while pruning, checking and appending. Independent instances cannot overspend one key.
    const result = await this.execute(sql`
      INSERT INTO api_rate_limit (key, hits, expires_at, allowed)
      VALUES (${key}, ARRAY[${now}], ${now} + ${budget.windowMs}, true)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN cardinality(${live}) < ${budget.maxRequests}
          THEN array_append(${live}, ${now}) ELSE ${live} END,
        allowed = cardinality(${live}) < ${budget.maxRequests},
        expires_at = CASE WHEN cardinality(${live}) < ${budget.maxRequests}
          THEN greatest(${now} + ${budget.windowMs}, api_rate_limit.expires_at) ELSE api_rate_limit.expires_at END
      RETURNING hits, allowed, ${now} AS now
    `);
    const row = result.rows[0];
    if (!row || typeof row !== "object" || !("hits" in row) || !Array.isArray(row.hits) ||
        !("allowed" in row) || typeof row.allowed !== "boolean" || !("now" in row)) {
      throw new Error("Postgres rate-limit query returned an invalid row.");
    }
    const hits = row.hits.map(Number).sort((a, b) => a - b);
    const timestamp = Number(row.now);
    if (!hits.length || hits.some((hit) => !Number.isSafeInteger(hit)) || !Number.isSafeInteger(timestamp)) {
      throw new Error("Postgres rate-limit query returned invalid timestamps.");
    }
    return windowResult(hits, row.allowed, budget, timestamp);
  }
}
