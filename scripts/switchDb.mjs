#!/usr/bin/env node
/**
 * Chuyển Jarvis sang một database RIÊNG trên cùng Neon project.
 *
 * Vì sao cần: database `neondb` đang chứa một project khác (phim) với dữ liệu thật. Hai
 * project chung một database vẫn chạy được — Postgres không quan tâm — nhưng một lệnh
 * `drizzle-kit push` từ phía kia sẽ thấy 4 bảng của Jarvis là "thừa" và xoá sạch, kéo theo
 * toàn bộ user, cấu hình và cookie đã mã hoá. Rủi ro đó không đáng để tiết kiệm một database.
 *
 * Script chỉ đổi TÊN DATABASE trong chuỗi kết nối — host, user, mật khẩu, tham số SSL giữ
 * nguyên — nên không cần copy lại chuỗi bí mật từ Neon Console về.
 *
 *   node scripts/switchDb.mjs jarvis
 */
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const target = process.argv[2] ?? "jarvis";
const current = process.env.DATABASE_URL;
if (!current) {
  console.error("DATABASE_URL chưa được đặt trong .env.");
  process.exit(1);
}

const url = new URL(current);
const from = url.pathname.replace("/", "");
if (from === target) {
  console.log(`• DATABASE_URL đã trỏ tới「${target}」— không cần đổi.`);
  process.exit(0);
}

url.pathname = `/${target}`;
const next = url.toString();

// Thử kết nối TRƯỚC khi ghi vào .env: thà báo "chưa tạo database" ngay bây giờ còn hơn để
// một chuỗi hỏng nằm trong file rồi mọi lệnh sau đó thất bại vì lý do trông chẳng liên quan.
try {
  const probe = neon(next);
  const rows = await probe`select current_database() as db`;
  console.log(`✔ Kết nối được database「${rows[0].db}」.`);
} catch (err) {
  console.error(
    `✗ Không kết nối được「${target}」: ${err.message}\n` +
      `  Hãy tạo database này trước: Neon Console → project → Databases → New Database.`,
  );
  process.exit(1);
}

const env = readFileSync(".env", "utf8");
const updated = env.includes("DATABASE_URL=")
  ? env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${next}"`)
  : `${env.trimEnd()}\nDATABASE_URL="${next}"\n`;
writeFileSync(".env", updated);

console.log(`✔ .env: DATABASE_URL đã trỏ từ「${from}」sang「${target}」.`);
console.log("  Bước tiếp: npm run db:migrate && npm run db:seed");
console.log(`  Nhớ cập nhật DATABASE_URL trên Vercel sang database「${target}」nữa.`);
