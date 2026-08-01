#!/usr/bin/env node
/**
 * Áp mọi migration trong ./drizzle lên DATABASE_URL.
 *
 * Chạy được cả trên máy nhà lẫn trong build của Vercel, và chỉ cần đúng một biến môi
 * trường. Neon-http là driver duy nhất ở đây (giống hệt runtime), nên không có chuyện
 * "migrate bằng đường này, chạy bằng đường khác" rồi lệch nhau về SSL hay pooling.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL chưa được đặt — xem .env.example.");
  process.exit(1);
}

// .env cho dev cục bộ; trên Vercel biến đã có sẵn trong môi trường nên bước này bỏ qua.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* không có .env là chuyện bình thường */
}

const db = drizzle(neon(process.env.DATABASE_URL));

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✔ Migration đã áp xong.");
