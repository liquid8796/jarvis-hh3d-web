"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { forceStartJobAction, forceStopJobAction } from "@/app/actions/queue";
import type { QueueEntry, QueueSnapshot } from "@/lib/services/queue";
import type { JobStatus } from "@/lib/realtime/dashboardTypes";
import { Pager, usePageSize, usePaged } from "@/components/Pager";

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

/** Khoá riêng của bảng này trong localStorage — sổ môn đồ có khoá của nó, hai bên không giẫm nhau. */
const QUEUE_PAGE_SIZE_KEY = "jarvis:queue:per-page";

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

/** Dòng đã tắt hẳn — còn nằm trên bảng một lúc chỉ để có chỗ bấm Bắt Đầu. */
const isFinished = (entry: QueueEntry) => entry.status === "stopped" || entry.status === "failed";

function statusDot(entry: QueueEntry): string {
  if (entry.status === "running") return "bg-[var(--color-jade-400)] pulse-jade";
  if (entry.status === "stopping") return "bg-[var(--color-gold-300)]";
  if (entry.status === "failed") return "bg-[#c96a6a]";
  if (entry.status === "stopped") return "bg-[var(--color-ink-600)]";
  return entry.queuePosition == null ? "bg-[var(--color-ink-600)]" : "bg-[var(--color-gold-400)]";
}

/**
 * Hai nhánh `stopped`/`failed` KHÔNG được quên, và đây là chỗ dễ quên nhất: trước khi bảng
 * giữ lại dòng đã tắt, mọi trạng thái không phải running/stopping/queued đều rơi xuống nhánh
 * cuối và được kể là "Đang nghỉ — tới lượt lúc…". Với một đàn đã dừng hẳn thì câu ấy là một
 * lời hứa sai: nó sẽ không tới lượt nào cả.
 */
