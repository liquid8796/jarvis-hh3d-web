import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CycleProgress } from "@/lib/realtime/dashboardTypes";

/**
 * One database for everything, on purpose.
 *
 * User identity/approval is classic relational data. The per-user automation CONFIG is a
 * different animal — document-shaped, schema evolving with every quest change (the desktop
 * app is on quest-profile schema 41 and counting) — and that shape lives here as JSONB in
 * the SAME Postgres rather than in a second store. Reasons, in order: the config's schema
 * churns too fast for columns; JSONB still lets SQL peek inside when an admin question
 * needs it; and one database is one backup, one connection string, one thing to operate.
 * Edge Config is for rarely-changing global flags and Blob is unqueryable, so neither fits
 * per-user config that changes from a form.
 */

/**
 * pending — registered, waiting for an admin; can log in but sees only the waiting room.
 * active  — approved; automation features unlocked.
 * disabled — turned away or switched off; can log in to see why, nothing else.
 */
export const userStatus = pgEnum("user_status", ["pending", "active", "disabled"]);

/**
 * VAI TRÒ: một người giữ được nhiều vai, và từ 09/08/2026 quan hệ ấy là một BẢNG THẬT
 * (`user_roles`) chứ không còn là một cột mảng.
 *
 *   gia-chu — vai lớn nhất, MỘT MÌNH nó có quyền sửa/xoá vai của người mang vai. Sinh ra vì
 *             một lỗ hổng có thật: các Trưởng môn ngang quyền có thể hạ vai hay trục xuất
 *             LẪN NHAU, nghĩa là admin nào cũng chỉ an toàn cho tới khi một admin khác đổi ý.
 *
 *   Ba vai NGANG NHAU ở bậc trị sự — duyệt môn đồ, quản môn đồ thường, và KHÔNG đụng được
 *   người mang vai, kể cả người mang đúng vai của mình:
 *     thai-thuong-truong-lao, chuong-mon, admin
 *
 * Không có vai nào = môn đồ thường.
 *
 * Bốn bảng ở cuối tệp này (`roles`, `permissions`, `role_permissions`, `user_roles`) là hình
 * dạng chuẩn hoá của toàn bộ chuyện ấy. Ma trận CHẠY vẫn ở `src/lib/auth/permissions.ts` —
 * xem ghi chú tại `rolePermissions` để biết vì sao có hai bản và bản nào là gốc.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    // Nullable only for accounts created before migration 0008. Every new registration and
    // admin-created account must supply one; old members can add theirs from Hồ Sơ.
    email: text("email").unique(),
    passwordHash: text("password_hash").notNull(),
    /**
     * KHÔNG có cột vai nào ở đây, và đó là chủ ý.
     *
     * Từng có hai: `role` (enum `user|admin`) rồi `roles` (`text[]`). Cả hai bị drop ở migration
     * 0014 sau khi `user_roles` đã cầm sự thật được trọn một nhịp deploy. Thứ tự thu hồi NGƯỢC
     * với thứ tự mở rộng, và nhầm chiều là hỏng thật:
     *
     *   • Thêm cột: migrate TRƯỚC, deploy sau — bản code cũ chưa biết cột mới, không sao.
     *   • Bỏ cột:  deploy TRƯỚC, migrate sau — bản code cũ còn GHI vào cột ấy, drop sớm là
     *              mọi lượt sửa người văng lỗi cho tới khi deploy xong.
     *
     * Ai cần vai thì hỏi `user_roles` (dưới đây), hoặc gọi `findById`/`findByUsername` — cả hai
     * đã ghép sẵn mảng `roles` vào kết quả nên phía trên tầng service không thấy khác gì.
     */
    /**
     * Tag trang trí — hiện thành huy hiệu cạnh tên trong Phòng Chat. Do Trưởng môn/Gia chủ
     * ban (như đạo hiệu được ban trong môn phái), không phải tự nhận. Trần 3 tag × 20 ký tự
     * gác ở tầng action; cột chỉ là mảng chữ.
     */
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    /**
     * Ảnh đại diện — URL công khai trong tàng khố media (OCI), null = chưa đặt và giao diện
     * vẽ vòng tròn chữ đầu như trước.
     *
     * HAI cột cho một tấm ảnh, và cột thứ hai không dư: `avatarKey` là tên object trong kho,
     * thứ duy nhất `DeleteObject` nhận. Đổi ảnh là ghi ảnh mới rồi xoá ảnh cũ, nên phải biết
     * ảnh cũ tên gì — suy ngược từ URL thì được về mặt chuỗi, nhưng đó là một phép giải mã
     * chạy trước một lệnh XOÁ: đoán sai một ký tự là xoá nhầm object của người khác. Giữ
     * nguyên văn cái tên đã ghi thì không có gì để đoán.
     *
     * Vì sao không dùng một key cố định `avatar/{userId}` rồi PUT ghi đè (khỏi cần cột này):
     * kho stamp `immutable, max-age=30 ngày` lên mọi object, nên một key bất biến nghĩa là
     * trình duyệt còn giữ MẶT CŨ suốt một tháng sau khi đổi.
     */
    avatarUrl: text("avatar_url"),
    avatarKey: text("avatar_key"),
    status: userStatus("status").notNull().default("pending"),
    /**
     * LINH PHÙ — token riêng cho khôi lỗi máy nhà của đạo hữu này, lưu dạng SHA-256.
     *
     * Vì sao không dùng chung WORKER_TOKEN: trang cài đặt phát lệnh cài cho MỌI thành viên,
     * mà ai cầm token toàn cục là claim được job của tất cả — tức đọc được cookie game của
     * tất cả. Nên token toàn cục rút về làm token của khôi lỗi tông môn (do người vận hành
     * giữ), còn mỗi đạo hữu cầm một linh phù chỉ mở được job của chính mình.
     *
     * Chỉ lưu hash: bảng users bị lộ thì kẻ đọc trộm vẫn không có token để giả khôi lỗi.
     * Bản rõ chỉ tồn tại đúng một lần — trong hồi đáp của action tạo linh phù.
     */
    workerTokenHash: text("worker_token_hash").unique(),
    workerTokenCreatedAt: timestamp("worker_token_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_status_idx").on(t.status)],
);

