import { isAdminUser } from "./permissions";

/**
 * Ai còn được vào cửa nào trong lúc BẾ QUAN TRÙNG TU — thuần dữ liệu vào ra, không đụng
 * database, nên kiểm chứng được bằng script không cần dựng gì cả.
 *
 * Nằm riêng khỏi permissions.ts dù cùng họ "ai được làm gì": tệp kia là ma trận VAI, còn đây là
 * một trạng thái vận hành nhân với vai. Trộn hai trục vào một tệp thì mỗi lần thêm một vai lại
 * phải đọc lại cả phần bảo trì, và ngược lại.
 */

/**
 * `open`   — vẽ trang như thường, không có gì thêm.
 * `banner` — vẽ trang như thường, kèm một dải mỏng nhắc rằng tông môn đang bế quan.
 * `wall`   — KHÔNG vẽ trang; thay bằng bảng bế quan không tắt được.
 */
export type MaintenanceView = "open" | "banner" | "wall";

/**
 * Trong lúc bế quan trùng tu thì ai còn được vào cửa nào.
 *
 * Từ 09/08/2026 bảng bế quan phủ MỌI trang và KHÔNG tắt được — tức môn đồ thường không vào
 * được trang nào cho tới khi mở cửa. Hai ngoại lệ dưới đây không phải để nương tay, chúng là
 * điều kiện để chế độ bế quan còn tắt được:
 *
 *   1. **Bậc trị sự đi qua tự do.** Công tắc tắt bảo trì nằm TRONG trang Tông Môn. Dựng bảng
 *      chắn trước mặt họ là khoá trái căn phòng chứa chìa khoá của chính nó — đúng loại lỗi
 *      mà cả tệp này sinh ra để phòng. Họ nhận dải nhắc thay vì bảng chắn, vì "đang bảo trì"
 *      là thứ không được phép biến mất khỏi mắt người đang trực.
 *
 *   2. **Khách chưa đăng nhập cũng đi qua** (kèm dải nhắc). Cửa đăng nhập là đường DUY NHẤT
 *      để một trưởng môn vừa hết phiên quay lại được với cái công tắc ấy; chắn nó là cùng
 *      một căn phòng khoá trái, chỉ khác lối vào. Khách vốn đã không vào được trang nào của
 *      thành viên (guard chặn sẵn), nên chỗ này không mở thêm cửa nào — chỉ giữ cửa vào.
 *      Người ấy đăng nhập xong mà không mang vai thì gặp bảng chắn ngay ở trang kế tiếp.
 *
 * `viewer` là `null` khi chưa đăng nhập, HOẶC khi phiên trỏ vào một dòng users không còn tồn
 * tại — cả hai đều là "chưa có ai ở đây", và cả hai đều cần cửa đăng nhập.
 */
export function maintenanceViewFor(
  maintenance: { active: boolean },
  /** Chỉ cần mảng vai. Khai hình dạng tại đây thay vì mượn kiểu nội bộ của permissions.ts. */
  viewer: { roles: readonly string[] } | null,
): MaintenanceView {
  if (!maintenance.active) return "open";
  if (viewer === null) return "banner";
  return isAdminUser(viewer) ? "banner" : "wall";
}
