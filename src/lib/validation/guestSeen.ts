import { NOTICE_WINDOW_DAYS } from "@/lib/validation/notices";

/**
 * DẤU「ĐÃ XEM」CỦA KHÁCH CHƯA ĐĂNG NHẬP — sống trong một cookie, không trong database.
 *
 * ── VÌ SAO KHÔNG PHẢI MỘT BẢNG ────────────────────────────────────────────────────────────────
 *
 * `notice_reads` gắn dấu vào `user_id` (NOT NULL, khoá ngoại sang `users`), mà khách thì không
 * có dòng nào ở đó. Lối hiển nhiên là dựng một bảng thứ hai khoá theo một id ẩn danh — và đó là
 * lối SAI, vì hai lẽ:
 *
 *   • Số dòng KHÔNG có trần. Mỗi con bot, mỗi lượt quét, mỗi trình duyệt xoá cookie là một danh
 *     tính mới. Một bảng như thế phình theo lưu lượng Internet chứ không theo số người dùng, và
 *     nó phình trên chính cái Neon vừa hạ tông môn bằng hạn mức truyền dữ liệu.
 *   • Dữ liệu ấy VÔ GIÁ TRỊ sau bảy ngày (`NOTICE_WINDOW_DAYS`) — thông báo hết hạn thì cái dấu
 *     cũng hết nghĩa. Một thứ tự hết hạn thì cookie làm đúng việc ấy miễn phí, còn bảng thì đòi
 *     thêm một vòng quét dọn nữa.
 *
 * Cái giá, nói thẳng: xoá cookie hay đổi trình duyệt là thấy lại popup. Với một lời nhắn cho
 * khách vãng lai thì đó là cái giá đúng — thà hiện lại một lần còn hơn nuôi một bảng vô hạn.
 *
 * ── VÌ SAO PHẢI LỌC LÚC ĐỌC ───────────────────────────────────────────────────────────────────
 *
 * Cookie là thứ NGOÀI INTERNET GÕ VÀO ĐƯỢC, và mấy id này đi thẳng vào một câu truy vấn so với
 * cột `uuid`. Một chuỗi không phải uuid làm cả câu NÉM (`invalid input syntax for type uuid`) —
 * tức một cookie nghịch ngợm biến thành lỗi 500 trên mọi trang, cho mọi khách. Cùng bài học đã
 * chép ở `UUID_SHAPE` trong `services/notices.ts`, nhưng ở đây nó nặng hơn: bên ấy đầu vào tới
 * từ form của bậc trị sự, còn ở đây tới từ bất kỳ ai.
 */

/** Tên cookie. Tiền tố `jvz_` cùng lối với mọi thứ khác của tông môn trên trình duyệt. */
export const GUEST_SEEN_COOKIE = "jvz_notice_seen";

/**
 * Giữ tối đa ngần này id.
 *
 * Trần cookie của trình duyệt là ~4KB; 20 uuid kèm dấu phẩy là ~740 byte, còn thừa chỗ cho mọi
 * cookie khác của trang. Con số cũng đủ rộng theo nghĩa thật: thông báo chỉ sống bảy ngày, nên
 * để chạm trần thì tông môn phải phát hơn hai mươi lời nhắn CHO KHÁCH trong một tuần.
 */
export const GUEST_SEEN_MAX = 20;

/** Cookie sống đúng bằng hạn của thông báo — dài hơn là giữ rác, ngắn hơn là hiện lại lời cũ. */
export const GUEST_SEEN_MAX_AGE_SECONDS = NOTICE_WINDOW_DAYS * 24 * 60 * 60;

/** Hình dạng uuid mà `gen_random_uuid()` sinh ra. Chỉ dùng để KHỎI NÉM, không phải để tin. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đọc cookie thành danh sách id sạch.
 *
 * Mọi thứ không phải uuid bị vứt IM LẶNG — ở đây im lặng là đúng: một cookie hỏng không phải
 * lỗi của người đang xem trang, và câu trả lời đúng là「coi như chưa xem gì」rồi đi tiếp.
 */
export function parseGuestSeen(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const id = piece.trim().toLowerCase();
    if (!UUID_SHAPE.test(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= GUEST_SEEN_MAX) break;
  }
  return out;
}

/**
 * Thêm một id vào danh sách, MỚI NHẤT ĐỨNG ĐẦU, rồi cắt về trần.
 *
 * Mới nhất đứng đầu vì phép cắt chặt ở đuôi: id cũ nhất là id sắp hết hạn theo
 * `NOTICE_WINDOW_DAYS`, nên mất nó là mất một thứ sắp vô nghĩa. Cắt ở đầu thì ngược lại — người
 * ta vừa bấm「Đã hiểu」xong đã thấy lại đúng cái vừa đóng.
 */
export function addGuestSeen(current: readonly string[], noticeId: string): string[] {
  const id = noticeId.trim().toLowerCase();
  if (!UUID_SHAPE.test(id)) return [...current];
  return [id, ...current.filter((value) => value !== id)].slice(0, GUEST_SEEN_MAX);
}

/** Ghi ra dạng cất trong cookie. Rỗng thì trả chuỗi rỗng — nơi gọi tự quyết xoá hay để yên. */
export function serializeGuestSeen(ids: readonly string[]): string {
  return ids.slice(0, GUEST_SEEN_MAX).join(",");
}
