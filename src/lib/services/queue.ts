import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { CycleProgress, JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Hàng đợi công việc của CẢ TÔNG MÔN — ai cũng xem được, để biết đàn của mình đang đứng thứ
 * mấy và vì sao chưa tới lượt.
 *
 * <b>Ranh giới riêng tư</b>: trang này cố ý cho thấy job của người khác, nên phải nói rõ cái
 * gì được thấy và cái gì không. Của người khác: tên đã che, trạng thái, thời điểm chạy kế,
 * số vòng đã chạy, SỐ ĐẾM tiến độ vòng này, và linh sứ nào đang cầm (chỉ TÔNG MÔN hay RIÊNG,
 * không phải id máy). KHÔNG BAO GIỜ: tên tài khoản game, cookie, cấu hình nhiệm vụ, TÊN
 * nhiệm vụ đang chạy, id linh sứ riêng. Của chính mình thì thấy đủ.
 *
 * Vì sao con số được phép qua mà cái tên thì không: "3/8" trả lời đúng câu hỏi trang này
 * sinh ra để trả lời — cái ghế linh sứ tông môn kia sắp trống chưa — mà không hé lộ đạo hữu
 * ấy bật những nhiệm vụ nào. Danh sách tên thì hé lộ đúng cái đó, và cấu hình nhiệm vụ nằm
 * bên phía KHÔNG BAO GIỜ ngay từ ngày trang này ra đời. Ranh giới được dịch có chủ ý, không
 * phải vì tiện tay.
 */

/** Tiến độ một vòng, đã cắt theo ranh giới riêng tư ở đầu tệp. */
export type QueueProgress = {
  /** Tên nhiệm vụ đang chạy — CHỈ dòng của mình; dòng người khác luôn `null`. */
  running: string[] | null;
  done: number;
  total: number;
};

export type QueueEntry = {
  id: string;
  /** Dòng này của chính người đang xem. */
  mine: boolean;
  /** Tên chủ nhân — của mình thì nguyên vẹn, của người khác đã che 2/3. */
  owner: string;
  /** Tên tài khoản game: CHỈ dòng của mình mới có. */
  accountLabel: string | null;
  status: JobStatus;
  attempts: number;
  nextRunAt: string;
  /** Linh sứ đang cầm job: id đầy đủ cho dòng của mình, chỉ hạng cho dòng người khác. */
  workerId: string | null;
  workerKind: "sect" | "personal" | null;
  /**
   * Thứ tự trong hàng chờ của linh sứ tông môn, tính từ 1. `null` khi job chưa tới giờ
   * (đang nghỉ theo cooldown) hoặc đang chạy — hai trạng thái ấy không xếp hàng.
   */
  queuePosition: number | null;
  /**
   * Vòng này đang làm tới đâu. `null` khi linh sứ chưa khai — job đang nghỉ, vòng vừa xong,
   * hoặc linh sứ đời cũ chưa biết gửi. Giao diện phải chịu được `null` mà không mất chữ nào.
   */
  progress: QueueProgress | null;
};

export type QueueSnapshot = {
  entries: QueueEntry[];
  /** Đếm nhanh cho phần tóm tắt đầu trang. */
  running: number;
  waiting: number;
  sleeping: number;
};

/**
 * Che 2/3 tên, giữ lại đầu tên đủ để chủ nhân tự nhận ra mình.
 *
 * Đếm theo CODE POINT chứ không theo `.length`: tên có dấu tiếng Việt hoặc emoji mà cắt theo
 * đơn vị UTF-16 thì sẽ chặt đôi một ký tự và trả về ký tự lỗi.
 *
 * `floor` cho phần lộ ra, nên phần bị che LUÔN từ hai phần ba trở lên. Tên ngắn dưới ba ký
 * tự bị che sạch — lộ một trong hai chữ cái là đã quá nửa, và lời hứa "che 2/3" phải đúng
 * với mọi cái tên chứ không chỉ những cái tên đủ dài để nó tiện đúng.
 */
export function maskUsername(name: string): string {
  const chars = [...(name ?? "").trim()];
  if (chars.length === 0) return "?";

  const revealed = Math.floor(chars.length / 3);
  return chars.slice(0, revealed).join("") + "•".repeat(chars.length - revealed);
}

const ACTIVE_STATUSES = ["queued", "running", "stopping"] as const;

/**
 * Đọc cột `cycle_progress` về đúng hình thù, và trả `null` cho mọi thứ không phải hình thù
 * đó. Zod ở /api/worker đã canh cửa GHI, nên đây không phải lớp canh thứ hai — nó là lời
 * thừa nhận rằng cột jsonb này sống lâu hơn mọi phiên bản code đã ghi vào nó: một dòng do
 * bản cũ để lại, hay một lần sửa tay trên database, không được phép làm trắng cả trang.
 *
 * `mine` cắt tên nhiệm vụ ngay tại đây — chỗ hẹp nhất mà mọi đường đọc đều đi qua — nên
 * không tồn tại một đường nào lấy được ảnh chụp hàng đợi mà tên của người khác còn nguyên.
 *
 * Export vì cùng lý do với `maskUsername`: phép cắt riêng tư đáng được ghim bằng test trực
 * tiếp, không phải qua ba lớp database mới soi được.
 */
export function readProgress(raw: unknown, mine: boolean): QueueProgress | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const value = raw as Partial<CycleProgress>;
  const done = Number(value.done);
  const total = Number(value.total);
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null;

  const running = Array.isArray(value.running)
    ? value.running.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];

  return { running: mine ? running : null, done, total };
}

