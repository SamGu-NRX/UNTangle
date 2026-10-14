import "server-only";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { GradesMcpClient } from "./client";
import { GradesDiskCache } from "./cache";
import { GradesHistoryService } from "./service";
import { GradesPostgresCache, GradesPostgresLimiter } from "./postgres";

// Fail closed when Postgres is configured but unavailable. Connection and query
// timeouts also bound storage work while callers wait for a budget permit.
const database = process.env.DATABASE_URL ? drizzle(new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 1_000,
  query_timeout: 1_000,
  statement_timeout: 1_000,
  idle_in_transaction_session_timeout: 5_000,
})) : undefined;

export const gradesHistory = new GradesHistoryService(
  new GradesMcpClient(database ? { limiter: new GradesPostgresLimiter(database) } : {}),
  database ? new GradesPostgresCache(database) : new GradesDiskCache(path.join(process.cwd(), ".grades-history-cache")),
);