/**
 * DANH MỤC VAI. Mỗi dòng là một vai tồn tại; `sort_order` là thứ tự thang vai (gia-chu = 0),
 * cũng chính là thứ tự huy hiệu trên giao diện và thứ tự `normalizeRoles` trả về.
 *
 * Khoá chính là MÃ VAI chứ không phải một `serial` vô nghĩa. Hai lý do: mã vai đã nằm sẵn
 * trong `users.roles` của database thật nên backfill là một phép join thẳng, không cần bảng
 * tra; và một dòng `user_roles` đọc bằng mắt trong psql nói luôn được người ấy là gì, thay vì
 * một con số phải đi tra tiếp. Cái giá là mã vai không đổi tên được nếu không di dân — đúng
 * điều `permissions.ts` đã chốt và giải thích.
 */
export const roles = pgTable("roles", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * DANH MỤC QUYỀN — từng việc cụ thể một vai mở ra được. Mã quyền có mặt trong code dưới dạng
 * kiểu `Permission`, nên một mã gõ sai không biên dịch được.
 */
export const permissions = pgTable("permissions", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * VAI → QUYỀN. Bảng này là bản SAO của `ROLE_PERMISSIONS` trong `src/lib/auth/permissions.ts`,
 * và chiều gốc là code → database, không phải ngược lại. Cố ý, vì hai lẽ:
 *
 *   1. Ma trận được hỏi trên MỌI request có phiên (`isAdminUser` chạy ở guard, ở thanh đầu
 *      trang, ở mọi action). Một lượt đi database cho mỗi phép hỏi ấy là trả giá thật cho một
 *      bảng mà cả năm mới đổi một lần.
 *   2. `permissions.ts` là hàm THUẦN nên `npm run verify:permissions` đóng đinh được từng ô mà
 *      không cần dựng gì. Dời gốc xuống database là vứt luôn tính chất ấy.
 *
 * Vậy bảng này để làm gì: để một câu SQL trả lời được "ai xoá sạch được sảnh đàm đạo" mà không
 * phải đọc code, và để chính bản sao ấy bị soi. `npm run verify:roles` so từng dòng ba bảng
 * danh mục với hằng số trong code và ĐỎ khi lệch — nên "quên viết migration sau khi thêm quyền"
 * là một phép thử hỏng, không phải một bí ẩn về sau.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissions.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

/**
 * NGƯỜI → VAI. Đây là nơi duy nhất trả lời được "đạo hữu này mang vai gì" kể từ 09/08/2026.
 *
 * Khoá chính ghép `(user_id, role_code)` làm luôn ba việc: cấm cấp trùng một vai hai lần, cho
 * `on conflict do nothing` một đích để bám (nhờ đó phép ghi vai là idempotent), và chính nó là
 * index cho câu hỏi thường gặp nhất — "vai của người này" — vì `user_id` đứng đầu.
 *
 * `role_code` thì `on delete restrict` chứ KHÔNG cascade như `user_id`: xoá một người là việc
 * bình thường và vai của họ nên đi theo, còn xoá một VAI mà vẫn có người đang mang thì phải
 * ngã ngựa và nói ra, không được lặng lẽ tước quyền của người ta. Index riêng cho `role_code`
 * là để đếm ngược — "còn mấy Gia chủ" — phép đếm mà `adminDelete` hỏi trước mỗi lần trục xuất.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleCode] }),
    index("user_roles_role_code_idx").on(t.roleCode),
  ],
);

/**
 * Tài khoản game của một đạo hữu — số nhiều, như bản desktop từ đầu.
 *
 * Cookie từng sống trong user_configs như một trường cấu hình, nghĩa là mỗi người đúng một
 * tài khoản. Tách bảng vì: một người nuôi nhiều tài khoản và bật/tắt từng cái độc lập; hạng
 * VIP/thường là thuộc tính CỦA COOKIE (hai tài khoản cùng chủ có thể khác hạng); và job phải
 * biết mình chạy cho tài khoản nào để chọn đúng hồ sơ Chromium lẫn vá đúng verdict hạng.
 *
 * `cookieEnvelope` là phong bì AES-GCM y như user_configs từng giữ — cookie vẫn đi MỘT
 * CHIỀU: vào từ form, ra duy nhất ở /api/worker sau khi khôi lỗi xác thực.
 */
export const gameAccounts = pgTable(
  "game_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    cookieEnvelope: text("cookie_envelope").notNull(),
    /** Hạng do khôi lỗi chứng minh trên hub; null = cookie này chưa được dò. */
    accountTier: text("account_tier").$type<"vip" | "free">(),
    /** Tắt là đứng ngoài Khai Đàn — cấu hình và lịch sử giữ nguyên, chỉ không chạy. */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId, t.createdAt)],
);