/**
 * Ảnh chụp hàng đợi tại thời điểm gọi.
 *
 * Thứ tự truy vấn CỐ Ý trùng với `claimNextJob` (`next_run_at`, rồi `created_at`), nên số
 * thứ tự hiện trên màn hình chính là thứ tự linh sứ tông môn sẽ nhặt việc — không phải một
 * cách sắp xếp riêng của giao diện rồi người dùng đoán nhầm là hàng chờ thật.
 */
export async function getQueueSnapshot(viewerId: string): Promise<QueueSnapshot> {
  const result = await db().execute(sql`
    select
      job.id, job.user_id, job.status, job.attempts, job.next_run_at, job.worker_id,
      job.cycle_progress,
      usr.username,
      acc.label as account_label,
      case when job.worker_id is null then null
           when w.id is null then 'personal'
           when w.user_id is null then 'sect'
           else 'personal' end as worker_kind
    from automation_jobs as job
    join users as usr on usr.id = job.user_id
    left join game_accounts as acc on acc.id = job.account_id
    left join workers as w on w.id = job.worker_id
    where job.status in ('queued', 'running', 'stopping')
    order by job.next_run_at, job.created_at
  `);

  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
  const now = Date.now();
  let position = 0;
  let running = 0;
  let waiting = 0;
  let sleeping = 0;

  const entries = rows.map((row) => {
    const status = String(row.status) as JobStatus;
    const nextRunAt = new Date(String(row.next_run_at));
    const mine = String(row.user_id) === viewerId;

    // "Đang xếp hàng" = đã tới giờ mà chưa ai nhặt. Job chưa tới giờ đang NGHỈ, job đang
    // chạy thì đã ra khỏi hàng — gộp cả ba làm một con số sẽ nói dối về độ dài hàng chờ.
    const queued = status === "queued" && nextRunAt.getTime() <= now;
    if (queued) waiting++;
    else if (status === "queued") sleeping++;
    else running++;

    const workerKind = row.worker_kind == null ? null : (String(row.worker_kind) as "sect" | "personal");

    return {
      id: String(row.id),
      mine,
      owner: mine ? String(row.username) : maskUsername(String(row.username)),
      accountLabel: mine && row.account_label != null ? String(row.account_label) : null,
      status,
      attempts: Number(row.attempts ?? 0),
      nextRunAt: nextRunAt.toISOString(),
      workerId: mine && row.worker_id != null ? String(row.worker_id) : null,
      workerKind,
      queuePosition: queued ? ++position : null,
      progress: readProgress(row.cycle_progress, mine),
    } satisfies QueueEntry;
  });

  return { entries, running, waiting, sleeping };
}

export { ACTIVE_STATUSES };
