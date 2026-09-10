import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { appSettingsSchema, type AppSettings } from "./settings";

/** Keep network operations outside the row lock; merge each checkpoint into fresh settings. */
export async function mutateGithubState(change: (settings: AppSettings) => void): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(schema.appSettings).values({ id: "global", value: appSettingsSchema.parse({}) }).onConflictDoNothing();
    const [row] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.id, "global")).for("update");
    const settings = appSettingsSchema.parse(row.value);
    change(settings);
    await tx.update(schema.appSettings).set({ value: appSettingsSchema.parse(settings), updatedAt: new Date() }).where(eq(schema.appSettings.id, "global"));
  });
}

/** Transaction-scoped advisory lock releases even if the process or its connection dies. */
export async function withCompanionLease<T>(slug: string, work: () => Promise<T>): Promise<T | null> {
  return db().transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`companion:${slug.toLowerCase()}`})) as locked`);
    if (!result.rows[0]?.locked) return null;
    return work();
  });
}
