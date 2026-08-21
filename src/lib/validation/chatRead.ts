/**
 * Luật THUẦN quanh mốc đã-đọc của Phòng Chat — phần mà cả sảnh (định vị chỗ đọc dở) lẫn icon
 * nổi (huy hiệu số tin) cùng phải hiểu giống nhau, tách ra đây để `verify:chat-read` đo được
 * từng nhánh mà không cần Mongo hay trình duyệt.
 *
 * Mốc là `createdAt` (ms) của tin mới nhất người ấy đã thấy — cùng định nghĩa với
 * `chat_reads.lastReadAt` bên services/chat.ts. Mọi phép so ở đây đều so timestamp CỦA TIN,
 * không bao giờ đụng tới đồng hồ máy người dùng.
 */

/** Hình dạng tối thiểu của một tin mà các phép so cần — trùng tên trường với ChatMessageView. */
export type ReadableMessage = {
  createdAt: string;
  userId: string;
  deleted: boolean;
};

/** `lastReadAt` từ API (ISO hoặc null) thành ms; chuỗi hỏng đọc như「chưa có mốc」. */
export function parseMarkMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tin CHƯA ĐỌC đầu tiên trong một trang tin đã xếp theo thời gian tăng — chỗ đặt vạch
 *「tin chưa đọc」và cũng là chỗ neo cuộn khi mở sảnh. `-1` = không có gì chưa đọc.
 *
 * Tin của CHÍNH MÌNH và tin đã thu hồi không tính — cùng luật với `countUnread` phía server;
 * hai phía mà lệch nhau thì huy hiệu nói「3 tin」rồi mở sảnh ra lại đứng ở một chỗ khác.
 *
 * So bằng `>` chứ không `>=`: mốc CHÍNH LÀ tin mới nhất đã thấy, nên tin trùng mốc là tin
 * đã đọc.
 */
export function firstUnreadIndex(
  messages: readonly ReadableMessage[],
  markMs: number,
  meId: string,
): number {
  return messages.findIndex(
    (m) => !m.deleted && m.userId !== meId && Date.parse(m.createdAt) > markMs,
  );
}

/**
 * Nhãn trên huy hiệu của icon nổi; `null` = không đeo huy hiệu. Trần「99+」vì một con số bốn
 * chữ số trên một vòng tròn 3rem chỉ còn là vệt mực.
 */
export function fabBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}

/**
 * Gác `at` mà client khai khi đẩy mốc — biên tin cậy phía server.
 *
 * Chuỗi hỏng thành `null` (bỏ qua, không phải lỗi 500). Mốc TƯƠNG LAI bị kẹp về `nowMs`:
 * client chỉ được phép vọng lại `createdAt` mà server đã phát, nên một mốc vượt quá「bây
 * giờ」chỉ có thể là đồng hồ bịa — kẹp lại thì người ấy cùng lắm tự đánh dấu đã-đọc-hết,
 * không bao giờ đánh dấu trước được tin CHƯA tồn tại.
 */
export function clampReadAt(iso: unknown, nowMs: number): number | null {
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, nowMs);
}
