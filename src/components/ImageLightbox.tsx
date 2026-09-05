"use client";

import { useEffect, useRef } from "react";

/**
 * Khung ngắm ảnh — phóng một tấm ảnh lên giữa màn hình thay vì ném người xem sang tab khác.
 *
 * Sinh ra cho sảnh đàm đạo: ảnh đính kèm trước đây là một thẻ `<a target="_blank">`, nên mỗi
 * lần muốn nhìn rõ một tấm là mất chỗ đang đứng trong sảnh, và quay lại thì sảnh đã cuộn đi
 * đâu mất. Ngắm tại chỗ giữ nguyên mạch đọc.
 *
 * ── VÌ SAO NÓ PHẢI ĐƯỢC VẼ Ở GỐC ChatRoom, KHÔNG PHẢI CẠNH TẤM ẢNH ─────────────────────────
 * `.chat-scroll > *` mang `zoom: var(--chat-zoom)` ở khung hẹp (globals.css). `zoom` KHÔNG chỉ
 * thu nội dung: nó dựng lại bố cục ở cỡ mới và kéo theo cả con cháu `position: fixed` — một
 * tấm phủ "toàn màn hình" vẽ bên trong vùng cuộn sẽ ra đúng 82% màn hình, lệch chỗ. Và
 * `.chat-shell` thì mang `z-index: 1`, tức một tầng xếp chồng riêng: vẽ vào trong đó thì `z-50`
 * ở đây chỉ còn nghĩa lý bên trong cái tầng ấy, không so được với thanh đầu trang.
 * Cả hai cái bẫy đều biến mất khi tấm phủ là con trực tiếp của `.chat-frame`.
 *
 * Tầng 50 theo đúng thang đã có của app: 70 lời nhắn tông môn, 60 nút Ngắm Tranh, 50 hộp thoại.
 * Khung ngắm ảnh là một hộp thoại, nên nó nằm dưới lời nhắn — một thông báo của tông chủ vẫn
 * phải chọc thủng được nó.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  /** Ảnh đang ngắm; `null` là đóng. Truyền `null` thay vì tháo component để chỗ gọi chỉ giữ một state. */
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  /**
   * Nơi con trỏ bàn phím phải quay về khi đóng.
   *
   * Ghi lúc MỞ chứ không lúc đóng: mở xong là tiêu điểm đã bị dời sang nút Đóng, lúc ấy hỏi
   * `document.activeElement` thì chỉ nhận lại chính cái nút của mình.
   */
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!src) return;
    returnTo.current = document.activeElement;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Chỉ trả tiêu điểm khi chỗ cũ VẪN còn trên trang: sảnh vẫn poll và vẽ lại, nên cái nút
      // vừa mở khung này có thể đã bị thay bằng một nút khác trong lúc ảnh đang mở.
      const back = returnTo.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `Ảnh phóng to: ${alt}` : "Ảnh phóng to"}
      onClick={(event) => {
        // Chỉ đóng khi bấm trúng tấm nền, không phải khi cú bấm nảy lên từ chính tấm ảnh.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Góc TRÁI, không phải phải: `.peek-toggle` (nút Ngắm Tranh) đóng đinh ở `top:1rem;
          right:1rem` với z-index 60, và bình chú của nó nói rõ vì sao nó phải nằm trên cả hộp
          thoại — đó là đường DUY NHẤT để tắt chế độ ngắm. Nên khung này KHÔNG được leo lên trên
          nó; thứ phải dời là cái nút của mình. Đo trên ảnh chụp 375px: hai nút chồng đúng lên
          nhau khi để bên phải. */}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Đóng ảnh"
        className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-2xl leading-none text-[var(--color-parchment)] hover:bg-black/80"
      >
        ×
      </button>

      {/* Kẹp theo KHUNG NHÌN chứ không theo tấm phủ: ảnh dọc rất cao vẫn phải nằm trọn trong
          màn hình thay vì đẩy tấm phủ mọc thanh cuộn. `p-4` của tấm phủ đã trừ sẵn ở đây. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain"
      />
    </div>
  );
}
