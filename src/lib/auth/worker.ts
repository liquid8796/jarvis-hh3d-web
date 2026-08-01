import { timingSafeEqual } from "node:crypto";

/**
 * Cửa vào của linh sứ (worker).
 *
 * Worker không phải là một người dùng: nó không có session, không có cookie, và nó gọi từ
 * một máy khác — nên nó tự xưng bằng một bí mật chia sẻ trong header `Authorization:
 * Bearer <WORKER_TOKEN>`. So sánh bằng `timingSafeEqual` vì đây là bí mật duy nhất đứng
 * giữa Internet và quyền đọc cookie game của mọi thành viên; một phép so sánh chuỗi thường
 * rò rỉ độ dài khớp qua thời gian trả lời.
 *
 * Đổi WORKER_TOKEN trên Vercel là cách cắt một linh sứ đã bị lộ khỏi hệ thống ngay lập tức.
 */
export function authorizeWorker(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected || expected === "change-me") {
    // Chưa cấu hình thì đóng cửa hoàn toàn, thay vì mở toang bằng giá trị mặc định.
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length === 0) {
    return false;
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