/** One JSONB document per user — the quest/automation configuration. */
export const userConfigs = pgTable("user_configs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * queued  — waiting for a worker, either immediately after Khai Đàn or until `nextRunAt`.
 * running — a worker claimed it and is heartbeating.
 * stopping — user pressed stop; the worker sees the flag on its next heartbeat and winds down.
 * stopped/failed/done — terminal.
 */
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "stopping",
  "stopped",
  "failed",
  "done",
]);

/**
 * Ai sẽ cầm browser cho lượt này.
 *
 * Từ v0.11 mọi job đều là `local` — một tiến trình worker sống dai (khôi lỗi tông môn trên
 * VM luôn trực, hoặc khôi lỗi máy nhà của chính đạo hữu). Giá trị `sandbox` chỉ còn trong
 * enum vì Postgres không cho rút một giá trị enum đã dùng, và các job lịch sử vẫn mang nó;
 * không dòng code nào còn GHI giá trị đó nữa. Vercel Sandbox bị bỏ vì hai lẽ: gói Hobby
 * không có cron đủ dày để lái nó, và một VM Always Free chạy liên tục phục vụ được CẢ
 * Mê Cung (phiên browser 35 phút không đứt) — thứ sandbox phù du không bao giờ làm nổi.
 */
export const runnerKind = pgEnum("runner_kind", ["sandbox", "local"]);

