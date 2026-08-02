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
      <div className="mb-6 flex gap-1 rounded-xl border border-[var(--color-ink-600)]/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            aria-pressed={active === t.key}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              active === t.key
                ? "bg-[var(--color-ink-600)]/70 text-[var(--color-gold-300)]"
                : "text-[var(--color-mist)] hover:text-[var(--color-parchment)]"
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
