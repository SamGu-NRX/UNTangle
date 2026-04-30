import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "@/lib/db/schema";

const defaultPoolConfig = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE ?? "untangle",
  user: process.env.PGUSER ?? process.env.USER ?? "postgres",
  password: process.env.PGPASSWORD,
};

export const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const globalForDb = globalThis as typeof globalThis & {
  untanglePool?: Pool;
};

const pool =
  globalForDb.untanglePool ??
  new Pool({
    ...(process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : defaultPoolConfig),
    max: 5,
  });

if (!globalForDb.untanglePool) {
  globalForDb.untanglePool = pool;
}

export const db = drizzle(pool, { schema });
