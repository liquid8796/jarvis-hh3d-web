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
 *
 * PHÂN VAI GIỮA HAI NGUỒN SỐ (12/08/2026): `/v2/usage` chỉ còn nuôi ĐÚNG dòng tóm tắt; **popup
 * chỉ vẽ bảng đầy đủ do GitHub Actions cào về**. Bản trước xếp cả hai vào popup và đó là một
 * popup tự cãi nhau: hai bảng, hai mốc thời gian, chung một tên meter mà hai con số lệch — người
 * đọc phải tự đoán cái nào là thật. Bảng cào LÀ bảng người ta thấy trên vercel.com (54 meter, có
 * cả Fluid Active CPU), còn API chỉ đọc được vài chỉ số và chỉ hai trong số ấy đối chiếu khớp.
 * Một câu hỏi thì một câu trả lời.
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
          </>
        ) : (
          <span className="text-[var(--color-mist)]">Mức dùng: {usage.error}</span>
        )}
        {/* Nút đứng NGOÀI ba nhánh trên, vì popup không còn đọc gì từ `/v2/usage` nữa. Trước đây
            nó nằm trong nhánh `usage.ok`, nên đúng lúc API hỏng — lúc người ta cần con số nhất —
            bảng cào vẫn nằm sẵn trong sổ mà không có đường nào mở ra. */}
        <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(true)}>
          Chi tiết
        </button>
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
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,8,20,0.72)] p-4"
          onClick={(event) => {
            // Chỉ đóng khi bấm trúng TẤM PHỦ, không phải khi bấm vào ruột hộp.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="card card-hairline max-h-[85vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="mb-3 flex items-start justify-between gap-4">
              <h3 className="h-display text-lg font-semibold text-gilded">Mức dùng Vercel —「{mirror.name}」</h3>
              <button type="button" className="btn btn-ghost px-2 py-0.5 text-sm" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {/**
             * BẢNG ĐẦY ĐỦ — do GitHub Actions dựng trang Usage bằng Chromium thật rồi đẩy lên,
             * và từ 12/08/2026 là thứ DUY NHẤT trong popup này (xem ghi chú đầu tệp).
             *
             * Nó là thứ trả lời câu hỏi người ta mở popup ra để hỏi: Fluid Active CPU còn bao xa
             * thì chạm trần. Mốc「cào lúc」đứng ngay trên bảng vì số ở đây CŨ tới sáu tiếng — bảng
             * không mang mốc thì người đọc tưởng nó vừa được đọc lúc bấm.
             */}
            {mirror.usageReport ? (
              <>
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
              </>
            ) : (
              /* Trạng thái THẬT, không phải phòng xa: lượt cào bỏ qua trạm nào chưa khai cookie
                 trong Secrets của repo, và trạm vừa thêm vào sổ thì còn tới sáu tiếng mới có
                 bảng. Không nói ra thì popup trống trơn trông như hỏng. */
              <p className="text-xs text-[var(--color-mist)]">
                Chưa có bảng đầy đủ cho trạm này. Bảng do GitHub Actions dựng trang Usage bằng
                Chromium rồi đẩy về, sáu giờ một lượt — trạm chưa khai cookie trong Secrets thì
                lượt cào bỏ qua nó (xem <span className="font-mono">.github/workflows/vercel-usage.yml</span>).
              </p>
            )}

            {/* Nét kẻ ngang tách bảng số khỏi hàng nút. */}
            <div className="mt-5 flex gap-2 border-t border-[rgba(232,194,92,0.18)] pt-3">
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
