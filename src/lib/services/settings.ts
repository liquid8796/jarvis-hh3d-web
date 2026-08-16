import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  HOURS_PER_DAY,
  JOB_EVENT_RETENTION_DEFAULT_HOURS,
  RETENTION_MAX_DAYS,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_DAYS,
  RETENTION_MIN_HOURS,
} from "@/lib/validation/retention";
import { MAX_LINES_PER_NOTE, MAX_LINE_LENGTH, MAX_NOTES } from "@/lib/changelog";
import { db, schema } from "@/lib/db/client";
import { DEFAULT_WORKFLOW_FILE } from "@/lib/validation/githubStations";
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
        /**
         * ── HAI TRƯỜNG THỪA KẾ (16/08/2026) ────────────────────────────────────────────────
         *
         * DATABASE_URL / MONGODB_URI của trạm kia, phong bì secretBox `v1.…`. Tab Gương Trạm
         * KHÔNG còn hỏi, không còn hiện, không còn kiểm mạch chúng: các trạm nay là vỏ chuyển
         * tiếp về backend trên VM, và kho riêng của từng trạm không ai đọc nữa.
         *
         * `.default("")` chứ không `.min(1)`, và đây là chỗ dễ trả giá nhất của cả lượt gỡ:
         * `min(1)` đứng đây thì một trạm ghi mới (không còn chuỗi kết nối) sẽ làm CẢ MẢNG
         * `mirrors` trượt phép gán, rơi vào `.catch([])` bên dưới — tức mất trắng sổ, gồm cả
         * những trạm cũ đang lành. Một trường không ai điền phải là một trường được phép rỗng.
         *
         * Giá trị CŨ vẫn nằm nguyên trong sổ: gỡ khỏi giao diện không phải là xoá dữ liệu, và
         * xoá phong bì credential là một quyết định riêng, cố ý, của người vận hành.
         */
        pg: z.string().default(""),
        mongo: z.string().default(""),
        /**
         * Vercel API token của TÀI KHOẢN giữ trạm này, phong bì secretBox — để tab Gương Trạm
         * đọc được mức dùng 30 ngày (`/v2/usage`).
         *
         * `.default("")` chứ không bắt buộc, và đó là phần quan trọng: mọi trạm đã ghi vào sổ
         * TRƯỚC bản này đều không có trường này, và chúng phải tiếp tục sống bình thường —
         * chỉ là chưa đọc được usage cho tới khi ai đó dán token vào.
         *
         * Vì sao vào SỔ chứ không vào env của deployment: token là của một TÀI KHOẢN VERCEL
         * KHÁC. Rải nó vào env nghĩa là mỗi trạm phải ôm token của mọi trạm còn lại, và đổi
         * một cái token là phải deploy lại tất cả. Sổ thì đã mã hoá sẵn, đã đi theo mọi lượt
         * đồng bộ, và đã là chỗ giữ hai chuỗi kết nối cùng loại nhạy cảm.
         */
        vercelToken: z.string().default(""),
        /**
         * BẢNG USAGE ĐẦY ĐỦ do bên ngoài ĐẨY LÊN — không phải thứ web tự đọc được.
         *
         * Vì sao phải đẩy: bảng đầy đủ chỉ lấy được bằng cách dựng trang Usage trong một trình
         * duyệt thật rồi cuộn cho nó render (đo 11/08/2026: `fetch` thuần chỉ đúng 1/8 lượt, và
         * thiếu đúng mấy cột Fluid). Function trên Vercel không mở nổi Chromium, nên chỗ có
         * Chromium — GitHub Actions theo lịch — cào rồi POST vào `/api/usage-report`.
         *
         * Ở đây KHÔNG có credential nào: cookie phiên ở lại trong secret của GitHub, chỉ có con
         * số đi qua dây. Đó là toàn bộ lý do thiết kế này đảo chiều thay vì cho web đi lấy.
         *
         * Giữ `used`/`limit` dạng CHUỖI đúng như trang hiển thị ("3h 44m", "217.4 GB-Hrs",
         * "1.29 GB"). Quy về số thì phải đoán đơn vị cho từng meter, mà đơn vị là thứ Vercel
         * đổi được — còn chuỗi thì hiện lên đúng bằng thứ người ta thấy trên dashboard.
         */
        usageReport: z
          .object({
            readAt: z.string(),
            meters: z
              .array(
                z.object({
                  title: z.string().min(1).max(80),
                  used: z.string().max(40),
                  limit: z.string().max(40).nullable().default(null),
                }),
              )
              .max(200),
          })
          .nullable()
          .catch(null)
          .default(null),
        lastProbeAt: z.string().nullable().catch(null),
        lastProbeOk: z.boolean().nullable().catch(null),
        lastProbeNote: z.string().max(500).catch(""),
      }),
    )
    .catch([])
    .prefault([]),

  /**
   * Máy trạng thái của lượt chuyển trạm đang diễn ra (deploy/mirror/README.md §6).
   *
   * Sống trong app_settings để đóng tab rồi mở lại vẫn đi tiếp được — lượt chuyển do trang
   * admin lái từng bước, và bước nào cũng có thể là bước cuối trước khi ai đó đóng máy.
   *
   * `phase` KHÔNG có "flipping": lượt lật bảng điều phối là một `PutObject` nguyên tử rồi
   * đọc lại xác nhận, nên nó hoặc xong hoặc chưa — không có khoảnh khắc nào đáng đặt tên ở
   * giữa.
   *
   * Trạm VỪA ĐƯỢC CẤT NHẮC thức dậy ở `phase: "idle"`, không phải `"done"` — `flipSwitchAction`
   * ghi thẳng bản ghi ấy vào đích. Bản trước để nó thừa hưởng phase dở dang và đã trả giá trong
   * lượt diễn tập 10/08/2026: trạm mới lên ngôi mà không mở nổi lượt chuyển kế (vì
   * `beginSwitchAction` chỉ nhận `idle`/`failed`), lại còn hiện nút「Lật」trỏ vào chính nó. Trạm
   * CŨ thì giữ `"done"` — với nó, lượt ấy đã xong thật, và đó là dấu vết kể lại chuyện vừa qua.
   * Dấu vết CÓ THẨM QUYỀN vẫn là bảng điều phối, không phải bản ghi này.
   */
  mirrorSwitch: z
    .object({
      phase: z.enum(["idle", "draining", "syncing", "verifying", "done", "failed"]).catch("idle"),
      /** `id` trong sổ gương — trạm ĐÍCH của lượt chuyển. Rỗng khi phase = idle. */
      targetId: z.string().max(64).catch(""),
      startedAt: z.string().nullable().catch(null),
      updatedAt: z.string().nullable().catch(null),
      /** Câu chữ hiện trên trang admin: đang chép bảng nào, hỏng vì cái gì. */
      note: z.string().max(1000).catch(""),
      /** Chỉ số bảng đang chép trong SYNC_TABLE_ORDER, và offset trong bảng ấy. */
      tableIndex: z.number().int().min(0).catch(0),
      rowOffset: z.number().int().min(0).catch(0),
      copiedRows: z.number().int().min(0).catch(0),
    })
    .catch({ phase: "idle", targetId: "", startedAt: null, updatedAt: null, note: "", tableIndex: 0, rowOffset: 0, copiedRows: 0 })
    .prefault({ phase: "idle", targetId: "", startedAt: null, updatedAt: null, note: "", tableIndex: 0, rowOffset: 0, copiedRows: 0 }),

  /**
   * SỔ KHO GITHUB — tài khoản nào đang giữ một khôi lỗi chạy trên GitHub Actions
   * (deploy/github-actions.md §7).
   *
   * Vì sao ở đây chứ không phải một bảng riêng như bản phác ban đầu ghi. Ba lẽ, lẽ thứ hai là
   * lẽ nặng nhất:
   *   1. Hình dạng TRÙNG KHÍT sổ gương trạm — một danh sách ngắn do người gõ tay, mỗi dòng giữ
   *      một bí mật đã đóng phong bì. Đó đúng là thứ tệp này mở đầu bằng câu「mỗi tính năng mới
   *      thêm một nhánh vào schema này, không thêm bảng」.
   *   2. `assertTablesCovered` (mirror/pgSync.ts) NÉM khi database đích có một bảng không nằm
   *      trong `SYNC_TABLE_ORDER`. Một bảng mới mà quên khai ở đó không hỏng lúc migrate, không
   *      hỏng lúc chạy — nó hỏng giữa một lượt chuyển trạm, tức đúng lúc đang có sự cố. Còn
   *      `app_settings` thì đã nằm trong sổ ấy từ đầu.
   *   3. Nhờ (2), sổ này tự ĐI THEO mọi lượt chuyển trạm — trạm mới thức dậy vẫn nuôi tiếp bốn
   *      kho, không cần ai nhập lại PAT. Điều kiện: mọi trạm chung `ENCRYPTION_KEY`, y như sổ
   *      gương trạm.
   *
   * `pat` là phong bì secretBox, mã hoá NGAY TRONG server action — bản rõ không chạm document,
   * không xuống client, không vào log. Nó nguy hiểm hơn cookie game một bậc: cookie mở một tài
   * khoản game, PAT thì PUSH ĐƯỢC MÃ vào kho đang chạy khôi lỗi. Vì thế cửa vào là
   * `github_station.manage`, mã riêng chỉ Gia chủ.
   */
  githubStations: z
    .array(
      z.object({
        owner: z.string().min(1).max(39),
        repo: z.string().min(1).max(100),
        /** Tệp workflow trong `.github/workflows/` — cần tên để hỏi trạng thái và bật lại lịch. */
        workflowFile: z.string().min(1).max(100).catch(DEFAULT_WORKFLOW_FILE).default(DEFAULT_WORKFLOW_FILE),
        /**
         * `WORKER_ID` mà workflow của kho này khai. Chỉ để ĐỐI CHIẾU bằng mắt với mục Khôi Lỗi
         * trên dashboard — sổ này không dùng nó để quyết định gì, nên một giá trị rỗng hay lệch
         * không làm hỏng vòng nuôi. Có nó vì câu hỏi「kho này nuôi con khôi lỗi nào」là câu
         * người vận hành hỏi đầu tiên khi một khôi lỗi biến mất khỏi dashboard.
         */
        workerId: z.string().max(120).catch("").default(""),
        /** PAT của tài khoản giữ kho, phong bì secretBox `v1.…`. */
        pat: z.string().min(1),
        /** Tắt là đứng ngoài vòng nuôi — dòng và PAT giữ nguyên, chỉ không ai đụng tới kho ấy. */
        enabled: z.boolean().catch(true).default(true),
        /**
         * HAI mốc thời gian, và chúng KHÔNG thay nhau được:
         *   • `lastPingAt` — lượt ngó gần nhất, mỗi ngày một lần. Trả lời「vòng nuôi còn chạy không」.
         *   • `lastCommitAt` — lượt GHI gần nhất, ~20 ngày một lần. Trả lời「kho còn cách mốc 60
         *     ngày bao xa」, và là mốc duy nhất `isCommitDue` đọc.
         * Gộp chúng làm một là mất đúng con số quan trọng: một vòng ngó thành công mỗi ngày sẽ
         * đẩy mốc đi hoài, và sổ vĩnh viễn báo「vừa nuôi hôm qua」kể cả khi lượt ghi cuối đã 59
         * ngày trước.
         */
        lastPingAt: z.string().nullable().catch(null).default(null),
        lastCommitAt: z.string().nullable().catch(null).default(null),
        lastPingOk: z.boolean().nullable().catch(null).default(null),
        lastPingNote: z.string().max(500).catch("").default(""),
        /** `state` GitHub khai ở lượt ngó gần nhất — xem `WorkflowState`. Rỗng = chưa ngó lần nào. */
        workflowState: z.string().max(40).catch("").default(""),
      }),
    )
    /**
     * `.catch([])` theo luật của tệp: một phần tử rác làm hỏng phép gán thì mất SỔ chứ không
     * mất trang admin — mất sổ thì nhập lại được, còn admin sập thì không còn chỗ mà nhập.
     */
    .catch([])
    .prefault([]),

  /**
   * Hạn lưu NHẬT KÝ ĐÀN — van xả mà `deploy/mirror/README.md` §11 đã ghi trước là sẽ cần.
   *
   * `job_events` chỉ đi một chiều, và nó là bảng LỚN NHẤT trong lượt chuyển trạm: đo 10/08/2026
   * là 12.038 dòng cho 9 ngày, mà đỉnh tới 9.674 dòng MỘT ngày. Giữ mãi thì sau một tháng là
   * ~290 nghìn dòng, và bước chép sẽ từ 26 giây phình thành hàng chục phút — tức mỗi lượt
   * chuyển trạm là một lượt bế quan dài ra theo tuổi của tông môn.
   *
   * Mặc định 7 ngày, TRÙNG với hạn lưu sảnh đàm đạo có chủ ý: một khái niệm「hạn lưu」duy nhất
   * cho cả hệ, không phải hai con số phải nhớ. Nới lên thì nhật ký giữ lâu hơn, đổi lại lượt
   * chuyển trạm chậm đi theo — đó là toàn bộ sự đánh đổi, và nó nằm ở đúng một chỗ này.
   *
   * ĐƠN VỊ LƯU LÀ GIỜ từ bản 0.72.0 (`retentionHours`) — xem `validation/retention.ts` cho lý
   * lẽ. `retentionDays` là khoá của MỌI document đã ghi trước bản ấy, nên nhánh này đọc cả hai
   * và đổi ngày thành giờ. Bỏ nhánh đọc cũ đi thì hạn lưu trưởng môn đã đặt lặng lẽ rơi về mặc
   * định 7 ngày ngay nhịp deploy — không báo gì, chỉ là một hôm nào đó nhật ký biến mất sớm hơn
   * người ta tưởng. Ghi thì chỉ ghi `retentionHours`: đọc-sửa-ghi trọn document nên khoá cũ tự
   * rụng ở lần Lưu đầu tiên, và giữ lại cả hai khoá nghĩa là nuôi một câu hỏi「cái nào thắng」.
   */
  /**
   * BẢN TIN CẬP NHẬT do Gia chủ sửa tay — phần ĐÈ LÊN danh sách viết sẵn trong
   * `src/lib/changelog.ts`, không phải bản thay thế nó.
   *
   * Luật gộp nằm ở `mergeReleaseNotes` (thuần): cùng số bản thì sổ này thắng, số bản chỉ có
   * trong tệp mã thì lấy nguyên. Nhờ vậy một lượt sửa lời hôm nay không chôn sống mục tin của
   * những lượt phát hành sau — cái bẫy duy nhất của việc cho sửa từ giao diện.
   *
   * `.catch([])` theo đúng luật của tệp này: một phần tử rác thì mất phần SỬA TAY chứ không
   * mất trang. Bản tin còn nguyên danh sách trong tệp mã, và trang admin vẫn mở được để nhập lại.
   *
   * Ràng buộc ở ĐÂY lỏng hơn `reviewNotes` (nó đòi mỗi dòng ít nhất 15 ký tự), và đó là chủ ý:
   * đây là biên TIN CẬY — nó chỉ chặn thứ làm phình document hay sai kiểu. Luật BIÊN TẬP thì
   * gác ở cửa ghi (`saveChangelogAction` → `parseNotesText` → `reviewNotes`). Siết chặt cả hai
   * nơi bằng cùng một con số nghĩa là một document cũ hợp lệ hôm qua có thể bị Zod ném sạch
   * hôm nay chỉ vì luật biên tập đổi — mất bản tin vì một lượt sửa văn phong.
   */
  changelog: z
    .object({
      notes: z
        .array(
          z.object({
            version: z.string().trim().min(1).max(24),
            date: z.string().trim().min(1).max(24),
            lines: z.array(z.string().trim().min(1).max(MAX_LINE_LENGTH)).min(1).max(MAX_LINES_PER_NOTE),
          }),
        )
        .max(MAX_NOTES)
        .catch([])
        .prefault([]),
      /**
       * BIA MỘ — số bản của danh sách viết sẵn đã bị Gia chủ gỡ khỏi bản tin.
       *
       * Không gộp vào `notes` được: một mục đã gỡ thì KHÔNG có nội dung để mà lưu, mà vẫn phải
       * để lại dấu vết — bằng không lượt dựng trang sau lại lấy nguyên mục ấy từ tệp mã và nó
       * mọc lại. Xem `hiddenVersionsFor`.
       *
       * Trần rộng gấp đôi `MAX_NOTES`: danh sách này tích theo lịch sử phát hành chứ không theo
       * số mục đang hiện, nên nó được phép dài hơn — nhưng vẫn phải có trần, vì đây là biên tin cậy.
       */
      hidden: z.array(z.string().trim().min(1).max(24)).max(MAX_NOTES * 2).catch([]).prefault([]),
    })
    .prefault({}),

  jobEvents: z
    .object({
      retentionHours: z
        .number()
        .int()
        .min(RETENTION_MIN_HOURS)
        .max(RETENTION_MAX_HOURS)
        .optional(),
      /** Chỉ để ĐỌC document cũ. Không nơi nào ghi khoá này nữa. */
      retentionDays: z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS).optional(),
    })
    .prefault({})
    .transform(({ retentionHours, retentionDays }) => ({
      retentionHours:
        retentionHours ??
        (retentionDays === undefined
          ? JOB_EVENT_RETENTION_DEFAULT_HOURS
          : retentionDays * HOURS_PER_DAY),
    })),
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
