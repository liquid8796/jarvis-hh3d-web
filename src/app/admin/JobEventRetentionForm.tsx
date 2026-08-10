"use client";

import { useActionState } from "react";
import { saveJobEventsSettingsAction, type AdminResult } from "@/app/actions/admin";
import {
  JOB_EVENTS_PURGE_INTENT,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
} from "@/lib/validation/retention";

/**
 * Hạn lưu NHẬT KÝ ĐÀN — tab Bảo Trì.
 *
 * Khác form hạn lưu đàm đạo ở một chỗ có chủ ý: nó KỂ SỐ. `job_events` là bảng lớn nhất trong
 * một lượt chuyển trạm, nên con số gõ ở đây quyết định một lượt bế quan dài bao lâu — mà gõ một
 * con số vào chỗ trống thì không ai biết mình vừa quyết định điều gì. Hai số dưới đây (đang có
 * / đã quá hạn) biến cái núm thành một quyết định có căn cứ.
 *
 * Nút「Quét ngay」đứng cạnh vì thiếu nó cái núm trông như hỏng: hạ 30 ngày xuống 7 rồi mà bảng
 * vẫn y nguyên tới nhịp cron kế — gói Hobby chỉ chạy MỘT LẦN MỘT NGÀY.
 *
 * HAI NÚT, MỘT ACTION, phân nhánh bằng `intent`. Bản đầu cho nút quét một action riêng và một
 * `useState` riêng, và thế là một khung chữ có hai nguồn: phải đoán cái nào mới hơn, mà phép
 * đoán ấy lại dựa vào thứ tự `onSubmit` chạy trước form action — một chi tiết nội bộ của React
 * không đáng để một dòng thông báo phụ thuộc vào.
 */
export function JobEventRetentionForm({
  retentionDays,
  total,
  expired,
}: {
  retentionDays: number;
  total: number;
  expired: number;
}) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveJobEventsSettingsAction,
    null,
  );

  const n = (v: number) => v.toLocaleString("vi-VN");

  return (
    <form action={action} className="card card-hairline max-w-xl p-6">
      <h2 className="h-display mb-5 text-lg font-semibold text-gilded">Hạn Lưu Nhật Ký Đàn</h2>

      <label className="label" htmlFor="jobEventRetentionDays">
        Nhật ký sống bao nhiêu ngày
      </label>
      <input
        id="jobEventRetentionDays"
        name="retentionDays"
        type="number"
        min={RETENTION_MIN_DAYS}
        max={RETENTION_MAX_DAYS}
        className="input max-w-[10rem] font-mono"
        defaultValue={retentionDays}
      />
      <p className="mt-1 text-xs text-[var(--color-mist)]">
        {RETENTION_MIN_DAYS}–{RETENTION_MAX_DAYS} ngày. Dòng nhật ký cũ hơn mốc này bị quét ở
        nhịp dọn dẹp kế tiếp. Bản thân các đàn KHÔNG bị đụng tới — chỉ nhật ký của chúng.
      </p>

      <div className="mt-4 rounded-lg border border-[rgba(232,194,92,0.28)] px-4 py-3 text-xs">
        <p className="text-[var(--color-mist)]">
          Đang có <span className="font-mono text-[var(--color-gold-300)]">{n(total)}</span> dòng,
          trong đó <span className="font-mono text-[var(--color-gold-300)]">{n(expired)}</span> dòng
          đã quá hạn theo mốc đang lưu ({retentionDays} ngày).
        </p>
        <p className="mt-1 text-[var(--color-mist)]">
          Đây là bảng LỚN NHẤT trong một lượt chuyển trạm — nới hạn lưu thì giữ nhật ký lâu hơn,
          đổi lại mỗi lượt chuyển trạm bế quan lâu hơn.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Hạn Lưu"}
        </button>
        {/* Gõ Enter trong ô số KHÔNG gửi kèm `intent` của nút nào — mặc định về nhánh lưu, đúng
            ý người đang gõ dở một con số. */}
        <button
          type="submit"
          name="intent"
          value={JOB_EVENTS_PURGE_INTENT}
          className="btn btn-ghost"
          disabled={pending || expired === 0}
        >
          Quét ngay
        </button>
        {state && (
          <p
            role="status"
            className={`text-sm ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
          >
            {state.message}
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--color-mist)]">
        「Quét ngay」dùng mốc ĐANG LƯU, không phải con số đang gõ dở ở trên — đổi hạn lưu thì bấm
        Lưu trước rồi mới quét.
      </p>
    </form>
  );
}
