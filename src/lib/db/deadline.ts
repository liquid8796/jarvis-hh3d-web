import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/** A dedicated connection is closed at the deadline, cancelling active SQL/transactions. */
export async function withDatabaseDeadline<T>(deadlineAt: number, operation: (database: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0 || !process.env.DATABASE_URL) throw Error("Database deadline/configuration unavailable");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: Math.min(10_000, remaining), query_timeout: remaining, statement_timeout: remaining });
  client.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => { await client.connect(); if (Date.now() >= deadlineAt) throw Error("Database deadline reached"); return operation(drizzle(client, { schema })); })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { void client.end().catch(() => {}); reject(Error("Database deadline reached")); }, remaining); }),
    ]);
  } finally { clearTimeout(timer); await client.end().catch(() => {}); }
}
