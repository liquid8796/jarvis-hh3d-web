"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  clearLogAction,
  setWorkerPrefAction,
  startAction,
  stopAction,
} from "@/app/actions/automation";
import { useDashboardJobLive, useDashboardPresenceLive } from "./DashboardLiveProvider";
import type { WorkerPref } from "@/lib/services/configs";
import type { DashboardJob, DashboardPresence, JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Tế đàn auto — nút start/stop và nhật ký tu luyện, giờ cho CẢ ĐỘI tài khoản.
 *
 * Trạng thái thật nằm ở server: nút bấm chỉ gửi ý định, còn màn hình được đẩy lại từ SSE
 * (và feed một-lần khi reconnect). Đó là điều khiến việc đóng tab không có nghĩa lý gì — mở lại
 * ở máy khác vẫn thấy đúng lượt đang chạy, đúng nhật ký, vì chưa bao giờ có state nào chỉ
 * sống trong trình duyệt. Mỗi tài khoản một dòng trạng thái; nhật ký gộp chung, từng dòng
 * mang nhãn tài khoản đã kể ra nó.
 */

const ACTIVE: JobStatus[] = ["queued", "running", "stopping"];

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "Chờ khôi lỗi tiếp nhận",
  running: "Đàn pháp đang vận hành",
  stopping: "Đang thu đàn…",
  stopped: "Đã thu đàn",
  failed: "Đàn pháp gặp trắc trở",
  done: "Đã viên mãn",
};

