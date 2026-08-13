/**
 * Luật của một HẠN LƯU — biên, phép đọc đầu vào của người gõ, và cách kể lại bằng chữ.
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
 * Đơn vị lưu trữ của hạn lưu NHẬT KÝ ĐÀN là GIỜ, không phải ngày — đổi từ bản 0.72.0.
 *
 * Người gõ được chọn「giờ」hay「ngày」, nhưng thứ đem đi so với cột `at` thì chỉ nên có MỘT
 * dạng: lưu kèm một trường đơn vị nghĩa là mọi chỗ đọc hạn lưu (purge, thống kê, thông báo)
 * phải tự nhớ nhân lại — và chỗ nào quên là xoá sớm gấp 24 lần. Đơn vị là chuyện của cái form
 * và chỉ sống trong cái form.
 *
 * Biên trên vẫn đúng 365 ngày cũ, kể theo giờ — đổi đơn vị không được lén nới hạn.
 */
export const HOURS_PER_DAY = 24;
export const RETENTION_MIN_HOURS = 1;
export const RETENTION_MAX_HOURS = RETENTION_MAX_DAYS * HOURS_PER_DAY;

/**
 * Mặc định cho hạn lưu NHẬT KÝ ĐÀN. Trùng hạn lưu sảnh đàm đạo có chủ ý — một khái niệm
 *「hạn lưu」duy nhất cho cả hệ, không phải hai con số phải nhớ.
 */
export const JOB_EVENT_RETENTION_DEFAULT_DAYS = 7;
export const JOB_EVENT_RETENTION_DEFAULT_HOURS = JOB_EVENT_RETENTION_DEFAULT_DAYS * HOURS_PER_DAY;

/**
 * Giá trị của nút「Quét ngay」trong form hạn lưu. Hai nút cùng gửi về MỘT action, và chuỗi
 * này là thứ phân biệt chúng — nằm ở đây vì cả form (client) lẫn action (server) đều đọc nó,
 * và một chuỗi gõ tay ở hai nơi là một chỗ để lệch.
 */
export const JOB_EVENTS_PURGE_INTENT = "purge";

export type RetentionUnit = "hour" | "day";

/**
 * Hai đơn vị người gõ chọn được, kèm biên RIÊNG của từng đơn vị. Biên phải riêng vì cùng một
 * con số 8760 là hợp lệ khi đếm giờ và vô nghĩa khi đếm ngày — ô `<input>` lấy `min`/`max` từ
 * đây, và phép kiểm phía server cũng vậy, nên không có đường nào để hai bên lệch nhau.
 */
export const RETENTION_UNITS = [
  { value: "day", label: "ngày", hours: HOURS_PER_DAY, min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS },
  { value: "hour", label: "giờ", hours: 1, min: RETENTION_MIN_HOURS, max: RETENTION_MAX_HOURS },
] as const satisfies readonly {
  value: RetentionUnit;
  label: string;
  hours: number;
  min: number;
  max: number;
}[];

export type RetentionUnitSpec = (typeof RETENTION_UNITS)[number];

export function retentionUnitSpec(unit: RetentionUnit): RetentionUnitSpec {
  // Tìm chứ không tra bằng chỉ số: thứ tự trong mảng là chuyện của cái `<select>`, đổi thứ tự
  // để「ngày」đứng trước không được phép làm sai phép tra này.
  const spec = RETENTION_UNITS.find((candidate) => candidate.value === unit);
  if (!spec) throw new Error(`Đơn vị hạn lưu lạ: ${unit}`);
  return spec;
}

/** Đọc đơn vị từ `<select>`. Trả `null` cho mọi thứ không phải một trong hai đơn vị đã khai. */
export function parseRetentionUnit(raw: unknown): RetentionUnit | null {
  const text = typeof raw === "string" ? raw.trim() : raw;
  return text === "hour" || text === "day" ? text : null;
}

export type RetentionParse = { ok: true; hours: number } | { ok: false; message: string };

/**
 * Đọc hạn lưu từ đầu vào NGƯỜI GÕ (`<input type="number">` + `<select>` đều gửi lên chuỗi).
 *
 * Đây là biên tin cậy: qua được đây thì `saveAppSettings` không phải ngờ gì nữa — mà nó lại
 * `parse()` chứ không `safeParse()`, nên một giá trị lọt lưới ở đây sẽ nổ thành lỗi server
 * trần trụi thay vì một dòng nhắc tử tế.
 *
 * Đơn vị vắng mặt thì TỪ CHỐI, không đoán. Đoán sai chiều「ngày」thành「giờ」là cắt hạn lưu
 * xuống 1/24 và lượt quét kế tiếp xoá thật — một cái nút Lưu không được phép có nhánh im lặng
 * nào dẫn tới đó. (Ca thật của nhánh này: một tab admin mở từ bản cũ, form chưa có ô đơn vị.)
 */
