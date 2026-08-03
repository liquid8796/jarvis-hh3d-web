"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { clearLogAction, startAction, stopAction } from "@/app/actions/automation";
import { useDashboardJobLive } from "./DashboardLiveProvider";
import type { DashboardJob, JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Lư Khai Đàn — nút start/stop và nhật ký tu luyện.
 *
 * Trạng thái thật nằm ở server: nút bấm chỉ gửi ý định, còn màn hình được đẩy lại từ SSE
 * (và feed một-lần khi reconnect). Đó là điều khiến việc đóng tab không có nghĩa lý gì — mở lại
 * ở máy khác vẫn thấy đúng lượt đang chạy, đúng nhật ký, vì chưa bao giờ có state nào chỉ
 * sống trong trình duyệt.
 */

const ACTIVE: JobStatus[] = ["queued", "running", "stopping"];

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "Chờ linh sứ tiếp nhận",
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

export function ControlPanel({ initiallyRunning }: { initiallyRunning: boolean }) {
  const { job, events, connected, refresh, clearEvents } = useDashboardJobLive();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const logRef = useRef<HTMLDivElement>(null);
  const running = job ? ACTIVE.includes(job.status) : initiallyRunning;

  // Chỉ tự cuộn khi người đọc đang ở sát đáy — ai đang đọc lại dòng cũ thì không bị giật đi.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setNotice(result.message);
      await refresh();
    });
  };

  const clearLog = () => {
    if (!confirm("Dọn sạch nhật ký của lượt này? Những dòng đã ghi sẽ không lấy lại được.")) {
      return;
    }
    startTransition(async () => {
      const result = await clearLogAction();
      clearEvents();
      // KHÔNG đụng tới cursor trong provider: id của job_events là bigserial, không bao giờ dùng lại, nên
      // mọi dòng linh sứ kể từ đây đều mang id lớn hơn và vẫn chảy về bình thường. Reset
      // con trỏ về 0 chỉ tổ kéo lại đúng những dòng vừa xoá nếu câu DELETE về chậm hơn nhịp
      // hỏi tin kế tiếp.
      setNotice(result.message);
    });
  };

  return (
    <section className="card card-hairline flex flex-col p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="h-display text-xl font-semibold text-gilded">Lư Khai Đàn</h2>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                running
                  ? "bg-[var(--color-jade-400)] pulse-jade"
                  : job?.status === "failed"
                    ? "bg-[#f2a0a0]"
                    : "bg-[var(--color-ink-600)]"
              }`}
              aria-hidden
            />
            <span className="text-[var(--color-mist)]">
              {job ? describeStatus(job) : "Chưa khai đàn lần nào"}
            </span>
          </p>
        </div>

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

      {notice && (
        <p role="status" className="mb-4 text-sm text-[var(--color-gold-300)]">
          {notice}
        </p>
      )}

      {/* Nói cho ĐỦ, không chỉ nói phần hay ho. "Tắt trình duyệt vẫn chạy" là thật, nhưng
          bỏ lửng ở đó thì người ta suy ra "tắt máy chắc cũng thế" — sai, nếu linh sứ đang
          nằm trên chính máy họ. Một câu hứa đúng một nửa còn tệ hơn không hứa. */}
      <p className="mb-2 text-xs text-[var(--color-mist)]">
        Khai Đàn một lần, linh sứ tự canh cooldown và chạy hết vòng này sang vòng khác; chỉ bấm
        Thu Đàn mới dừng. Tắt trình duyệt thoải mái. Còn tắt máy thì tuỳ ai đang chạy: linh sứ
        tông môn không sao, linh sứ nằm trên máy bạn sẽ dừng theo.
        {job?.workerId && (
          <>
            {" "}
            Linh sứ phụ trách: <span className="font-mono">{job.workerId}</span>.
          </>
        )}
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
        className="h-80 overflow-y-auto rounded-xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-950)]/60 p-3"
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
              </span>{" "}
              <span className={`log-${e.level}`}>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
