"use client";

import { useEffect, useState } from "react";

/**
 * Nút「Ngắm Tranh」— làm MỜ mọi thứ trên trang để nhìn rõ bức nền, và chỉ làm mờ.
 *
 * Không `display:none`, không `visibility:hidden`, không `pointer-events:none`: nội dung vẫn
 * ở đó, vẫn đọc được lờ mờ, vẫn bấm được. Đây là một chế độ NGẮM, không phải một chế độ ẩn —
 * người ta gạt nó để xem tấm tranh, không phải để trang biến mất.
 *
 * Cách làm: đặt một thuộc tính lên `<body>`, rồi để MỘT luật CSS trong globals.css làm mờ mọi
 * con trực tiếp của body trừ tấm nền và chính cái nút này. Chọn đường ấy thay vì bọc
 * `children` trong một thẻ có `opacity` vì hai lẽ:
 *   • Nút phải nằm NGOÀI vùng bị mờ. Bọc children rồi đặt nút bên trong là tự làm mờ luôn
 *     đường quay lại — người dùng kẹt trong một trang 12% không có gì để bấm.
 *   • Thanh đầu trang, nội dung và chân trang là BA con riêng của body (layout gốc dựng vậy),
 *     nên một luật theo con trực tiếp phủ trọn cả ba, và phủ luôn trang nào thêm vào sau này.
 *
 * KHÔNG lưu lại lựa chọn. Đây là một cử chỉ nhất thời — liếc nhìn tấm tranh rồi thôi. Lưu vào
 * localStorage thì người ta tải lại trang hôm sau và thấy cả web mờ tịt, và thứ đầu tiên họ
 * nghĩ là web hỏng chứ không phải "à mình đang bật chế độ ngắm".
 */

/** Thuộc tính đánh dấu trên `<body>`. Luật làm mờ nằm ở globals.css, tìm theo đúng tên này. */
const PEEK_ATTRIBUTE = "data-peek";

export function BackdropPeek() {
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    const { body } = document;
    if (peeking) body.setAttribute(PEEK_ATTRIBUTE, "");
    else body.removeAttribute(PEEK_ATTRIBUTE);

    // Dọn khi rời: component này sống ở layout gốc nên gần như không bao giờ bị gỡ, nhưng một
    // thuộc tính viết thẳng lên DOM mà không có đường thu về là một thứ chờ ngày sống dai hơn
    // thứ đã đặt nó.
    return () => body.removeAttribute(PEEK_ATTRIBUTE);
  }, [peeking]);

  useEffect(() => {
    if (!peeking) return;

    // Esc để thoát, cùng thói quen với khay cảm xúc trong Phòng Chat. Người đang ngắm tranh
    // thì tay không còn ở chuột, và Esc là phản xạ chung của "cho tôi ra".
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeeking(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [peeking]);

  const label = peeking ? "Thôi ngắm tranh — trả lại độ rõ cho trang" : "Ngắm tranh — làm mờ trang để nhìn rõ nền";

  return (
    <button
      type="button"
      className="peek-toggle"
      aria-pressed={peeking}
      title={label}
      onClick={() => setPeeking((on) => !on)}
    >
      <span aria-hidden>🌙</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
