import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { DEFAULT_GAME_BASE_URL, normalizeGameBaseUrl } from "@/lib/quest-engine/cookies.mjs";
import type { TagFrame } from "@/lib/validation/tags";

/**
 * Cấu hình toàn hệ thống — một document JSONB duy nhất, Zod gác CẢ HAI CHIỀU y như
 * user_configs: document ghi bởi bản deploy cũ vẫn về đúng hình thù hôm nay, defaults điền
 * đủ. Mỗi tính năng mới thêm một nhánh vào schema này (và một tab trong trang Tông Môn),
 * không thêm bảng.
 */
/**
 * Một tấm nền đã chọn. Giữ CẢ `key` lẫn `url`: url để vẽ, key để còn xoá được object và để
 * lưới ảnh biết tấm nào đang được dùng — suy ngược url ra key là một phép giải mã chạy trước
 * một lệnh XOÁ, đúng cái bẫy đã ghi ở cột `avatarKey` trong schema.ts.
 */
const backdropImageSchema = z.object({
  key: z.string().min(1).max(512),
  url: z.string().min(1).max(2048),
});

export const appSettingsSchema = z.object({
  chat: z
    .object({
      /**
       * Tin đàm đạo sống bao nhiêu ngày trước khi bị quét. Sảnh chung là dòng chảy, không
       * phải tàng thư — giữ mãi thì kho MongoDB phình vô hạn vì những câu "hôm nay cày chưa".
       */
      retentionDays: z.number().int().min(1).max(365).default(7),

      /**
       * Sổ KHUNG TAG — bài vị hoa văn hiện cạnh tên trong Phòng Chat (xem validation/tags.ts
       * cho luật so khớp). Nằm trong app_settings chứ không thành bảng riêng vì nó là danh
       * sách cấu hình cỡ chục phần tử do admin quản — đúng loại dữ liệu mà document này sinh
       * ra để giữ, và một bảng mới nghĩa là một migration trên database thật cho một tính
       * năng không cần JOIN với ai.
       *
       * `.catch([])` theo đúng luật của tệp: một phần tử rác (sửa tay JSONB) làm hỏng cả
       * mảng thì sảnh vẽ tag dạng chữ như trước — mất trang trí, không mất chức năng.
       */
      tagFrames: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().trim().min(1).max(24),
            url: z.string().min(1).max(2048),
            key: z.string().min(1).max(512),
            isDefault: z.boolean().default(false),
          }),
        )
        .catch([])
        .default([]) satisfies z.ZodType<TagFrame[]>,
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
       * còn lại của giao thức khôi lỗi không bị chạm. Mặc định TẮT, hiển nhiên: mọi document
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

  appearance: z
    .object({
      /**
       * Nền MẶC ĐỊNH — cũng chính là nền trang chủ, và nền của mọi trang chưa ai chọn gì.
       *
       * `null` nghĩa là chưa ai đặt, và lúc ấy tấm cứu hộ trong `public/` lo (xem
       * `RESCUE_BACKDROP_URL`). Một khái niệm, một ô để bấm: không có "nền trang chủ" tách
       * khỏi "nền mặc định" để rồi phải nhớ giữ hai thứ cho khớp nhau.
       */
      defaultBackdrop: backdropImageSchema.nullable().catch(null),

      /**
       * Nền riêng của từng trang: mã trang → ảnh. Trang vắng mặt là "theo mặc định".
       *
       * `z.record` chứ không phải một object khai đủ chín khoá, vì sổ trang sống ở
       * `validation/backdrops.ts` — nơi KHÔNG được import zod (nó đi vào bundle trình duyệt).
       * Chép danh sách trang ra đây lần nữa là dựng một sự thật thứ hai để chờ ngày lệch;
       * thay vào đó phía ĐỌC lọc theo sổ (`backdropCss` chỉ duyệt `BACKDROP_PAGES`), nên một
       * mã lạ nằm trong document cũng không sinh ra được luật CSS nào.
       *
       * `.catch({})` theo đúng luật của tệp: một phần tử rác làm hỏng cả phép gán thì mọi
       * trang về nền mặc định — mất trang trí, không mất chức năng.
       */
      pageBackdrops: z.record(z.string(), backdropImageSchema).catch({}),
    })
    .prefault({ defaultBackdrop: null, pageBackdrops: {} }),

  game: z
    .object({
      /**
       * Tên miền hoathinh3d ĐANG SỐNG. Site đổi TLD định kỳ (mx → am → one → …), và mỗi lần
       * đổi là mọi automation đứng im cho tới khi có người sửa.
       *
       * Nằm trong app_settings chứ không phải hằng số trong mã nguồn, vì đó chính là bài học
       * của 07/08/2026: cú dời `.am → .one` đã bắt cả tông môn chờ một lần deploy chỉ để đổi
       * ba ký tự. Ở đây trưởng môn gõ tên miền mới và vòng chạy KẾ TIẾP đã dùng nó — không
       * deploy, không sửa env trên VM, không cài lại khôi lỗi.
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

  /**
   * Sổ gương trạm — danh mục trạm dự phòng cho hệ chuyển trạm (deploy/mirror/README.md §4).
   *
   * `pg`/`mongo` là chuỗi kết nối của trạm BÊN KIA, mã hoá bằng secretBox (khoá
   * ENCRYPTION_KEY trong env) NGAY TỪ server action — bản rõ không bao giờ chạm document.
   * Cùng lẽ với cookie game: quyền đọc database này không được đồng nghĩa quyền cầm database
   * khác. Sổ sống trong app_settings nên tự đi theo mọi lượt đồng bộ — trạm mới nhận nguyên
   * sổ để ngày sau chuyển tiếp hoặc quay về; điều kiện là mọi trạm chung ENCRYPTION_KEY.
   *
   * `.catch([])` theo luật của tệp: một phần tử rác (sửa tay JSONB) làm hỏng phép gán thì
   * mất SỔ chứ không mất trang admin — và mất sổ thì nhập lại được, còn admin sập thì không
   * còn chỗ mà nhập.
   */
  mirrors: z
    .array(
      z.object({
        /** Trùng SITE_ID của deploy bên kia — khoá định danh, không đổi sau khi tạo. */
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
        url: z.string().url().startsWith("https://"),
        /** DATABASE_URL của trạm kia, phong bì secretBox `v1.…`. */
        pg: z.string().min(1),
        /** MONGODB_URI của trạm kia, phong bì secretBox `v1.…`. */
        mongo: z.string().min(1),
        lastProbeAt: z.string().nullable().catch(null),
        lastProbeOk: z.boolean().nullable().catch(null),
        lastProbeNote: z.string().max(500).catch(""),
      }),
    )
    .catch([])
    .prefault([]),
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

/**
 * `getAppSettings` cho ĐƯỜNG DỰNG TRANG — một lượt đọc duy nhất cho cả lượt dựng.
 *
 * Sinh ra vì layout gốc giờ hỏi cấu hình hai lần cho hai việc khác nhau: cửa bế quan
 * (`getMaintenanceFeed`) và tấm nền (`getAppearanceFeed`). Không chung `cache()` thì mỗi lượt
 * vẽ trang tốn hai câu truy vấn cho cùng một dòng JSONB — và tệ hơn, hai câu ấy có thể trả về
 * hai đời cấu hình khác nhau nếu trưởng môn bấm Lưu đúng khe giữa chúng.
 *
 * KHÔNG bọc `cache()` thẳng lên `getAppSettings`: đó là API gốc, và các action lẫn script kiểm
 * chứng đọc-rồi-ghi-rồi-đọc-lại qua nó (`verifyMaintenanceMode` chẳng hạn). Trong lượt dựng của
 * React thì không có phép ghi nào, nên chỉ đường ấy mới an toàn để ghi nhớ.
 *
 * Ngoài lượt dựng của React, `cache()` chỉ là gọi thẳng — nên script dùng hàm này cũng không
 * nhận phải dữ liệu cũ.
 */
export const getRenderSettings = cache(getAppSettings);

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
