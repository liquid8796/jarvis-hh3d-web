"use client";

import { useActionState } from "react";
import { saveChatSettingsAction, type AdminResult } from "@/app/actions/admin";

/** Tab Đàm Đạo: hiện chỉ một núm — hạn lưu tin. Núm sau cứ xếp thêm vào form này. */
export function ChatSettingsForm({ retentionDays }: { retentionDays: number }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveChatSettingsAction,
    null,
  );

  return (
    <form action={action} className="card card-hairline max-w-xl p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Nghị Sự Đường</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        Sảnh đàm đạo là dòng chảy, không phải tàng thư — tin quá hạn sẽ tự tan để kho không
        phình theo năm tháng.
      </p>

      <label className="label" htmlFor="retentionDays">
        Tin nhắn sống bao nhiêu ngày
      </label>
      <input
        id="retentionDays"
        name="retentionDays"
        type="number"
        min={1}
        max={365}
        className="input max-w-[10rem] font-mono"
        defaultValue={retentionDays}
      />
      <p className="mt-1 text-xs text-[var(--color-mist)]">
        1–365 ngày. Tin cũ hơn mốc này bị quét ở nhịp dọn dẹp kế tiếp — cả nội dung lẫn cảm
        xúc đi kèm.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Hạn Lưu"}
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
