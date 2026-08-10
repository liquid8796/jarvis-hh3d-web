import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { listAccountsWithEnvelope } from "./accounts";
import { getEditableConfig, getStoredConfigForSnapshot, storedConfigSchema } from "./configs";
import { getAppSettings } from "./settings";
import { anyWorkerOnlineFor } from "./workers";
import type { WorkerScope } from "@/lib/auth/worker";
import type { JobEventRow, JobRow } from "@/lib/db/schema";
import type { CycleProgress } from "@/lib/realtime/dashboardTypes";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";

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

export async function getActiveJobs(userId: string): Promise<JobRow[]> {
  return db()
    .select()
    .from(schema.automationJobs)
    .where(and(eq(schema.automationJobs.userId, userId), inArray(schema.automationJobs.status, ACTIVE)))
    .orderBy(desc(schema.automationJobs.createdAt));
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

/**
 * Job mới nhất của TỪNG tài khoản — cái Tế đàn auto hiển thị. Mỗi tài khoản một dòng trạng
 * thái, theo thứ tự tạo tài khoản; tài khoản chưa chạy lần nào không có dòng. Người dùng
 * từ thời một-cookie (mọi job đều thiếu account_id) được thấy lượt gần nhất của họ như cũ.
 */
export type CurrentJobSummary = {
  id: string;
  accountId: string | null;
  accountLabel: string | null;
  status: JobRow["status"];
  createdAt: Date;
  nextRunAt: Date;
  attempts: number;
  workerId: string | null;
};

export async function getCurrentJobsPerAccount(userId: string): Promise<CurrentJobSummary[]> {
  const result = await db().execute(sql`
    select
      job.id, job.account_id, acc.label as account_label, job.status,
      job.created_at, job.next_run_at, job.attempts, job.worker_id
    from game_accounts as acc
    join lateral (
      select * from automation_jobs as j
      where j.account_id = acc.id
      order by j.created_at desc
      limit 1
    ) as job on true
    where acc.user_id = ${userId}
    order by acc.created_at, acc.id
  `);

  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    const legacy = await getLatestJob(userId);
    if (!legacy || legacy.accountId != null) return [];
    return [
      {
        id: legacy.id,
        accountId: null,
        accountLabel: null,
        status: legacy.status,
        createdAt: legacy.createdAt,
        nextRunAt: legacy.nextRunAt,
        attempts: legacy.attempts,
        workerId: legacy.workerId,
      },
    ];
  }

  return rows.map((row) => ({
    id: String(row.id),
    accountId: row.account_id == null ? null : String(row.account_id),
    accountLabel: row.account_label == null ? null : String(row.account_label),
    status: String(row.status) as JobRow["status"],
    createdAt: new Date(String(row.created_at)),
    nextRunAt: new Date(String(row.next_run_at)),
    attempts: Number(row.attempts ?? 0),
    workerId: row.worker_id == null ? null : String(row.worker_id),
  }));
}

export type StartOutcome =
  | { ok: true; startedLabels: string[]; alreadyRunning: number }
  | { ok: false; error: string };

/**
 * Khai Đàn = lập một ý định bền cho MỖI tài khoản đang bật; từng job sống dai qua nhiều
 * vòng như trước. Tài khoản đã có đàn chạy thì để yên — bấm Khai Đàn lần nữa chỉ bổ sung
 * những tài khoản còn đứng ngoài (ví dụ vừa bật thêm một tài khoản mới).
 */
