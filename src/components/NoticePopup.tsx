"use client";

import { useCallback, useEffect, useState } from "react";
import { acknowledgeNoticeAction } from "@/app/actions/notices";

/**
 * Popup THÔNG BÁO TÔNG MÔN — hiện ngay lúc bậc trị sự phát, trên bất kỳ trang nào người dùng
 * đang đứng.
 *
 * Gắn ở layout gốc, tức nó có mặt cả ở trang đăng nhập nơi chẳng có ai để mà nhắn. Cách nó
 * biết mà nằm im: hỏi `/api/notice` một lần: 401 thì thôi hẳn, không mở kênh, không hỏi lại.
 * Chọn đường này thay vì để layout (server) tự đọc phiên rồi truyền xuống một cờ, vì lượt đọc
 * ấy tốn thêm MỘT lượt hỏi database cho MỌI trang — kể cả những trang không cần biết người
 * xem là ai. Cái giá đổi lại: khách vãng lai tốn đúng một request 401 mỗi lần tải trang.
 *
 * Hai nguồn tin, cố ý:
 *   • một lượt `fetch` lúc mở trang — đường CHẮC CHẮN, vớt lại lời nhắn phát lúc mình offline;
 *   • rồi `EventSource` — đường NHANH, cho đúng cái "ngay tại thời điểm phát".
 * Kênh chết thì tính năng chỉ mất độ tức thì. Trình duyệt tự nối lại EventSource (`retry` do
 * server gửi), nên ở đây không có vòng thử lại tự viết nào cả.
 */

/** Hàng đợi lời nhắn: hiện từng cái một, cũ nhất trước — đúng thứ tự server trả về. */
type Notice = { id: string; body: string; createdAt: string; sender: string | null };

export function NoticePopup() {
  const [queue, setQueue] = useState<Notice[]>([]);
  const [live, setLive] = useState(false);

  /**
   * Hoà danh sách mới vào hàng đợi, GIỮ NGUYÊN cái đang hiện.
   *
   * Không thay thẳng bằng mảng mới: người dùng có thể đang đọc dở lời nhắn đầu, mà một frame
   * mới tới sẽ đổi phần tử [0] ngay dưới con trỏ chuột của họ — bấm「Đã hiểu」cho cái này hoá
   * ra lại đóng cái kia. Ghép theo id thì cái đang đọc ở yên chỗ của nó.
   */
  const merge = useCallback((incoming: Notice[]) => {
    setQueue((current) => {
      const seen = new Set(current.map((notice) => notice.id));
      const added = incoming.filter((notice) => !seen.has(notice.id));
      return added.length > 0 ? [...current, ...added] : current;
    });
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/notice", { cache: "no-store" });
      if (!response.ok) return false;
      const data = (await response.json()) as { notices?: Notice[] };
      merge(Array.isArray(data.notices) ? data.notices : []);
      return true;
    } catch {
      // Mạng chớp: im lặng: kênh SSE hoặc lượt tải trang sau sẽ bù. Một popup báo "không tải
      // được thông báo" là tự biến mình thành cái phiền toái mà nó sinh ra để tránh.
      return false;
    }
  }, [merge]);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;

    void load().then((allowed) => {
      // 401 = khách vãng lai. Không mở kênh, và cũng không thử lại: trang đăng nhập không có
      // lý do gì giữ một kết nối SSE.
      if (!alive || !allowed) return;

      source = new EventSource("/api/notice/stream");
      source.addEventListener("open", () => setLive(true));
      source.addEventListener("notice", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { notices?: Notice[] };
          merge(Array.isArray(data.notices) ? data.notices : []);
        } catch {
          // Một frame hỏng không được phép giết kênh; frame sau vẫn là danh sách đầy đủ.
        }
      });
      source.addEventListener("error", () => setLive(false));
    });

    return () => {
      alive = false;
      source?.close();
    };
  }, [load, merge]);

  /**
   * Quay lại tab thì hỏi lại một lượt. Kênh SSE tự đóng sau bốn phút và trình duyệt nối lại,
   * nhưng máy vừa ngủ dậy có thể mất vài giây mới nối được — trong quãng ấy một lượt fetch trả
   * lời ngay, và `merge` lo phần không hiện trùng.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const current = queue[0] ?? null;

  const dismiss = useCallback(async () => {
    if (!current) return;
    // Đóng NGAY rồi mới ghi: người bấm "đã hiểu" không có lý do gì phải ngồi đợi một round-trip,
    // và nếu lượt ghi hỏng thì lời nhắn quay lại ở lần tải trang sau — đúng hành vi mong muốn
    // (chưa xác nhận được thì coi như chưa đọc).
    const remaining = queue.length - 1;
    setQueue((rest) => rest.slice(1));
    try {
      await acknowledgeNoticeAction(current.id);
    } catch (error) {
      console.error("notice: không ghi được dấu đã xem", error);
    }
    // Đọc hết hàng đợi thì hỏi lại một lượt. Server trả tối đa 20 lời nhắn một lần, và nó chỉ
    // tự đẩy khi có tiếng gõ cửa MỚI — nên người nào tồn đọng hơn 20 cái sẽ đứng hình sau khi
    // đọc hết chỗ đầu, cho tới lần tải trang sau. Một lượt hỏi ở đây bịt đúng cái khe ấy.
    if (remaining === 0) void load();
  }, [current, load, queue.length]);

  // Esc cũng đóng — cùng thói quen với khay cảm xúc và nút Ngắm Tranh.
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, dismiss]);

  if (!current) return null;

  const when = new Date(current.createdAt).toLocaleString("vi-VN", { hour12: false });

  return (
    /* `z-[70]`: TRÊN cả nút Ngắm Tranh (60) và mọi hộp thoại (50). Một lời nhắn của tông môn
       phát ra giữa lúc người ta đang mở một hộp thoại khác thì nó phải được thấy, chứ không
       phải nằm khuất phía sau rồi chờ tới lượt. */
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notice-title"
      onClick={(event) => {
        // Bấm ra ngoài cũng đóng, nhưng chỉ khi bấm trúng tấm nền — không phải khi cú bấm
        // nảy lên từ trong thẻ.
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section className="card card-hairline w-full max-w-lg p-6">
        <div className="mb-4 flex items-center gap-3">
          <h2 id="notice-title" className="h-display text-lg font-semibold text-gilded">
            Thông báo tông môn
          </h2>
          {queue.length > 1 && (
            <span className="badge badge-pending" title="Số lời nhắn còn chờ đọc">
              còn {queue.length - 1}
            </span>
          )}
          <span className="ml-auto text-xs text-[var(--color-mist)]" title={live ? "Đang nối kênh trực tiếp" : "Kênh trực tiếp đang đứt — vẫn nhận được khi tải lại trang"}>
            {live ? "• trực tiếp" : ""}
          </span>
        </div>

        {/* `whitespace-pre-line`: người phát xuống dòng thế nào thì người đọc thấy thế ấy. Nội
            dung đi ra bằng text thường của React nên không có đường nào cho thẻ HTML lọt vào. */}
        <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-parchment)]">
          {current.body}
        </p>

        <p className="mt-4 text-xs text-[var(--color-mist)]">
          {current.sender ? `${current.sender} phát lúc ${when}` : `Phát lúc ${when}`}
        </p>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-gold" onClick={() => void dismiss()} autoFocus>
            Đã hiểu
          </button>
        </div>
      </section>
    </div>
  );
}
