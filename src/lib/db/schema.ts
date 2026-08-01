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
 * sandbox — Vercel Sandbox: microVM dựng theo yêu cầu, chạy một LÁT có giới hạn thời gian
 *           rồi tắt. Hợp với nhiệm vụ chu kỳ ngắn (Luyện Đan Đường: mỗi lượt ghé vài phút,
 *           rồi nghỉ ~26 phút chờ mẻ chín) — đúng hình dạng mà một VM phù du phục vụ tốt.
 * local   — tiến trình worker trên máy chạy liên tục. Bắt buộc với nhiệm vụ cần một PHIÊN
 *           browser sống dai: Mê Cung phải tạo phòng, chờ đủ 5 người thật, rồi đánh liền
 *           tới 35 phút — mất VM giữa chừng là mất luôn cái phòng đang đứng trong đó.
 *
 * Chọn theo hình dạng thời gian của nhiệm vụ, không theo sở thích: đây là lý do một job
 * mang sẵn runner của nó thay vì để runner nào rảnh thì giành.
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
    runner: runnerKind("runner").notNull().default("sandbox"),
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

export type UserRow = typeof users.$inferSelect;
export type JobRow = typeof automationJobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