export async function startJob(userId: string): Promise<StartOutcome> {
  // Bế quan trùng tu: kiểm TRƯỚC MỌI THỨ, và ở tầng service chứ không ở action — mọi đường
  // gọi tương lai (API mới, cron, một action khác) đều phải đập vào cùng cánh cửa này.
  // Popup trên Auto đã báo trước, nhưng một tab mở từ hôm qua vẫn bấm được nút cũ.
  const { maintenance } = await getAppSettings();
  if (maintenance.active) {
    return {
      ok: false,
      error: "Tông môn đang bế quan trùng tu — Khai Đàn tạm khoá tới khi mở cửa lại. Đàn đang chạy dở sẽ tự hoàn thành vòng rồi nghỉ.",
    };
  }

  const accounts = await listAccountsWithEnvelope(userId);
  if (accounts.length === 0) {
    return {
      ok: false,
      error: "Chưa có tài khoản game nào. Thêm tài khoản hoathinh3d ở Ngọc Giản Cấu Hình trước đã.",
    };
  }

  const enabledAccounts = accounts.filter((account) => account.enabled);
  if (enabledAccounts.length === 0) {
    return { ok: false, error: "Mọi tài khoản đang tắt. Bật ít nhất một tài khoản rồi khai đàn lại." };
  }

  // Duyệt MỌI nhiệm vụ, không liệt kê tên. Chốt này ra đời khi hồ sơ chỉ có Mê Cung và
  // Luyện Đan, rồi mười nhiệm vụ ngày được thêm vào (v0.9.0) mà không ai nhớ tới nó — nên
  // một đạo hữu bật đủ chín nhiệm vụ ngày vẫn bị dội lại "Chưa bật nhiệm vụ nào", mâu thuẫn
  // thẳng với những ô đang tick trước mắt họ. Sổ điểm danh 02/08 cho thấy đúng một người
  // thật rơi vào đó. Đọc từ dữ liệu thì nhiệm vụ thứ mười ba tự được tính.
  const view = await getEditableConfig(userId);
  if (!Object.values(view.quests).some((q) => q.enabled)) {
    return { ok: false, error: "Chưa chọn nhiệm vụ nào. Tick ít nhất một nhiệm vụ rồi bấm Khắc Ngọc Giản." };
  }

  const active = await getActiveJobs(userId);
  const busyAccounts = new Set(active.map((job) => job.accountId));
  const idle = enabledAccounts.filter((account) => !busyAccounts.has(account.id));
  if (idle.length === 0) {
    return { ok: false, error: "Các tài khoản đang bật đều có đàn pháp chạy rồi. Bấm Thu Đàn nếu muốn dừng." };
  }

  // Snapshot = cấu hình nhiệm vụ chung + cookie/hạng của ĐÚNG tài khoản này. Cookie giữ
  // nguyên dạng ĐÃ MÃ HOÁ: bảng jobs sống lâu hơn bảng config rất nhiều (nó là lịch sử),
  // nên để plaintext ở đây là tự tay dựng lại đúng cái lỗ vừa bịt. Giải mã diễn ra đúng
  // một lần, ở /api/worker, khi khôi lỗi đã xác thực.
  const config = await getStoredConfigForSnapshot(userId);
  const workerOnline = await anyWorkerOnlineFor(userId);
  const startedLabels: string[] = [];

  for (const account of idle) {
    const snapshot = storedConfigSchema.parse({
      ...config,
      gameCookie: account.cookieEnvelope,
      accountTier: account.accountTier ?? null,
    });

    // Phép kiểm idle ở trên chỉ là phép lịch sự — luật thật là index
    // jobs_one_active_per_account: hai lượt Khai Đàn đồng thời (hai tab, hai thiết bị)
    // cùng thấy tài khoản còn rảnh, nhưng chỉ một INSERT thắng; kẻ đến sau DO NOTHING và
    // đi tiếp. Bọc thêm try/catch cho ngả tài khoản vừa bị xoá giữa vòng lặp (FK chặn) —
    // một tài khoản biến mất không được phép đánh đổ cả đợt khai đàn của những tài khoản còn lại.
    let jobId: string | null = null;
    try {
      const inserted = await db().execute(sql`
        insert into automation_jobs (user_id, account_id, config_snapshot, runner)
        values (${userId}, ${account.id}, ${JSON.stringify(snapshot)}::jsonb, 'local')
        on conflict (account_id) where status in ('queued', 'running', 'stopping') do nothing
        returning id
      `);
      jobId = inserted.rows?.[0]?.id ? String(inserted.rows[0].id) : null;
    } catch (error) {
      console.error(`startJob: không lập được đàn cho tài khoản ${account.id}`, error);
      continue;
    }
    if (!jobId) {
      continue;
    }

    await addEvent(
      jobId,
      "info",
      `Đàn pháp đã lập cho「${account.label}」— sẽ tự chạy liên tục qua nhiều vòng cho tới khi đạo hữu Thu Đàn.`,
    );

    // Nói thật NGAY LÚC NÀY nếu chẳng có khôi lỗi nào nhận nổi job — trước đây người dùng chỉ
    // biết điều đó sau sáu phút im lặng, khi reaper kết liễu job. Vẫn cho xếp hàng (một linh
    // sứ có thể lên ca ngay sau đây), nhưng cảnh báo nằm sẵn trong nhật ký.
    if (workerOnline) {
      await addEvent(jobId, "info", "Khôi lỗi đang trực — sẽ tiếp nhận trong giây lát.");
    } else {
      await addEvent(
        jobId,
        "warning",
        "Chưa thấy khôi lỗi nào điểm danh — đàn pháp sẽ chờ. Cài khôi lỗi riêng ở mục Khôi Lỗi nếu chờ quá lâu.",
      );
    }

    startedLabels.push(account.label);
  }

  if (startedLabels.length === 0) {
    // Mọi INSERT đều thua cuộc đua (tab khác vừa khai đàn) hoặc lỗi — nói thật thay vì
    // báo thành công rỗng.
    return { ok: false, error: "Các tài khoản đang bật đều có đàn pháp chạy rồi. Bấm Thu Đàn nếu muốn dừng." };
  }

  return { ok: true, startedLabels, alreadyRunning: active.length };
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

  await announceStops(changed.rows as Array<Record<string, unknown>>);
}

