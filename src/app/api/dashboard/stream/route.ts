import type { Notification } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import {
  createDashboardListener,
  DASHBOARD_CHANNEL,
  parseDashboardSignal,
} from "@/lib/realtime/dashboardChannel";
import type { DashboardLivePayload } from "@/lib/realtime/dashboardTypes";
import { getDashboardFeed } from "@/lib/services/dashboard";
import { JOB_EVENT_PAGE_SIZE, reapStaleJobs } from "@/lib/services/jobs";
import { ONLINE_WINDOW_MS } from "@/lib/services/workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();
const STREAM_LIFETIME_MS = 4 * 60 * 1000;
const KEEP_ALIVE_MS = 15_000;

function cursorFrom(request: NextRequest): number {
  const query = Number(request.nextUrl.searchParams.get("after") ?? 0);
  const resumed = Number(request.headers.get("last-event-id") ?? 0);
  return Math.max(
    Number.isSafeInteger(query) && query > 0 ? query : 0,
    Number.isSafeInteger(resumed) && resumed > 0 ? resumed : 0,
  );
}

function frame(payload: DashboardLivePayload, eventId: number): Uint8Array {
  const id = eventId > 0 ? `id: ${eventId}\n` : "";
  return encoder.encode(`${id}event: dashboard\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** Bỏ lastSeen đang-online khỏi chữ ký: heartbeat vẫn dời hạn vắng nhưng không cần vẽ lại UI. */
function visibleSignature(payload: DashboardLivePayload): string {
  return JSON.stringify({
    jobs: payload.jobs,
    accounts: payload.accounts,
    presence: {
      sectOnline: payload.presence.sectOnline,
      // Số bản NẰM TRONG chữ ký: nó đổi hiếm, nhưng đúng lúc nó đổi là lúc người dùng vừa cài
      // lại — và một dòng vẫn báo「bản cũ」sau khi họ vừa làm đúng lời nhắc thì còn tệ hơn không
      // nhắc. Cùng lẽ ấy cho `webVersion`: một lượt chuyển trạm có thể đổi nó mà không đổi gì khác.
      webVersion: payload.presence.webVersion,
      mine: payload.presence.mine.map((worker) => ({
        id: worker.id,
        online: worker.online,
        lastSeen: worker.online ? null : worker.lastSeen,
        version: worker.version,
      })),
    },
  });
}

function nextPresenceExpiry(payload: DashboardLivePayload): number | null {
  const expiries: number[] = [];
  if (payload.presence.sectOnline && payload.presence.sectLastSeen) {
    expiries.push(new Date(payload.presence.sectLastSeen).getTime() + ONLINE_WINDOW_MS);
  }
  for (const worker of payload.presence.mine) {
    if (worker.online) expiries.push(new Date(worker.lastSeen).getTime() + ONLINE_WINDOW_MS);
  }
  const valid = expiries.filter(Number.isFinite);
  return valid.length > 0 ? Math.min(...valid) : null;
}

/**
 * Một kết nối SSE cho toàn Auto. PostgreSQL đánh thức route bằng LISTEN/NOTIFY đúng lúc
 * job, log hoặc sổ khôi lỗi đổi; route chỉ đọc snapshot khi có tín hiệu, không poll DB liên tục.
 */
export async function GET(request: NextRequest) {
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
    console.error("dashboard stream: không mở được LISTEN", error);
    await listener.end().catch(() => undefined);
    return Response.json({ error: "realtime unavailable" }, { status: 503 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let refreshing = false;
  let refreshQueued = true;
  let forceQueued = true;
  let resetQueued = false;
  let cursor = cursorFrom(request);
  let signature = "";
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    if (lifetimeTimer) clearTimeout(lifetimeTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    listener.removeAllListeners();
    try {
      controller?.close();
    } catch {
      // Trình duyệt đã đóng socket trước; stream cũng coi như xong.
    }
    await listener.end().catch(() => undefined);
  };

  const queueRefresh = (options: { force?: boolean; resetEvents?: boolean } = {}) => {
    if (closed) return;
    refreshQueued = true;
    forceQueued ||= options.force === true;
    resetQueued ||= options.resetEvents === true;
    if (!refreshing) void drainRefreshes();
  };

  const scheduleExpiry = (payload: DashboardLivePayload) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const at = nextPresenceExpiry(payload);
    if (at == null) return;
    expiryTimer = setTimeout(
      () => queueRefresh({ force: true }),
      Math.max(250, at - Date.now() + 100),
    );
  };

  const drainRefreshes = async () => {
    if (refreshing || closed || !controller) return;
    refreshing = true;
    try {
      while (refreshQueued && !closed) {
        refreshQueued = false;
        const force = forceQueued;
        const resetEvents = resetQueued;
        forceQueued = false;
        resetQueued = false;

        const payload = await getDashboardFeed(user.id, cursor);
        // Feed đọc lùi JOB_EVENT_REPLAY_MARGIN dưới con trỏ để vớt dòng commit muộn; "mới"
        // với stream này nghĩa là id vượt con trỏ — những dòng biên chỉ là hàng khử-trùng
        // cho client, không được phép tự mình kích một frame.
        const freshEvents = payload.events.filter((event) => event.id > cursor).length;
        if (payload.events.length > 0) {
          cursor = Math.max(cursor, payload.events[payload.events.length - 1].id);
        }
        // Mở một job lâu ngày có thể còn hơn một trang log. Kéo tiếp ngay, không chờ một
        // NOTIFY mới hoặc nhịp fallback 30 giây mới thấy phần đuôi.
        if (payload.events.length === JOB_EVENT_PAGE_SIZE) refreshQueued = true;
        scheduleExpiry(payload);

        const nextSignature = visibleSignature(payload);
        if (force || resetEvents || freshEvents > 0 || nextSignature !== signature) {
          signature = nextSignature;
          controller.enqueue(frame({ ...payload, resetEvents: resetEvents || undefined }, cursor));
        }
      }
    } catch (error) {
      console.error("dashboard stream: không đọc được snapshot", error);
      await close();
    } finally {
      refreshing = false;
      if (refreshQueued && !closed) void drainRefreshes();
    }
  };

  const onNotification = (message: Notification) => {
    if (message.channel !== DASHBOARD_CHANNEL) return;
    const signal = parseDashboardSignal(message.payload);
    if (!signal || (signal.userId !== "*" && signal.userId !== user.id)) return;
    queueRefresh({ resetEvents: signal.topic === "events-cleared" });
  };

  const onListenerError = (error: Error) => {
    console.error("dashboard stream: LISTEN bị ngắt", error);
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
      queueRefresh({ force: true });
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
