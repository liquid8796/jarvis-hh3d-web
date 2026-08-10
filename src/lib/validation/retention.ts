/**
 * Luật của một HẠN LƯU (số ngày) — biên và phép đọc đầu vào.
 *
 * Ở đây chứ không ở `services/settings.ts`, và lý do rất cụ thể chứ không phải gu sắp xếp:
 * form hạn lưu là component `"use client"`, nên mọi thứ nó import đều đi thẳng vào bundle
 * trình duyệt. `settings.ts` import `db`/drizzle và dựng schema Zod ở cấp module — nhập một
 * hằng số từ đó là gánh cả client database sang phía trình duyệt cho một ô `<input>`. Cùng
 * bài học đã viết ở `validation/tags.ts`. **Tệp này KHÔNG import gì cả, và phải giữ nguyên
 * như vậy.**
 *
 * Ba nơi cần cùng một biên: schema Zod trong settings.ts, action kiểm đầu vào, và `min`/`max`
 * của ô nhập. Cách duy nhất chắc chắn khớp là cùng đọc một hằng số.
 */

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 365;

/**
 * Mặc định cho hạn lưu NHẬT KÝ ĐÀN. Trùng hạn lưu sảnh đàm đạo có chủ ý — một khái niệm
 *「hạn lưu」duy nhất cho cả hệ, không phải hai con số phải nhớ.
 */
export const JOB_EVENT_RETENTION_DEFAULT_DAYS = 7;

/**
 * Giá trị của nút「Quét ngay」trong form hạn lưu. Hai nút cùng gửi về MỘT action, và chuỗi
 * này là thứ phân biệt chúng — nằm ở đây vì cả form (client) lẫn action (server) đều đọc nó,
 * và một chuỗi gõ tay ở hai nơi là một chỗ để lệch.
 */
export const JOB_EVENTS_PURGE_INTENT = "purge";

export type RetentionParse = { ok: true; days: number } | { ok: false; message: string };

/**
 * Đọc số ngày hạn lưu từ đầu vào NGƯỜI GÕ (`<input type="number">` gửi lên chuỗi).
 *
 * Đây là biên tin cậy: qua được đây thì `saveAppSettings` không phải ngờ gì nữa — mà nó lại
 * `parse()` chứ không `safeParse()`, nên một giá trị lọt lưới ở đây sẽ nổ thành lỗi server
 * trần trụi thay vì một dòng nhắc tử tế.
 */
export function parseRetentionDays(raw: unknown): RetentionParse {
  const text = typeof raw === "string" ? raw.trim() : raw;
  if (text === null || text === undefined || text === "") {
    return { ok: false, message: "Chưa nhập số ngày." };
  }
  // `Number` nuốt cả "7.5", "abc", "Infinity" — `Number.isInteger` chặn cả ba, và chặn luôn
  // NaN mà không cần một phép kiểm riêng.
  const days = Number(text);
  if (!Number.isInteger(days) || days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS) {
    return {
      ok: false,
      message: `Hạn lưu phải là số ngày nguyên trong khoảng ${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS}.`,
    };
  }
  return { ok: true, days };
}
