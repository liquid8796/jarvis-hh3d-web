import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getEditableConfig, getStoredConfigForSnapshot } from "./configs";
import { decideRunner, sandboxAllowedFor, type RunnerKind } from "@/lib/runners/policy";
import { findById } from "./users";
import type { JobEventRow, JobRow } from "@/lib/db/schema";

/**
 * The automation job lifecycle — the heart of "bấm Start rồi đóng browser vẫn chạy".
 *
 * The web NEVER runs a browser itself: Vercel functions are short-lived and cannot nurse a
 * 35-minute Chromium session. Instead a job is a durable row a WORKER claims over
 * /api/worker/* — the worker being a machine that can hold a browser open for hours (the
 * desktop Jarvis engine, or any VPS running the reference worker). The user's browser is
 * only ever a remote control; closing it changes nothing about the run.
 */

const ACTIVE: JobRow["status"][] = ["queued", "running", "stopping"];

/** A worker that has not heartbeat within this window is presumed dead. */
const STALE_AFTER_MS = 3 * 60 * 1000;

/**
 * Một job xếp hàng lâu hơn thế này mà chưa ai nhận thì coi như không có runner nào đang
 * trực. Rộng rãi có chủ ý: cron của Vercel chạy theo phút, và một sandbox lần đầu (chưa có
 * ảnh dựng sẵn) mất ~30 giây chỉ để cài Chromium.
 */
const UNCLAIMED_AFTER_MS = 6 * 60 * 1000;

