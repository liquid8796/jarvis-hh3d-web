import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

export const userRole = pgEnum("user_role", ["user", "admin"]);

/**
 * pending — registered, waiting for an admin; can log in but sees only the waiting room.
 * active  — approved; automation features unlocked.
 * disabled — turned away or switched off; can log in to see why, nothing else.
 */
export const userStatus = pgEnum("user_status", ["pending", "active", "disabled"]);

/**
 * Vai trò từ 08/08/2026 là MỘT MẢNG, không phải một enum đơn — một người có thể vừa là Gia
 * chủ vừa là Trưởng môn. Mảng rỗng = môn đồ thường.
 *
 *   gia-chu — vai lớn nhất, MỘT MÌNH nó có quyền sửa/xoá vai của người mang vai. Sinh ra vì
 *             một lỗ hổng có thật: các Trưởng môn ngang quyền có thể hạ vai hay trục xuất
 *             LẪN NHAU, nghĩa là admin nào cũng chỉ an toàn cho tới khi một admin khác đổi ý.
 *
 *   Ba vai NGANG NHAU ở bậc trị sự (từ 09/08/2026) — duyệt môn đồ, quản môn đồ thường, và
 *   KHÔNG đụng được người mang vai, kể cả người mang đúng vai của mình:
 *     thai-thuong-truong-lao, chuong-mon, admin
 *
 * Cột này là `text[]` chứ không phải enum CỐ Ý: thêm một vai là thêm một chuỗi trong
 * permissions.ts, không phải một migration `ALTER TYPE` trên database thật.
 *
 * Danh sách hợp lệ nằm ở `src/lib/auth/permissions.ts` — nơi giữ toàn bộ ma trận ai-được-làm-gì.
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
     * CỘT DI SẢN — thay bằng `roles` từ 08/08/2026, còn nằm đây MỘT nhịp deploy nữa vì lý do
     * expand-contract: migration chạy TRƯỚC deploy, và bản code cũ (vẫn đang phục vụ trong
     * cửa sổ ấy) SELECT đích danh cột này — drop ngay là mọi trang 500 cho tới khi bản mới
     * lên. Code mới không đọc nó, chỉ GHI GƯƠNG (mirror) để cửa sổ kia an toàn cả hai chiều.
     * Migration kế tiếp sẽ drop cả cột lẫn enum user_role.
     */
    role: userRole("role").notNull().default("user"),
    /** Vai trò thật của hệ thống — xem ghi chú ở đầu tệp. Rỗng = môn đồ thường. */
    roles: text("roles").array().notNull().default(sql`ARRAY[]::text[]`),
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
  },
  (t) => [index("workers_user_idx").on(t.userId, t.lastSeen)],
);

export type UserRow = typeof users.$inferSelect;
export type GameAccountRow = typeof gameAccounts.$inferSelect;
export type JobRow = typeof automationJobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
