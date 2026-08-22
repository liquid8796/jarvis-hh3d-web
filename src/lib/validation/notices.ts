import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@/lib/auth/permissions";

/**
 * THÔNG BÁO TÔNG MÔN — luật về hình dạng một lời nhắn và về việc nó tới tay ai.
 *
 * Nằm ở `validation/` chứ không trong service, vì cùng một bộ luật phải đúng ở BA nơi: form
 * bên trình duyệt (chặn sớm cho người gõ đỡ mất công), server action (chặn thật, vì form là
 * thứ ngoài Internet chạm tới được), và bảng trong database (cột `audience_kind` có check).
 */

/**
 * Ai nhận: cả tông môn, những người mang một trong các vai đã chọn, đúng những người đã chỉ,
 * hoặc KHÁCH CHƯA ĐĂNG NHẬP.
 *
 * `guests` khác hẳn ba kiểu kia ở một điểm quyết định mọi thứ phía dưới: người nhận KHÔNG CÓ
 * dòng nào trong `users`. Nên nó không đếm được, không ghi được dấu「đã xem」vào `notice_reads`
 * (cột `user_id` là NOT NULL kèm khoá ngoại), và không dùng chung một câu truy vấn với ba kiểu
 * kia. Ba hệ quả ấy được xử ở đúng ba chỗ — `countRecipients`, `guestSeen.ts`, `guestNotices` —
 * chứ không nhét vào một nhánh chung rồi để mỗi nơi tự nhớ.
 *
 * Và một điều PHẢI đúng mãi: `unseenNotices` (đường của người đã đăng nhập) liệt kê tường minh
 * ba kiểu `all`/`users`/`roles`, nên một lời nhắn `guests` KHÔNG BAO GIỜ lọt sang màn hình
 * thành viên. Đó là phép loại trừ theo DANH SÁCH TRẮNG, không phải theo phép trừ — thêm kiểu
 * thứ năm sau này cũng vẫn an toàn mà không ai phải nhớ sửa chỗ ấy.
 */
export const NOTICE_AUDIENCE_KINDS = ["all", "roles", "users", "guests"] as const;
export type NoticeAudienceKind = (typeof NOTICE_AUDIENCE_KINDS)[number];

export const NOTICE_AUDIENCE_LABEL: Record<NoticeAudienceKind, string> = {
  all: "Cả tông môn",
  roles: "Theo vai",
  users: "Chọn từng người",
  guests: "Khách chưa đăng nhập",
};

/** Kiểu phạm vi KHÔNG kèm danh sách người nhận — `audience` phải rỗng. */
export function audienceIsBroad(kind: NoticeAudienceKind): boolean {
  return kind === "all" || kind === "guests";
}

/**
 * Trần độ dài. 1000 ký tự là một lời nhắn dài — đủ cho một thông báo bảo trì có đầu có đuôi,
 * mà vẫn vừa một popup không phải cuộn ba màn hình. Trần này CŨNG là hàng rào: popup hiện ra
 * đè lên mọi trang, nên một lời nhắn dài vô hạn là một cách khoá màn hình người khác.
 */
export const NOTICE_MAX_LENGTH = 1000;