export async function getActiveJob(userId: string): Promise<JobRow | null> {
  const rows = await db()
    .select()
    .from(schema.automationJobs)
    .where(and(eq(schema.automationJobs.userId, userId), inArray(schema.automationJobs.status, ACTIVE)))
    .orderBy(desc(schema.automationJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLatestJob(userId: string): Promise<JobRow | null> {
  const rows = await db()
    .select()
    .from(schema.automationJobs)
    .where(eq(schema.automationJobs.userId, userId))
    .orderBy(desc(schema.automationJobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Start = enqueue, with the config frozen into the job (edits change the NEXT run). */
export async function startJob(
  userId: string,
): Promise<{ ok: true; job: JobRow } | { ok: false; error: string }> {
  const existing = await getActiveJob(userId);
  if (existing) {
    return { ok: false, error: "Đàn pháp đang vận hành — dừng lượt hiện tại trước đã." };
  }

  // Kiểm tra bằng bản KHÔNG chứa bí mật: ở đây chỉ cần biết cookie có tồn tại hay không.
  const view = await getEditableConfig(userId);
  if (!view.hasCookie) {
    return { ok: false, error: "Chưa có cookie đăng nhập game — dán vào phần Pháp Khí trước." };
  }

  if (!view.quests.meCung.enabled && !view.quests.luyenDan.enabled) {
    return { ok: false, error: "Chưa bật nhiệm vụ nào — chọn ít nhất một nhiệm vụ để khai đàn." };
  }

  // Snapshot giữ nguyên cookie ở dạng ĐÃ MÃ HOÁ. Bảng jobs sống lâu hơn bảng config rất
  // nhiều (nó là lịch sử), nên để plaintext ở đây là tự tay dựng lại đúng cái lỗ vừa bịt.
  // Giải mã diễn ra đúng một lần, ở /api/worker, khi linh sứ đã xác thực.
  const snapshot = await getStoredConfigForSnapshot(userId);

  // Runner do HÌNH DẠNG NHIỆM VỤ quyết định, không phải do ai rảnh — xem runners/policy.ts.
  // Quyền dùng sandbox đọc lại từ DÒNG USER, không từ cấu hình đã lưu: cấu hình là thứ
  // người dùng gửi lên, còn vai trò thì không. Tông chủ hạ quyền ai đó là lượt kế tiếp của
  // họ đã về máy nhà, không phải chờ họ lưu lại form.
  const owner = await findById(userId);
  const decision = decideRunner(view, {
    sandboxAllowed: owner ? sandboxAllowedFor(owner) : false,
  });

  const rows = await db()
    .insert(schema.automationJobs)
    .values({ userId, configSnapshot: snapshot, runner: decision.runner })
    .returning();

  await addEvent(rows[0].id, "info", "Đàn pháp đã lập.");
  await addEvent(rows[0].id, "info", decision.reason);
  return { ok: true, job: rows[0] };
}

/**
 * Stop is a REQUEST, not a kill: `queued` dies immediately, `running` flips to `stopping`
 * and the worker winds down at its next safe point — mirroring how the desktop engine only
 * ever stops between steps, never mid-click.
 */
export async function requestStop(userId: string): Promise<void> {
  const job = await getActiveJob(userId);
  if (!job) {
    return;
  }

  if (job.status === "queued") {
    await db()
      .update(schema.automationJobs)
      .set({ status: "stopped", finishedAt: new Date() })
      .where(eq(schema.automationJobs.id, job.id));
    await addEvent(job.id, "info", "Đã thu đàn — lượt chưa kịp chạy.");
    return;
  }

  await db()
    .update(schema.automationJobs)
    .set({ status: "stopping" })
    .where(and(eq(schema.automationJobs.id, job.id), eq(schema.automationJobs.status, "running")));
  await addEvent(job.id, "info", "Đã gửi lệnh thu đàn — linh sứ sẽ dừng ở điểm an toàn kế tiếp.");
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

/**
 * Atomically claim the oldest queued job. The single-UPDATE-with-subselect is the whole
 * locking story: two workers racing get two different rows or one row and one null —
 * Postgres decides, nobody double-runs.
 */
export async function claimNextJob(workerId: string, runner: RunnerKind): Promise<JobRow | null> {
  const claimed = await db().execute(sql`
    update automation_jobs set
      status = 'running',
      worker_id = ${workerId},
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      last_heartbeat = now()
    where id = (
      select id from automation_jobs
      where status = 'queued' and runner = ${runner}
      order by created_at
      limit 1
    )
    returning *
  `);

  const row = (claimed.rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!row) {
    return null;
  }

  await addEvent(String(row.id), "success", `Linh sứ「${workerId}」đã tiếp nhận đàn pháp.`);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: "running",
    configSnapshot: row.config_snapshot,
    runner,
    attempts: Number(row.attempts ?? 1),
    workerId,
    createdAt: new Date(String(row.created_at)),
    startedAt: new Date(),
    finishedAt: null,
    lastHeartbeat: new Date(),
  } as JobRow;
}

/** Heartbeat returns the job's CURRENT status so the worker learns about a stop request. */
export async function heartbeat(jobId: string): Promise<JobRow["status"] | null> {
  const rows = await db()
    .update(schema.automationJobs)
    .set({ lastHeartbeat: new Date() })
    .where(eq(schema.automationJobs.id, jobId))
    .returning({ status: schema.automationJobs.status });
  return rows[0]?.status ?? null;
}

export async function completeJob(
  jobId: string,
  outcome: "done" | "failed" | "stopped",
  message: string,
): Promise<void> {
  await db()
    .update(schema.automationJobs)
    .set({ status: outcome, finishedAt: new Date() })
    .where(eq(schema.automationJobs.id, jobId));
  await addEvent(jobId, outcome === "failed" ? "error" : "success", message);
}

export async function addEvent(
  jobId: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
): Promise<void> {
  await db().insert(schema.jobEvents).values({ jobId, level, message });
}

/** The dashboard's log feed: everything after `afterId`, oldest first, bounded. */
export async function eventsAfter(jobId: string, afterId: number): Promise<JobEventRow[]> {
  return db()
    .select()
    .from(schema.jobEvents)
    .where(and(eq(schema.jobEvents.jobId, jobId), gt(schema.jobEvents.id, afterId)))
    .orderBy(schema.jobEvents.id)
    .limit(200);
}

/**
 * Đưa một job đang dở về hàng chờ để lát sau chạy tiếp — cơ chế sống của runner sandbox,
 * nơi một lượt có thể cần nhiều lát VM.
 */
export async function requeueJob(jobId: string, note: string): Promise<void> {
  await db()
    .update(schema.automationJobs)
    .set({ status: "queued", workerId: null })
    .where(eq(schema.automationJobs.id, jobId));
  await addEvent(jobId, "info", note);
}

/**
 * Chuyển một job sang linh sứ máy nhà. Đây là đường DỰ PHÒNG: sandbox thử vài lát không
 * xong (hết giờ dựng VM, thiếu quota, Chromium không lên) thì thay vì chết hẳn, job đổi
 * chủ và nằm chờ worker máy nhà — người dùng không phải làm gì cả.
 */
export async function failoverToLocal(jobId: string, why: string): Promise<void> {
  await db()
    .update(schema.automationJobs)
    .set({ status: "queued", runner: "local", workerId: null, attempts: 0 })
    .where(eq(schema.automationJobs.id, jobId));
  await addEvent(jobId, "warning", `${why} — chuyển lượt này cho linh sứ máy nhà.`);
}

/**
 * Dọn dẹp hai kiểu job mắc kẹt.
 *
 * 1) `running` mà nhịp tim im — linh sứ chết giữa chừng.
 * 2) `queued` mà KHÔNG AI nhận suốt một thời gian dài. Trường hợp này từng bị bỏ sót hoàn
 *    toàn: reaper cũ chỉ nhìn `running`/`stopping`, nên một job xếp hàng khi không có runner
 *    nào đang trực sẽ nằm đó VĨNH VIỄN, còn người dùng chỉ thấy mãi dòng "Chờ linh sứ tiếp
 *    nhận" mà không bao giờ biết là chẳng có linh sứ nào tồn tại. Thà nói thật.
 *
 * Gọi cơ hội từ đường đọc của dashboard — ở quy mô này chưa cần cron riêng.
 */
export async function reapStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const stale = await db()
    .select({ id: schema.automationJobs.id })
    .from(schema.automationJobs)
    .where(
      and(
        inArray(schema.automationJobs.status, ["running", "stopping"]),
        sql`${schema.automationJobs.lastHeartbeat} < ${cutoff}`,
      ),
    );

  for (const row of stale) {
    await completeJob(row.id, "failed", "Linh sứ mất liên lạc (quá 3 phút không hồi đáp) — lượt bị kết thúc.");
  }

  const abandoned = await db()
    .select({ id: schema.automationJobs.id, runner: schema.automationJobs.runner })
    .from(schema.automationJobs)
    .where(
      and(
        eq(schema.automationJobs.status, "queued"),
        sql`${schema.automationJobs.createdAt} < ${new Date(Date.now() - UNCLAIMED_AFTER_MS)}`,
      ),
    );

  for (const row of abandoned) {
    await completeJob(
      row.id,
      "failed",
      row.runner === "local"
        ? "Không có linh sứ máy nhà nào đang trực. Hãy chạy `npm run worker` trên máy chạy liên tục rồi khai đàn lại."
        : "Sandbox không nhận được lượt này (cron chưa chạy hoặc thiếu cấu hình Vercel Sandbox). Xem README mục Sandbox.",
    );
  }
}
