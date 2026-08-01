#!/usr/bin/env node
/**
 * Áp mọi migration trong ./drizzle lên DATABASE_URL.
 *
 * Chạy được cả trên máy nhà lẫn trong build của Vercel, và chỉ cần đúng một biến môi
 * trường. Neon-http là driver duy nhất ở đây (giống hệt runtime), nên không có chuyện
 * "migrate bằng đường này, chạy bằng đường khác" rồi lệch nhau về SSL hay pooling.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { loadEnv } from "./loadEnv.mjs";

// Nạp TRƯỚC khi kiểm tra. Thứ tự ngược lại khiến script luôn báo "chưa đặt" dù .env có đủ —
// đúng lỗi đã xảy ra ở lần chạy đầu tiên.
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL chưa được đặt.\n" +
      "Database trên Vercel? Kéo biến của môi trường production về:\n" +
      "  vercel env pull .env --environment=production",
  );
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL));

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✔ Migration đã áp xong.");