export const automationJobs = pgTable(
  "automation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Tài khoản game mà lượt này phục vụ. Nullable vì bảng jobs là lịch sử — các lượt trước
     * khi có bảng game_accounts không có gì để trỏ. Xoá tài khoản kéo theo job của nó.
     */
    accountId: uuid("account_id").references(() => gameAccounts.id, { onDelete: "cascade" }),
    status: jobStatus("status").notNull().default("queued"),
    /**
     * The config frozen for the CURRENT cycle. At the safe boundary between cycles the server
     * refreshes it from user_configs, so edits never mutate a click in flight but do apply to
     * the next automatic cycle.
     */
    configSnapshot: jsonb("config_snapshot").notNull().default({}),
    /** Runner nào được phép giành job này — xem chú thích của `runnerKind`. */
    runner: runnerKind("runner").notNull().default("local"),
    /** Số vòng đã được khôi lỗi tiếp nhận; tăng mỗi lần job thức dậy khỏi lịch chờ. */
    attempts: integer("attempts").notNull().default(0),
    workerId: text("worker_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Lúc job đủ điều kiện được claim. Sau mỗi vòng, server đặt mốc này theo cooldown sớm
     * nhất; cùng một job vì thế sống mãi qua nhiều vòng cho tới khi người dùng Thu Đàn.
     */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    /**
     * Vòng này đang chạy nhiệm vụ nào — khôi lỗi gửi kèm nhịp tim, server không tự suy ra
     * được. NULL nghĩa là "không biết", và đó là trạng thái đúng ở ba lúc: job đang nghỉ,
     * vòng vừa xong, và khôi lỗi đời cũ chưa biết gửi trường này.
     *
     * Ở đây chứ không phải một bảng riêng: nó là thuộc tính của ĐÚNG một vòng của đúng một
     * job, sống và chết cùng dòng job, và luôn được đọc chung với dòng ấy. Một bảng riêng
     * chỉ thêm một phép join cho mỗi lần vẽ hàng đợi mà không mua được gì.
     */
    cycleProgress: jsonb("cycle_progress").$type<CycleProgress>(),
    /**
     * Lúc `cycle_progress` ĐỔI lần gần nhất — không phải lúc nhận nhịp tim gần nhất.
     *
     * Hai thứ ấy khác nhau, và chính chỗ khác nhau đó là toàn bộ lý do cột này tồn tại:
     * `last_heartbeat` nhảy mỗi 5 giây kể cả khi khôi lỗi đang đứng chôn chân ở một nhiệm vụ,
     * nên nó chứng minh được "máy còn sống" nhưng KHÔNG chứng minh được "việc còn tiến". Một
     * đàn kẹt trông y hệt một đàn khoẻ nếu chỉ nhìn nhịp tim.
     *
     * Ghi bằng `is distinct from` ngay trong câu UPDATE của heartbeat, nên không có vòng
     * đọc-rồi-ghi nào để mà đua. NULL với đàn chưa từng khai tiến độ (đang nghỉ, hoặc khôi
     * lỗi đời cũ) — nơi đọc phải chịu được NULL mà không gọi nhầm là kẹt.
     */
    cycleProgressAt: timestamp("cycle_progress_at", { withTimezone: true }),
    /**
     * SỔ ĐỦ LƯỢT HÔM NAY — nhiệm vụ ngày nào của đàn này đã chứng minh là hết lượt, và cho
     * ngày nào. Vòng sau đọc sổ rồi bỏ hẳn những nhiệm vụ ấy: không mở trang, không tốn tab.
     *
     * Ở trên JOB chứ không trên `game_accounts`, và đó chính là cách luật「Khai Đàn lại thì
     * kiểm lại」được thoả mà không cần thêm một dòng mã nào: một lần Khai Đàn là một dòng job
     * mới với sổ trắng, nên vòng 1 luôn kiểm đủ. Đó cũng là đường thoát hiểm — ghi nhầm một
     * nhiệm vụ là「đã đủ lượt」thì Thu Đàn rồi Khai Đàn lại là xoá sạch, không cần ai vào
     * database.
     *
     * `day` là NGÀY THEO GIỜ VIỆT NAM (xem `vietnamDayKey` trong services/jobs.ts), vì mốc
     * reset của game theo giờ ấy. Sổ mang ngày cũ được đọc thành sổ trắng chứ không xoá —
     * lượt ghi kế tiếp tự viết đè, nên không cần một tiến trình dọn nào.
     */
    dailyDone: jsonb("daily_done").$type<DailyQuotaMemory>(),
  },
  (t) => [
    index("jobs_user_idx").on(t.userId),
    // Hàng chờ được quét theo (status, runner) ở mỗi nhịp cron và mỗi lần worker hỏi việc —
    // index ghép đúng theo hình dạng câu truy vấn đó.
    index("jobs_queue_idx").on(t.status, t.runner, t.createdAt),
    // Auto hỏi "job mới nhất của TỪNG tài khoản" mỗi lần dựng feed.
    index("jobs_account_idx").on(t.accountId, t.createdAt),
    // MỖI TÀI KHOẢN TỐI ĐA MỘT ĐÀN SỐNG — luật nằm ở database chứ không chỉ ở startJob,
    // vì startJob là check-then-insert qua nhiều round-trip: hai lượt Khai Đàn đồng thời
    // (hai tab, hai thiết bị) cùng thấy tài khoản còn rảnh rồi cùng insert. Hai job sống
    // cùng cookie nghĩa là hai Chromium giành một hồ sơ và một nhân vật bị chạy nhiệm vụ
    // đôi. INSERT phía service dùng ON CONFLICT DO NOTHING để kẻ đến sau lặng lẽ thua.
    uniqueIndex("jobs_one_active_per_account")
      .on(t.accountId)
      .where(sql`status in ('queued', 'running', 'stopping')`),
  ],
);

