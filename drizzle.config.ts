import type { Config } from "drizzle-kit";

/**
 * `npm run db:generate` đọc file này để sinh SQL migration từ schema.ts.
 * Việc ÁP migration lên database do scripts/migrate.mjs làm, để một lần deploy chỉ cần một
 * biến môi trường (DATABASE_URL) chứ không cần cài drizzle-kit trên máy chủ.
 */
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
} satisfies Config;