/**
 * Thu đàn cho MỘT tài khoản — dùng khi người dùng tắt (disable) tài khoản đang chạy.
 * Cùng một UPDATE chống khe đua như requestStop, chỉ thêm hàng rào account_id.
 */
export async function requestStopForAccount(userId: string, accountId: string): Promise<boolean> {
  const changed = await db().execute(sql`
    update automation_jobs set
      status = case
        when status = 'queued' then 'stopped'::job_status
        else 'stopping'::job_status
      end,
      finished_at = case when status = 'queued' then now() else finished_at end,
      next_run_at = case when status = 'queued' then now() else next_run_at end
    where user_id = ${userId}
      and account_id = ${accountId}
      and status in ('queued', 'running')
    returning id, status
  `);

  const rows = changed.rows as Array<Record<string, unknown>>;
  await announceStops(rows);
  return rows.length > 0;
}

/**
 * Kết cục một lượt dừng cưỡng bức. Ba nhánh CÓ THẬT, không phải một cờ boolean cho gọn: người
 * bấm nút cần biết mình vừa dừng hẳn được một đàn, hay chỉ vừa gửi đi một lời nhắn mà khôi lỗi
 * còn phải chạy nốt vòng — hai chuyện ấy khác nhau tới vài chục phút chờ.
 */
export type ForceStopOutcome =
  | { ok: true; ended: boolean }
  | { ok: false; reason: "not-found" | "already-stopping" };

/**
 * Dừng MỘT đàn theo id, bất kể của ai — nút Dừng trên trang Hàng Đợi.
 *
 * Phân quyền KHÔNG nằm ở đây mà ở action gọi vào (`job.force_stop`): tầng này chỉ biết dừng,
 * và đó là chủ ý — một hàm service tự đoán quyền là một luật thứ hai sống lệch luật thật.
 *
 * Ngữ nghĩa mượn NGUYÊN của `requestStop`, không mạnh hơn: `queued` chết ngay, `running` đổi
 * sang `stopping` rồi khôi lỗi tự thu ở điểm an toàn kế tiếp. Cân nhắc rồi mới chọn thế —
 * một lệnh giết cứng (ép thẳng `stopped`) sẽ để khôi lỗi chạy nốt vòng rồi báo cáo vào một
 * job đã terminal, và `reapStaleJobs` vốn đã dọn hộ ca khôi lỗi CHẾT trong 3 phút. Cái còn
 * lại — khôi lỗi SỐNG mà vòng nào cũng hỏng rồi tự xếp lại — chính là ca cần lệnh này, và
 * `stopping` cắt đúng vòng lặp ấy.
 *
 * Tự-join `prev` để biết trạng thái CŨ trong cùng một câu lệnh: `returning` chỉ trả về hàng
 * MỚI, mà không có trạng thái cũ thì không phân biệt nổi "vừa dừng" với "đã dừng từ trước" —
 * và bấm lại một đàn đang dừng sẽ đẻ thêm một dòng nhật ký nói dối là vừa có lệnh mới. Cùng
 * lối nghĩ với `setAvatar` bên users.ts.
 */
export async function forceStopJob(jobId: string, actorName: string): Promise<ForceStopOutcome> {
  const changed = await db().execute(sql`
    update automation_jobs as job set
      status = case
        when job.status = 'queued' then 'stopped'::job_status
        else 'stopping'::job_status
      end,
      finished_at = case when job.status = 'queued' then now() else job.finished_at end,
      next_run_at = case when job.status = 'queued' then now() else job.next_run_at end
    from automation_jobs as prev
    where job.id = ${jobId}
      and prev.id = job.id
      and job.status in ('queued', 'running', 'stopping')
    returning prev.status as was, job.user_id, job.status as now
  `);

  const row = changed.rows[0] as { was: string; user_id: string; now: string } | undefined;
  // Không có hàng nào: id bịa, hoặc đàn đã về đích/đã dừng xong trước khi nút kịp bấm. Cả hai
  // đều là "không còn gì để dừng" dưới mắt người dùng.
  if (!row) return { ok: false, reason: "not-found" };
  if (row.was === "stopping") return { ok: false, reason: "already-stopping" };

  const ended = row.now === "stopped";
  await addEvent(
    jobId,
    "warning",
    ended
      ? `Bậc trị sự「${actorName}」đã dừng đàn này — vòng kế chưa kịp bắt đầu.`
      : `Bậc trị sự「${actorName}」đã dừng đàn này — khôi lỗi sẽ thu ở điểm an toàn kế tiếp.`,
  );

  /**
   * Đánh thức realtime, thứ mà `requestStop` (nút Thu Đàn của chính chủ) KHÔNG làm — nó chỉ
   * `revalidatePath("/dashboard")`, nên bảng Hàng Đợi phải đợi tới nhịp soát 30 giây.
   *
   * Ở đây thì không được phép đợi: người ra lệnh đang đứng nhìn đúng cái bảng ấy, và chủ nhân
   * đàn cần biết ngay vì sao đàn của mình dừng. Kênh Hàng Đợi không lọc theo userId nên một
   * tín hiệu đánh thức cả hai màn hình.
   */
  await notifyDashboard({ userId: String(row.user_id), topic: "job" });

  return { ok: true, ended };
}