function describe(entry: QueueEntry): string {
  if (entry.status === "running") return "Đang chạy";
  if (entry.status === "stopping") return "Đang thu đàn";
  if (entry.status === "failed") return "Trắc trở — đã dừng";
  if (entry.status === "stopped") return "Đã thu đàn";
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
 * "1 giờ 12 phút" chứ không phải "72 phút" — con số này để một người ước lượng mức độ nghiêm
 * trọng trong một giây, và giờ/phút đọc nhanh hơn một số phút lớn. Dưới một phút thì nói
 * "vừa xong" thay vì "0 phút", dù ngưỡng kẹt 45 phút khiến ca ấy không xảy ra ở tab này —
 * hàm định dạng không nên phụ thuộc vào ngưỡng của người gọi.
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "vừa xong";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} phút`;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
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

const TABS = [
  { id: "queue", label: "Hàng đợi" },
  { id: "stuck", label: "Đang kẹt" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function QueueBoard({
  initial,
  canForceStop,
  canForceStart,
}: {
  initial: QueueSnapshot;
  canForceStop: boolean;
  canForceStart: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<TabId>("queue");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /**
   * Lời báo của lần dừng gần nhất. MỘT chỗ duy nhất cho cả bảng, không phải mỗi dòng một chỗ:
   * người ta bấm dừng xong thì dòng ấy đổi trạng thái ngay (hoặc biến mất khỏi hàng đợi), nên
   * một lời báo neo vào dòng sẽ trôi mất cùng với dòng.
   */
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  /**
   * Lệnh đang bay — MỘT ô cho cả Dừng lẫn Bắt Đầu, không phải hai state song song.
   *
   * Hai ô riêng thì mỗi nút chỉ tự khoá chính mình, và người sốt ruột bấm Bắt Đầu ở dòng dưới
   * trong lúc lệnh Dừng chưa về. Một ô chung khoá cả bảng cho tới khi có câu trả lời: cả hai
   * hành động đều đổi hàng đợi, và bảng đang cầm một ảnh chụp đã cũ thì mọi nút trên nó đều
   * đang nói về một thế giới sắp không còn đúng.
   */
  const [pending, setPending] = useState<{ id: string; kind: "stop" | "start" } | null>(null);
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

  /**
   * Dòng này còn dừng được không.
   *
   * `stopping` KHÔNG có nút, và đó là chủ ý: lệnh đã gửi rồi, khôi lỗi đang thu ở điểm an
   * toàn. Vẽ thêm một cái nút cho nó là mời người ta bấm lại vì sốt ruột, rồi nhận một câu
   * "đã nhận lệnh từ trước" — một cái nút chỉ để bị từ chối thì thà đừng có.
   */
  const canStop = (entry: QueueEntry) =>
    canForceStop && (entry.status === "queued" || entry.status === "running");

  /**
   * Nút Bắt Đầu chỉ sáng khi đàn ĐÃ TẮT HẲN và còn khai lại được — `restartable` do server
   * quyết (xem queue.ts), vì nó cần biết tài khoản còn sống và đang bật, hai điều client
   * không được phép biết về người khác.
   *
   * Không có nút Bắt Đầu cho dòng `stopping`: lệnh dừng còn đang trên đường, khai lại lúc ấy
   * chỉ để nhận về "đàn này đang chạy rồi". Chờ nó tắt hẳn rồi nút tự hiện.
   */
  const canStart = (entry: QueueEntry) => canForceStart && entry.restartable;

  /**
   * Dừng một đàn. Hỏi lại trước khi làm — đây là việc đụng vào lượt chạy của NGƯỜI KHÁC, và
   * họ sẽ mất phần việc còn dở của vòng này.
   *
   * `refresh()` sau khi xong dù server đã đánh thức kênh SSE: tín hiệu ấy đi qua Postgres rồi
   * vòng lại, còn người vừa bấm thì đang nhìn chằm chằm vào cái dòng ấy. Một lượt hỏi thẳng
   * cho họ câu trả lời ngay, và nếu kênh có tới sau thì nó chỉ vẽ lại đúng thứ đã vẽ.
   */
  const stop = async (entry: QueueEntry) => {
    const who = entry.mine ? "đàn của chính mình" : `đàn của ${entry.owner}`;
    if (!window.confirm(`Dừng ${who}? Vòng đang chạy sẽ không hoàn tất.`)) return;

    setPending({ id: entry.id, kind: "stop" });
    setNotice(null);
    try {
      const result = await forceStopJobAction(entry.id);
      setNotice(result);
    } catch {
      // Server action ngã (mạng chớp, deploy giữa chừng): nói ra chứ không im lặng, vì người
      // dùng vừa bấm một nút và cần biết nó có ăn hay không.
      setNotice({ ok: false, message: "Không gửi được lệnh dừng — thử lại sau một nhịp." });
    } finally {
      setPending(null);
      await refresh();
    }
  };

  /**
   * Khai đàn hộ. Cũng hỏi lại như lúc dừng, và cũng vì cùng một lý do: đây là bắt máy của
   * người khác chạy. Nhẹ tay hơn lệnh dừng thật, nhưng "nhẹ hơn" không có nghĩa là "không cần
   * hỏi" — chủ nhân có thể vừa cố ý dừng nó xong.
   */
  const start = async (entry: QueueEntry) => {
    const who = entry.mine ? "đàn của chính mình" : `đàn của ${entry.owner}`;
    if (!window.confirm(`Khai lại ${who}? Đàn mới sẽ vào hàng chờ ngay.`)) return;

    setPending({ id: entry.id, kind: "start" });
    setNotice(null);
    try {
      const result = await forceStartJobAction(entry.id);
      setNotice(result);
    } catch {
      setNotice({ ok: false, message: "Không gửi được lệnh khai đàn — thử lại sau một nhịp." });
    } finally {
      setPending(null);
      await refresh();
    }
  };

  /**
   * Điều hướng tab bằng phím mũi tên — bắt buộc với `role="tablist"`, vì một tablist chỉ nghe
   * chuột là một tablist nói dối trình đọc màn hình về cách dùng nó. Roving tabIndex đi kèm:
   * chỉ tab đang chọn nằm trong vòng Tab, còn lại nhường cho mũi tên.
   */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex((item) => item.id === tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;

    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

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

  const { entries, running, waiting, sleeping, stuck } = snapshot;
  const stuckEntries = entries.filter((entry) => entry.stuckFor != null);

  /**
   * MỘT mức số dòng cho cả hai tab, nhưng HAI số trang riêng.
   *
   * Chung mức vì đó là một thói quen xem, không phải thuộc tính của từng tab — chọn 50 ở Hàng
   * đợi rồi sang Đang kẹt thấy 20 là một bất ngờ không ai xin. Riêng số trang vì hai tab dài
   * ngắn khác hẳn nhau: đang đọc trang 3 của hàng đợi mà nhảy sang tab kẹt (thường chỉ vài
   * dòng) thì trang 3 ở đó là trang trống.
   *
   * Cả hai hook gọi VÔ ĐIỀU KIỆN ở đây chứ không đặt trong nhánh `tab === …`: hook không được
   * phép nằm sau một cái if, và giữ cả hai sống cũng chính là thứ giữ được số trang của tab
   * kia khi người dùng liếc qua rồi quay lại.
   */
  const [perPage, setPerPage] = usePageSize(QUEUE_PAGE_SIZE_KEY);
  const queuePaged = usePaged(entries, perPage);
  const stuckPaged = usePaged(stuckEntries, perPage);

  /**
   * Một dòng, dùng cho CẢ HAI tab.
   *
   * Tab Đang Kẹt là một lát cắt của cùng bộ dữ liệu, không phải một bảng khác — nên nó phải
   * là cùng một khuôn vẽ. Chép đôi khối JSX này là hẹn trước ngày hai tab lệch nhau: ai đó
   * sửa nút ở tab trên, quên tab dưới, và người trực ca đêm nhìn hai màn hình nói hai chuyện.
   */
  const renderRow = (entry: QueueEntry) => {
    const quests = questPhrase(entry);
    const progress = entry.progress;
    const busy = pending !== null;

    return (
      <li
        key={entry.id}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm ${
          entry.stuckFor != null
            ? "border-[#c96a6a]/45 bg-[#c96a6a]/5"
            : entry.mine
              ? "border-[var(--color-gold-400)]/40 bg-[var(--color-gold-400)]/5"
              : isFinished(entry)
                ? "border-[var(--color-ink-600)]/40 bg-[var(--color-ink-600)]/20"
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

        {/* Tên nhiệm vụ đang chạy. `title` mang bản đầy đủ cho lúc ba nhiệm vụ song song làm
            dòng dài quá khung — cắt chữ mà không còn đường đọc lại là đổi một câu trả lời lấy
            một dấu ba chấm. */}
        {quests && (
          <span className="max-w-full truncate text-[var(--color-jade-300)]" title={quests}>
            {quests}
          </span>
        )}

        {/* Huy hiệu kẹt hiện ở CẢ hai tab, không riêng tab Đang Kẹt: người mở Hàng Đợi vì việc
            khác cũng cần đập vào mắt cái đang hỏng, chứ không phải chỉ ai nhớ bấm sang tab. */}
        {entry.stuckFor != null && (
          <span className="badge badge-pending" title="Tiến độ không nhích suốt quãng này">
            kẹt {formatDuration(entry.stuckFor)}
          </span>
        )}

        <span className="text-xs text-[var(--color-mist)]">vòng {entry.attempts}</span>

        {/* Con số đi cùng MỌI dòng — nó trả lời "cái ghế khôi lỗi kia còn bao lâu nữa mới
            trống", câu hỏi mà một danh sách tên không trả lời thay được. */}
        {progress && progress.total > 0 && isWorking(entry) && (
          <span className="text-xs text-[var(--color-mist)]">
            {progress.done}/{progress.total} nhiệm vụ
          </span>
        )}

        {/* Cụm đuôi dòng gom làm MỘT và tự đẩy sang phải. Trước đây nhãn khôi lỗi tự mang
            `ml-auto`, nhưng dòng đang xếp hàng thì chưa có khôi lỗi nào — nút Dừng sẽ dính vào
            giữa dòng. Gom lại thì mọi ca đều thẳng mép phải. */}
        {(entry.workerKind || canStop(entry) || canStart(entry)) && (
          <span className="ml-auto flex items-center gap-2">
            {entry.workerKind && (
              <span className="font-mono text-[11px] text-[var(--color-mist)]">
                {entry.workerId ?? (entry.workerKind === "sect" ? "khôi lỗi tông môn" : "khôi lỗi riêng")}
              </span>
            )}
            {canStop(entry) && (
              <button
                type="button"
                className="btn btn-danger px-2.5 py-1 text-xs"
                disabled={busy}
                onClick={() => void stop(entry)}
              >
                {pending?.id === entry.id && pending.kind === "stop" ? "Đang dừng…" : "Dừng"}
              </button>
            )}
            {canStart(entry) && (
              <button
                type="button"
                className="btn btn-gold px-2.5 py-1 text-xs"
                disabled={busy}
                onClick={() => void start(entry)}
              >
                {pending?.id === entry.id && pending.kind === "start" ? "Đang khai…" : "Bắt Đầu"}
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

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

      <div
        role="tablist"
        aria-label="Cách xem hàng đợi"
        className="queue-tabs mb-4"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((item, index) => {
          const active = tab === item.id;
          // Tab Hàng đợi đếm đàn CÒN SỐNG, không đếm `entries.length`: mảng ấy nay mang thêm
          // cả dòng đã tắt còn nán lại, nên lấy độ dài của nó là để huy hiệu cãi nhau với
          // đúng dòng tóm tắt nằm ngay bên trên.
          const count = item.id === "stuck" ? stuck : running + waiting + sleeping;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`queue-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`queue-panel-${item.id}`}
              /* Roving tabIndex: chỉ tab đang chọn nằm trong vòng Tab, phần còn lại đi bằng
                 phím mũi tên — đúng khuôn tablist mà trình đọc màn hình chờ đợi. */
              tabIndex={active ? 0 : -1}
              className={active ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {count > 0 && (
                <span className={`queue-tab-count ${item.id === "stuck" ? "is-warn" : ""}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "queue" && (
        <div role="tabpanel" id="queue-panel-queue" aria-labelledby="queue-tab-queue" tabIndex={0}>
          {entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-mist)]">
              Cả tông môn đang rảnh — chưa có đàn nào chờ hay chạy.
            </p>
          ) : (
            <>
              <ul className="space-y-2">{queuePaged.items.map(renderRow)}</ul>
              <Pager paged={queuePaged} perPage={perPage} onPerPage={setPerPage} unit="đàn" />
            </>
          )}
        </div>
      )}

      {tab === "stuck" && (
        <div role="tabpanel" id="queue-panel-stuck" aria-labelledby="queue-tab-stuck" tabIndex={0}>
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
            Đàn mà khôi lỗi <strong className="text-[var(--color-parchment)]">vẫn còn sống</strong> —
            nhịp tim đều — nhưng tiến độ không nhích một nấc nào suốt hơn 45 phút. Khôi lỗi mất
            liên lạc thì đã có phép dọn tự động lo, không hiện ở đây. Ngưỡng 45 phút cố ý dài hơn
            một ván Mê Cung chạy đúng luật (~35 phút) để đàn khoẻ không bị réo nhầm.
          </p>

          {stuckEntries.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-jade-300)]">
              Không có đàn nào kẹt — mọi khôi lỗi đang tiến việc bình thường.
            </p>
          ) : (
            <>
              <ul className="space-y-2">{stuckPaged.items.map(renderRow)}</ul>
              <Pager paged={stuckPaged} perPage={perPage} onPerPage={setPerPage} unit="đàn" />
              <p className="mt-4 text-xs leading-relaxed text-[var(--color-mist)]">
                Cách gỡ: bấm <strong className="text-[var(--color-parchment)]">Dừng</strong> rồi đợi
                dòng chuyển sang「Đã thu đàn」— khôi lỗi thu ở điểm an toàn nên có thể mất một lúc —
                sau đó nút <strong className="text-[var(--color-parchment)]">Bắt Đầu</strong> hiện ra
                ở chính dòng ấy.
              </p>
            </>
          )}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className={`mt-4 text-sm ${notice.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
        >
          {notice.message}
        </p>
      )}
    </section>
  );
}

export { STATUS_TEXT };
