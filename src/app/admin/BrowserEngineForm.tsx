"use client";

import { useActionState, useState } from "react";
import { saveBrowserEngineAction, type AdminResult } from "@/app/actions/admin";

/**
 * Trình duyệt mà khôi lỗi mở để cày — một ô chọn áp cho CẢ tông môn.
 *
 * Đứng chung tab Bảo Trì với Tên Miền Game vì cùng một loại việc: thứ trưởng môn chạm vào khi
 * site đổi nết và auto bắt đầu vấp. Hai lựa chọn được mô tả bằng cái người bấm THẤY (dễ ăn
 * captcha / cần cài thêm), không phải bằng tên thư viện bên dưới.
 */
type Engine = "chromium" | "obscura";

const CHOICES: ReadonlyArray<{ value: Engine; name: string; note: string }> = [
  {
    value: "chromium",
    name: "Chromium",
    note: "Trình duyệt đang dùng bấy lâu. Có sẵn trên mọi máy đã cài auto, không phải làm gì thêm.",
  },
  {
    value: "obscura",
    name: "Obscura",
    note: "Trình duyệt ẩn mình, sinh ra để đỡ bị nghi là máy. Máy nào chưa cài thì tự chạy Chromium như cũ.",
  },
];

export function BrowserEngineForm({ engine }: { engine: Engine }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveBrowserEngineAction,
    null,
  );
  // Ô đang chọn nằm trong state để phần mô tả bên dưới đổi ngay lúc bấm — chờ tới lượt lưu mới
  // biết mình vừa chọn gì thì ô chọn ấy chỉ là một cái nút câm.
  const [picked, setPicked] = useState<Engine>(engine);

  return (
    <form action={action} className="card card-hairline p-6">
      <h2 className="h-display mb-5 text-lg font-semibold text-gilded">Trình Duyệt Của Khôi Lỗi</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
              picked === choice.value
                ? "border-[var(--color-gold-400)]/70 bg-[var(--color-ink-600)]/40"
                : "border-[var(--color-ink-600)]/60 hover:border-[var(--color-ink-600)]"
            }`}
          >
            <input
              type="radio"
              name="engine"
              value={choice.value}
              checked={picked === choice.value}
              onChange={() => setPicked(choice.value)}
              className="mt-1 h-4 w-4 accent-[var(--color-gold-400)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--color-parchment)]">{choice.name}</span>
              <span className="mt-1 block text-xs text-[var(--color-mist)]">{choice.note}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--color-mist)]">
        Đổi xong là khôi lỗi dùng ngay từ vòng kế — đàn đang chạy vẫn đi nốt bằng trình duyệt cũ.
        Máy của tông môn tự có sẵn Obscura, không phải làm gì thêm.
      </p>
      {picked === "obscura" && (
        // Chỉ hiện khi thật sự cần: máy nhà không tự tải Obscura (gói ~74 MB, phần lớn máy vẫn
        // chạy Chromium), nên đây là thứ duy nhất người bấm phải tự tay làm — và nó chỉ đáng
        // chiếm chỗ trên màn hình đúng lúc người ta vừa chọn Obscura.
        <p className="mt-2 text-xs text-[var(--color-mist)]">
          Muốn máy nhà cũng dùng Obscura thì chạy lại lệnh cài auto, thêm{" "}
          <span className="font-mono text-[var(--color-parchment)]">$env:LINH_SU_OBSCURA=&apos;1&apos;;</span>{" "}
          (Windows) hoặc <span className="font-mono text-[var(--color-parchment)]">LINH_SU_OBSCURA=1</span>{" "}
          (Linux/macOS) ở đầu lệnh. Chưa cài thì máy ấy vẫn chạy Chromium và ghi một dòng trong nhật ký.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Lựa Chọn"}
        </button>
        {state && (
          <p role="status" className={`text-sm ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
