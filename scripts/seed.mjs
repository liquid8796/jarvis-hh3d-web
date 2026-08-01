#!/usr/bin/env node
/**
 * Tạo trưởng môn đầu tiên. Idempotent: chạy lại nhiều lần cũng chỉ có một tài khoản đó, và
 * nếu tài khoản đã tồn tại thì script KHÔNG đổi mật khẩu — một lệnh seed lỡ tay không được
 * phép reset chìa khoá của hệ thống đang chạy.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* không có .env là chuyện bình thường */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL chưa được đặt — xem .env.example.");
  process.exit(1);
}

const username = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 8) {
  console.error("ADMIN_PASSWORD chưa đặt hoặc ngắn hơn 8 ký tự — xem .env.example.");
  process.exit(1);
}

const sql = neon(url);

const existing = await sql`select id from users where username = ${username} limit 1`;
if (existing.length > 0) {
  console.log(`• Trưởng môn「${username}」đã tồn tại — không đổi gì cả.`);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 12);
await sql`
  insert into users (username, display_name, password_hash, role, status)
  values (${username}, ${process.env.ADMIN_DISPLAY_NAME ?? "Trưởng Môn"}, ${hash}, 'admin', 'active')
`;

console.log(`✔ Đã tạo trưởng môn「${username}」. Đăng nhập rồi ĐỔI MẬT KHẨU ngay.`);
