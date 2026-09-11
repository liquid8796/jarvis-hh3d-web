import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { appSettingsSchema, parseGithubSettingsForMutation, type AppSettings } from "./settings";
import { Client } from "pg";
import { withDatabaseDeadline } from "../db/deadline";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type GithubSessionLease = { assertHeld: (budget?: { deadlineAt: number }) => Promise<void>; release: () => Promise<void> };

/** Session locks span GitHub calls without holding a transaction or a settings row lock. */
async function acquireGithubSessionLease(keys: readonly string[], deadlineAt: number, unavailable: string): Promise<GithubSessionLease | null> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const left = () => { const ms = deadlineAt - Date.now(); if (ms <= 0) throw Error("Provisioning deadline reached"); return Math.min(10_000, ms); };
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: left(), query_timeout: left() });
  // A broken idle connection must not emit an unhandled error in the application process.
  let healthy = true;
  client.on("error", () => { healthy = false; });
  try {
    await client.connect();
    for (const key of [...new Set(keys)].sort()) {
      const query = { text: "select pg_try_advisory_lock(hashtext($1)) as locked", values: [key], query_timeout: left() };
      const result = await client.query(query);
      if (!result.rows[0]?.locked) { await client.end(); return null; }
    }
    return {
      assertHeld: async (budget) => { if (!healthy) throw new Error("Provisioning lease lost"); const ms = (budget?.deadlineAt ?? deadlineAt) - Date.now(); if (ms <= 0) throw Error("Provisioning deadline reached"); const query = { text: "select 1", query_timeout: Math.min(10_000, ms) }; await client.query(query); },
      // Closing this dedicated session releases every session advisory lock without another query.
      release: async () => { healthy = false; await client.end(); },
    };
  } catch { await client.end().catch(() => {}); throw new Error(unavailable); }
}

export async function acquireGithubProvisioningLease(slug: string, workerId: string, deadlineAt = Date.now() + 240_000): Promise<GithubSessionLease | null> {
  const [owner = "", repo = ""] = slug.split("/").map(part => part.toLowerCase());
  return acquireGithubSessionLease([
    `provision-owner:${owner}`,
    `provision:${slug.toLowerCase()}`,
    `provision-worker:${repo}`,
    `provision-worker:${workerId.toLowerCase()}`,
  ], deadlineAt, "Provisioning lease unavailable");
}

/** Freeze same-owner creation plus every primary/companion runner while deleting the account group. */
export async function acquireGithubOwnerDeletionLease(
  owner: string,
  targets: readonly { slug: string; workerId: string }[],
  deadlineAt = Date.now() + 240_000,
): Promise<GithubSessionLease | null> {
  const normalizedOwner = owner.toLowerCase();
  if (!normalizedOwner || targets.length === 0 || targets.some((target) => target.slug.split("/")[0]?.toLowerCase() !== normalizedOwner)) {
    throw new Error("Invalid GitHub deletion lease targets");
  }
  return acquireGithubSessionLease([
    `provision-owner:${normalizedOwner}`,
    ...targets.flatMap((target) => [
      `provision:${target.slug.toLowerCase()}`,
      `provision-worker:${target.slug.split("/")[1]?.toLowerCase() ?? ""}`,
      `provision-worker:${target.workerId.toLowerCase()}`,
      `companion:${target.slug.toLowerCase()}`,
    ]),
  ], deadlineAt, "GitHub deletion lease unavailable");
}

/** Keep network operations outside the row lock; merge each checkpoint into fresh settings. */
export async function mutateGithubState(change: (settings: AppSettings) => void, options: { deadlineAt?: number } = {}): Promise<void> {
  const mutate = (database: NodePgDatabase<typeof schema>) => database.transaction(async (tx) => {
    await tx.insert(schema.appSettings).values({ id: "global", value: appSettingsSchema.parse({}) }).onConflictDoNothing();
    const [row] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.id, "global")).for("update");
    const settings = parseGithubSettingsForMutation(row.value);
    change(settings);
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) throw Error("GitHub mutation deadline reached");
    await tx.update(schema.appSettings).set({ value: appSettingsSchema.parse(settings), updatedAt: new Date() }).where(eq(schema.appSettings.id, "global"));
  });
  if (options.deadlineAt !== undefined) await withDatabaseDeadline(options.deadlineAt, mutate);
  else await mutate(db());
}

/** Transaction-scoped advisory lock releases even if the process or its connection dies. */
export async function withCompanionLease<T>(slug: string, work: () => Promise<T>, options: { deadlineAt?: number } = {}): Promise<T | null> {
  const leased = (database: NodePgDatabase<typeof schema>) => database.transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`companion:${slug.toLowerCase()}`})) as locked`);
    if (!result.rows[0]?.locked) return null;
    return work();
  });
  return options.deadlineAt !== undefined ? withDatabaseDeadline(options.deadlineAt, leased) : leased(db());
}