/** The user-facing activity feed, one narrated line per row — the web twin of the desktop app's Activity log. */
/**
 * Hình dạng của `automation_jobs.daily_done`. Cố tình PHẲNG và nhỏ: nó đi qua dây mỗi lần phát
 * việc, và mọi trường thêm vào đây là một trường phải giữ tương thích với những khôi lỗi đã
 * cài ngoài kia.
 */
export type DailyQuotaMemory = {
  /** Ngày theo giờ Việt Nam, dạng `YYYY-MM-DD`. Khác hôm nay = sổ này đã hết hiệu lực. */
  day: string;
  /** ID nhiệm vụ trong hồ sơ quest — xem `DAILY_QUOTA_QUEST_IDS` cho phạm vi hợp lệ. */
  questIds: string[];
};

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => automationJobs.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
  },
  (t) => [index("events_job_idx").on(t.jobId, t.id)],
);

/**
 * Cấu hình TOÀN HỆ THỐNG do tông chủ đặt — một document JSONB duy nhất (id = "global"),
 * cùng triết lý với user_configs: hình thù churns theo tính năng (hôm nay là hạn lưu đàm
 * đạo, mai là gì nữa chưa biết), Zod giữ hình thù ở tầng service, cả hai chiều.
 *
 * LƯU Ý: tin nhắn đàm đạo KHÔNG ở đây và không ở Postgres — chúng sống trong MongoDB qua
 * src/lib/services/chat.ts (trước 08/08/2026 là Upstash Redis). Postgres chỉ giữ danh tính
 * và cấu hình.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sổ ĐIỂM DANH khôi lỗi — mỗi worker từng gõ cửa /api/worker có một dòng, cập nhật
 * `lastSeen` mỗi lần nó hỏi việc (5 giây một lần khi đang trực).
 *
 * Tồn tại để trả lời câu hỏi vận hành số một: "có khôi lỗi nào đang trực không?" — trước
 * đây câu trả lời chỉ lộ ra sau sáu phút im lặng, khi reaper kết liễu job với một dòng lỗi.
 * Giờ dashboard đọc bảng này và nói thật NGAY LÚC khai đàn; mục Khôi Lỗi cũng dựa vào đây
 * để chỉ cho đạo hữu thấy khôi lỗi máy nhà của họ đã lên ca hay chưa.
 *
 * `userId` null = khôi lỗi tông môn (xác thực bằng token toàn cục, nhận job của mọi người).
 * `userId` có giá trị = khôi lỗi riêng, xác thực bằng linh phù, chỉ nhận job của chủ mình.
 */
export const workers = pgTable(
  "workers",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Bản của GÓI khôi lỗi mà tiến trình này đang chạy, do chính nó khai mỗi lần gõ cửa.
     *
     * Nullable, và cái `null` ấy MANG NGHĨA: khôi lỗi đời cũ không biết khai gì, nên vắng số
     * bản chính là dấu「máy này đang chạy bản trước 0.71.0, cài lại đi」. Đó cũng là lý do
     * cột này ra đời — trước nó, một khôi lỗi máy nhà chạy mã cũ trông y hệt một khôi lỗi mới
     * trên dashboard, và ngày chuyển trạm nó lặng lẽ không đi theo được.
     *
     * Ghi ĐÈ ở mỗi lượt điểm danh kể cả khi vắng: một tiến trình bị hạ cấp về bản cũ phải trở
     * lại trạng thái「không rõ」chứ không được giữ con số cũ làm bằng chứng giả.
     */
    version: text("version"),
  },
  (t) => [index("workers_user_idx").on(t.userId, t.lastSeen)],
);

export type UserRow = typeof users.$inferSelect;
export type GameAccountRow = typeof gameAccounts.$inferSelect;
export type JobRow = typeof automationJobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
