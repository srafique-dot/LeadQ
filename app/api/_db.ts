import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or POSTGRES_URL) is not set — attach a Postgres database to this Vercel project.");
}

// One pool per serverless instance, reused across warm invocations.
const globalForPool = globalThis as unknown as { pgPool?: Pool };
export const pool =
  globalForPool.pgPool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
globalForPool.pgPool = pool;

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
