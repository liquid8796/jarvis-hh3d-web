"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { startAction, stopAction } from "@/app/actions/automation";

/**
 * Lư Khai Đàn — nút start/stop và nhật ký tu luyện.
 *
 * Trạng thái thật nằm ở server: nút bấm chỉ gửi ý định, còn màn hình được vẽ lại từ những
 * gì `/api/jobs/feed` trả về. Đó là điều khiến việc đóng tab không có nghĩa lý gì — mở lại
 * ở máy khác vẫn thấy đúng lượt đang chạy, đúng nhật ký, vì chưa bao giờ có state nào chỉ
 * sống trong trình duyệt.
 */

type JobStatus = "queued" | "running" | "stopping" | "stopped" | "failed" | "done";

type FeedJob = {
  id: string;
  status: JobStatus;
  createdAt: string;
  workerId: string | null;
};

type FeedEvent = {
  id: number;
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

const ACTIVE: JobStatus[] = ["queued", "running", "stopping"];

/** Nhịp hỏi tin: dồn dập khi đàn đang chạy, thong thả khi đã nghỉ. */
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 12000;

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "Chờ linh sứ tiếp nhận",
  running: "Đàn pháp đang vận hành",
  stopping: "Đang thu đàn…",
  stopped: "Đã thu đàn",
  failed: "Đàn pháp gặp trắc trở",
  done: "Đã viên mãn",
};

export function ControlPanel({ initiallyRunning }: { initiallyRunning: boolean }) {
  const [job, setJob] = useState<FeedJob | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Con trỏ nhật ký: chỉ xin những dòng SAU dòng cuối đã có, nên phiên chạy dài hàng giờ
  // vẫn không kéo lại toàn bộ lịch sử mỗi 3 giây.
  const cursor = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const running = job ? ACTIVE.includes(job.status) : initiallyRunning;

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/feed?after=${cursor.current}`, { cache: "no-store" });
      if (!res.ok) return;

      const data = (await res.json()) as { job: FeedJob | null; events: FeedEvent[] };
      setJob(data.job);
      if (data.events.length > 0) {
        cursor.current = data.events[data.events.length - 1].id;
        setEvents((prev) => [...prev, ...data.events].slice(-400));
      }
    } catch {
      // Mạng chớp tắt là chuyện thường của một trang mở hàng giờ; nhịp sau hỏi lại.
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), running ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [poll, running]);

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
      await poll();
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
              {job ? STATUS_TEXT[job.status] : "Chưa khai đàn lần nào"}
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

      <p className="mb-2 text-xs text-[var(--color-mist)]">
        Đàn pháp chạy trên server. Đạo hữu có thể tắt trình duyệt, tắt máy — lượt vẫn tiếp
        diễn, mở lại trang là thấy đúng chỗ đang tới.
        {job?.workerId && (
          <>
            {" "}
            Linh sứ phụ trách: <span className="font-mono">{job.workerId}</span>.
          </>
        )}
      </p>

      <div
        ref={logRef}
        className="h-80 overflow-y-auto rounded-xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-950)]/60 p-3"
      >
        {events.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-mist)]">
            Nhật ký tu luyện sẽ hiện ở đây khi đàn pháp khởi động.
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
