"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueEntry, QueueSnapshot } from "@/lib/services/queue";
import type { JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Bảng hàng đợi của cả tông môn.
 *
 * Sống bằng SSE: Postgres đánh thức server ngay khi một đàn bất kỳ đổi trạng thái, và server
 * đẩy ảnh chụp mới xuống. Nhịp hỏi-lại chỉ còn là LƯỚI AN TOÀN cho lúc EventSource rớt —
 * 30 giây khi kênh sống (soát lại cho chắc), 2 giây khi nó đứt, y như Auto.
 *
 * Tab bị ẩn thì ngừng hỏi lại: một trang mở quên trong nền không có lý do gì gõ cửa database
 * cả ngày. Kênh SSE vẫn giữ nguyên — nó rẻ, và mở lại tốn hơn là để yên.
 */

const POLL_LIVE_MS = 30_000;
const POLL_FALLBACK_MS = 2_000;

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "Chờ tới lượt",
  running: "Đang chạy",
  stopping: "Đang thu đàn",
  stopped: "Đã thu đàn",
  failed: "Trắc trở",
  done: "Viên mãn",
};

function statusDot(entry: QueueEntry): string {
  if (entry.status === "running") return "bg-[var(--color-jade-400)] pulse-jade";
  if (entry.status === "stopping") return "bg-[var(--color-gold-300)]";
  return entry.queuePosition == null ? "bg-[var(--color-ink-600)]" : "bg-[var(--color-gold-400)]";
}

