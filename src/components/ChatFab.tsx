"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fabBadge } from "@/lib/validation/chatRead";

/**
 * Icon Phòng Chat nổi ở góc phải-dưới của MỌI trang thành viên, đeo huy hiệu số tin chưa đọc.
 *
 * Gắn ở layout gốc như popup thông báo, và cùng phép cư xử với khách vãng lai: cú hỏi đầu
 * trả 401 là im hẳn tới lần tải trang sau — khách không có sảnh để mà được gọi vào. Trên
 * chính trang /chat thì icon lặn (đang đứng trong sảnh mà còn gõ cửa mời vào sảnh là thừa)
 * và ngừng luôn nhịp hỏi: mốc đã-đọc do chính sảnh đẩy tới, rời sảnh là icon hỏi lại ngay.
 *
 * Con số đến từ `GET /api/chat?unread=1` — nhánh nhẹ chỉ trả một số, và nguồn của số ấy là
 * mốc `chat_reads` phía server, nên nó đúng trên mọi thiết bị của cùng một người. Nhịp hỏi
 * 30 giây: huy hiệu là bảng hiệu, không phải sảnh chat — trễ nửa phút là cái giá đúng cho
 * việc không nhân đôi nhịp poll 2.5s của sảnh lên toàn bộ các trang còn lại.
 */

const UNREAD_POLL_MS = 30_000;

export function ChatFab() {
  const pathname = usePathname();
  /** `null` = chưa biết (chưa hỏi xong, khách, hay kho đóng) — icon chưa được phép hiện. */
  const [unread, setUnread] = useState<number | null>(null);
  const inChat = pathname === "/chat" || pathname.startsWith("/chat/");

  useEffect(() => {
    if (inChat) return;
    let alive = true;
    let stopped = false;

    const tick = async () => {
      if (!alive || stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/chat?unread=1", { cache: "no-store" });
        if (!alive) return;
        if (res.status === 401) {
          // Khách vãng lai — thôi hỏi hẳn, đừng gõ 401 mỗi nửa phút vào log của ai.
          stopped = true;
          setUnread(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { unread?: number };
        if (typeof data.unread === "number") setUnread(data.unread);
      } catch {
        /* mạng chớp — nhịp sau gặp lại */
      }
    };

    void tick();
    const timer = setInterval(tick, UNREAD_POLL_MS);
    // Quay lại tab thì hỏi ngay một lượt — người ta vừa đọc chat ở tab khác xong, huy hiệu
    // còn đeo số cũ suốt nửa phút là một bảng hiệu nói dối.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [inChat]);

  if (inChat || unread === null) return null;

  const badge = fabBadge(unread);
  return (
    <Link
      href="/chat"
      className="chat-fab"
      title="Phòng Chat"
      aria-label={badge ? `Phòng Chat — ${unread} tin chưa đọc` : "Phòng Chat"}
    >
      <span aria-hidden>💬</span>
      {badge && <b className="chat-fab-badge" aria-hidden>{badge}</b>}
    </Link>
  );
}
