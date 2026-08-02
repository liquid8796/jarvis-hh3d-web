import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getEditableConfig, getStoredConfigForSnapshot } from "./configs";
import { anyWorkerOnlineFor } from "./workers";
import type { WorkerScope } from "@/lib/auth/worker";
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

/** Start = create one durable intent; the same job is re-queued after every completed cycle. */
export async function startJob(
  userId: string,
): Promise<{ ok: true; job: JobRow } | { ok: false; error: string }> {
  const existing = await getActiveJob(userId);
  if (existing) {
    return { ok: false, error: "Auto đang chạy. Bấm Thu Đàn để dừng trước đã." };
  }

  // Kiểm tra bằng bản KHÔNG chứa bí mật: ở đây chỉ cần biết cookie có tồn tại hay không.
  const view = await getEditableConfig(userId);
  if (!view.hasCookie) {
    return { ok: false, error: "Chưa có tài khoản game. Dán chuỗi cookie vào ô Tài khoản hoathinh3d rồi bấm Khắc Ngọc Giản." };
  }

  // Duyệt MỌI nhiệm vụ, không liệt kê tên. Chốt này ra đời khi hồ sơ chỉ có Mê Cung và
  // Luyện Đan, rồi mười nhiệm vụ ngày được thêm vào (v0.9.0) mà không ai nhớ tới nó — nên
  // một đạo hữu bật đủ chín nhiệm vụ ngày vẫn bị dội lại "Chưa bật nhiệm vụ nào", mâu thuẫn
  // thẳng với những ô đang tick trước mắt họ. Sổ điểm danh 02/08 cho thấy đúng một người
  // thật rơi vào đó. Đọc từ dữ liệu thì nhiệm vụ thứ mười ba tự được tính.
  if (!Object.values(view.quests).some((q) => q.enabled)) {
    return { ok: false, error: "Chưa chọn nhiệm vụ nào. Tick ít nhất một nhiệm vụ rồi bấm Khắc Ngọc Giản." };
  }

  // Snapshot giữ nguyên cookie ở dạng ĐÃ MÃ HOÁ. Bảng jobs sống lâu hơn bảng config rất
  // nhiều (nó là lịch sử), nên để plaintext ở đây là tự tay dựng lại đúng cái lỗ vừa bịt.
  // Giải mã diễn ra đúng một lần, ở /api/worker, khi linh sứ đã xác thực.
  const snapshot = await getStoredConfigForSnapshot(userId);

  const rows = await db()
    .insert(schema.automationJobs)
    .values({ userId, configSnapshot: snapshot, runner: "local" })
    .returning();

  await addEvent(
    rows[0].id,
    "info",
    "Đàn pháp đã lập — sẽ tự chạy liên tục qua nhiều vòng cho tới khi đạo hữu Thu Đàn.",
  );

  // Nói thật NGAY LÚC NÀY nếu chẳng có linh sứ nào nhận nổi job — trước đây người dùng chỉ
  // biết điều đó sau sáu phút im lặng, khi reaper kết liễu job. Vẫn cho xếp hàng (một linh
  // sứ có thể lên ca ngay sau đây), nhưng cảnh báo nằm sẵn trong nhật ký.
  if (await anyWorkerOnlineFor(userId)) {
    await addEvent(rows[0].id, "info", "Linh sứ đang trực — sẽ tiếp nhận trong giây lát.");
  } else {
    await addEvent(
      rows[0].id,
      "warning",
      "Chưa thấy linh sứ nào điểm danh — đàn pháp sẽ chờ. Cài linh sứ riêng ở mục Linh Sứ nếu chờ quá lâu.",
    );
  }

  return { ok: true, job: rows[0] };
}

/**
 * Stop is a REQUEST, not a kill: `queued` dies immediately, `running` flips to `stopping`
 * and the worker winds down at its next safe point — mirroring how the desktop engine only
 * ever stops between steps, never mid-click.
 */