function describeStatus(job: DashboardJob): string {
  const next = new Date(job.nextRunAt);
  if (job.status === "queued" && job.attempts > 0 && next.getTime() > Date.now() + 5000) {
    return `Đang nghỉ — vòng ${job.attempts + 1} lúc ${next.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return STATUS_TEXT[job.status];
}

/**
 * Ba lối giao đàn. Nhãn nói theo NGÔI của người đọc ("máy nhà của tôi"), vì đây là câu trả lời
 * cho câu hỏi "ai chạy auto giúp tôi" — đúng câu mà mục Khôi Lỗi ngay bên dưới đang mở đầu.
 */
const RUN_BY_OPTIONS: { value: WorkerPref; label: string; note: string }[] = [
  {
    value: "any",
    label: "Ai rảnh cũng được",
    note: "Khôi lỗi nào trực trước thì nhận — chạy sớm nhất.",
  },
  {
    value: "sect",
    label: "Khôi lỗi tông môn",
    note: "Máy của tông môn luôn trực, máy nhà tắt cũng không sao.",
  },
  {
    value: "mine",
    label: "Máy nhà của tôi",
    note: "Chỉ máy đã cài khôi lỗi của đạo hữu chạy; tắt máy là auto nghỉ.",
  },
];

/**
 * Lời nhắc theo LỰA CHỌN và sổ điểm danh NGAY LÚC NÀY — thứ nói trước được chuyện "bấm Khai
 * Đàn xong rồi nằm chờ mãi". `null` khi lựa chọn ấy có người trực, hoặc khi chưa đọc được sổ
 * (đừng doạ người ta chỉ vì frame SSE đầu tiên chưa về).
 */
function runByWarning(pref: WorkerPref, presence: DashboardPresence | null): string | null {
  if (presence == null) return null;
  const mineOnline = presence.mine.some((worker) => worker.online);

  if (pref === "sect") {
    return presence.sectOnline
      ? null
      : "Khôi lỗi tông môn đang vắng — khai đàn lúc này thì đàn sẽ nằm chờ nó trực lại.";
  }
  if (pref === "mine") {
    if (mineOnline) return null;
    return presence.mine.length === 0
      ? "Đạo hữu chưa có khôi lỗi máy nhà nào — cài ở mục Khôi Lỗi bên dưới, nếu không đàn sẽ nằm chờ mãi."
      : "Máy nhà của đạo hữu đang tắt — bật lên thì đàn mới có người cầm.";
  }
  return presence.sectOnline || mineOnline
    ? null
    : "Chưa có khôi lỗi nào trực — khai đàn lúc này thì đàn sẽ nằm chờ.";
}

function statusDotClass(job: DashboardJob): string {
  if (ACTIVE.includes(job.status)) return "bg-[var(--color-jade-400)] pulse-jade";
  if (job.status === "failed") return "bg-[#f2a0a0]";
  return "bg-[var(--color-ink-600)]";
}

export function ControlPanel({
  initiallyRunning,
  initialWorkerPref,
}: {
  initiallyRunning: boolean;
  /** Lựa chọn đang lưu trong ngọc giản — server đọc, đây chỉ vẽ lại. */
  initialWorkerPref: WorkerPref;
}) {
  const { jobs, events, connected, refresh, clearEvents } = useDashboardJobLive();
  const { presence } = useDashboardPresenceLive();
  const [notice, setNotice] = useState<string | null>(null);
  const [workerPref, setWorkerPref] = useState<WorkerPref>(initialWorkerPref);
  const [pending, startTransition] = useTransition();

  const logRef = useRef<HTMLDivElement>(null);
  // Ghim đáy nhật ký: mở trang là đứng ở dòng MỚI NHẤT, và bám theo dòng mới chừng nào
  // người đọc còn ở sát đáy. Ai đang kéo lên đọc lại dòng cũ thì không bị giật đi — chỉ khi
  // họ tự kéo xuống đáy, nhật ký mới bám tiếp.
  const pinnedToBottom = useRef(true);

  const running = jobs.length > 0 ? jobs.some((job) => ACTIVE.includes(job.status)) : initiallyRunning;
  const showLabels = jobs.length > 1;
  const warning = runByWarning(workerPref, presence);

  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setNotice(result.message);
      await refresh();
    });
  };

  /**
   * Đổi lối giao đàn. Đặt state TRƯỚC rồi mới đợi máy chủ: một cái nút bấm xong đứng im vài
   * nhịp mạng thì người ta bấm lần nữa. Máy chủ từ chối thì trả nút về đúng chỗ cũ — không để
   * lại một lựa chọn chỉ có thật trên màn hình.
   *
   * Thành công thì KHÔNG báo một chữ nào: nút vừa sáng lên và dòng ghi chú dưới nhóm nút đã nói
   * đủ. Dọn luôn lời nhắn cũ (nếu có) để không còn một câu của thao tác trước nằm cạnh một lựa
   * chọn vừa đổi, trông như thể nó vừa nói về lựa chọn ấy.
   */
  const chooseWorkerPref = (next: WorkerPref) => {
    if (next === workerPref || pending) return;
    const previous = workerPref;
    setWorkerPref(next);
    setNotice(null);
    startTransition(async () => {
      const result = await setWorkerPrefAction(next);
      if (result.ok) return;
      setWorkerPref(previous);
      setNotice(result.message);
    });
  };

  const clearLog = () => {
    if (!confirm("Dọn sạch nhật ký đang hiển thị? Những dòng đã ghi sẽ không lấy lại được.")) {
      return;
    }
    startTransition(async () => {
      // Xoá màn hình TRƯỚC khi chờ server: dòng nào khôi lỗi ghi trong lúc câu DELETE đang
      // bay sẽ được frame SSE (hoặc tín hiệu events-cleared của server) đưa về lại — còn xoá
      // SAU thì chính những dòng mới ấy bị quét oan, và cursor đã vượt qua id của chúng nên
      // không bao giờ được kéo lại cho tới khi F5.
      clearEvents();
      const result = await clearLogAction();
      // KHÔNG đụng tới cursor trong provider: id của job_events là bigserial, không bao giờ dùng lại, nên
      // mọi dòng khôi lỗi kể từ đây đều mang id lớn hơn và vẫn chảy về bình thường. Reset
      // con trỏ về 0 chỉ tổ kéo lại đúng những dòng vừa xoá nếu câu DELETE về chậm hơn nhịp
      // hỏi tin kế tiếp.
      setNotice(result.message);
    });
  };

  return (
    <section className="card card-hairline flex flex-col p-6 xl:p-8">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="h-display text-xl font-semibold text-gilded">Tế đàn auto</h2>

        {running ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => run(stopAction)}
          >
            Thu Đàn
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-jade"
            disabled={pending}
            onClick={() => run(startAction)}
          >
            Khai Đàn
          </button>
        )}
      </div>

      {/* Giao đàn cho ai — đứng NGAY dưới nút Khai Đàn vì nó quyết định cú bấm ấy đi về đâu.
          Radio thật (ẩn bằng sr-only) chứ không phải ba cái <button>: nhờ vậy phím mũi tên,
          Space và trình đọc màn hình cư xử đúng như mọi nhóm radio khác mà không phải tự viết
          lại điều hướng bàn phím — thứ rất dễ viết thiếu một nửa. */}
      <fieldset className="mb-4" disabled={pending}>
        <legend className="text-xs font-semibold text-[var(--color-parchment)]">Giao đàn cho</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RUN_BY_OPTIONS.map((option) => (
            <label key={option.value} title={option.note}>
              <input
                type="radio"
                name="workerPref"
                value={option.value}
                checked={workerPref === option.value}
                onChange={() => chooseWorkerPref(option.value)}
                className="peer sr-only"
              />
              <span className="inline-block cursor-pointer rounded-lg border border-[var(--color-ink-600)] px-3 py-1.5 text-xs text-[var(--color-mist)] transition-colors peer-checked:border-[var(--color-jade-400)]/50 peer-checked:bg-[var(--color-jade-400)]/15 peer-checked:text-[var(--color-jade-400)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-gold-300)]/60 peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                {option.label}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--color-mist)]">
          {RUN_BY_OPTIONS.find((option) => option.value === workerPref)?.note}
        </p>
        {/* Cảnh báo「chọn xong sẽ phải chờ」nói TRƯỚC lúc bấm Khai Đàn. Cùng một sự thật cũng
            được ghi vào nhật ký lúc lập đàn (describeWorkerWait), nhưng ở đó thì người ta đã
            bấm rồi. */}
        {warning && <p className="mt-1 text-xs text-[var(--color-gold-300)]">{warning}</p>}
      </fieldset>

      {/* Mỗi tài khoản một dòng trạng thái — bản web của bảng account trên desktop. */}
      {jobs.length === 0 ? (
        <p className="mb-3 flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ink-600)]" aria-hidden />
          <span className="text-[var(--color-mist)]">Chưa khai đàn lần nào</span>
        </p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDotClass(job)}`}
                aria-hidden
              />
              {job.accountLabel && (
                <span className="font-semibold text-[var(--color-parchment)]">
                  {job.accountLabel}
                </span>
              )}
              <span className="text-[var(--color-mist)]">{describeStatus(job)}</span>
              {job.workerId && ACTIVE.includes(job.status) && (
                <span className="ml-auto font-mono text-[11px] text-[var(--color-mist)]">
                  {job.workerId}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="mb-4 text-sm text-[var(--color-gold-300)]">
          {notice}
        </p>
      )}

      {/* Nói cho ĐỦ, không chỉ nói phần hay ho. "Tắt trình duyệt vẫn chạy" là thật, nhưng
          bỏ lửng ở đó thì người ta suy ra "tắt máy chắc cũng thế" — sai, nếu khôi lỗi đang
          nằm trên chính máy họ. Một câu hứa đúng một nửa còn tệ hơn không hứa. */}
      <p className="mb-2 text-xs text-[var(--color-mist)]">
        Tắt trình duyệt thoải mái. Còn tắt máy thì tuỳ ai đang chạy: khôi lỗi tông môn không
        sao, khôi lỗi nằm trên máy bạn sẽ dừng theo.
      </p>

      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[var(--color-parchment)]">
          Nhật ký tu luyện
        </span>
        <div className="flex items-center gap-2">
          <span
            role="status"
            className={`text-[11px] ${
              connected ? "text-[var(--color-jade-400)]" : "text-[var(--color-gold-300)]"
            }`}
          >
            {connected ? "● Trực tiếp" : "↻ Đang nối lại…"}
          </span>
          <button
            type="button"
            onClick={clearLog}
            disabled={pending || events.length === 0}
            className="rounded-md border border-[var(--color-ink-600)] px-2 py-0.5 text-xs text-[var(--color-mist)] transition-colors hover:text-[var(--color-gold-300)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Dọn nhật ký
          </button>
        </div>
      </div>

      <div
        ref={logRef}
        onScroll={() => {
          const el = logRef.current;
          if (!el) return;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="h-80 overflow-y-auto rounded-xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-950)]/60 p-3 xl:h-[26rem] xl:p-4"
      >
        {events.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-mist)]">
            Bấm Khai Đàn để bắt đầu. Auto làm tới đâu sẽ kể ở đây.
          </p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="log-line">
              <span className="log-time">
                {new Date(e.at).toLocaleTimeString("vi-VN", { hour12: false })}
              </span>
              {/* Một ô duy nhất cho vế nội dung — xem ghi chú ở .log-line. */}
              <span className={`log-${e.level}`}>
                {showLabels && e.accountLabel && (
                  <span className="text-[var(--color-gold-300)]">{`「${e.accountLabel}」 `}</span>
                )}
                {e.message}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
