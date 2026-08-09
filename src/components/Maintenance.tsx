"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import type { DashboardMaintenance } from "@/lib/realtime/dashboardTypes";

/**
 * Bế quan trùng tu, phía client: bảng chắn cho môn đồ, dải nhắc cho người trực, và một nhịp
 * soát để cả hai xuất hiện/biến mất mà không ai phải F5.
 *
 * Trước 09/08/2026 đây là `dashboard/MaintenanceOverlay.tsx` — chỉ phủ trang Auto, đóng được
 * bằng một nút, và nhận trạng thái qua frame SSE của Auto. Cả ba điểm ấy đều đã đổi: bảng
 * chắn giờ do MaintenanceGate dựng ở layout gốc nên nó phủ mọi trang, KHÔNG có nút đóng, và
 * vì môn đồ không còn vào được Auto trong lúc bế quan thì đường SSE của Auto cũng hết việc —
 * nhịp soát bên dưới thay nó, và chạy trên mọi trang chứ không riêng một trang.
 */

/** Nhịp soát khi ĐANG bế quan: người ta đang đợi cửa mở, mười giây là đủ nhanh. */
const POLL_ACTIVE_MS = 10_000;

/**
 * Nhịp soát khi cửa đang mở. Một phút, vì việc duy nhất nó chờ là một cú gạt công tắc hiếm
 * hoi — soát dày hơn chỉ là một lượt gọi function nữa mỗi tab, mãi mãi, để không đổi gì cả.
 */
const POLL_IDLE_MS = 60_000;

type Clock = {
  /** Chuỗi đọc được: "05:42", "2 giờ 13 phút", "sắp xong", hoặc "chưa rõ hạn". */
  countdown: string;
  /** 0–100, hoặc null khi không có đủ hai mốc để nội suy. */
  progress: number | null;
  overtime: boolean;
  hasWindow: boolean;
};

/**
 * Đồng hồ đếm ngược tới `expectedEndAt` và thanh tiến độ nội suy giữa hai mốc.
 *
 * Quá hẹn thì nói「sắp xong」và ghim thanh ở 100% — TUYỆT ĐỐI không đếm số âm: một cái đồng hồ
 * chạy lùi qua 0 rồi tiếp tục lùi là cách nhanh nhất để người xem kết luận cả trang đã hỏng.
 * Mốc là chuỗi ISO trong một document JSONB không ai ép kiểu ở tầng ghi, nên `Date.parse`
 * hỏng là một trạng thái phải xử lý, không phải một chuyện không thể xảy ra.
 */
function useClock(maintenance: DashboardMaintenance): Clock {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!maintenance.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [maintenance.active]);

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

  return { countdown, progress, overtime, hasWindow };
}

function ProgressBar({ progress, pulse }: { progress: number | null; pulse: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-ink-600)]/80">
      <div
        className={`h-full rounded-full bg-gradient-to-r from-[var(--color-gold-500)] to-[var(--color-gold-300)] transition-[width] duration-1000 ease-linear ${
          pulse ? "animate-pulse" : ""
        }`}
        style={{ width: `${progress ?? 100}%` }}
      />
    </div>
  );
}

/**
 * Bảng bế quan — thay CHỖ của cả trang, không phủ lên trên nó.
 *
 * Khác biệt ấy là cả yêu cầu: một tấm màn `position: fixed` phủ lên trang thì nội dung trang
 * vẫn được gửi xuống máy người ta và vẫn dùng được sau ba giây trong devtools. Ở đây không có
 * trang nào nằm sau để mà lộ hay để mà bấm — guard đã kết thúc hồi đáp của trang trước khi nó
 * kịp dựng xong (xem MaintenanceGate).
 *
 * Có đúng MỘT nút, và nó là nút Xuất Quan. Vì bảng này thay cả trang, thanh đầu trang cũng
 * không còn — không có nút ấy thì người ta bị kẹt trong một phiên không rời ra được.
 */
export function MaintenanceWall({ maintenance }: { maintenance: DashboardMaintenance }) {
  const { countdown, progress, overtime, hasWindow } = useClock(maintenance);

  return (
    <main
      data-backdrop="be-quan"
      className="mx-auto flex min-h-[80vh] w-full max-w-md items-center justify-center px-4 py-10"
    >
      <div className="card card-hairline rise-in w-full p-8 text-center">
        <div className="mb-3 text-3xl" aria-hidden>
          ⏳
        </div>
        <h1 className="h-display text-xl font-bold text-gilded">Tông môn đang bế quan trùng tu</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-mist)]">
          {maintenance.note.trim() ||
            "Trưởng môn đang nâng cấp hệ thống. Tông môn sẽ mở cửa lại trong chốc lát."}
        </p>

        <div className="mt-6">
          <ProgressBar progress={progress} pulse={overtime || progress === null} />
        </div>
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
          Cả tông môn tạm đóng cửa nên không trang nào mở được lúc này — kể cả Auto, Hàng Đợi và
          Phòng Chat. Đàn đang chạy dở vẫn hoàn thành nốt vòng rồi nghỉ, không mất gì cả; mở cửa
          lại là mọi đàn tự chạy tiếp, đạo hữu không phải làm gì.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-mist)]">
          Trang này tự mở ra ngay khi cửa mở lại — không cần tải lại.
        </p>

        <form action={logoutAction} className="mt-6">
          <button type="submit" className="btn btn-ghost">
            Xuất Quan
          </button>
        </form>
      </div>
    </main>
  );
}

