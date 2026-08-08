import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { CycleProgress, JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Hàng đợi công việc của CẢ TÔNG MÔN — ai cũng xem được, để biết đàn của mình đang đứng thứ
 * mấy và vì sao chưa tới lượt.
 *
 * <b>Ranh giới riêng tư</b>: trang này cố ý cho thấy job của người khác, nên phải nói rõ cái
 * gì được thấy và cái gì không. Của người khác: tên đã che, trạng thái, thời điểm chạy kế,
 * số vòng đã chạy, tiến độ vòng này — CẢ SỐ ĐẾM LẪN TÊN NHIỆM VỤ ĐANG CHẠY — và khôi lỗi nào
 * đang cầm (chỉ TÔNG MÔN hay RIÊNG, không phải id máy). KHÔNG BAO GIỜ: tên tài khoản game,
 * cookie, cấu hình nhiệm vụ đã lưu, id khôi lỗi riêng. Của chính mình thì thấy đủ.
 *
 * <b>Tên nhiệm vụ đã ĐỔI PHÍA, ngày 08/08/2026, theo yêu cầu của tông chủ.</b> Trước đó chỉ
 * con số "3/8" được qua, với lập luận: nó trả lời đúng câu hỏi trang này sinh ra để trả lời
 * — cái ghế khôi lỗi tông môn kia sắp trống chưa — mà không hé lộ ai bật những nhiệm vụ nào.
 * Lập luận ấy vẫn đúng về mặt logic; thứ đổi là điều tông môn MUỐN thấy. Ghi lại để người
 * sau biết đây là một ranh giới được dịch có chủ ý, không phải một chỗ rò rỉ.
 *
 * Cái được lộ hẹp hơn "cấu hình nhiệm vụ" — thứ vẫn nằm bên phía KHÔNG BAO GIỜ: đây là
 * những nhiệm vụ đang chạy NGAY LÚC NÀY của vòng này, không phải danh sách đã bật trong
 * ngọc giản, và nó biến mất ngay khi vòng chạy xong.
 */

/** Tiến độ một vòng, đã cắt theo ranh giới riêng tư ở đầu tệp. */
export type QueueProgress = {
  /**
   * Tên nhiệm vụ đang chạy ngay lúc này, MỌI dòng đều có — xem ghi chú "đổi phía" ở đầu tệp.
   *
   * Rỗng là một trạng thái THẬT, không phải thiếu dữ liệu: đó là quãng khôi lỗi mở trình
   * duyệt, qua cổng Cloudflare và dò hạng tài khoản, trước khi nhiệm vụ đầu tiên bắt đầu.
   */
  running: string[];
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
  /** Khôi lỗi đang cầm job: id đầy đủ cho dòng của mình, chỉ hạng cho dòng người khác. */
  workerId: string | null;
  workerKind: "sect" | "personal" | null;
  /**
   * Thứ tự trong hàng chờ của khôi lỗi tông môn, tính từ 1. `null` khi job chưa tới giờ
   * (đang nghỉ theo cooldown) hoặc đang chạy — hai trạng thái ấy không xếp hàng.
   */
  queuePosition: number | null;
  /**
   * Vòng này đang làm tới đâu. `null` khi khôi lỗi chưa khai — job đang nghỉ, vòng vừa xong,
   * hoặc khôi lỗi đời cũ chưa biết gửi. Giao diện phải chịu được `null` mà không mất chữ nào.
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

/** Trần hiển thị cho danh sách tên nhiệm vụ — xem lý do trong `readProgress`. */
const MAX_RUNNING_QUEST_NAMES = 12;
const MAX_QUEST_NAME_LENGTH = 60;

/**
 * Đọc cột `cycle_progress` về đúng hình thù, và trả `null` cho mọi thứ không phải hình thù
 * đó. Zod ở /api/worker đã canh cửa GHI, nên đây không phải lớp canh thứ hai — nó là lời
 * thừa nhận rằng cột jsonb này sống lâu hơn mọi phiên bản code đã ghi vào nó: một dòng do
 * bản cũ để lại, hay một lần sửa tay trên database, không được phép làm trắng cả trang.
 *
 * Trước 08/08/2026 hàm này còn nhận `mine` để cắt tên nhiệm vụ của người khác. Tham số ấy đã
 * bỏ hẳn thay vì để lại và luôn truyền `true`: một tham số riêng tư không còn ai đọc là một
 * cái bẫy mời người sau tin rằng vẫn còn phép cắt ở đâu đó.
 *
 * Export vì cùng lý do với `maskUsername`: phép cắt riêng tư đáng được ghim bằng test trực
 * tiếp, không phải qua ba lớp database mới soi được.
 */
export function readProgress(raw: unknown): QueueProgress | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const value = raw as Partial<CycleProgress>;
  const done = Number(value.done);
  const total = Number(value.total);
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null;

  const running = Array.isArray(value.running)
    ? value.running
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        // Trần ở ĐƯỜNG ĐỌC, dù Zod của /api/worker đã chặn ở đường ghi (≤32 tên, ≤120 ký tự).
        // Không phải lớp canh thứ hai — mà vì từ hôm nay chuỗi này đi thẳng lên màn hình của
        // MỌI đạo hữu, chứ không riêng chủ nó. Cột jsonb sống lâu hơn mọi phiên bản code đã
        // ghi vào nó (một dòng do bản cũ để lại, một lần sửa tay), và một dòng như thế giờ
        // làm hỏng trang của cả tông môn chứ không của một người. Hai con số dưới đây rộng
        // gấp nhiều lần dữ liệu thật — tối đa 8 tab, tên dài nhất trong hồ sơ ~30 ký tự —
        // nên chúng không bao giờ chạm vào một hàng đợi lành lặn.
        .filter((name) => name.length <= MAX_QUEST_NAME_LENGTH)
        .slice(0, MAX_RUNNING_QUEST_NAMES)
    : [];

  return { running, done, total };
}

/**
 * Ảnh chụp hàng đợi tại thời điểm gọi.
 *
 * Thứ tự truy vấn CỐ Ý trùng với `claimNextJob` (`next_run_at`, rồi `created_at`), nên số
 * thứ tự hiện trên màn hình chính là thứ tự khôi lỗi tông môn sẽ nhặt việc — không phải một
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
      progress: readProgress(row.cycle_progress),
    } satisfies QueueEntry;
  });

  return { entries, running, waiting, sleeping };
}

export { ACTIVE_STATUSES };
