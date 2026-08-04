/**
 * Chọn hồ sơ Chromium cho đúng CHỦ và đúng COOKIE mà chủ vừa lưu.
 *
 * Worker tông môn nhận job của nhiều người. Dùng một `browser-profile` chung khiến cookie
 * đăng nhập còn sống của người chạy trước thắng cookie trong job chạy sau. Cũng chính lỗi đó
 * làm một người đổi từ tài khoản VIP sang tài khoản thường nhưng Chromium vẫn giữ VIP cũ.
 *
 * Mỗi cặp (user, chuỗi cookie đã lưu) vì thế có một profile riêng. Hash giữ bí mật khỏi tên
 * thư mục; cookie site tự refresh vẫn sống bền trong profile ấy qua các vòng. Khi người dùng
 * dán cookie khác, fingerprint đổi và worker bắt đầu bằng profile sạch — cookie mới chắc chắn
 * được tiêm, không phải đoán phiên cũ còn thuộc tài khoản nào.
 */
import { createHash } from "node:crypto";
import path from "node:path";

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function profileDirForJob(rootDir, { userId, gameCookie }) {
  const owner = String(userId ?? "").trim();
  const cookie = String(gameCookie ?? "").trim();
  if (!owner) throw new Error("Job thiếu userId — không thể chọn hồ sơ trình duyệt an toàn.");
  if (!cookie) throw new Error("Job thiếu cookie — không thể chọn hồ sơ trình duyệt.");

  const root = path.resolve(rootDir);
  const ownerKey = fingerprint(owner);
  const accountKey = fingerprint(`${owner}\0${cookie}`);
  return path.join(root, `user-${ownerKey}`, `account-${accountKey}`);
}
