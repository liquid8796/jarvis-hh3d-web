"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { forceStartJobAction, forceStopJobAction } from "@/app/actions/queue";
import type { QueueEntry, QueueSnapshot } from "@/lib/services/queue";
import type { WorkerState } from "@/lib/services/workers";
import type { JobStatus } from "@/lib/realtime/dashboardTypes";
import { describeAssignment } from "@/lib/validation/queueAssign";
import { PageSizeSelect, Pager, usePageSize, usePaged } from "@/components/Pager";

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
  /**
   * Số thứ tự phải đi kèm HÀNG CHỜ của nó, và phải im khi hàng ấy không có ai.
   *
   * Đàn giao riêng cho máy nhà không đứng chung hàng với ai — nói「thứ 1」cho nó là mời người
   * đọc tưởng đàn mình sắp tới lượt trong khi thứ duy nhất nhận được nó là máy ở nhà họ. Và
   * nếu máy ấy đang tắt thì con số kia sẽ đứng yên mãi mãi: đó mới là tin cần hiện, không phải
   * một cái thứ tự đẹp đẽ.
   */
  if (entry.queuePosition != null) {
    if (entry.queuePool === "own") {
      return entry.poolHasWorker
        ? `Chờ máy nhà · thứ ${entry.queuePosition}`
        : "Chờ máy nhà — chưa máy nào trực";
    }
    return entry.poolHasWorker
      ? `Chờ tới lượt · thứ ${entry.queuePosition}`
      : `Chờ tới lượt · thứ ${entry.queuePosition} — chưa khôi lỗi nào trực`;
  }

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

/**
 * TÊN KHÔI LỖI đang cầm một dòng đàn — hiện ở đuôi dòng, và CHỈ khi có máy thật đang cầm.
 *
 * Im ở dòng đang nghỉ theo cooldown, dòng đang xếp hàng, và dòng đã tắt: ba ca ấy chưa (hoặc
 * không còn) có tên nào để nói. Cột trạng thái đã kể phần chờ đợi rồi —「Đang nghỉ — tới lượt
 * lúc …」,「Chờ máy nhà · thứ 2」— nên nói lại ở đây là một chỗ thừa mang hình dạng lời hứa.
 *
 * Bản 0.91.0 từng cho dòng chưa ai cầm một nhãn dự đoán suy từ「Giao đàn cho」; tông chủ bác
 * ngay trong ngày. Luật hiện hành nằm ở `validation/queueAssign.ts` (thuần, `verify:queue-pools`
 * bao từng nhánh).
 *
 * KHÔNG hỏi quyền ở đây: `workerId` chỉ tới nơi này khi service đã quyết là người xem được
 * biết (xem `visibleWorkerId` trong queue.ts). Giao diện chỉ kể lại thứ được đưa.
 */
function assignmentOf(entry: QueueEntry) {
  return describeAssignment({
    workerKind: entry.workerKind,
    workerId: entry.workerId,
    finished: entry.status === "stopped" || entry.status === "failed",
  });
}

/** "vắng 12 phút" — mốc điểm danh chỉ đi xuống dây khi khôi lỗi đang vắng (xem workers.ts). */
function awayText(lastSeen: string | null): string {
  if (lastSeen == null) return "chưa từng điểm danh";
  const ms = Date.now() - new Date(lastSeen).getTime();
  return ms < 60_000 ? "vừa vắng" : `vắng ${formatDuration(ms)}`;
}

/**
 * Hình thức của ba trạng thái khôi lỗi — một bảng tra, không phải một chuỗi ba tầng `?:` trong JSX.
 *
 * Ba màu phải PHÂN BIỆT ĐƯỢC KHI KHÔNG CÓ MÀU, vì đó là ranh giới dễ hỏng nhất của một bảng trạng
 * thái: chấm ngọc CÓ NHỊP THỞ (rảnh — máy đang chờ việc), chấm vàng ĐỨNG YÊN (bận — đang cày), chấm
 * xám chìm (đã chết). Chuyển động và độ đậm gánh phần nghĩa, màu chỉ nhấn thêm.
 *
 * Vì sao「rảnh」lấy màu ngọc chứ không phải màu vàng: với người đọc trang này, một khôi lỗi rảnh là
 * tin TỐT — đàn của họ sẽ được nhặt ngay. Bận không phải lỗi, nhưng nó là thứ giải thích vì sao
 * hàng đợi chưa nhúc nhích, nên nó đeo màu「đang chờ」chứ không đeo màu「sẵn sàng」.
 */
