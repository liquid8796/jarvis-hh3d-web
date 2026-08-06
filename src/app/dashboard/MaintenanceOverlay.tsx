"use client";

import { useEffect, useState } from "react";
import { useDashboardMaintenanceLive } from "./DashboardLiveProvider";

/**
 * Popup bế quan trùng tu trên Linh Đài.
 *
 * Ai đang mở trang nhận nó qua frame SSE (admin gạt công tắc là notifyDashboard "*" đẩy
 * ngay); ai mới vào nhận qua initialMaintenance từ SSR. Cả hai đường đổ về cùng một context
 * nên component này không cần biết mình được báo bằng cách nào.
 *
 * Đồng hồ đếm ngược trỏ vào `expectedEndAt`, thanh tiến độ nội suy giữa startedAt và
 * expectedEndAt. Quá hẹn thì nói「sắp xong」và ghim thanh ở 100% — tuyệt đối không đếm số
 * âm: một cái đồng hồ chạy lùi qua 0 rồi tiếp tục lùi là cách nhanh nhất để người xem kết
 * luận cả trang đã hỏng.
 *
 * Đóng được (đạo hữu còn muốn đọc nhật ký đàn đang chạy nốt), nhưng đóng rồi vẫn còn một
 * dải mỏng ghim trên đỉnh — trạng thái "đang trùng tu" không được phép biến mất hoàn toàn
 * khỏi mắt. Popup tự bật lại nếu một ĐỢT trùng tu mới bắt đầu (startedAt đổi).
 */
export function MaintenanceOverlay() {
  const maintenance = useDashboardMaintenanceLive();
  const [now, setNow] = useState(() => Date.now());
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!maintenance.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [maintenance.active]);

  if (!maintenance.active) return null;

  const startMs = maintenance.startedAt ? Date.parse(maintenance.startedAt) : NaN;
  const endMs = maintenance.expectedEndAt ? Date.parse(maintenance.expectedEndAt) : NaN;
  const hasWindow = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs;

  const remainingMs = hasWindow ? endMs - now : NaN;
  const overtime = hasWindow && remainingMs <= 0;
  const progress = hasWindow
    ? Math.min(100, Math.max(0, Math.round(((now - startMs) / (endMs - startMs)) * 100)))
    : null;

  const countdown = (() => {
    if (!hasWindow) return "chưa rõ hạn";
    if (overtime) return "sắp xong";
    const total = Math.floor(remainingMs / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h} giờ ${String(m).padStart(2, "0")} phút`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  })();

  const dismissKey = maintenance.startedAt ?? "unknown";
  const dismissed = dismissedFor === dismissKey;

  const bar = (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-ink-600)]/80">
      <div
        className={`h-full rounded-full bg-gradient-to-r from-[var(--color-gold-500)] to-[var(--color-gold-300)] transition-[width] duration-1000 ease-linear ${
          overtime || progress === null ? "animate-pulse" : ""
        }`}
        style={{ width: `${progress ?? 100}%` }}
      />
    </div>
  );

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissedFor(null)}
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-3 border-b border-[var(--color-gold-300)]/30 bg-[var(--color-ink-900)]/95 px-4 py-2 text-xs text-[var(--color-parchment)] backdrop-blur"
        title="Mở lại bảng trùng tu"
      >
        <span aria-hidden>⏳</span>
        <span>
          Đang bế quan trùng tu — {overtime || !hasWindow ? countdown : `còn ${countdown}`}
        </span>
        {progress !== null && <span className="text-[var(--color-mist)]">{progress}%</span>}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-ink-950)]/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Thông báo bảo trì"
    >
      <div className="card card-hairline w-full max-w-md p-8 text-center">
        <div className="mb-3 text-3xl" aria-hidden>
          ⏳
        </div>
        <h2 className="h-display text-xl font-bold text-gilded">Tông môn đang bế quan trùng tu</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-mist)]">
          {maintenance.note.trim() ||
            "Trưởng môn đang nâng cấp hệ thống. Linh Đài sẽ trở lại trong chốc lát."}
        </p>

        <div className="mt-6">{bar}</div>
        <p className="mt-3 text-sm">
          {overtime ? (
            <span className="text-gilded">Quá hẹn một chút — đang hoàn tất, sắp xong.</span>
          ) : hasWindow ? (
            <>
              Còn lại khoảng <span className="font-mono text-lg text-gilded">{countdown}</span>
              {progress !== null && (
                <span className="ml-2 text-xs text-[var(--color-mist)]">({progress}%)</span>
              )}
            </>
          ) : (
            <span className="text-[var(--color-mist)]">Chưa có ước lượng thời gian.</span>
          )}
        </p>

        <p className="mt-5 text-xs leading-relaxed text-[var(--color-mist)]">
          Đàn đang chạy dở sẽ hoàn thành nốt vòng rồi nghỉ — không mất gì cả. Khai Đàn tạm
          khoá; mở cửa lại là mọi đàn tự chạy tiếp, đạo hữu không phải làm gì.
        </p>

        <button
          type="button"
          onClick={() => setDismissedFor(dismissKey)}
          className="btn btn-ghost mt-6"
        >
          Đã hiểu — để tôi xem nhật ký
        </button>
      </div>
    </div>
  );
}
