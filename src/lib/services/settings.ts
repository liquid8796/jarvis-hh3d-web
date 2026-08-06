import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

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
       * phải tàng thư — giữ mãi thì kho NoSQL phình vô hạn vì những câu "hôm nay cày chưa".
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