export function parseRetentionHours(rawAmount: unknown, rawUnit: unknown): RetentionParse {
  const unit = parseRetentionUnit(rawUnit);
  if (!unit) {
    return { ok: false, message: "Chưa chọn đơn vị hạn lưu — giờ hay ngày. Tải lại trang rồi thử lại." };
  }
  const spec = retentionUnitSpec(unit);

  const text = typeof rawAmount === "string" ? rawAmount.trim() : rawAmount;
  if (text === null || text === undefined || text === "") {
    return { ok: false, message: `Chưa nhập số ${spec.label}.` };
  }
  // `Number` nuốt cả "7.5", "abc", "Infinity" — `Number.isInteger` chặn cả ba, và chặn luôn
  // NaN mà không cần một phép kiểm riêng.
  const amount = Number(text);
  if (!Number.isInteger(amount) || amount < spec.min || amount > spec.max) {
    return {
      ok: false,
      message: `Hạn lưu phải là số ${spec.label} nguyên trong khoảng ${spec.min}–${spec.max}.`,
    };
  }
  return { ok: true, hours: amount * spec.hours };
}

/**
 * Số giờ đã lưu → cặp (số, đơn vị) để rót vào form. Tròn ngày thì kể bằng ngày: 168 giờ hiện
 * ra là「7 ngày」chứ không phải một con số ba chữ số mà người đọc phải tự chia.
 */
export function splitRetention(hours: number): { amount: number; unit: RetentionUnit } {
  return hours % HOURS_PER_DAY === 0
    ? { amount: hours / HOURS_PER_DAY, unit: "day" }
    : { amount: hours, unit: "hour" };
}

/** Kể một hạn lưu bằng chữ: `168` →「7 ngày」, `36` →「1 ngày 12 giờ」, `6` →「6 giờ」. */
export function formatRetention(hours: number): string {
  const days = Math.floor(hours / HOURS_PER_DAY);
  const rest = hours % HOURS_PER_DAY;
  if (days === 0) return `${hours} giờ`;
  if (rest === 0) return `${days} ngày`;
  return `${days} ngày ${rest} giờ`;
}

/**
 * NHỊP QUÉT TỰ ĐỘNG suy ra từ chính hạn lưu — một phần sáu của nó, kẹp trong [5 phút, 6 giờ].
 *
 * Ở đây, cùng chỗ với các biên, vì đúng ba nơi cần chung một nhịp và hai trong số đó KỂ nó ra
 * bằng chữ: form hạn lưu (client) hứa với trưởng môn, câu báo sau khi Lưu (server) nhắc lại lời
 * hứa ấy, và `sweepExpiredJobEventsIfDue` (server) là nơi thật sự giữ lời. Một hằng số gõ lại ở
 * ba nơi là ba cơ hội để giao diện hứa một nhịp mà máy không chạy — đúng cái bẫy tệp này sinh ra
 * để chặn. Nên nó phải sống trong module KHÔNG import gì này, chứ không trong `services/jobs.ts`.
 *
 * Vì sao một phần sáu: thứ cần ràng buộc là phần VƯỢT HẠN tương đối. Dòng nhật ký sống lâu nhất
 * là hạn lưu cộng một nhịp, tức không quá ~17% quá mốc, đúng như thế ở mọi hạn lưu từ 1 giờ tới
 * 365 ngày. Trần 6 giờ không phá tính chất ấy (từ 36 giờ trở lên, 6 giờ vốn đã nhỏ hơn một phần
 * sáu) mà chỉ giữ cho hạn lưu 365 ngày không kéo theo một câu xoá rỗng mỗi vài phút suốt năm.
 *
 * Sàn 5 phút KHÔNG BAO GIỜ chạm tới với một hạn lưu hợp lệ — hạn lưu nhỏ nhất là 1 giờ, cho nhịp
 * 10 phút. Nó là hàng rào cho một con số hỏng lọt vào, không phải một nấc người ta gặp được.
 */
export const JOB_EVENT_SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const JOB_EVENT_SWEEP_MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const JOB_EVENT_SWEEP_DIVISOR = 6;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function jobEventSweepInterval(retentionHours: number): number {
  // Hạn lưu đi ra từ Zod (`int().min(1).max(8760)`) nên không thể là NaN — nhưng hàm này export
  // ra ngoài, và một NaN lọt tới đây làm MỌI phép so mốc thành false, tức quét không nghỉ. Hỏng
  // về phía "quét thưa nhất" thì mất vài dòng nhật ký chậm; hỏng chiều kia là bào database.
  if (!Number.isFinite(retentionHours)) return JOB_EVENT_SWEEP_MAX_INTERVAL_MS;
  const share = (retentionHours * MS_PER_HOUR) / JOB_EVENT_SWEEP_DIVISOR;
  return Math.min(JOB_EVENT_SWEEP_MAX_INTERVAL_MS, Math.max(JOB_EVENT_SWEEP_MIN_INTERVAL_MS, share));
}

/** Kể một NHỊP bằng chữ: `600000` →「10 phút」, `14400000` →「4 giờ」, `5400000` →「1 giờ 30 phút」. */
export function formatSweepInterval(ms: number): string {
  // Làm tròn tới phút trước khi tách, nếu không `share` lẻ sẽ đẻ ra「0 giờ 60 phút」.
  const minutes = Math.max(1, Math.round(ms / MS_PER_MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} phút`;
  if (rest === 0) return `${hours} giờ`;
  return `${hours} giờ ${rest} phút`;
}
