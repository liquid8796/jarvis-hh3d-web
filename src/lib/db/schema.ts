import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("pending"),
    /**
     * LINH PHÙ — token riêng cho linh sứ máy nhà của đạo hữu này, lưu dạng SHA-256.
     *
     * Vì sao không dùng chung WORKER_TOKEN: trang cài đặt phát lệnh cài cho MỌI thành viên,
     * mà ai cầm token toàn cục là claim được job của tất cả — tức đọc được cookie game của
     * tất cả. Nên token toàn cục rút về làm token của linh sứ tông môn (do người vận hành
     * giữ), còn mỗi đạo hữu cầm một linh phù chỉ mở được job của chính mình.
     *
     * Chỉ lưu hash: bảng users bị lộ thì kẻ đọc trộm vẫn không có token để giả linh sứ.
     * Bản rõ chỉ tồn tại đúng một lần — trong hồi đáp của action tạo linh phù.
     */
    workerTokenHash: text("worker_token_hash").unique(),
    workerTokenCreatedAt: timestamp("worker_token_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_status_idx").on(t.status)],
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
 * queued  — user pressed Khai Đàn; waiting for a worker to claim it.
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
 * Từ v0.11 mọi job đều là `local` — một tiến trình worker sống dai (linh sứ tông môn trên
 * VM luôn trực, hoặc linh sứ máy nhà của chính đạo hữu). Giá trị `sandbox` chỉ còn trong
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
    status: jobStatus("status").notNull().default("queued"),
    /**
     * The config as it stood at start — a snapshot, so an edit mid-run changes the NEXT run,
     * not the one in flight. (The desktop engine learned live options the hard way; a
     * distributed worker gets the simpler, predictable contract.)
     */
    configSnapshot: jsonb("config_snapshot").notNull().default({}),
    /** Runner nào được phép giành job này — xem chú thích của `runnerKind`. */
    runner: runnerKind("runner").notNull().default("local"),
    /**
     * Số LÁT đã chạy. Một lượt sandbox không nhất thiết xong trong một lát: VM có trần thời
     * gian, nên job quay lại hàng chờ và lát sau chạy tiếp. Đếm ở đây để (a) biết khi nào
     * nên bỏ cuộc, và (b) chuyển sang runner dự phòng sau vài lát thất bại liên tiếp.
     */
    attempts: integer("attempts").notNull().default(0),
    workerId: text("worker_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  },
  (t) => [
    index("jobs_user_idx").on(t.userId),
    // Hàng chờ được quét theo (status, runner) ở mỗi nhịp cron và mỗi lần worker hỏi việc —
    // index ghép đúng theo hình dạng câu truy vấn đó.
    index("jobs_queue_idx").on(t.status, t.runner, t.createdAt),
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
 * LƯU Ý: tin nhắn đàm đạo KHÔNG ở đây và không ở Postgres — chúng sống trong kho NoSQL
 * (Upstash Redis) qua src/lib/services/chat.ts. Postgres chỉ giữ danh tính và cấu hình.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sổ ĐIỂM DANH linh sứ — mỗi worker từng gõ cửa /api/worker có một dòng, cập nhật
 * `lastSeen` mỗi lần nó hỏi việc (5 giây một lần khi đang trực).
 *
 * Tồn tại để trả lời câu hỏi vận hành số một: "có linh sứ nào đang trực không?" — trước
 * đây câu trả lời chỉ lộ ra sau sáu phút im lặng, khi reaper kết liễu job với một dòng lỗi.
 * Giờ dashboard đọc bảng này và nói thật NGAY LÚC khai đàn; mục Linh Sứ cũng dựa vào đây
 * để chỉ cho đạo hữu thấy linh sứ máy nhà của họ đã lên ca hay chưa.
 *
 * `userId` null = linh sứ tông môn (xác thực bằng token toàn cục, nhận job của mọi người).
 * `userId` có giá trị = linh sứ riêng, xác thực bằng linh phù, chỉ nhận job của chủ mình.
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
export type JobRow = typeof automationJobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
