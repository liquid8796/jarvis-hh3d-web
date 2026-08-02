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

/**
 * Một job xếp hàng lâu hơn thế này mà chưa ai nhận thì coi như không có linh sứ nào đang
 * trực. Worker hỏi việc mỗi 5 giây, nên hai phút là đã rất rộng rãi — đủ cho một linh sứ
 * vừa khởi động lại xong kịp lên ca.
 */
const UNCLAIMED_AFTER_MS = 2 * 60 * 1000;

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
    return { ok: false, error: "Chưa có tài khoản hoathinh3d — dán chuỗi cookie đăng nhập vào phần Tài khoản trước." };
  }

  // Duyệt MỌI nhiệm vụ, không liệt kê tên. Chốt này ra đời khi hồ sơ chỉ có Mê Cung và
  // Luyện Đan, rồi mười nhiệm vụ ngày được thêm vào (v0.9.0) mà không ai nhớ tới nó — nên
  // một đạo hữu bật đủ chín nhiệm vụ ngày vẫn bị dội lại "Chưa bật nhiệm vụ nào", mâu thuẫn
  // thẳng với những ô đang tick trước mắt họ. Sổ điểm danh 02/08 cho thấy đúng một người
  // thật rơi vào đó. Đọc từ dữ liệu thì nhiệm vụ thứ mười ba tự được tính.
  if (!Object.values(view.quests).some((q) => q.enabled)) {
    return { ok: false, error: "Chưa bật nhiệm vụ nào — chọn ít nhất một nhiệm vụ để khai đàn." };
  }

  // Snapshot giữ nguyên cookie ở dạng ĐÃ MÃ HOÁ. Bảng jobs sống lâu hơn bảng config rất
  // nhiều (nó là lịch sử), nên để plaintext ở đây là tự tay dựng lại đúng cái lỗ vừa bịt.
  // Giải mã diễn ra đúng một lần, ở /api/worker, khi linh sứ đã xác thực.
  const snapshot = await getStoredConfigForSnapshot(userId);

  const rows = await db()
    .insert(schema.automationJobs)
    .values({ userId, configSnapshot: snapshot, runner: "local" })
    .returning();

  await addEvent(rows[0].id, "info", "Đàn pháp đã lập.");

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
 *
 * Scope là hàng rào phân quyền, không phải tuỳ chọn: linh sứ tông môn (operator) nhận job
 * của bất kỳ ai; linh sứ riêng chỉ nhìn thấy hàng chờ CỦA CHỦ MÌNH — điều kiện nằm ngay
 * trong câu SQL nên không tồn tại đường nào claim chéo, kể cả khi route quên kiểm.
 */
export async function claimNextJob(workerId: string, scope: WorkerScope): Promise<JobRow | null> {
  const scopeFilter =
    scope.kind === "user" ? sql` and user_id = ${scope.userId}` : sql``;

  const claimed = await db().execute(sql`
    update automation_jobs set
      status = 'running',
      worker_id = ${workerId},
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      last_heartbeat = now()
    where id = (
      select id from automation_jobs
      where status = 'queued'${scopeFilter}
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
    runner: "local",
    attempts: Number(row.attempts ?? 1),
    workerId,
    createdAt: new Date(String(row.created_at)),
    startedAt: new Date(),
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
    .select({ id: schema.automationJobs.id })
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
      "Không có linh sứ nào tiếp nhận đàn pháp. Nếu tình trạng kéo dài, cài linh sứ riêng ở mục Linh Sứ rồi khai đàn lại.",
    );
  }
}