/**
 * THỜI HẠN TỒN TẠI — mỗi lời nhắn tự mang hạn của nó, và bảy ngày chỉ còn là mặc định.
 *
 * Vì sao cần một cái hạn: người vắng mặt nửa tháng quay lại mà bị bảy cái popup xếp hàng thì
 * họ bấm "đã hiểu" bảy lần trong vô thức — tức là không ai đọc gì cả, và cái popup mất luôn
 * sức nặng cho lần thông báo THẬT tiếp theo. Bảy ngày đủ để một người đi nghỉ cuối tuần về
 * vẫn nhận được tin, và đủ ngắn để tin cũ không đội mồ.
 *
 * Vì sao hạn ấy phải ĐẶT ĐƯỢC TỪNG LỜI NHẮN (21/08/2026): chính ô soạn của tab Phát Thông Báo
 * gợi ý「Tối nay 21h tông môn bế quan trùng tu khoảng 15 phút」— một lời nhắn hết nghĩa lúc
 * 21h15, mà bảy ngày sau vẫn nhảy ra chặn màn hình người mới vào. Một hạn cứng cho mọi loại tin
 * là bắt tin sống vài giờ phải mang tuổi thọ của tin sống một tuần.
 *
 * Hạn nằm trong cột `expires_at` của từng dòng, tính lúc phát (`now() + hạn`) chứ không suy ra
 * lúc đọc: phép đọc chỉ còn một mệnh đề `expires_at > now()`, và dòng nào đã phát thì hạn của
 * nó đóng băng theo — đổi mặc định ở đây KHÔNG hồi tố lên tin đã gửi.
 */
export const HOURS_PER_DAY = 24;

/** Mặc định khi người phát không đụng gì tới ô thời hạn. */
export const NOTICE_DEFAULT_LIFETIME_DAYS = 7;
export const NOTICE_DEFAULT_LIFETIME_HOURS = NOTICE_DEFAULT_LIFETIME_DAYS * HOURS_PER_DAY;

/**
 * Sàn một giờ. Ngắn hơn thì lời nhắn gần như chỉ còn là cú bắn realtime cho ai đang mở web —
 * ai đi pha ấm trà về là mất, và không có cách nào biết mình đã lỡ cái gì.
 */
export const NOTICE_MIN_LIFETIME_HOURS = 1;

/**
 * Trần ba mươi ngày, và nó là hàng rào chứ không phải con số cho tròn: cái lẽ「đừng để popup xếp
 * hàng」ở trên vẫn đúng, nên một lời nhắn sống nửa năm là một cách khoá màn hình người mới bằng
 * tin đã chết. Cần một thứ đứng lâu hơn thế thì chỗ của nó là Bản Tin, không phải popup.
 */
export const NOTICE_MAX_LIFETIME_DAYS = 30;
export const NOTICE_MAX_LIFETIME_HOURS = NOTICE_MAX_LIFETIME_DAYS * HOURS_PER_DAY;

/** Đơn vị người phát gõ vào. Giờ cho tin bảo trì trong tối, ngày cho tin còn lại. */
export const NOTICE_LIFETIME_UNITS = ["hours", "days"] as const;
export type NoticeLifetimeUnit = (typeof NOTICE_LIFETIME_UNITS)[number];

export const NOTICE_LIFETIME_UNIT_LABEL: Record<NoticeLifetimeUnit, string> = {
  hours: "giờ",
  days: "ngày",
};

/** Gộp「số + đơn vị」thành giờ. Một chỗ duy nhất, dùng chung cho form và cho server action. */
export function lifetimeToHours(value: number, unit: NoticeLifetimeUnit): number {
  return unit === "days" ? value * HOURS_PER_DAY : value;
}

/**
 * Đọc một số giờ thành tiếng người: 168 → "7 ngày", 36 → "36 giờ".
 *
 * Quy về ngày khi chia hết, vì đó là cách người ta nói. Không quy về "1 ngày 12 giờ" — một câu
 * hai đơn vị dài hơn mà không nói thêm được gì trong ngữ cảnh này.
 */
export function formatLifetime(hours: number): string {
  return hours % HOURS_PER_DAY === 0
    ? `${hours / HOURS_PER_DAY} ${NOTICE_LIFETIME_UNIT_LABEL.days}`
    : `${hours} ${NOTICE_LIFETIME_UNIT_LABEL.hours}`;
}

const bodySchema = z
  .string()
  .trim()
  .min(1, "Chưa có nội dung thông báo.")
  .max(NOTICE_MAX_LENGTH, `Thông báo dài quá ${NOTICE_MAX_LENGTH} ký tự.`);