/**
 * Vì sao một lượt khai đàn hộ có thể không thành. Mỗi nhánh là một câu KHÁC NHAU nói với
 * người bấm, vì cách xử lý khác nhau hẳn: tài khoản bị chủ tắt thì phải đi hỏi chủ, còn đàn
 * đã chạy lại rồi thì chỉ cần tải lại trang.
 */
export type ForceStartOutcome =
  | { ok: true; accountLabel: string }
  | {
      ok: false;
      reason: "not-found" | "still-active" | "account-gone" | "account-disabled" | "maintenance" | "no-quests";
    };

/**
 * Khai đàn hộ MỘT tài khoản, từ dòng đàn đã dừng trên trang Hàng Đợi.
 *
 * Nhận `stoppedJobId` chứ không nhận `accountId`, và đó là một lựa chọn về AN TOÀN chứ không
 * phải về tiện tay: id tài khoản của người khác không bao giờ được gửi xuống trình duyệt (xem
 * ranh giới riêng tư ở queue.ts), nên nếu action nhận accountId thì hoặc phải rò id ấy ra
 * client, hoặc phải bịa một lớp ánh xạ. Đi từ id đàn thì server tự tra ra chủ và tài khoản.
 *
 * Đàn CŨ không được đụng tới: một job terminal là một dòng lịch sử, và lịch sử thì không viết
 * lại. Lượt này lập một đàn MỚI, đúng như `startJob` vẫn làm — nhờ vậy số vòng, mốc thời gian
 * và nhật ký của lượt cũ còn nguyên để sau này còn soi lại vì sao nó kẹt.
 *
 * Mọi cánh cửa của `startJob` đều phải đi qua lại đủ, không được rút gọn cái nào: bảo trì,
 * tài khoản còn sống và đang bật, và có ít nhất một nhiệm vụ được tick. Rút gọn một cửa ở đây
 * là đẻ ra một đường khai đàn có luật lỏng hơn đường chính — và luật lỏng hơn thì sớm muộn
 * cũng thành luật thật.
 */
export async function forceStartJob(stoppedJobId: string, actorName: string): Promise<ForceStartOutcome> {
  const found = await db().execute(sql`
    select user_id, account_id, status
    from automation_jobs
    where id = ${stoppedJobId}
  `);
  const job = found.rows[0] as { user_id: string; account_id: unknown; status: string } | undefined;
  if (!job) return { ok: false, reason: "not-found" };

  // Còn sống thì không có gì để khai lại — và nếu cứ chạy tiếp, index
  // jobs_one_active_per_account sẽ nuốt lặng lẽ cái INSERT rồi ta báo một lời thành công rỗng.
  if (job.status === "queued" || job.status === "running" || job.status === "stopping") {
    return { ok: false, reason: "still-active" };
  }
  if (job.account_id == null) return { ok: false, reason: "account-gone" };

  const ownerId = String(job.user_id);
  const accountId = String(job.account_id);

  const { maintenance } = await getAppSettings();
  if (maintenance.active) return { ok: false, reason: "maintenance" };

  const account = (await listAccountsWithEnvelope(ownerId)).find((item) => item.id === accountId);
  if (!account) return { ok: false, reason: "account-gone" };
  // Chủ nhân tự tay tắt tài khoản này. Bậc trị sự đè lên ý muốn ấy là một quyết định của tông
  // môn, không phải của một cái nút — nên chỗ này từ chối và nói rõ để đi hỏi chủ.
  if (!account.enabled) return { ok: false, reason: "account-disabled" };

  const view = await getEditableConfig(ownerId);
  if (!Object.values(view.quests).some((quest) => quest.enabled)) {
    return { ok: false, reason: "no-quests" };
  }

  const config = await getStoredConfigForSnapshot(ownerId);
  const snapshot = storedConfigSchema.parse({
    ...config,
    gameCookie: account.cookieEnvelope,
    accountTier: account.accountTier ?? null,
  });

  const inserted = await db().execute(sql`
    insert into automation_jobs (user_id, account_id, config_snapshot, runner)
    values (${ownerId}, ${accountId}, ${JSON.stringify(snapshot)}::jsonb, 'local')
    on conflict (account_id) where status in ('queued', 'running', 'stopping') do nothing
    returning id
  `);
  const newJobId = inserted.rows?.[0]?.id ? String(inserted.rows[0].id) : null;
  // Thua cuộc đua: giữa lúc ta kiểm và lúc ta chèn, chủ nhân vừa tự Khai Đàn ở tab của họ.
  // Đó không phải lỗi, nhưng cũng không phải thành công — nói đúng tên nó.
  if (!newJobId) return { ok: false, reason: "still-active" };

  await addEvent(
    newJobId,
    "warning",
    `Bậc trị sự「${actorName}」đã khai đàn hộ cho「${account.label}」sau khi đàn trước dừng.`,
  );
  const workerOnline = await anyWorkerOnlineFor(ownerId);
  await addEvent(
    newJobId,
    workerOnline ? "info" : "warning",
    workerOnline
      ? "Khôi lỗi đang trực — sẽ tiếp nhận trong giây lát."
      : "Chưa thấy khôi lỗi nào điểm danh — đàn pháp sẽ chờ.",
  );

  await notifyDashboard({ userId: ownerId, topic: "job" });
  return { ok: true, accountLabel: account.label };
}

