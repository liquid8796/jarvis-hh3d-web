"use client";

import { useActionState, useEffect, useState } from "react";
import { purgeChatAction, type AdminResult } from "@/app/actions/admin";
import { CHAT_PURGE_PHRASE, matchesChatPurgePhrase } from "@/lib/validation/chat";

/**
 * Thẻ thanh tẩy — nút nguy hiểm nhất trang, nên nó đứng RIÊNG một thẻ dưới thẻ hạn lưu chứ
 * không nằm chung form: một cú Enter lạc trong ô "số ngày" không được phép trở thành lệnh
 * xoá sạch sảnh.
 *
 * Nút chỉ mở khi ô xác nhận gõ đúng câu, và phép so ấy dùng CHUNG hàm với server
 * (validation/chat.ts) — nút sáng lên mà server vẫn từ chối là kiểu lỗi khiến người ta bấm
 * lại năm lần rồi đi báo hỏng.
 *
 * `canPurge` chỉ để VẼ. Luật thật gác trong action; ở đây nó chỉ quyết định người không đủ
 * vai nhìn thấy gì — và họ vẫn thấy thẻ này kèm lý do, vì một cái nút biến mất không giải
 * thích được chính nó.
 */
export function ChatPurgePanel({ canPurge }: { canPurge: boolean }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    purgeChatAction,
    null,
  );
  const [confirm, setConfirm] = useState("");

  // Xoá xong thì trả ô xác nhận về trống: để nguyên là để lại một cái nút đỏ đang sẵn sàng
  // bắn phát nữa ngay dưới dòng báo thành công.
  useEffect(() => {
    if (state?.ok) setConfirm("");
  }, [state]);

  const armed = matchesChatPurgePhrase(confirm);

  return (
    <form action={action} className="card card-hairline max-w-xl p-6">
      <h2 className="h-display mb-5 text-lg font-semibold text-[#ff9c9c]">Thanh Tẩy Sảnh Đàm Đạo</h2>

      <p className="mb-4 text-sm leading-relaxed text-[var(--color-mist)]">
        Xoá <span className="text-gilded">toàn bộ</span> tin nhắn khỏi tàng thư — mọi người, mọi
        ngày, kể cả tin đã thu hồi — và quét sạch mọi tệp đính kèm khỏi tàng khố media. Ảnh GIF
        không nằm trong kho của tông môn nên không có gì để xoá.
      </p>
      <p className="mb-5 text-xs leading-relaxed text-[#f2a0a0]">
        KHÔNG có đường lui: không thùng rác, không bản sao. Ai đang mở sảnh sẽ còn thấy tin cũ
        cho tới khi họ tải lại trang.
      </p>

      {canPurge ? (
        <>
          <label className="label" htmlFor="confirm">
            Gõ「{CHAT_PURGE_PHRASE}」để mở khoá
          </label>
          <input
            id="confirm"
            name="confirm"
            type="text"
            autoComplete="off"
            className="input max-w-[14rem] font-mono"
            placeholder={CHAT_PURGE_PHRASE}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="submit" className="btn btn-danger" disabled={!armed || pending}>
              {pending ? "Đang thanh tẩy…" : "Xoá Toàn Bộ Đàm Đạo"}
            </button>
            {state && (
              <p
                role="status"
                className={`text-sm ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
              >
                {state.message}
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--color-mist)]">
          Cửa này chỉ Gia chủ mở được — lịch sử đàm đạo của cả tông môn không nên nằm trong tay
          bất kỳ ai đổi ý.
        </p>
      )}
    </form>
  );
}