export async function requestStop(userId: string): Promise<void> {
  // Một UPDATE duy nhất đóng khe đua ở ranh giới hai vòng. Nếu worker vừa đổi `running`
  // thành `queued` đúng lúc người dùng bấm, cùng câu lệnh này vẫn thấy `queued` và kết thúc
  // nó; không còn cảnh nút Thu Đàn bấm trúng khe 1ms rồi job lặng lẽ sống tiếp.
  const changed = await db().execute(sql`
    update automation_jobs set
      status = case
        when status = 'queued' then 'stopped'::job_status
        else 'stopping'::job_status
      end,
      finished_at = case when status = 'queued' then now() else finished_at end,
      next_run_at = case when status = 'queued' then now() else next_run_at end
    where user_id = ${userId}
      and status in ('queued', 'running')
    returning id, status
  `);

  for (const row of changed.rows as Array<Record<string, unknown>>) {
    const stoppedNow = String(row.status) === "stopped";
    await addEvent(
      String(row.id),
      "info",
      stoppedNow
        ? "Đã thu đàn — vòng kế chưa kịp bắt đầu."
        : "Đã gửi lệnh thu đàn — linh sứ sẽ dừng ở điểm an toàn kế tiếp.",
    );
  }
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

/**
 * Atomically claim the oldest queued job. The single-UPDATE-with-subselect is the whole
 * locking story: two workers racing get two different rows or one row and one null —
 * Postgres decides, nobody double-runs.
 *
 * Scope là hàng rào phân quyền, không phải tuỳ chọn: linh sứ tông môn (operator) nhận job
 * của bất kỳ ai; linh sứ riêng chỉ nhìn thấy hàng chờ CỦA CHỦ MÌNH — điều kiện nằm ngay
 * trong câu SQL nên không tồn tại đường nào claim chéo, kể cả khi route quên kiểm.
 */
export async function claimNextJob(workerId: string, scope: WorkerScope): Promise<JobRow | null> {
  const scopeFilter =
    scope.kind === "user" ? sql` and user_id = ${scope.userId}` : sql``;

  const claimed = await db().execute(sql`
    with candidate as (
      select id from automation_jobs
      where status = 'queued'
        and next_run_at <= now()${scopeFilter}
      order by next_run_at, created_at
      for update skip locked
      limit 1
    )
    update automation_jobs set
      status = 'running',
      worker_id = ${workerId},
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      last_heartbeat = now()
    from candidate
    where automation_jobs.id = candidate.id
    returning automation_jobs.*
  `);

  const row = (claimed.rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!row) {
    return null;
  }

  const attempts = Number(row.attempts ?? 1);
  await addEvent(
    String(row.id),
    "success",
    attempts === 1
      ? `Linh sứ「${workerId}」đã tiếp nhận đàn pháp.`
      : `Linh sứ「${workerId}」bắt đầu vòng ${attempts}.`,
  );
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: "running",
    configSnapshot: row.config_snapshot,
    runner: "local",
    attempts,
    workerId,
    createdAt: new Date(String(row.created_at)),
    nextRunAt: new Date(String(row.next_run_at)),
    startedAt: row.started_at ? new Date(String(row.started_at)) : new Date(),
    finishedAt: null,
    lastHeartbeat: new Date(),
  } as JobRow;
}

/**
 * Job này có thuộc quyền của scope không — hàng rào cho heartbeat/event/complete.
 *
 * Thiếu nó thì một linh phù hợp lệ bất kỳ có thể bơm nhật ký giả hoặc "complete" job của
 * người khác chỉ bằng cách đoán jobId. Operator đi thẳng, khỏi tốn query.
 */
export async function jobBelongsTo(jobId: string, scope: WorkerScope): Promise<boolean> {
  if (scope.kind === "operator") {
    return true;
  }

  const rows = await db()
    .select({ userId: schema.automationJobs.userId })
    .from(schema.automationJobs)
    .where(eq(schema.automationJobs.id, jobId))
    .limit(1);
  return rows[0]?.userId === scope.userId;
}

/**
 * Heartbeat returns the job's CURRENT status so the worker learns about a stop request —
 * và trả kèm `workerId` để nơi gọi làm mới điểm danh.
 *
 * Vì sao phải trả workerId: sổ điểm danh chỉ được cập nhật ở `claim`, mà một linh sứ ĐANG
 * BẬN thì thôi không claim nữa. Hệ quả đo được ngày 02/08: linh sứ chạy Mê Cung — phiên dài
 * hàng chục phút — tụt khỏi sổ sau 30 giây và dashboard báo "vắng mặt" đúng lúc nó làm việc
 * chăm chỉ nhất; tệ hơn, `startJob` đọc cùng cái sổ ấy nên cảnh báo sai "chưa thấy linh sứ
 * nào". Nhịp tim 20 giây là bằng chứng sống chính xác hơn, và nó có sẵn.
 *
 * Lấy workerId từ CHÍNH DÒNG JOB chứ không bắt worker khai thêm: nhờ vậy những linh sứ đã
 * cài từ trước không phải cập nhật gì mà vẫn được điểm danh đúng.
 */