const WORKER_LOOK: Record<WorkerState, { row: string; dot: string; text: string; label: string }> = {
  idle: {
    row: "border-[var(--color-jade-400)]/35 bg-[var(--color-jade-400)]/5",
    dot: "bg-[var(--color-jade-400)] pulse-jade",
    text: "text-[var(--color-jade-300)]",
    label: "đang rảnh",
  },
  busy: {
    row: "border-[var(--color-gold-400)]/35 bg-[var(--color-gold-400)]/5",
    dot: "bg-[var(--color-gold-400)]",
    text: "text-[var(--color-gold-300)]",
    label: "đang bận",
  },
  offline: {
    row: "border-[var(--color-ink-600)]/60",
    dot: "bg-[var(--color-ink-600)]",
    text: "text-[var(--color-mist)]",
    label: "đã chết",
  },
};

const TABS = [
  { id: "queue", label: "Hàng đợi" },
  { id: "stuck", label: "Đang kẹt" },
  { id: "workers", label: "Khôi lỗi" },
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

  const { entries, running, waiting, sleeping, stuck, workers } = snapshot;
  const stuckEntries = entries.filter((entry) => entry.stuckFor != null);
  const workersOnline = workers.filter((worker) => worker.state !== "offline").length;
  /**
   * Sổ khôi lỗi đi CHUNG ảnh chụp hàng đợi (xem `QueueSnapshot.workers`), nên nó tươi đúng
   * bằng ảnh chụp: mỗi khung SSE, mỗi nhịp hỏi lại. Một khôi lỗi vừa tắt có thể còn hiện
   *「đang trực」tới hết nhịp ấy — cửa sổ điểm danh vốn đã là 30 giây, nên đây không phải một
   * độ trễ mới, chỉ là cùng một độ trễ.
   */
  const hasOwnWorker = workers.some((worker) => worker.kind === "mine");

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
    const assignment = assignmentOf(entry);
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
        {(assignment || canStop(entry) || canStart(entry)) && (
          <span className="ml-auto flex items-center gap-2">
            {assignment && (
              <span
                title={assignment.title}
                className="font-mono text-[11px] text-[var(--color-mist)]"
              >
                {assignment.label}
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
        chờ hàng chung.
      </p>

      {/* Ô chọn số dòng đứng NGOÀI `role="tablist"`, không phải chuyện thẩm mỹ: một tablist chỉ
          được chứa tab, nhét thêm thứ khác vào là trình đọc màn hình đếm nhầm số tab và phím
          mũi tên (roving tabindex ở `onTabKeyDown`) có thể lạc vào một phần tử không phải tab.
          Nên bọc cả hai bằng một thanh, ai ở phần của nấy. */}
      <div className="queue-tabbar mb-4">
        <div
          role="tablist"
          aria-label="Cách xem hàng đợi"
          className="queue-tabs"
          onKeyDown={onTabKeyDown}
        >
          {TABS.map((item, index) => {
            const active = tab === item.id;
            // Tab Hàng đợi đếm đàn CÒN SỐNG, không đếm `entries.length`: mảng ấy nay mang thêm
            // cả dòng đã tắt còn nán lại, nên lấy độ dài của nó là để huy hiệu cãi nhau với
            // đúng dòng tóm tắt nằm ngay bên trên.
            const count =
              item.id === "stuck" ? stuck : item.id === "workers" ? workersOnline : running + waiting + sleeping;
            // Tab Khôi lỗi hiện huy hiệu KỂ CẢ khi bằng 0, ngược với hai tab kia: ở đây số 0
            // chính là tin đáng báo — không còn ai nhặt việc — nên giấu nó đi là giấu đúng cái
            // cần thấy. Hai tab kia thì 0 nghĩa là「không có gì để xem」, và một huy hiệu「0」
            // chỉ làm rối thanh tab.
            const showCount = item.id === "workers" || count > 0;
            const warn = item.id === "stuck" || (item.id === "workers" && count === 0);
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
                {showCount && (
                  <span className={`queue-tab-count ${warn ? "is-warn" : ""}`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* `pb-1.5` để ô chọn không đậu hẳn lên nét kẻ — hàng tab căn đáy, mà một ô nhập chạm
            đúng vào đường kẻ trông như bị dính. */}
        <span className="ml-auto pb-1.5">
          <PageSizeSelect perPage={perPage} onPerPage={setPerPage} unit="đàn" />
        </span>
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
              <Pager paged={queuePaged} unit="đàn" />
            </>
          )}
        </div>
      )}

      {tab === "stuck" && (
        <div role="tabpanel" id="queue-panel-stuck" aria-labelledby="queue-tab-stuck" tabIndex={0}>
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
            Đàn mà khôi lỗi <strong className="text-[var(--color-parchment)]">vẫn còn sống</strong> —
            nhịp tim đều — nhưng tiến độ không nhích một nấc nào suốt hơn 45 phút. Khôi lỗi mất
            liên lạc thì đã có phép dọn tự động lo, không hiện ở đây.
          </p>

          {stuckEntries.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-jade-300)]">
              Không có đàn nào kẹt — mọi khôi lỗi đang tiến việc bình thường.
            </p>
          ) : (
            <>
              <ul className="space-y-2">{stuckPaged.items.map(renderRow)}</ul>
              <Pager paged={stuckPaged} unit="đàn" />
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
      {/**
       * Tab KHÔI LỖI — "còn ai nhặt việc không".
       *
       * Đứng cạnh hàng đợi vì hai câu hỏi dính vào nhau: một hàng dài mười đàn nghĩa hoàn toàn
       * khác nhau tuỳ khôi lỗi đang trực hay đã tắt, mà trước bản này trang chỉ trả lời được vế
       * đầu. Ai đọc「11 đang nghỉ」lúc cả tông môn đứng im thì không có cách nào biết đó là
       * cooldown hay là không còn ai làm việc.
       *
       * Từ 19/08/2026 MỌI đạo hữu nhận từng tiến trình tông môn một, kèm id và số bản (xem
       * `getWorkerRoster`); dòng GỘP chỉ còn xuất hiện khi sổ chưa có khôi lỗi tông môn nào.
       * Khôi lỗi RIÊNG thì vẫn chỉ của chính người xem. Ở đây không có phép hỏi quyền nào —
       * service đã cắt xong, giao diện chỉ vẽ đúng thứ được đưa.
       */}
      {tab === "workers" && (
        <div role="tabpanel" id="queue-panel-workers" aria-labelledby="queue-tab-workers" tabIndex={0}>
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
            Ai đang trực để nhặt việc.{" "}
            <strong className="text-[var(--color-parchment)]">Khôi lỗi tông môn</strong> là của
            chung — nó nhặt đàn của mọi người theo đúng thứ tự ở tab Hàng đợi, nên nó vắng thì cả
            hàng đứng im.{" "}
            <strong className="text-[var(--color-parchment)]">Khôi lỗi riêng</strong> chỉ chạy ở
            máy nhà, không cần xếp hàng chờ ở hàng đợi.
          </p>
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
            <span className="text-[var(--color-jade-300)]">đang rảnh</span> — còn sống mà chưa cầm
            đàn nào, đàn tới là nhặt ngay.{" "}
            <span className="text-[var(--color-gold-300)]">đang bận</span> — đang phục vụ ít nhất
            một đàn; nó vẫn nhận thêm nếu còn ghế trống.{" "}
            <span className="text-[var(--color-parchment)]">đã chết</span> — quá 30 giây không gửi
            tín hiệu cho server, cửa phát việc đã gạch tên nó.
          </p>

          <ul className="space-y-2">
            {workers.map((worker) => {
              const look = WORKER_LOOK[worker.state];
              return (
              <li
                key={`${worker.kind}:${worker.id ?? "gop"}`}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-sm ${look.row}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${look.dot}`} aria-hidden />
                <span className="font-semibold text-[var(--color-parchment)]">
                  {worker.kind === "sect" ? "Khôi lỗi tông môn" : "Khôi lỗi riêng"}
                </span>
                {worker.kind === "mine" && <span className="badge badge-active">của bạn</span>}
                {/* Vắng id chỉ còn một nghĩa: đây là dòng gộp của một sổ tông môn rỗng. */}
                {worker.id && (
                  <span className="font-mono text-[11px] text-[var(--color-mist)]">{worker.id}</span>
                )}
                <span className={look.text}>
                  {look.label}
                  {/* Đã chết thì kể thêm VẮNG TỪ BAO GIỜ: nhãn trả lời「còn sống không」, con số
                      trả lời「chết lâu chưa」— vừa tắt một phút và tắt từ hôm qua là hai tình
                      cảnh khác hẳn nhau, và chỉ con số ấy phân biệt được. */}
                  {worker.state === "offline" && (
                    <span className="text-[var(--color-mist)]"> · {awayText(worker.lastSeen)}</span>
                  )}
                </span>
                {/* Số bản chỉ đi kèm dòng có id: dòng GỘP không kể bản của ai cả, mà `null` ở
                    đó nghĩa là「không được cho biết」chứ không phải「bản cũ」— hai điều khác hẳn
                    nhau, và nói nhầm sẽ giục người ta đi cài lại một thứ vốn đang đúng. */}
                {worker.id && (
                  <span className="ml-auto font-mono text-[11px] text-[var(--color-mist)]">
                    {worker.version ? `bản ${worker.version}` : "bản cũ — chưa khai số"}
                  </span>
                )}
              </li>
              );
            })}
          </ul>

          {!hasOwnWorker && (
            <p className="mt-4 text-xs leading-relaxed text-[var(--color-mist)]">
              Đạo hữu chưa nuôi khôi lỗi riêng nào — đàn của mình đang trông cả vào khôi lỗi tông
              môn. Muốn lượt chạy đi từ máy nhà thì vào trang <strong className="text-[var(--color-parchment)]">Auto</strong>, mục
              Khôi Lỗi.
            </p>
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
