import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { z } from "zod";

/**
 * The per-user automation config. Stored as one JSONB document (see schema.ts for why) but
 * VALIDATED here at the edge of the system, so garbage can never reach a worker. The shape
 * mirrors the desktop app's quest options — the two products stay conceptually one tool.
 *
 * Nested groups use `.prefault({})`, not `.default({})`: in Zod 4 a `.default()` must be the
 * fully-formed OUTPUT, while `.prefault()` supplies the INPUT that then flows through each
 * field's own default. That distinction is what lets a brand-new user — whose JSONB column
 * is literally `{}` — parse into a complete config instead of a validation error.
 */
export const configSchema = z.object({
  /** The hoathinh3d login cookie bundle the worker automates with. */
  gameCookie: z.string().trim().max(8000).default(""),
  quests: z
    .object({
      meCung: z
        .object({
          enabled: z.boolean().default(false),
          /** is-normal | is-hard | is-nightmare — the site's own mode classes. */
          mode: z.enum(["is-normal", "is-hard", "is-nightmare"]).default("is-normal"),
          /** 0 = never kick; anything else is an HP floor (the desktop's kickHp). */
          kickHp: z.number().int().min(0).max(99_999_999).default(0),
          /** Stop when the daily huyền tinh cap is reached. */
          capCheck: z.boolean().default(true),
        })
        .prefault({}),
      luyenDan: z
        .object({
          enabled: z.boolean().default(false),
          tier: z.enum(["Hạ Phẩm", "Trung Phẩm", "Thượng Phẩm", "Cực Phẩm"]).default("Hạ Phẩm"),
          /** Highest star that still gets decomposed; 0 = decompose everything, 5 = keep all. */
          keepStarsFrom: z.number().int().min(0).max(5).default(0),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type UserConfig = z.infer<typeof configSchema>;

export async function getConfig(userId: string): Promise<UserConfig> {
  const rows = await db()
    .select({ config: schema.userConfigs.config })
    .from(schema.userConfigs)
    .where(eq(schema.userConfigs.userId, userId))
    .limit(1);

  // Parsing on the way OUT as well as in: a document written by an older deploy still
  // comes back in today's shape, defaults filled — the JSONB twin of a schema migration.
  const parsed = configSchema.safeParse(rows[0]?.config ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export async function saveConfig(userId: string, config: UserConfig): Promise<void> {
  const clean = configSchema.parse(config);
  await db()
    .insert(schema.userConfigs)
    .values({ userId, config: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userConfigs.userId,
      set: { config: clean, updatedAt: sql`now()` },
    });
}
