import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "@/lib/db/schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/untangle";

export const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const globalForDb = globalThis as typeof globalThis & {
  untanglePool?: Pool;
};

const pool =
  globalForDb.untanglePool ??
  new Pool({
    connectionString,
    max: 5,
  });

if (!globalForDb.untanglePool) {
  globalForDb.untanglePool = pool;
}

export const db = drizzle(pool, { schema });