/**
 * Dải nhắc cho người ĐI QUA ĐƯỢC trong lúc bế quan — bậc trị sự và khách chưa đăng nhập.
 *
 * `sticky` trong luồng thường, KHÔNG `fixed`: nó phải ĐẨY trang xuống chứ không được đè lên
 * thanh đầu trang, nơi có ấn tông môn và cả hàng menu — trong đó có đúng cái nút dẫn tới công
 * tắc tắt bảo trì. Che chính cái nút ấy thì dải nhắc trở thành chướng ngại.
 */
export function MaintenanceBanner({ maintenance }: { maintenance: DashboardMaintenance }) {
  const { countdown, progress, overtime, hasWindow } = useClock(maintenance);

  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[var(--color-gold-300)]/30 bg-[var(--color-ink-900)]/95 px-4 py-2 text-xs text-[var(--color-parchment)] backdrop-blur"
    >
      <span aria-hidden>⏳</span>
      <span>
        Tông môn đang bế quan trùng tu — {overtime || !hasWindow ? countdown : `còn ${countdown}`}
      </span>
      {progress !== null && <span className="text-[var(--color-mist)]">{progress}%</span>}
      <span className="text-[var(--color-mist)]">· môn đồ đang thấy bảng chắn ở mọi trang</span>
    </div>
  );
}

/**
 * Nhịp soát cờ bảo trì. Không vẽ gì; việc duy nhất của nó là gọi `router.refresh()` đúng lúc
 * cờ ĐỔI, để server dựng lại layout — và chính layout quyết định vẽ bảng chắn hay vẽ trang.
 *
 * So `active` với thứ SSR vừa dựng nên nó chỉ refresh khi thật sự có chuyển trạng thái, không
 * phải mỗi nhịp. Không gọi một lượt ngay lúc mount: SSR vừa nói sự thật xong.
 *
 * Không dùng SSE như Auto: một kết nối giữ mở trên MỌI trang cho một cú gạt công tắc hiếm hoi
 * thì đắt hơn hẳn một lượt hỏi mỗi phút — và endpoint này trả về bốn trường, không phải cả
 * một ảnh chụp hàng đợi.
 */
export function MaintenanceWatch({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch("/api/maintenance", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const data = (await res.json()) as { active?: unknown };
        if (Boolean(data.active) === active) return;

        /**
         * PHẢI là `refresh()`, không phải `push`/`replace`. Bảng chắn do LAYOUT GỐC vẽ, và Next
         * TÁI DÙNG layout khi điều hướng phía client — nó chỉ tải lại đoạn trang đã đổi. Đo
         * được ngày 09/08/2026: một cú `router.replace("/")` đổi URL từ /dashboard sang / và
         * đổi cả tiêu đề tab, mà bảng chắn vẫn nằm nguyên trên màn hình, vì layout không được
         * dựng lại. `refresh()` thì dựng lại cả cây từ layout xuống.
         *
         * Và nó cũng là hành vi đúng hơn: người xem ở lại đúng URL họ đang muốn vào, nên cửa mở
         * ra là họ thấy chính trang ấy, không bị đá về trang chủ.
         */
        router.refresh();
      } catch {
        // Mạng chớp — nhịp sau hỏi lại. Một lượt hỏi trượt không được phép làm gì cả.
      }
    };

    /**
     * Tab bị ẩn thì KHÔNG hỏi. Nhịp này nằm trên mọi trang nên nó sống trong từng tab đang mở,
     * và cái tab bị bỏ quên cả ngày chính là cái tốn nhiều lượt gọi nhất mà chẳng ai nhìn kết
     * quả. Đổi lại, lúc quay lại tab thì hỏi NGAY — người vừa quay lại cần biết sự thật của
     * bây giờ, không phải đợi hết một phút nữa.
     */
    const tickIfVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };

    const timer = setInterval(tickIfVisible, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    document.addEventListener("visibilitychange", tickIfVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tickIfVisible);
    };
  }, [active, router]);

  return null;
}
