#!/usr/bin/env node
/**
 * Đặt lại mật khẩu cho MỘT tài khoản — lối thoát khi không còn ai vào được hệ thống.
 *
 *   NEW_PASSWORD='...' node scripts/resetPassword.mjs admin
 *
 * Vì sao cần một script riêng: `db:seed` **cố ý** không đổi mật khẩu của tài khoản đã tồn
 * tại — một lệnh seed lỡ tay không được phép reset chìa khoá của hệ thống đang chạy. Điều
 * đó đúng, nhưng nó để lại một ngõ cụt: khi mật khẩu trưởng môn thất lạc, chạy lại seed chỉ
 * in "đã tồn tại — không đổi gì cả" rồi thoát 0, trông y hệt như đã làm xong việc. Người
 * dùng gõ lại mật khẩu mới trong .env, chạy seed, thấy màu xanh, và vẫn không vào được.
 *
 * Nên đường reset phải TỒN TẠI, và phải ồn ào: tên tài khoản khai tường minh (không có mặc
 * định để lỡ tay), database được in ra trước khi ghi (hai database từng bị nhầm nhau ở dự
 * án này), và mật khẩu đi qua biến môi trường chứ không qua tham số dòng lệnh — tham số sẽ
 * nằm lại trong lịch sử shell và trong bảng tiến trình.
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const username = (process.argv[2] ?? "").trim().toLowerCase();
const password = process.env.NEW_PASSWORD ?? "";

if (!username) {
  console.error(
    "Thiếu tên tài khoản.\n" +
      "  NEW_PASSWORD='mật-khẩu-mới' node scripts/resetPassword.mjs admin\n\n" +
      "Cố ý không có mặc định: script này ghi đè chìa khoá của một tài khoản, nên nó phải\n" +
      "được gọi tên rõ ràng chứ không đoán.",
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error(
    "NEW_PASSWORD chưa đặt hoặc ngắn hơn 8 ký tự.\n" +
      "Đặt qua biến môi trường, đừng truyền vào dòng lệnh — tham số dòng lệnh nằm lại trong\n" +
      "lịch sử shell và hiện ra trong bảng tiến trình.",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL chưa được đặt — xem .env.example.");
  process.exit(1);
}

const sql = neon(url);

// In database ra TRƯỚC khi ghi. Dự án này có hai database trên cùng một host và đã một lần
// migrate nhầm chỗ; một dòng xác nhận rẻ hơn nhiều so với việc đổi mật khẩu ở database mà
// production không hề đọc rồi ngồi tự hỏi sao vẫn không vào được.
const [{ db, host }] = await sql`select current_database() db, inet_server_addr()::text host`;
console.log(`• Database: ${db}  (host ${host ?? "?"})`);

const existing = await sql`select id, role, status from users where username = ${username} limit 1`;
if (existing.length === 0) {
  console.error(`✗ Không có tài khoản「${username}」trong database「${db}」— không đổi gì cả.`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
await sql`update users set password_hash = ${hash}, updated_at = now() where username = ${username}`;

const row = existing[0];
console.log(`✔ Đã đặt lại mật khẩu cho「${username}」(role ${row.role}, status ${row.status}).`);
if (row.status !== "active") {
  console.log(`  Lưu ý: tài khoản đang ở trạng thái「${row.status}」— đăng nhập được nhưng chưa vào được Linh Đài.`);
}