export async function heartbeat(
  jobId: string,
): Promise<{ status: JobRow["status"]; workerId: string | null } | null> {
  const rows = await db()
    .update(schema.automationJobs)
    .set({ lastHeartbeat: new Date() })
    .where(eq(schema.automationJobs.id, jobId))
    .returning({
      status: schema.automationJobs.status,
      workerId: schema.automationJobs.workerId,
    });
  return rows[0] ?? null;
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

export type WorkerCycleOutcome = "done" | "failed" | "stopped";

export type WorkerCycleTransition = {
  status: "queued" | "stopped";
  nextRunAt: Date;
};

const MIN_NEXT_DELAY_SECONDS = 30;
const MAX_NEXT_DELAY_SECONDS = 24 * 3600;
const DEFAULT_NEXT_DELAY_SECONDS = 5 * 60;
const FAILED_NEXT_DELAY_SECONDS = 30 * 60;

function normalizeNextDelay(outcome: WorkerCycleOutcome, proposed?: number): number {
  const fallback = outcome === "failed" ? FAILED_NEXT_DELAY_SECONDS : DEFAULT_NEXT_DELAY_SECONDS;
  const seconds = typeof proposed === "number" && Number.isFinite(proposed)
    ? Math.round(proposed)
    : fallback;
  return Math.max(MIN_NEXT_DELAY_SECONDS, Math.min(MAX_NEXT_DELAY_SECONDS, seconds));
}

function formatDelay(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
  if (minutes > 0) return `${minutes} phút`;
  return `${seconds} giây`;
}

/** Giữ nhật ký của một job chạy quanh năm không phình vô hạn. */
async function trimJobEvents(jobId: string, keep = 1000): Promise<void> {
  await db().execute(sql`
    delete from job_events
    where job_id = ${jobId}
      and id < coalesce((
        select id from job_events
        where job_id = ${jobId}
        order by id desc
        offset ${keep - 1}
        limit 1
      ), 0)
  `);
}

/**
 * Kết thúc MỘT VÒNG, không kết thúc ý định auto.
 *
 * `done` và `failed` đều quay về hàng chờ; thất bại chỉ nghỉ lâu hơn. Chỉ `stopped`, hoặc
 * trạng thái `stopping` do người dùng vừa bấm Thu Đàn, mới biến job thành terminal. Phép
 * chuyển trạng thái nằm trong một UPDATE để lệnh Thu Đàn không thể lọt qua khe giữa hai vòng.
 */
export async function completeWorkerCycle(
  jobId: string,
  outcome: WorkerCycleOutcome,
  message: string,
  proposedDelaySeconds?: number,
): Promise<WorkerCycleTransition | null> {
  const delaySeconds = normalizeNextDelay(outcome, proposedDelaySeconds);
  const nextRunAt = new Date(Date.now() + delaySeconds * 1000);
  const stopFromWorker = outcome === "stopped";

  const updated = await db().execute(sql`
    update automation_jobs set
      status = case
        when status = 'stopping' or ${stopFromWorker} then 'stopped'::job_status
        else 'queued'::job_status
      end,
      finished_at = case
        when status = 'stopping' or ${stopFromWorker} then now()
        else null
      end,
      next_run_at = case
        when status = 'stopping' or ${stopFromWorker} then now()
        else ${nextRunAt}
      end,
      config_snapshot = case
        when status = 'stopping' or ${stopFromWorker} then config_snapshot
        else coalesce(
          (select config from user_configs where user_id = automation_jobs.user_id),
          config_snapshot
        )
      end,
      last_heartbeat = now()
    where id = ${jobId}
      and status in ('running', 'stopping')
    returning status, next_run_at, attempts
  `);

  const row = (updated.rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!row) return null;

  const status = String(row.status) as WorkerCycleTransition["status"];
  const actualNextRunAt = new Date(String(row.next_run_at));

  if (status === "stopped") {
    await addEvent(
      jobId,
      "success",
      outcome === "stopped" ? message : `${message} Đã nhận lệnh Thu Đàn — không xếp vòng mới.`,
    );
  } else {
    await addEvent(jobId, outcome === "failed" ? "error" : "success", message);
    await addEvent(
      jobId,
      "info",
      `Tự chạy vòng ${Number(row.attempts ?? 0) + 1} sau khoảng ${formatDelay(delaySeconds)} — chỉ Thu Đàn mới dừng hẳn.`,
    );
  }

  await trimJobEvents(jobId);
  return { status, nextRunAt: actualNextRunAt };
}

export async function addEvent(
  jobId: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
): Promise<void> {
  await db().insert(schema.jobEvents).values({ jobId, level, message });
}

/**
 * Xoá sạch nhật ký của lượt GẦN NHẤT — đúng cái người dùng đang nhìn thấy trên Lư Khai Đàn.
 *
 * Không nhận `jobId` từ người gọi mà tự tra lượt gần nhất CỦA CHÍNH HỌ: `getLatestJob` đã
 * lọc theo userId, nên id đi vào câu DELETE không thể là job của người khác. Nhận jobId từ
 * ngoài thì phải thêm một phép kiểm chủ sở hữu nữa, và một phép kiểm có thể bị quên.
 *
 * Xoá thật chứ không ẩn ở phía trình duyệt: con trỏ nhật ký reset về 0 mỗi lần tải lại
 * trang, nên "xoá" chỉ trong state của React sẽ sống lại nguyên vẹn sau một lần F5.
 */
export async function clearLatestJobEvents(userId: string): Promise<number> {
  const job = await getLatestJob(userId);
  if (!job) {
    return 0;
  }

  const gone = await db()
    .delete(schema.jobEvents)
    .where(eq(schema.jobEvents.jobId, job.id))
    .returning({ id: schema.jobEvents.id });
  return gone.length;
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
 * Dọn job đang chạy nhưng mất nhịp tim.
 *
 * `queued` KHÔNG còn là xác: nó có thể đang ngủ tới `nextRunAt`, hoặc đang chờ một linh sứ
 * bận làm vòng dài cho người khác. Kết liễu hàng chờ sau hai phút sẽ phá chính lời hứa auto
 * liên tục. `startJob` đã ghi cảnh báo ngay khi không thấy ai trực; job cứ chờ tới khi có
 * người nhận hoặc chủ nhân Thu Đàn.
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

}
