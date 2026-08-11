"use client";

import { useCallback, useEffect, useState } from "react";
import { mirrorUsageAction, type MirrorView } from "@/app/actions/mirrors";
import {
  formatLimit,
  formatUsed,
  usedRatio,
  type UsageMetric,
  type VercelUsage,
} from "@/lib/services/vercelUsage";

/**
 * Mức dùng Vercel của một trạm — một dòng tóm tắt trong sổ, và một popup cho phần chi tiết.
 *
 * Tự đọc khi gắn, KHÔNG chờ ai bấm: câu hỏi「trạm nào sắp chạm trần」là lý do người ta mở tab
 * này, và bắt bấm từng trạm một để biết là bắt họ làm việc của máy. Nhưng đọc ở CLIENT sau khi
 * trang đã vẽ, không nhét vào lượt render phía server — `/v2/usage` là một lượt đi ra Internet
 * và tab này còn giữ nút chuyển trạm, thứ người ta mở ra đúng lúc đang có sự cố.
 *
 * Ngưỡng cảnh báo đọc từ chính tỉ lệ đã dùng: quá 100% là ĐỎ (đã vượt hạn miễn phí), quá 80%
 * là VÀNG. Không có ngưỡng thì không có lý do gì để nhìn bảng này.
 */

/** Quá mức này thì tô vàng — còn một phần năm hạn mức là lúc đáng biết, không phải lúc đã muộn. */
const WARN_RATIO = 0.8;

function toneOf(metric: UsageMetric): string {
  const ratio = usedRatio(metric);
  if (ratio == null) return "text-[var(--color-mist)]";
  if (ratio >= 1) return "text-[#f2a0a0]";
  if (ratio >= WARN_RATIO) return "text-[var(--color-gold-300)]";
  return "text-[var(--color-jade-300)]";
}

/** Chỉ số đáng lo nhất — thứ được kể trong dòng tóm tắt. */
function worstMetric(metrics: UsageMetric[]): UsageMetric | null {
  let worst: UsageMetric | null = null;
  let worstRatio = -1;
  for (const metric of metrics) {
    const ratio = usedRatio(metric);
    if (ratio != null && ratio > worstRatio) {
      worst = metric;
      worstRatio = ratio;
    }
  }
  return worst;
}

function UsageBar({ metric }: { metric: UsageMetric }) {
  const ratio = usedRatio(metric);
  if (ratio == null) return null;
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
      <div
        className={`h-full rounded-full ${
          ratio >= 1 ? "bg-[#f2a0a0]" : ratio >= WARN_RATIO ? "bg-[var(--color-gold-400)]" : "bg-[var(--color-jade-300)]"
        }`}
        // Kẹp ở 100%: vượt trần thì thanh đầy, con số bên cạnh mới là chỗ kể vượt bao nhiêu.
        style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }}
      />
    </div>
  );
}

export function MirrorUsage({ mirror }: { mirror: MirrorView }) {
  const [usage, setUsage] = useState<VercelUsage | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    if (!mirror.hasVercelToken) {
      setUsage({ ok: false, error: "Chưa có token Vercel — dán vào ô ở form Sửa trạm." });
      return;
    }
    setUsage(null);
    // Action đã nuốt mọi ngả hỏng thành `{ ok: false }`; `catch` ở đây phủ nốt ngả mạng đứt
    // giữa trình duyệt và chính server của ta.
    mirrorUsageAction(mirror.id)
      .then(setUsage)
      .catch((err: unknown) =>
        setUsage({ ok: false, error: err instanceof Error ? err.message : "Không gọi được server." }),
      );
  }, [mirror.id, mirror.hasVercelToken]);

  useEffect(load, [load]);

  // Đóng popup bằng Escape — một hộp phủ toàn màn hình mà chỉ đóng được bằng cách nhắm đúng
  // cái nút thì phiền, nhất là trên màn hẹp.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const worst = usage?.ok ? worstMetric(usage.metrics) : null;

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        {usage === null ? (
          <span className="text-[var(--color-mist)]">Đang đọc mức dùng…</span>
        ) : usage.ok ? (
          <>
            <span className="text-[var(--color-mist)]">Vercel 30 ngày:</span>
            {worst ? (
              <span className={toneOf(worst)}>
                {worst.label} {formatUsed(worst)}
                {formatLimit(worst) ? ` / ${formatLimit(worst)}` : ""}
                {(usedRatio(worst) ?? 0) >= 1 && " — VƯỢT HẠN"}
              </span>
            ) : (
              <span className="text-[var(--color-mist)]">chưa có số liệu</span>
            )}
            <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(true)}>
              Chi tiết
            </button>
          </>
        ) : (
          <span className="text-[var(--color-mist)]">Mức dùng: {usage.error}</span>
        )}
      </div>

      {open && usage?.ok && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,8,20,0.72)] p-4"
          onClick={(event) => {
            // Chỉ đóng khi bấm trúng TẤM PHỦ, không phải khi bấm vào ruột hộp.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="card card-hairline max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-1 flex items-start justify-between gap-4">
              <h3 className="h-display text-lg font-semibold text-gilded">Mức dùng Vercel —「{mirror.name}」</h3>
              <button type="button" className="btn btn-ghost px-2 py-0.5 text-sm" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <p className="mb-4 text-xs text-[var(--color-mist)]">
              {usage.windowDays} ngày gần nhất · {usage.daysWithData} ngày có lưu lượng
              {usage.lastUpdate && ` · Vercel cập nhật ${new Date(usage.lastUpdate).toLocaleString("vi-VN")}`}
            </p>

            <div className="flex flex-col gap-3">
              {usage.metrics.map((metric) => {
                const limit = formatLimit(metric);
                const ratio = usedRatio(metric);
                return (
                  <div key={metric.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{metric.label}</span>
                      <span className={`font-mono text-xs ${toneOf(metric)}`}>
                        {formatUsed(metric)}
                        {limit ? ` / ${limit}` : ""}
                        {ratio != null && ` · ${(ratio * 100).toFixed(ratio >= 1 ? 0 : 1)}%`}
                      </span>
                    </div>
                    <UsageBar metric={metric} />
                    <p className="mt-0.5 font-mono text-[0.65rem] text-[var(--color-mist)]">{metric.from}</p>
                  </div>
                );
              })}
            </div>

            {/* Hai lời thú nhận, và cả hai đều cần: người đọc một bảng số phải biết nó đo cái
                gì và số nào là do ta tự khai. */}
            <p className="mt-5 border-t border-[rgba(232,194,92,0.18)] pt-3 text-xs text-[var(--color-mist)]">
              Số đo là của cả <b>TÀI KHOẢN VERCEL</b> giữ trạm này, không riêng một project — token
              không hẹp xuống project được ở endpoint này. Theo lệ mỗi trạm một tài khoản riêng thì
              hai thứ ấy trùng nhau; nuôi thêm project khác trong cùng tài khoản thì con số gộp cả
              chúng.
            </p>
            <p className="mt-2 text-xs text-[var(--color-mist)]">
              Hạn mức là của gói <b>Hobby</b>, chép tay từ bảng Usage trên dashboard — API chỉ phát ra
              phần đã dùng, không phát ra hạn. Vercel đổi hạn thì bảng này nói sai cho tới khi có
              người sửa <code>vercelUsage.ts</code>.
            </p>

            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-ghost text-sm" onClick={load}>
                Đọc lại
              </button>
              <a
                className="btn btn-ghost text-sm"
                href="https://vercel.com/dashboard/usage"
                target="_blank"
                rel="noreferrer"
              >
                Mở bảng Usage trên Vercel ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
