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
 * Thông báo cũ hơn ngần này ngày thì thôi không đuổi theo nữa.
 *
 * Vì sao cần một cái hạn: người vắng mặt nửa tháng quay lại mà bị bảy cái popup xếp hàng thì
 * họ bấm "đã hiểu" bảy lần trong vô thức — tức là không ai đọc gì cả, và cái popup mất luôn
 * sức nặng cho lần thông báo THẬT tiếp theo. Bảy ngày đủ để một người đi nghỉ cuối tuần về
 * vẫn nhận được tin, và đủ ngắn để tin cũ không đội mồ.
 */
export const NOTICE_WINDOW_DAYS = 7;

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
  })
  .superRefine((value, ctx) => {
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
  });

export type NoticeInput = z.infer<typeof noticeInputSchema>;
