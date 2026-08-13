"use client";

import { useState, type ReactNode } from "react";

/**
 * Khung tab của trang Tông Môn. Nội dung từng tab là server-render sẵn và truyền vào làm
 * slot — client chỉ giữ đúng một mảnh state "đang mở tab nào", nên thêm khu cấu hình mới
 * về sau là thêm một mục vào mảng này + một slot, không đụng dữ liệu hay quyền.
 *
 * Tab ĐỔI HIỂN THỊ chứ không unmount (cùng bài học với form nhiệm vụ): bảng môn đồ giữ
 * nguyên scroll và ô tìm kiếm đang gõ dở khi tông chủ liếc sang tab khác rồi quay lại.
 */
export function AdminTabs({ tabs }: { tabs: Array<{ key: string; label: string; pane: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");

  return (
    <>
      {/* Thanh tab đứng THẲNG trên ảnh nền (`data-backdrop="admin"`), không nằm trong thẻ nào
          — cùng cảnh với `.btn-ghost`. Bản cũ chỉ có viền, không nền, nên chữ tab rơi đúng vào
          mặt trăng sáng của tấm backdrop là tắt: chữ sương trên nền trắng chỉ đạt 2.80:1, và
          cả tab đang mở (vàng trên `ink-600/70`) cũng chỉ 3.90:1 — cả hai dưới chuẩn AA.
          Mượn luôn `.card` thay vì tự pha một màu nền mới: độ đục 0.93/0.96 của nó là con số
          đã ĐO (xem ghi chú tại `.card`), và tab thì được hưởng ké mỗi lần thẻ chỉnh lại.
          Trên nền ấy: chữ sương 4.96:1, chữ vàng của tab đang mở 7.93:1. */}
      <div className="card mb-6 flex gap-1 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            aria-pressed={active === t.key}
            /* Viền trong suốt ở MỌI tab, tab đang mở chỉ đổi màu viền — cùng bài học với
               `.queue-tabs`: thêm viền cho riêng tab đang mở là cả hàng cao thêm 2px mỗi lần
               bấm. Và viền vàng là thứ mang HÌNH của tab đang mở: nền thanh nay đã tối, nên
               mảng nền tím một mình chỉ hơn thanh 1.25:1 — nhìn ra chữ vàng chứ không nhìn ra
               cái nút. Vàng 0.6 đưa đường viền ấy lên 3.90:1, qua chuẩn 3:1 cho nét giao diện. */
            className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              active === t.key
                ? "border-[var(--color-gold-400)]/60 bg-[var(--color-spirit-500)]/25 text-[var(--color-gold-300)]"
                : "border-transparent text-[var(--color-mist)] hover:bg-[var(--color-ink-600)]/50 hover:text-[var(--color-parchment)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div key={t.key} hidden={active !== t.key}>
          {t.pane}
        </div>
      ))}
    </>
  );
}
