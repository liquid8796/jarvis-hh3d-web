import { timingSafeEqual } from "node:crypto";

/**
 * Phép gác của MỌI cửa máy-gọi-máy: `Authorization: Bearer CRON_SECRET`.
 *
 * Gom về một chỗ vì tới bản 0.81.3 nó đã được chép tay ở BA nơi — `/api/cron`, `/api/usage-report`,
 * và cửa quét nhật ký mới — mỗi bản một `secretMatches` riêng giống hệt nhau. Ba bản giống hệt là
 * ba cơ hội để một bản được "sửa cho nhanh" rồi lặng lẽ sống lệch hai bản kia; mà đây lại là loại
 * mã không ai kiểm bằng mắt được, vì một phép so sai vẫn cho đúng kết quả với chìa đúng.
 *
 * FAIL CLOSED khi chưa đặt `CRON_SECRET`: thà việc vệ sinh không chạy còn hơn để ngỏ một cửa xoá
 * hàng loạt cho cả Internet. (Trước 09/08/2026 `/api/cron` còn cho qua khi `user-agent` chứa chữ
 * "vercel-cron" — một header do client đặt, tức một dòng curl là mở được.)
 */
export function authorizeCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!expected || presented.length === 0) return false;

  // Độ dài phải so RIÊNG: `timingSafeEqual` NÉM khi hai buffer khác độ dài, nên không kiểm trước
  // là biến một chìa sai độ dài thành lỗi 500 thay vì 401.
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
