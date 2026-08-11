import type { Notification } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { createNoticeListener, NOTICE_CHANNEL } from "@/lib/realtime/noticeChannel";
import { unseenNotices, type NoticeForUser } from "@/lib/services/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();

/**
 * Bốn phút rồi đóng, y như hai kênh sẵn có. Không phải để tiết kiệm — mà vì mọi tầng ở giữa
 * (Vercel, CDN, proxy công ty) đều có hạn riêng của chúng, và một kênh tự đóng đúng lúc thì
 * client biết mở lại; một kênh bị cắt ngang thì nó im lặng chết.
 */
const STREAM_LIFETIME_MS = 4 * 60 * 1000;
const KEEP_ALIVE_MS = 15_000;

function frame(notices: NoticeForUser[]): Uint8Array {
  return encoder.encode(`event: notice\ndata: ${JSON.stringify({ notices })}\n\n`);
}

/**
 * Kênh đánh thức cho THÔNG BÁO TÔNG MÔN.
 *
 * Gắn ở layout gốc nên nó sống trên MỌI trang — đó là toàn bộ lý do nó tồn tại: một lời nhắn
 * "phát lúc này" mà chỉ ai đang mở đúng trang Auto mới thấy thì không phải là thông báo.
 *
 * CÁI GIÁ, nói thẳng ra: mỗi tab đang mở giữ một session Postgres cho `LISTEN` (không đi qua
 * pooler được — xem realtimeDatabaseUrl). Ở cỡ tông môn hiện tại (26 đạo hữu) thì rẻ; ngày số
 * người mở đồng thời vượt hạn kết nối của Neon, chỗ phải đổi là ĐÂY — hạ xuống một nhịp hỏi
 * lại vài chục giây, hoặc gom mọi tín hiệu về một kênh dùng chung với dashboard.
 *
 * Payload của NOTIFY rỗng nghĩa: route tự hỏi database phần của CHÍNH người đang mở trang.
 * Nhờ vậy một tiếng gõ cửa phát cho cả tông môn không thể mang nội dung của người này sang
 * trang người kia.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const listener = createNoticeListener();
  try {
    await listener.connect();
    await listener.query(`listen ${NOTICE_CHANNEL}`);
  } catch (error) {
    console.error("notice stream: không mở được LISTEN", error);
    await listener.end().catch(() => undefined);
    return Response.json({ error: "realtime unavailable" }, { status: 503 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let reading = false;
  let queued = true;
  /** Chữ ký của lần đẩy gần nhất — chỉ đẩy khi danh sách THẬT SỰ đổi, kẻo mỗi tiếng gõ cửa
   *  cho cả tông môn lại làm popup của người không liên quan nháy một cái. */
  let signature = "";
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    if (lifetimeTimer) clearTimeout(lifetimeTimer);
    listener.removeAllListeners();
    try {
      controller?.close();
    } catch {
      // Trình duyệt đã đóng socket trước; stream cũng coi như xong.
    }
    await listener.end().catch(() => undefined);
  };

  const drain = async () => {
    if (reading || closed || !controller) return;
    reading = true;
    try {
      while (queued && !closed) {
        queued = false;
        const notices = await unseenNotices(user.id);
        const next = notices.map((notice) => notice.id).join(",");
        if (next !== signature) {
          signature = next;
          controller.enqueue(frame(notices));
        }
      }
    } catch (error) {
      console.error("notice stream: không đọc được thông báo", error);
      await close();
    } finally {
      reading = false;
      if (queued && !closed) void drain();
    }
  };

  const onNotification = (message: Notification) => {
    if (message.channel !== NOTICE_CHANNEL || closed) return;
    queued = true;
    void drain();
  };

  listener.on("notification", onNotification);
  listener.on("error", (error: Error) => {
    console.error("notice stream: LISTEN bị ngắt", error);
    void close();
  });
  request.signal.addEventListener("abort", () => void close(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      keepAliveTimer = setInterval(() => {
        if (!closed) controller?.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, KEEP_ALIVE_MS);
      lifetimeTimer = setTimeout(() => void close(), STREAM_LIFETIME_MS);
      void drain();
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
