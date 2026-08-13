"use client";

import { useActionState, useState } from "react";
import { saveJobEventsSettingsAction, type AdminResult } from "@/app/actions/admin";
import {
  JOB_EVENTS_PURGE_INTENT,
  JOB_EVENT_SWEEP_CLOCK_MINUTES,
  RETENTION_UNITS,
  formatRetention,
  formatSweepInterval,
  parseRetentionHours,
  retentionUnitSpec,
  splitRetention,
  type RetentionUnit,
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
 * vẫn y nguyên cho tới nhịp quét kế. Từ 13/08/2026 nhịp ấy bám theo hạn lưu (một phần sáu) thay
 * vì đứng im ở một lần mỗi ngày, nên khoảng chờ đã ngắn đi rất nhiều — nút vẫn đáng giữ cho hai
 * ca nó vốn phục vụ: muốn thấy kết quả NGAY, và không có khôi lỗi nào đang trực để chở nhịp quét.
 *
 * HAI NÚT, MỘT ACTION, phân nhánh bằng `intent`. Bản đầu cho nút quét một action riêng và một
 * `useState` riêng, và thế là một khung chữ có hai nguồn: phải đoán cái nào mới hơn, mà phép
 * đoán ấy lại dựa vào thứ tự `onSubmit` chạy trước form action — một chi tiết nội bộ của React
 * không đáng để một dòng thông báo phụ thuộc vào.
 *
 * SỐ + ĐƠN VỊ (từ bản 0.72.0), và ô số KHÔNG tự đổi giá trị khi đổi đơn vị: đổi hộ là quyết
 * định hộ, mà「7」có thể là 7 ngày người ta đang gõ dở lẫn 7 giờ người ta vừa định. Thay vào đó
 * là một dòng ĐANG XEM ngay dưới ô — người gõ đọc thấy「Sẽ giữ: 7 giờ」thì biết ngay mình vừa
 * cắt hạn lưu đi 24 lần, trước khi bấm Lưu chứ không phải sau.
 */
export function JobEventRetentionForm({
  retentionHours,
  total,
  expired,
}: {
  retentionHours: number;
  total: number;
  expired: number;
}) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveJobEventsSettingsAction,
    null,
  );

  const saved = splitRetention(retentionHours);
  const [unit, setUnit] = useState<RetentionUnit>(saved.unit);
  const [amount, setAmount] = useState(String(saved.amount));
  const spec = retentionUnitSpec(unit);

  // Đúng phép kiểm mà server sẽ chạy, gọi ngay trên bàn phím — nên dòng xem trước không bao giờ
  // hứa một thứ mà cú bấm Lưu lại từ chối.
  const preview = parseRetentionHours(amount, unit);

  const n = (v: number) => v.toLocaleString("vi-VN");

  return (
    <form action={action} className="card card-hairline max-w-xl p-6">
      <h2 className="h-display mb-5 text-lg font-semibold text-gilded">Hạn Lưu Nhật Ký Đàn</h2>

      <label className="label" htmlFor="jobEventRetentionAmount">
        Nhật ký sống bao lâu
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="jobEventRetentionAmount"
          name="retentionAmount"
          type="number"
          min={spec.min}
          max={spec.max}
          className="input max-w-[10rem] font-mono"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <select
          aria-label="Đơn vị hạn lưu"
          name="retentionUnit"
          className="input max-w-[7rem]"
          value={unit}
          onChange={(event) => setUnit(event.target.value as RetentionUnit)}
        >
          {RETENTION_UNITS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-mist)]">
          {preview.ok ? (
            <>
              Sẽ giữ:{" "}
              <span className="font-mono text-[var(--color-gold-300)]">
                {formatRetention(preview.hours)}
              </span>
            </>
          ) : (
            <span className="text-[#f2a0a0]">{preview.message}</span>
          )}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-mist)]">
        {spec.min}–{spec.max} {spec.label}. Bản thân các đàn KHÔNG bị đụng tới — chỉ nhật ký của
        chúng.
      </p>
      {/* Nhịp quét KHÔNG phụ thuộc con số đang gõ, nên dòng này đứng ngoài mọi nhánh: nó là tính
          chất của hệ, không phải của thứ sắp lưu. Trước 13/08/2026 chỗ này là một lời xin lỗi in
          đậm — nhịp tự động chạy MỘT LẦN MỖI NGÀY nên mọi hạn lưu ngắn hơn ngày đều không được thi
          hành. Con số dưới đây là lời hứa VÔ ĐIỀU KIỆN (đồng hồ ngoài), không phải nhịp tốt nhất
          trong điều kiện thuận lợi — hứa cái tốt nhất là cách nhanh nhất để lại nói dối. */}
      <p className="mt-1 text-xs text-[var(--color-mist)]">
        Dòng nhật ký cũ hơn mốc này bị quét mỗi{" "}
        <span className="font-mono text-[var(--color-gold-300)]">
          {formatSweepInterval(JOB_EVENT_SWEEP_CLOCK_MINUTES * 60_000)}
        </span>{" "}
        — chạy bằng đồng hồ ngoài, không cần khôi lỗi đang trực và cũng không cần ai mở web.
      </p>

      <div className="mt-4 rounded-lg border border-[rgba(232,194,92,0.28)] px-4 py-3 text-xs">
        <p className="text-[var(--color-mist)]">
          Đang có <span className="font-mono text-[var(--color-gold-300)]">{n(total)}</span> dòng,
          trong đó <span className="font-mono text-[var(--color-gold-300)]">{n(expired)}</span> dòng
          đã quá hạn theo mốc đang lưu ({formatRetention(retentionHours)}).
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
