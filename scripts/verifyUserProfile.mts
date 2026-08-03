#!/usr/bin/env node
/** Integration check for nullable legacy email, required new email and self-service edits. */
import { neon } from "@neondatabase/serverless";
import { findById, register, updateProfile } from "../src/lib/services/users";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);
const stamp = Date.now();
const legacyUsername = `__profile_old_${stamp}`;
const username = `__profile_${stamp}`;
const duplicateUsername = `__profile_dup_${stamp}`;
const email = `verify+${stamp}@example.com`;
const legacyEmail = `legacy+${stamp}@example.com`;
let legacyId = "";
let userId = "";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

try {
  // Tài khoản trước migration không có email vẫn phải đọc được và không cần backfill giả.
  const legacyRows = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${legacyUsername}, 'Legacy profile', 'not-a-login-hash', 'active')
    returning id
  `;
  legacyId = String(legacyRows[0].id);
  const legacy = await findById(legacyId);
  assert(legacy?.email === null, "tài khoản cũ phải giữ email null");

  const created = await register({
    username,
    displayName: "Profile verifier",
    email: email.toUpperCase(),
    password: "verification-password",
  });
  assert(created.ok, "đăng ký mới có email phải thành công");
  if (!created.ok) throw new Error(created.error);
  userId = created.user.id;
  assert(created.user.email === email, "email đăng ký phải được chuẩn hoá chữ thường");

  const duplicate = await register({
    username: duplicateUsername,
    displayName: "Duplicate verifier",
    email,
    password: "verification-password",
  });
  assert(!duplicate.ok && duplicate.error.includes("Email"), "email trùng phải bị từ chối rõ ràng");

  const updated = await updateProfile(legacyId, {
    displayName: "Legacy đã cập nhật",
    email: legacyEmail.toUpperCase(),
  });
  assert(updated.ok, "tài khoản cũ phải tự bổ sung email được");

  const collision = await updateProfile(legacyId, {
    displayName: "Không được ghi",
    email,
  });
  assert(!collision.ok, "không được cướp email của tài khoản khác");

  const after = await findById(legacyId);
  assert(after?.displayName === "Legacy đã cập nhật", "lỗi email trùng không được ghi nửa chừng");
  assert(after?.email === legacyEmail, "email hồ sơ phải được chuẩn hoá chữ thường");
  assert(after?.role === "user" && after.status === "active", "sửa hồ sơ không được chạm quyền/trạng thái");

  console.log("✔ Email legacy/new, chuẩn hoá, unique và quyền tự sửa đều đúng.");
} finally {
  await sql`
    delete from users
    where username = ${legacyUsername} or username = ${username} or username = ${duplicateUsername}
  `.catch(() => {});
}
