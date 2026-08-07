"use client";

import { useActionState } from "react";
import {
  endMaintenanceAction,
  startMaintenanceAction,
  type AdminResult,
} from "@/app/actions/admin";

/**
 * Tab Bảo Trì — công tắc bế quan trùng tu, kèm bảng drain để trưởng môn biết lúc nào deploy
 * an toàn: "đang chạy" về 0 nghĩa là không còn Chromium nào giữa chừng một vòng, chỉ còn
 * những dòng queued nằm im chờ mở cửa.
 *
 * Số liệu drain là ảnh chụp lúc tải trang (trang admin không có kênh live) — nên có ghi chú
 * bảo tải lại, thay vì giả vờ con số tự nhảy.
 */
export function MaintenanceForm({
  maintenance,
  drain,
}: {
  maintenance: { active: boolean; startedAt: string | null; expectedEndAt: string | null; note: string };
  drain: { running: number; queued: number };
}) {
  const [startState, startAction, startPending] = useActionState<AdminResult | null, FormData>(
    startMaintenanceAction,
    null,
  );
  const [endState, endAction, endPending] = useActionState<AdminResult | null, FormData>(
    () => endMaintenanceAction(),
    null,
  );

  const fmt = (iso: string | null) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(ms) ? "—" : new Date(ms).toLocaleString("vi-VN", { hour12: false });
  };

  // Bề rộng và khoảng cách giữa các thẻ do TRANG quyết (xem admin/page.tsx) — form này chỉ
  // dựng nội dung của chính nó, nếu không sẽ có hai lớp `max-w-2xl` lồng nhau.
  return (
    <>
      <form action={startAction} className="card card-hairline p-6">
        <h2 className="h-display mb-2 text-lg font-semibold text-gilded">
          Bế Quan Trùng Tu {maintenance.active && <span className="badge badge-pending ml-2 align-middle">ĐANG BẢO TRÌ</span>}
        </h2>
        <p className="mb-5 text-sm text-[var(--color-mist)]">
          Bật lên là cửa phát việc đóng và Khai Đàn tạm khoá. Đàn đang chạy dở <b>không</b> bị
          chém giữa vòng — nó hoàn thành nốt rồi tự vào hàng chờ; mở cửa lại là mọi đàn tự
          chạy tiếp, không ai phải bấm lại Khai Đàn.
        </p>

        {maintenance.active && (
          <p className="mb-4 rounded-lg border border-[var(--color-gold-300)]/40 bg-[var(--color-ink-600)]/40 p-3 text-xs leading-relaxed">
            Bắt đầu: <span className="text-gilded">{fmt(maintenance.startedAt)}</span> · Hạn chót dự
            kiến: <span className="text-gilded">{fmt(maintenance.expectedEndAt)}</span>
            {maintenance.note && (
              <>
                <br />
                Lời nhắn đang treo: <span className="text-gilded">{maintenance.note}</span>
              </>
            )}
          </p>
        )}

        <label className="label" htmlFor="minutes">
          {maintenance.active ? "Còn khoảng bao nhiêu phút nữa" : "Ước lượng bao nhiêu phút"}
        </label>
        <input
          id="minutes"
          name="minutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={30}
          className="input max-w-[10rem] font-mono"
        />
        <p className="mt-1 text-xs text-[var(--color-mist)]">
          Đồng hồ đếm ngược trong popup trỏ vào mốc này. Trễ hẹn thì popup nói「sắp xong」chứ
          không đếm số âm — nhưng đừng lạm dụng, hãy vào đây dời hạn cho tử tế.
        </p>

        <label className="label mt-4" htmlFor="note">
          Lời nhắn cho đạo hữu (tuỳ ý)
        </label>
        <input
          id="note"
          name="note"
          type="text"
          maxLength={500}
          defaultValue={maintenance.note}
          placeholder="Ví dụ: nâng cấp engine Hoang Vực, xong sẽ nhanh hơn"
          className="input"
        />

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-gold" disabled={startPending}>
            {startPending ? "Đang khắc…" : maintenance.active ? "Dời Hạn Chót" : "Khai Bảo Trì"}
          </button>
          {startState && (
            <p role="status" className={`text-sm ${startState.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
              {startState.message}
            </p>
          )}
        </div>
      </form>

      {maintenance.active && (
        <form action={endAction} className="card card-hairline p-6">
          <h3 className="h-display mb-2 text-base font-semibold text-gilded">Tình hình drain</h3>
          <p className="mb-4 text-sm text-[var(--color-mist)]">
            <span className="text-gilded">{drain.running}</span> đàn đang chạy nốt vòng ·{" "}
            <span className="text-gilded">{drain.queued}</span> đàn nằm chờ. Số liệu chụp lúc tải
            trang — tải lại để soát. Khi「đang chạy」về 0 là drain xong, deploy an toàn.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="btn btn-ghost" disabled={endPending}>
              {endPending ? "Đang mở…" : "Kết Thúc Bảo Trì — Mở Cửa Lại"}
            </button>
            {endState && (
              <p role="status" className={`text-sm ${endState.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
                {endState.message}
              </p>
            )}
          </div>
        </form>
      )}
    </>
  );
}
