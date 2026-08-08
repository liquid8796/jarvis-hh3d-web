import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { DEFAULT_GAME_BASE_URL, normalizeGameBaseUrl } from "@/lib/quest-engine/cookies.mjs";

/**
 * Cấu hình toàn hệ thống — một document JSONB duy nhất, Zod gác CẢ HAI CHIỀU y như
 * user_configs: document ghi bởi bản deploy cũ vẫn về đúng hình thù hôm nay, defaults điền
 * đủ. Mỗi tính năng mới thêm một nhánh vào schema này (và một tab trong trang Tông Môn),
 * không thêm bảng.
 */
export const appSettingsSchema = z.object({
  chat: z
    .object({
      /**
       * Tin đàm đạo sống bao nhiêu ngày trước khi bị quét. Sảnh chung là dòng chảy, không
       * phải tàng thư — giữ mãi thì kho MongoDB phình vô hạn vì những câu "hôm nay cày chưa".
       */
      retentionDays: z.number().int().min(1).max(365).default(7),
    })
    .prefault({}),

  membership: z
    .object({
      /**
       * Cổng bái sư có người gác hay không: bật thì người mới dừng ở `pending` chờ trưởng
       * môn điểm danh, tắt thì họ được thu nhận ngay lúc dâng thiếp.
       *
       * MẶC ĐỊNH `true`, và đó là phần quan trọng nhất của dòng này. Mọi document đã ghi
       * trước bản này đều KHÔNG có nhánh `membership`, nên default chính là thứ áp lên tất
       * cả chúng ngay khi deploy xong. Nếu default là `false`, cổng tông môn tự mở toang mà
       * không một ai bấm gì — một công tắc canh cửa chỉ được phép nghiêng về phía ĐÓNG khi
       * chưa ai nói gì.
       */
      requireApproval: z.boolean().default(true),
    })
    .prefault({}),

  maintenance: z
    .object({
      /**
       * Bế quan trùng tu: bật lên là cửa phát việc (op claim của /api/worker) đóng lại và
       * Khai Đàn từ chối lập đàn mới — nhưng vòng đang chạy dở vẫn được về đích, vì bốn op
       * còn lại của giao thức linh sứ không bị chạm. Mặc định TẮT, hiển nhiên: mọi document
       * đã ghi trước bản này không có nhánh maintenance, và không ai muốn deploy xong thì
       * cả tông môn tự dưng đóng cửa.
       */
      /**
       * MỌI trường đều có .catch(): getAppSettings khi safeParse trượt là trả default cho
       * CẢ document — nghĩa là một giá trị rác ở đây (ai đó sửa tay JSONB) sẽ kéo membership
       * về BẬT lại ngoài ý muốn. .catch() cô lập thiệt hại vào đúng trường hỏng: trường ấy
       * về default, hàng xóm không suy suyển. Mốc thời gian là chuỗi ISO và cố ý KHÔNG
       * .datetime() — phía đọc tự phòng thân bằng Date.parse.
       */
      active: z.boolean().catch(false),
      /** ISO — mốc bắt đầu, chân trái của thanh tiến độ. */
      startedAt: z.string().nullable().catch(null),
      /** ISO — hạn chót dự kiến do trưởng môn ước lượng; đồng hồ đếm ngược trỏ vào đây. */
      expectedEndAt: z.string().nullable().catch(null),
      /** Lời nhắn tuỳ ý hiện trong popup ("nâng cấp engine Hoang Vực…"). */
      note: z.string().max(500).catch(""),
    })
    // .catch() khiến input type của object hết rỗng được — prefault phải mang đủ bốn giá trị.
    .prefault({ active: false, startedAt: null, expectedEndAt: null, note: "" }),

  game: z
    .object({
      /**
       * Tên miền hoathinh3d ĐANG SỐNG. Site đổi TLD định kỳ (mx → am → one → …), và mỗi lần
       * đổi là mọi automation đứng im cho tới khi có người sửa.
       *
       * Nằm trong app_settings chứ không phải hằng số trong mã nguồn, vì đó chính là bài học
       * của 07/08/2026: cú dời `.am → .one` đã bắt cả tông môn chờ một lần deploy chỉ để đổi
       * ba ký tự. Ở đây trưởng môn gõ tên miền mới và vòng chạy KẾ TIẾP đã dùng nó — không
       * deploy, không sửa env trên VM, không cài lại linh sứ.
       *
       * `.catch()` rơi về hằng số trong mã nguồn: một giá trị rác ở đây (sửa tay JSONB) mà
       * làm cả nhánh hỏng thì thà chạy bằng tên miền cũ còn hơn chạy bằng chuỗi rỗng.
       */
      baseUrl: z
        .string()
        .transform((value) => {
          const parsed = normalizeGameBaseUrl(value);
          return parsed.ok ? parsed.baseUrl : DEFAULT_GAME_BASE_URL;
        })
        .catch(DEFAULT_GAME_BASE_URL),
    })
    .prefault({ baseUrl: DEFAULT_GAME_BASE_URL }),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

const GLOBAL_ID = "global";

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db()
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.id, GLOBAL_ID))
    .limit(1);

  const parsed = appSettingsSchema.safeParse(rows[0]?.value ?? {});
  return parsed.success ? parsed.data : appSettingsSchema.parse({});
}

export async function saveAppSettings(value: AppSettings): Promise<void> {
  const clean = appSettingsSchema.parse(value);
  await db()
    .insert(schema.appSettings)
    .values({ id: GLOBAL_ID, value: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.id,
      set: { value: clean, updatedAt: sql`now()` },
    });
}
