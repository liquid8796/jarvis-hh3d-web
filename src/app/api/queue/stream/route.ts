import type { Notification } from "pg";
import { currentUser } from "@/lib/auth/guards";
import {
  createDashboardListener,
  DASHBOARD_CHANNEL,
  parseDashboardSignal,
} from "@/lib/realtime/dashboardChannel";
import { reapStaleJobs } from "@/lib/services/jobs";
import { getQueueSnapshot, type QueueSnapshot } from "@/lib/services/queue";

/**
 * Đường sống của trang Hàng Đợi Công Việc.
 *
 * Vì sao có route riêng thay vì dùng lại `/api/dashboard/stream`: kênh kia chỉ vẽ lại khi
 * tín hiệu mang ĐÚNG userId của người nghe, còn hàng đợi thì đàn của bất kỳ ai đổi cũng làm
 * thứ tự của mọi người đổi theo. Nới cái lọc ấy ra là biến một kênh riêng tư thành kênh
 * chung — một lỗi lọc sai ở đó sẽ rò dữ liệu người khác. Hai route tách bạch: kênh kia giữ
 * nguyên luật riêng tư của nó, kênh này tự dựng payload ĐÃ CHE TÊN cho từng người nghe.
 *
 * Hai nguồn đánh thức, vì hàng đợi đổi theo hai cách khác nhau:
 *   1. NOTIFY từ Postgres — job sinh ra, đổi trạng thái, đổi giờ chạy, đổi khôi lỗi.
 *   2. ĐỒNG HỒ — một đàn đang nghỉ tự vào hàng đúng lúc `next_run_at` trôi qua, không có
 *      thay đổi nào trong database để mà báo. Thiếu nhánh này thì số thứ tự đứng im cho tới
 *      khi tình cờ có ai đó làm gì khác.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();
const STREAM_LIFETIME_MS = 4 * 60 * 1000;
const KEEP_ALIVE_MS = 15_000;

/**
 * Chỉ hai chủ đề làm hàng đợi đổi. Bỏ qua `event` là có chủ ý: mỗi dòng nhật ký của mọi
 * khôi lỗi đều phát một tín hiệu, mà nhật ký không hề xuất hiện trên trang này — nghe nó là
 * tự bắt mình đọc lại database hàng chục lần mỗi vòng chạy để rồi không vẽ gì khác.
 */
const QUEUE_TOPICS = new Set(["job", "config"]);

function frame(payload: QueueSnapshot): Uint8Array {
  return encoder.encode(`event: queue\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Lúc nào một đàn đang NGHỈ sẽ vào hàng. Trả về mốc gần nhất trong tương lai, hoặc null khi
 * không có ai đang ngủ.
 */
function nextDueAt(payload: QueueSnapshot): number | null {
  const now = Date.now();
  const due = payload.entries
    .filter((entry) => entry.status === "queued" && entry.queuePosition == null)
    .map((entry) => new Date(entry.nextRunAt).getTime())
    .filter((at) => Number.isFinite(at) && at > now);
  return due.length > 0 ? Math.min(...due) : null;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();

  const listener = createDashboardListener();
  try {
    await listener.connect();
    await listener.query(`listen ${DASHBOARD_CHANNEL}`);
  } catch (error) {
    console.error("queue stream: không mở được LISTEN", error);
    await listener.end().catch(() => undefined);
    return Response.json({ error: "realtime unavailable" }, { status: 503 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let refreshing = false;
  let refreshQueued = true;
  let forceQueued = true;
  let signature = "";
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let dueTimer: ReturnType<typeof setTimeout> | null = null;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    if (lifetimeTimer) clearTimeout(lifetimeTimer);
    if (dueTimer) clearTimeout(dueTimer);
    listener.removeAllListeners();
    try {
      controller?.close();
    } catch {
      // Trình duyệt đã đóng socket trước; stream cũng coi như xong.
    }
    await listener.end().catch(() => undefined);
  };

  const queueRefresh = (force = false) => {
    if (closed) return;
    refreshQueued = true;
    forceQueued ||= force;
    if (!refreshing) void drainRefreshes();
  };

  const scheduleDue = (payload: QueueSnapshot) => {
    if (dueTimer) clearTimeout(dueTimer);
    const at = nextDueAt(payload);
    if (at == null) return;
    // +150ms để chắc chắn đứng SAU mốc, không phải ngay trên nó — đọc sớm một nhịp là đọc ra
    // đúng trạng thái cũ rồi ngồi im.
    dueTimer = setTimeout(() => queueRefresh(), Math.max(250, at - Date.now() + 150));
  };

  const drainRefreshes = async () => {
    if (refreshing || closed || !controller) return;
    refreshing = true;
    try {
      while (refreshQueued && !closed) {
        refreshQueued = false;
        const force = forceQueued;
        forceQueued = false;

        const payload = await getQueueSnapshot(user);
        scheduleDue(payload);

        // Ảnh chụp nhỏ (vài chục dòng) nên so nguyên văn là đủ và không có chỗ cho một
        // trường bị quên như khi tự viết hàm chữ ký.
        const next = JSON.stringify(payload);
        if (force || next !== signature) {
          signature = next;
          controller.enqueue(frame(payload));
        }
      }
    } catch (error) {
      console.error("queue stream: không đọc được hàng đợi", error);
      await close();
    } finally {
      refreshing = false;
      if (refreshQueued && !closed) void drainRefreshes();
    }
  };

  const onNotification = (message: Notification) => {
    if (message.channel !== DASHBOARD_CHANNEL) return;
    const signal = parseDashboardSignal(message.payload);
    // KHÔNG lọc theo userId: đàn của người khác cũng là hàng đợi của mình.
    if (!signal || !QUEUE_TOPICS.has(signal.topic)) return;
    queueRefresh();
  };

  const onListenerError = (error: Error) => {
    console.error("queue stream: LISTEN bị ngắt", error);
    void close();
  };

  listener.on("notification", onNotification);
  listener.on("error", onListenerError);
  request.signal.addEventListener("abort", () => void close(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      keepAliveTimer = setInterval(() => {
        if (!closed) controller?.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, KEEP_ALIVE_MS);
      lifetimeTimer = setTimeout(() => void close(), STREAM_LIFETIME_MS);
      queueRefresh(true);
    },
    cancel() {
      void close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