function describe(entry: QueueEntry): string {
  if (entry.status === "running") return "Đang chạy";
  if (entry.status === "stopping") return "Đang thu đàn";
  if (entry.queuePosition != null) return `Chờ tới lượt · thứ ${entry.queuePosition}`;

  const at = new Date(entry.nextRunAt);
  return `Đang nghỉ — tới lượt lúc ${at.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Đàn này có đang trong tay một khôi lỗi không.
 *
 * Tiến độ chỉ được phép hiện ở hai trạng thái ấy. Server đã dọn cột lúc xong vòng và lúc
 * nhận việc, nên một dòng ĐANG NGHỈ mang tiến độ là chuyện không xảy ra — nhưng nếu có ngày
 * nó xảy ra, cái giá là dòng "Đang nghỉ — Mê Cung", tức màn hình nói một câu sai. Rẻ hơn
 * nhiều nếu chỗ vẽ cũng biết luật, thay vì tin rằng mọi đường ghi đều nhớ dọn.
 */
const isWorking = (entry: QueueEntry) => entry.status === "running" || entry.status === "stopping";

/**
 * Tên nhiệm vụ đang chạy của MỘT dòng — `null` khi không có gì để nói thêm.
 *
 * Không có phép kiểm `entry.mine` nào ở đây, và chưa bao giờ có: ranh giới riêng tư sống
 * trọn trong service (xem queue.ts), nên giao diện chỉ vẽ đúng những gì được đưa. Nhờ vậy
 * ngày 08/08/2026 tông chủ muốn thấy tên nhiệm vụ của mọi người, tệp này không phải đổi một
 * dòng logic nào — mỗi chú thích này.
 *
 * Danh sách RỖNG mà vẫn đang chạy là một trạng thái thật, không phải thiếu dữ liệu: đó là
 * quãng khôi lỗi mở trình duyệt, qua cổng Cloudflare và dò hạng tài khoản — có thể tới vài
 * chục giây, và im lặng suốt quãng ấy trông y hệt một cái treo.
 */
function questPhrase(entry: QueueEntry): string | null {
  const progress = entry.progress;
  if (!progress || !isWorking(entry)) return null;
  return progress.running.length > 0 ? progress.running.join(" · ") : "đang chuẩn bị…";
}

export function QueueBoard({ initial }: { initial: QueueSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  /**
   * CHỈ nói về kênh SSE, không nói về việc dữ liệu có tới hay không. Nếu để lưới an toàn
   * cũng bật cờ này thì lúc kênh trực tiếp đã đứt mà poll vẫn chạy, màn hình sẽ khoe "trực
   * tiếp" — một lời nói dối nhỏ nhưng đúng vào thứ người dùng dựa vào để tin con số.
   */
  const [live, setLive] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/queue", { cache: "no-store" });
      if (response.ok) setSnapshot((await response.json()) as QueueSnapshot);
    } catch {
      // Mạng chớp tắt: giữ ảnh cũ, nhịp sau hoặc frame SSE kế tiếp sẽ bù vào.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/queue/stream");
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener("queue", (raw) => {
      try {
        setSnapshot(JSON.parse((raw as MessageEvent<string>).data) as QueueSnapshot);
        setLive(true);
      } catch {
        // Một frame hỏng không được phép giết kênh; frame kế tiếp vẫn là ảnh chụp đầy đủ.
      }
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), live ? POLL_LIVE_MS : POLL_FALLBACK_MS);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, live]);

  const { entries, running, waiting, sleeping } = snapshot;

  return (
    <section className="card card-hairline p-6 xl:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="h-display text-xl font-semibold text-gilded">Hàng Đợi Công Việc</h2>
          <p className="mt-1 text-sm text-[var(--color-mist)]">
            {running} đang chạy · {waiting} chờ tới lượt · {sleeping} đang nghỉ theo cooldown
          </p>
        </div>
        <span
          role="status"
          className={`text-[11px] ${live ? "text-[var(--color-jade-400)]" : "text-[var(--color-gold-300)]"}`}
        >
          {live ? "● Trực tiếp" : "↻ Đang nối lại…"}
        </span>
      </div>

      {/* Nói thẳng luật của hàng đợi, kẻo người dùng đếm số rồi tự suy ra sai. */}
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
        Thứ tự khôi lỗi tông môn sẽ nhặt việc: đàn nào tới giờ trước thì đi trước. Đàn đang nghỉ
        chưa xếp hàng — nó chỉ vào hàng khi hết cooldown. Ai đã cài khôi lỗi riêng thì không phải
        chờ hàng chung, vì khôi lỗi ấy chỉ làm việc ở máy nhà.
      </p>

      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--color-mist)]">
          Cả tông môn đang rảnh — chưa có đàn nào chờ hay chạy.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const quests = questPhrase(entry);
            const progress = entry.progress;

            return (
              <li
                key={entry.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm ${
                  entry.mine
                    ? "border-[var(--color-gold-400)]/40 bg-[var(--color-gold-400)]/5"
                    : "border-[var(--color-ink-600)]/60"
                }`}
              >
                <span className="w-7 text-center font-mono text-xs text-[var(--color-mist)]">
                  {entry.queuePosition ?? "–"}
                </span>
                <span className={`inline-block h-2 w-2 rounded-full ${statusDot(entry)}`} aria-hidden />

                <span className="font-semibold text-[var(--color-parchment)]">{entry.owner}</span>
                {entry.mine && <span className="badge badge-active">bạn</span>}
                {entry.accountLabel && (
                  <span className="text-[var(--color-gold-300)]">「{entry.accountLabel}」</span>
                )}

                <span className="text-[var(--color-mist)]">{describe(entry)}</span>

                {/* Tên nhiệm vụ đang chạy. `title` mang bản đầy đủ cho lúc ba nhiệm vụ song
                    song làm dòng dài quá khung — cắt chữ mà không còn đường đọc lại là đổi
                    một câu trả lời lấy một dấu ba chấm. */}
                {quests && (
                  <span
                    className="max-w-full truncate text-[var(--color-jade-300)]"
                    title={quests}
                  >
                    {quests}
                  </span>
                )}

                <span className="text-xs text-[var(--color-mist)]">vòng {entry.attempts}</span>

                {/* Con số đi cùng MỌI dòng — nó trả lời "cái ghế khôi lỗi kia còn bao lâu nữa
                    mới trống", câu hỏi mà một danh sách tên không trả lời thay được. */}
                {progress && progress.total > 0 && isWorking(entry) && (
                  <span className="text-xs text-[var(--color-mist)]">
                    {progress.done}/{progress.total} nhiệm vụ
                  </span>
                )}

                {entry.workerKind && (
                  <span className="ml-auto font-mono text-[11px] text-[var(--color-mist)]">
                    {entry.workerId ?? (entry.workerKind === "sect" ? "khôi lỗi tông môn" : "khôi lỗi riêng")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { STATUS_TEXT };