async function announceStops(rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const stoppedNow = String(row.status) === "stopped";
    await addEvent(
      String(row.id),
      "info",
      stoppedNow
        ? "Đã thu đàn — vòng kế chưa kịp bắt đầu."
        : "Đã gửi lệnh thu đàn — khôi lỗi sẽ dừng ở điểm an toàn kế tiếp.",
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
 * Scope là hàng rào phân quyền, không phải tuỳ chọn: khôi lỗi tông môn (operator) nhận job
 * của bất kỳ ai; khôi lỗi riêng chỉ nhìn thấy hàng chờ CỦA CHỦ MÌNH — điều kiện nằm ngay
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
        -- Tài khoản đã tắt thì đàn của nó không được phát ra nữa — cửa chặn cho khe đua
        -- hiếm giữa "thu đàn của tài khoản" và "hạ cờ enabled" trong toggleAccountAction.
        and (
          account_id is null
          or exists (
            select 1 from game_accounts as acc
            where acc.id = automation_jobs.account_id and acc.enabled
          )
        )
      order by next_run_at, created_at
      for update skip locked
      limit 1
    )
    update automation_jobs set
      status = 'running',
      worker_id = ${workerId},
      attempts = attempts + 1,
      -- queued là ranh giới an toàn: chưa browser nào dùng snapshot này. Đọc lại config
      -- ngay lúc claim để cookie/nhiệm vụ vừa lưu trong thời gian chờ có hiệu lực ở vòng tới,
      -- thay vì bắt người dùng chịu thêm một vòng với ngọc giản cũ. Snapshot = cấu hình
      -- nhiệm vụ chung GHÉP cookie/hạng của đúng tài khoản job phục vụ; job đời cũ không
      -- gắn tài khoản rơi về nhánh giữa (config trần), rồi mới tới snapshot đông lạnh.
      config_snapshot = coalesce(
        (select uc.config || jsonb_build_object(
            'gameCookie', acc.cookie_envelope,
            'accountTier', acc.account_tier)
         from user_configs as uc
         join game_accounts as acc on acc.user_id = uc.user_id
         where uc.user_id = automation_jobs.user_id
           and acc.id = automation_jobs.account_id),
        (select config from user_configs where user_id = automation_jobs.user_id),
        automation_jobs.config_snapshot
      ),
      started_at = coalesce(started_at, now()),
      -- Vòng mới bắt đầu từ tờ giấy trắng. Không dọn ở đây thì tiến độ của vòng TRƯỚC
      -- (thường là "8/8, đang chạy nhiệm vụ cuối") còn nguyên trên hàng đợi suốt quãng linh
      -- sứ mở trình duyệt và qua cổng Cloudflare — vài chục giây kể một câu chuyện đã cũ.
      cycle_progress = null,
      -- Đồng hồ kẹt đi theo tiến độ, luôn luôn. Bỏ sót dòng này thì một đàn vừa nhận vòng mới
      -- vẫn đeo dấu thời gian của vòng cũ và bị tab Đang Kẹt gọi tên ngay từ giây đầu tiên.
      cycle_progress_at = null,
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
      ? `Khôi lỗi「${workerId}」đã tiếp nhận đàn pháp.`
      : `Khôi lỗi「${workerId}」bắt đầu vòng ${attempts}.`,
  );
  return {
    id: String(row.id),
    userId: String(row.user_id),
    accountId: row.account_id == null ? null : String(row.account_id),
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
 * Vì sao phải trả workerId: sổ điểm danh chỉ được cập nhật ở `claim`, mà một khôi lỗi ĐANG
 * BẬN thì thôi không claim nữa. Hệ quả đo được ngày 02/08: khôi lỗi chạy Mê Cung — phiên dài
 * hàng chục phút — tụt khỏi sổ sau 30 giây và dashboard báo "vắng mặt" đúng lúc nó làm việc
 * chăm chỉ nhất; tệ hơn, `startJob` đọc cùng cái sổ ấy nên cảnh báo sai "chưa thấy khôi lỗi
 * nào". Nhịp tim định kỳ là bằng chứng sống chính xác hơn, và nó có sẵn.
 *
 * Lấy workerId từ CHÍNH DÒNG JOB chứ không bắt worker khai thêm: nhờ vậy những khôi lỗi đã
 * cài từ trước không phải cập nhật gì mà vẫn được điểm danh đúng.
 *
 * `progress` cưỡi luôn nhịp tim này thay vì có op riêng: nó đổi đúng vào những lúc nhịp tim
 * vẫn đang chạy, nên một op mới chỉ là thêm một request mỗi lần đổi mà không sớm hơn được
 * giây nào. VẮNG MẶT KHÁC HẲN RỖNG — khôi lỗi đời cũ không biết trường này, và với nó cột
 * phải được GIỮ NGUYÊN chứ không bị xoá trắng mỗi 5 giây; nên chỉ nhắc tới cột khi thật sự
 * có tiến độ để ghi.
 */
export async function heartbeat(
  jobId: string,
  progress?: CycleProgress,
): Promise<{ status: JobRow["status"]; workerId: string | null } | null> {
  if (progress === undefined) {
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

  /**
   * `cycle_progress_at` chỉ nhích khi TIẾN ĐỘ nhích — phép so `is distinct from` nằm ngay
   * trong câu UPDATE nên không có vòng đọc-rồi-ghi để mà đua, và mọi biểu thức SET đều đọc
   * hàng CŨ nên thứ tự hai dòng dưới đây không quan trọng.
   *
   * So bằng `jsonb` chứ không bằng chuỗi: `is distinct from` trên jsonb là so theo NGỮ NGHĨA,
   * nên khôi lỗi gửi lại cùng một tiến độ với thứ tự khoá khác sẽ không bị tính là "vừa đổi"
   * — mà nếu tính nhầm thì đồng hồ kẹt bị đặt lại mỗi 5 giây và không đàn nào bị phát hiện nữa.
   */
  const serialised = JSON.stringify(progress);
  const result = await db().execute(sql`
    update automation_jobs set
      last_heartbeat = now(),
      cycle_progress_at = case
        when cycle_progress is distinct from ${serialised}::jsonb then now()
        else cycle_progress_at
      end,
      cycle_progress = ${serialised}::jsonb
    where id = ${jobId}
    returning status, worker_id
  `);

  const row = result.rows[0] as { status: string; worker_id: unknown } | undefined;
  if (!row) return null;
  return {
    status: row.status as JobRow["status"],
    workerId: row.worker_id == null ? null : String(row.worker_id),
  };
}

export async function completeJob(
  jobId: string,
  outcome: "done" | "failed" | "stopped",
  message: string,
): Promise<void> {
  // Chỉ kết liễu job còn đang chạy. Reaper là SELECT-rồi-UPDATE hai bước — giữa hai bước,
  // worker có thể vừa hoàn thành vòng và re-queue job khoẻ mạnh; một UPDATE vô điều kiện
  // sẽ giết nhầm nó (và hai reaper đồng thời ghi event trùng).
  const rows = await db()
    .update(schema.automationJobs)
    // cycleProgress về null cùng lúc: một job bị reaper kết liễu là một job không còn ai
    // chạy nhiệm vụ nào cho nó, và tiến độ cuối cùng nó kịp khai giờ chỉ là một lời nói dối
    // đông lạnh nằm chờ người đọc kế tiếp.
    .set({ status: outcome, finishedAt: new Date(), cycleProgress: null, cycleProgressAt: null })
    .where(
      and(
        eq(schema.automationJobs.id, jobId),
        inArray(schema.automationJobs.status, ["running", "stopping"]),
      ),
    )
    .returning({ id: schema.automationJobs.id });
  if (rows.length === 0) return;
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

  // Tài khoản đã tắt (hoặc job đời cũ mà tài khoản không còn) thì vòng này là vòng cuối:
  // re-queue một đàn mà claim sẽ không bao giờ phát ra chỉ tạo zombie "chờ khôi lỗi" vĩnh
  // viễn. Điều kiện nằm TRONG cùng câu UPDATE để không mở khe đua với toggleAccountAction.
  const accountRetired = sql`(
    automation_jobs.account_id is not null
    and not exists (
      select 1 from game_accounts as acc
      where acc.id = automation_jobs.account_id and acc.enabled
    )
  )`;

  const updated = await db().execute(sql`
    update automation_jobs set
      status = case
        when status = 'stopping' or ${stopFromWorker} or ${accountRetired} then 'stopped'::job_status
        else 'queued'::job_status
      end,
      finished_at = case
        when status = 'stopping' or ${stopFromWorker} or ${accountRetired} then now()
        else null
      end,
      next_run_at = case
        when status = 'stopping' or ${stopFromWorker} or ${accountRetired} then now()
        else ${nextRunAt}
      end,
      config_snapshot = case
        when status = 'stopping' or ${stopFromWorker} or ${accountRetired} then config_snapshot
        else coalesce(
          (select uc.config || jsonb_build_object(
              'gameCookie', acc.cookie_envelope,
              'accountTier', acc.account_tier)
           from user_configs as uc
           join game_accounts as acc on acc.user_id = uc.user_id
           where uc.user_id = automation_jobs.user_id
             and acc.id = automation_jobs.account_id),
          (select config from user_configs where user_id = automation_jobs.user_id),
          config_snapshot
        )
      end,
      -- Vòng đã xong thì không còn nhiệm vụ nào "đang chạy". Job quay về hàng chờ mà còn đeo
      -- tiến độ cũ sẽ hiện trên Hàng Đợi là "đang nghỉ — Mê Cung" suốt cả cooldown.
      cycle_progress = null,
      cycle_progress_at = null,
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
 * Xoá sạch nhật ký của những lượt ĐANG HIỂN THỊ — đúng cái người dùng nhìn thấy trên Lư
 * Khai Đàn, giờ là job mới nhất của từng tài khoản.
 *
 * Không nhận `jobId` từ người gọi mà tự tra các lượt CỦA CHÍNH HỌ: `getCurrentJobsPerAccount`
 * đã lọc theo userId, nên id đi vào câu DELETE không thể là job của người khác. Nhận jobId
 * từ ngoài thì phải thêm một phép kiểm chủ sở hữu nữa, và một phép kiểm có thể bị quên.
 *
 * Xoá thật chứ không ẩn ở phía trình duyệt: con trỏ nhật ký reset về 0 mỗi lần tải lại
 * trang, nên "xoá" chỉ trong state của React sẽ sống lại nguyên vẹn sau một lần F5.
 */
export async function clearVisibleJobEvents(userId: string): Promise<number> {
  const jobs = await getCurrentJobsPerAccount(userId);
  if (jobs.length === 0) {
    return 0;
  }

  const gone = await db()
    .delete(schema.jobEvents)
    .where(inArray(schema.jobEvents.jobId, jobs.map((job) => job.id)))
    .returning({ id: schema.jobEvents.id });
  if (gone.length > 0) {
    try {
      await notifyDashboard({ userId, topic: "events-cleared" });
    } catch (error) {
      // Xoá đã thành công; mất một tiếng chuông realtime không được biến thao tác thành thất bại.
      console.error("clearVisibleJobEvents: không phát được tín hiệu realtime", error);
    }
  }
  return gone.length;
}

/** The dashboard's log feed: everything after `afterId`, oldest first, bounded. */
export const JOB_EVENT_PAGE_SIZE = 200;

/**
 * Biên phát lại: đọc lùi thêm chừng này id dưới con trỏ. Vì sao phải lùi: id là bigserial
 * nhưng THỨ TỰ COMMIT không hứa theo id — hai job của hai tài khoản ghi log đồng thời, dòng
 * id nhỏ có thể commit SAU khi con trỏ đã vượt qua nó, và một phép đọc `id > cursor` thuần
 * sẽ bỏ rơi dòng ấy vĩnh viễn. Client khử trùng theo id (Map) nên đọc lặp vô hại; phía
 * stream chỉ phát frame khi có dòng THẬT SỰ mới để biên này không biến mỗi nhịp tim thành
 * một frame thừa.
 */
export const JOB_EVENT_REPLAY_MARGIN = 50;

/**
 * Nhật ký gộp của một BỘ job (mỗi tài khoản một job). id là bigserial toàn cục nên một con
 * trỏ duy nhất phục vụ cả bộ. Lượt tải đầu (afterId = 0) lấy phần ĐUÔI — người mở trang cần
 * những dòng mới nhất, không phải 200 dòng cổ nhất của một job đã chạy cả tuần; các lượt
 * sau bám con trỏ, đọc lùi thêm JOB_EVENT_REPLAY_MARGIN để vớt dòng commit muộn.
 */
export async function eventsForJobs(jobIds: string[], afterId: number): Promise<JobEventRow[]> {
  if (jobIds.length === 0) return [];

  if (afterId > 0) {
    return db()
      .select()
      .from(schema.jobEvents)
      .where(
        and(
          inArray(schema.jobEvents.jobId, jobIds),
          gt(schema.jobEvents.id, Math.max(0, afterId - JOB_EVENT_REPLAY_MARGIN)),
        ),
      )
      .orderBy(schema.jobEvents.id)
      .limit(JOB_EVENT_PAGE_SIZE);
  }

  const tail = await db()
    .select()
    .from(schema.jobEvents)
    .where(inArray(schema.jobEvents.jobId, jobIds))
    .orderBy(desc(schema.jobEvents.id))
    .limit(JOB_EVENT_PAGE_SIZE);
  return tail.reverse();
}

/**
 * Dọn job đang chạy nhưng mất nhịp tim.
 *
 * `queued` KHÔNG còn là xác: nó có thể đang ngủ tới `nextRunAt`, hoặc đang chờ một khôi lỗi
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
    await completeJob(row.id, "failed", "Khôi lỗi mất liên lạc (quá 3 phút không hồi đáp) — lượt bị kết thúc.");
  }

}

/** Một lô xoá. Đủ nhỏ để một câu lệnh không giữ khoá lâu, đủ lớn để không phải chạy trăm lượt. */
export const JOB_EVENT_PURGE_BATCH = 5_000;
/** Trần lô mỗi lượt quét: 50 nghìn dòng — gấp năm lần nhịp sinh cao nhất đo được (9.674/ngày). */
const JOB_EVENT_PURGE_MAX_BATCHES = 10;

/**
 * Quét nhật ký đàn quá hạn lưu — van xả của `deploy/mirror/README.md` §11.
 *
 * `job_events` là bảng lớn nhất trong một lượt chuyển trạm và nó chỉ đi một chiều; không có
 * van này thì mỗi lượt chuyển trạm dài ra theo tuổi của tông môn (xem `settings.ts`, khoá
 * `jobEvents.retentionDays`, cho cả phép đo lẫn sự đánh đổi).
 *
 * XOÁ THEO LÔ chứ không một câu lệnh: một `delete` chạm hàng trăm nghìn dòng trên kết nối
 * serverless là một câu lệnh dài vô định, và nó chạy trong cùng function 60 giây với hai việc
 * quét khác. Hết trần lô thì để dành cho lượt sau — `more: true` nói rõ còn nợ, và vì hạn lưu
 * là một mốc thời gian tuyệt đối nên lượt sau dọn tiếp đúng chỗ vừa dừng.
 *
 * KHÔNG chừa job đang chạy: một lượt sống lâu hơn hạn lưu sẽ mất phần nhật ký cũ của chính
 * nó, và đó đúng là ý nghĩa của「hạn lưu」— dòng nhật ký hết hạn thì hết hạn, bất kể ai sinh
 * ra nó. Bản thân job không hề hấn gì (khoá ngoại chỉ đi một chiều từ event sang job).
 *
 * CHỈ gọi từ cron, khác `reapStaleJobs` vốn đi kèm mọi lượt đọc dashboard: đây là xoá hàng
 * loạt, không phải thứ đáng đặt trên đường đi nóng của một trang.
 */
export async function purgeExpiredJobEvents(): Promise<{ purged: number; more: boolean }> {
  const { jobEvents } = await getAppSettings();
  const cutoff = new Date(Date.now() - jobEvents.retentionDays * 24 * 3600 * 1000);

  let purged = 0;
  for (let batch = 0; batch < JOB_EVENT_PURGE_MAX_BATCHES; batch++) {
    // `returning id` rồi đếm hàng, thay vì tin vào `rowCount` — trường ấy tuỳ driver, còn số
    // hàng trả về thì không.
    const gone = await db().execute(sql`
      delete from job_events
       where id in (
         select id from job_events where at < ${cutoff} order by id limit ${JOB_EVENT_PURGE_BATCH}
       )
      returning id
    `);
    const n = gone.rows.length;
    purged += n;
    // Lô chưa đầy nghĩa là đã vét sạch phần quá hạn — dừng, đừng chạy thêm một câu lệnh rỗng.
    if (n < JOB_EVENT_PURGE_BATCH) return { purged, more: false };
  }
  return { purged, more: true };
}

/**
 * Toàn cảnh drain cho tab Bảo Trì: bao nhiêu đàn còn chạy nốt vòng (running + stopping),
 * bao nhiêu đàn nằm chờ mà cửa claim sẽ không phát ra. Trưởng môn nhìn số "đang chạy" về 0
 * là biết drain xong, deploy an toàn.
 */
export async function countJobsForDrain(): Promise<{ running: number; queued: number }> {
  const rows = await db()
    .select({ status: schema.automationJobs.status, n: sql<number>`count(*)::int` })
    .from(schema.automationJobs)
    .where(inArray(schema.automationJobs.status, ACTIVE))
    .groupBy(schema.automationJobs.status);

  let running = 0;
  let queued = 0;
  for (const row of rows) {
    if (row.status === "queued") queued += row.n;
    else running += row.n;
  }
  return { running, queued };
}
