"use client";

import { useActionState, useState } from "react";
import { stopJobsByRoundsAction, type AdminResult } from "@/app/actions/admin";

/** Independent form inside the existing Tên Miền Game card. */
export function BulkStopRoundsForm() {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(stopJobsByRoundsAction, null);
  const [threshold, setThreshold] = useState("10");
  return (
    <div className="mt-6 border-t border-[var(--color-ink-600)] pt-5">
      <h3 className="text-base font-semibold text-gilded">Dừng tất cả đàn theo số vòng</h3>
      <p className="mt-1 text-sm text-[var(--color-mist)]">
        Dừng các đàn của mọi người dùng đã nhận từ N vòng trở lên. Đàn đang nghỉ dừng ngay;
        đàn đang chạy nhận lệnh dừng tại điểm an toàn. Không xóa tài khoản hay lịch sử.
      </p>
      <form
        action={action}
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          const n = Number(threshold);
          if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) {
            event.preventDefault(); return;
          }
          if (!window.confirm(
            "Dừng TẤT CẢ đàn trong hệ thống đã nhận từ " + n + " vòng trở lên?\n\n" +
            "Đàn đang chờ dừng ngay; đàn đang chạy sẽ dừng ở điểm an toàn tiếp theo. " +
            "Thao tác ảnh hưởng đến nhiều người dùng."
          )) event.preventDefault();
        }}
      >
        <div>
          <label className="label" htmlFor="bulkStopRounds">Số vòng tối thiểu (N)</label>
          <input
            id="bulkStopRounds" name="rounds" type="number" min={1} max={1_000_000}
            step={1} required inputMode="numeric" value={threshold}
            onChange={event => setThreshold(event.target.value)}
            className="input w-36 font-mono"
          />
        </div>
        <button
          className="btn btn-danger"
          type="submit"
          disabled={pending || !/^[1-9]\d{0,6}$/.test(threshold) || Number(threshold) > 1_000_000}
        >
          {pending ? "Đang gửi lệnh…" : "Dừng các đàn đạt ngưỡng"}
        </button>
      </form>
      {state && (
        <p role="status" className={state.ok ? "mt-3 text-sm text-[var(--color-jade-300)]" : "mt-3 text-sm text-[#f2a0a0]"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
