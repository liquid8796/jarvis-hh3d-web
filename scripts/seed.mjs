#!/usr/bin/env node
/**
 * Tạo trưởng môn đầu tiên. Idempotent: chạy lại nhiều lần cũng chỉ có một tài khoản đó, và
 * nếu tài khoản đã tồn tại thì script KHÔNG đổi mật khẩu — một lệnh seed lỡ tay không được
 * phép reset chìa khoá của hệ thống đang chạy.
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL chưa được đặt.\n" +
      "Database trên Vercel? Kéo biến của môi trường production về:\n" +
      "  vercel env pull .env --environment=production",
  );
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
// Tài khoản hạt giống giữ CẢ HAI vai: gia-chu (vai duy nhất đổi được vai người khác — không
// có nó là hệ thống sinh ra đã khoá trái) và admin. Cột `role` là di sản, ghi gương 'admin'.
await sql`
  insert into users (username, display_name, password_hash, roles, role, status)
  values (${username}, ${process.env.ADMIN_DISPLAY_NAME ?? "Trưởng Môn"}, ${hash}, ${["gia-chu", "admin"]}, 'admin', 'active')
`;

console.log(`✔ Đã tạo Gia chủ「${username}」. Đăng nhập rồi ĐỔI MẬT KHẨU ngay.`);
