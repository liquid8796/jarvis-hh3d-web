"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

/**
 * Chỉ số đáng lo nhất — thứ được kể trong dòng tóm tắt.
 *
 * Chỉ xét những chỉ số ĐÃ ĐỐI CHIẾU KHỚP bảng thật. Một con số thô không có hạn thì không có
 * tỉ lệ để so, mà kể cả nếu ta bịa cho nó một cái hạn thì dòng tóm tắt sẽ báo động về một cột
 * không tồn tại — đúng chuyện đã xảy ra ngày 11/08/2026 với「Function Duration 389%」.
 */
function worstMetric(metrics: UsageMetric[]): UsageMetric | null {
  let worst: UsageMetric | null = null;
  let worstRatio = -1;
  for (const metric of metrics) {
    if (!metric.matchesDashboard) continue;
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

      {/**
       * CỔNG RA `document.body`, không vẽ tại chỗ.
       *
       * `fixed inset-0 z-50` nghe như đủ, và nó KHÔNG đủ: thẻ này nằm sâu trong một dòng của
       * sổ trạm, mà tổ tiên của dòng ấy có `.card` mang nền mờ + biến đổi — bất kỳ tổ tiên nào
       * dựng một stacking context là `z-50` chỉ còn tranh chỗ TRONG context ấy, không tranh
       * được với những `.card` anh em ở ngoài. Triệu chứng đo được 11/08/2026: hộp hiện lên
       * nhưng nửa dưới bị đúng cái card của trạm kế tiếp đè lên.
       *
       * Portal đưa hộp ra thẳng `document.body` nên nó nằm ở gốc cây, cạnh mọi stacking
       * context khác chứ không nằm trong cái nào. Nâng z-index lên nữa thì vô ích — đó là lý
       * do phải sửa bằng cấu trúc, không sửa bằng con số.
       */}
      {open && usage?.ok && createPortal(
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

            {/**
             * BẢNG ĐẦY ĐỦ — do GitHub Actions dựng trang Usage bằng Chromium thật rồi đẩy lên.
             *
             * Đứng TRƯỚC bảng API vì nó mới là thứ trả lời câu hỏi người ta mở popup ra để hỏi:
             * Fluid Active CPU còn bao xa thì chạm trần. Bảng API bên trên chỉ có 2 cột đọc
             * được, nhưng nó là số ĐANG SỐNG (gọi ngay lúc mở), nên vẫn giữ — hai bảng trả lời
             * hai câu khác nhau, và mốc thời gian dưới đây nói rõ cái nào cũ hơn.
             */}
            {mirror.usageReport && (
              <div className="mt-5 border-t border-[rgba(232,194,92,0.18)] pt-4">
                <p className="mb-2 text-xs text-[var(--color-mist)]">
                  Bảng đầy đủ ({mirror.usageReport.meters.length} meter) — cào lúc{" "}
                  {new Date(mirror.usageReport.readAt).toLocaleString("vi-VN")}
                </p>
                <div className="flex flex-col gap-1">
                  {mirror.usageReport.meters.map((meter) => (
                    <div key={meter.title} className="flex items-baseline justify-between gap-3 text-xs">
                      <span>{meter.title}</span>
                      <span className="whitespace-nowrap font-mono text-[var(--color-parchment)]">
                        {meter.used}
                        {meter.limit ? ` / ${meter.limit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ba lời thú nhận. Người đọc một bảng số phải biết nó đo cái gì, số nào là do ta
                tự khai, và — quan trọng nhất — bảng này CÒN THIẾU gì. */}
            <p className="mt-5 border-t border-[rgba(232,194,92,0.18)] pt-3 text-xs text-[var(--color-mist)]">
              Chỉ hai dòng đầu đã <b>đối chiếu khớp</b> bảng Usage thật nên mới đeo hạn mức. Phần
              còn lại là <b>số thô của API</b>: nó không bằng cột nào trên dashboard, đừng đọc thành
              Fast Data Transfer hay Function Duration.
            </p>
            <p className="mt-2 text-xs text-[#f2a0a0]">
              Mấy meter đang thật sự siết một tài khoản Hobby — <b>Fluid Active CPU</b>,{" "}
              <b>Fluid Provisioned Memory</b>, Fast Origin Transfer, ISR — <b>có</b> trong{" "}
              <code>/v2/observability</code>, nhưng đọc giá trị thì Vercel đòi{" "}
              <b>Observability Plus</b> (gói Pro trở lên). Trên Hobby chỉ xem được ở dashboard —
              nút dưới đây.
            </p>
            <p className="mt-2 text-xs text-[var(--color-mist)]">
              Số đo là của cả <b>TÀI KHOẢN VERCEL</b> giữ trạm này, không riêng một project — token
              không hẹp xuống project được ở endpoint này. Hạn mức là của gói <b>Hobby</b>, chép tay
              từ dashboard vì API chỉ phát ra phần đã dùng.
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
        </div>,
        document.body,
      )}
    </>
  );
}