/**
 * Payload của một lượt phát, đã qua kiểm.
 *
 * `audience` là mảng RỖNG với `all` — và đó là chủ ý: một hình dạng duy nhất cho cả ba kiểu
 * thì bảng chỉ cần một cột, còn nơi đọc thì phân nhánh theo `kind` chứ không phải đoán từ
 * việc mảng có rỗng hay không.
 */
export const noticeInputSchema = z
  .object({
    body: bodySchema,
    audienceKind: z.enum(NOTICE_AUDIENCE_KINDS),
    audience: z.array(z.string().trim().min(1)).max(500).default([]),
    /**
     * Thời hạn đi vào dưới dạng NGƯỜI TA GÕ (số + đơn vị), không phải một con số giờ do trình
     * duyệt nhân sẵn: server phải kiểm đúng thứ con người đã chọn, và câu báo lỗi mới nói lại
     * được bằng chính đơn vị họ đang nhìn. Phép nhân là việc của `.transform` bên dưới.
     *
     * Có `.default` cho cả hai để một form CŨ (tab mở từ trước lượt phát hành này) không chết
     * ở cửa: thiếu hai ô ấy thì rơi về đúng hành vi bảy ngày như trước.
     */
    lifetimeValue: z.coerce
      .number("Thời hạn phải là một con số.")
      .int("Thời hạn phải là số nguyên.")
      .positive("Thời hạn phải lớn hơn 0.")
      .default(NOTICE_DEFAULT_LIFETIME_DAYS),
    lifetimeUnit: z
      .enum(NOTICE_LIFETIME_UNITS, { error: "Đơn vị thời hạn chỉ nhận giờ hoặc ngày." })
      .default("days"),
  })
  .superRefine((value, ctx) => {
    const hours = lifetimeToHours(value.lifetimeValue, value.lifetimeUnit);
    if (hours < NOTICE_MIN_LIFETIME_HOURS) {
      ctx.addIssue({
        code: "custom",
        path: ["lifetimeValue"],
        message: `Thời hạn ngắn nhất là ${NOTICE_MIN_LIFETIME_HOURS} giờ.`,
      });
    }
    if (hours > NOTICE_MAX_LIFETIME_HOURS) {
      ctx.addIssue({
        code: "custom",
        path: ["lifetimeValue"],
        message: `Thời hạn dài nhất là ${NOTICE_MAX_LIFETIME_DAYS} ngày.`,
      });
    }
    if (audienceIsBroad(value.audienceKind)) return;
    if (value.audience.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["audience"],
        message:
          value.audienceKind === "roles" ? "Chưa chọn vai nào." : "Chưa chọn đạo hữu nào.",
      });
      return;
    }
    if (value.audienceKind === "roles") {
      const known = new Set<string>(ASSIGNABLE_ROLES);
      // Vai lạ KHÔNG được im lặng bỏ qua: bỏ qua thì người phát tin rằng mình vừa gửi cho
      // một nhóm, mà nhóm ấy chưa từng tồn tại — một thông báo "đã gửi" mà không ai nhận.
      const stray = value.audience.filter((code) => !known.has(code));
      if (stray.length > 0) {
        ctx.addIssue({ code: "custom", path: ["audience"], message: `Vai không có trong thang vai: ${stray.join(", ")}` });
      }
    }
  })
  /**
   * Gộp「số + đơn vị」thành đúng một con số giờ TRƯỚC khi rời khỏi cửa kiểm.
   *
   * Nhờ vậy mọi thứ phía sau (service, database) chỉ biết một đại lượng duy nhất, và không nơi
   * nào phải nhớ nhân với 24 — cái phép nhân bị quên đúng một chỗ là một lời nhắn sống 7 giờ
   * thay vì 7 ngày, mà không có gì đỏ lên cả.
   */
  .transform(({ lifetimeValue, lifetimeUnit, ...rest }) => ({
    ...rest,
    lifetimeHours: lifetimeToHours(lifetimeValue, lifetimeUnit),
  }));

export type NoticeInput = z.infer<typeof noticeInputSchema>;
