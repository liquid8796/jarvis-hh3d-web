"use client";

import { useActionState, useState } from "react";
import { saveMembershipSettingsAction, type AdminResult } from "@/app/actions/admin";

/**
 * Môn quy — một công tắc: cổng bái sư có người gác hay không.
 *
 * Đặt ở tab Môn Đồ chứ không tách tab riêng, vì nó cai quản đúng cái hàng chờ nằm ngay bên
 * dưới. Trưởng môn gạt công tắc và nhìn thấy hậu quả trong cùng một màn hình.
 *
 * Ô tick giữ state cục bộ chỉ để CẢNH BÁO TRƯỚC KHI LƯU: thấy hậu quả rồi mới bấm lưu thì
 * tốt hơn nhiều so với bấm lưu rồi mới biết mình bỏ quên ai.
 */
export function MembershipSettingsForm({
  requireApproval,
  pendingCount,
}: {
  requireApproval: boolean;
  pendingCount: number;
}) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveMembershipSettingsAction,
    null,
  );
  const [checked, setChecked] = useState(requireApproval);

  return (
    <form action={action} className="card card-hairline p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Môn Quy — Cổng Bái Sư</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        Quyết định người mới dâng thiếp xong thì vào hàng chờ, hay được thu nhận ngay.
      </p>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--color-parchment)]">
        <input
          type="checkbox"
          name="requireApproval"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-jade-400)]"
        />
        <span>
          <span className="font-semibold">Xét duyệt thành viên mới</span>
          <span className="mt-1 block text-xs text-[var(--color-mist)]">
            {checked
              ? "ĐANG BẬT — người mới bái sư dừng ở phòng chờ tới khi trưởng môn điểm danh."
              : "ĐANG TẮT — người mới bái sư được thu nhận ngay và vào thẳng Linh Đài."}
          </span>
        </span>
      </label>

      {/* Tắt cổng KHÔNG với tay ngược về quá khứ: ai đã đứng sẵn trong hàng chờ vẫn đứng đó,
          và sẽ đứng mãi nếu không ai nói cho trưởng môn biết họ còn ở đấy. */}
      {!checked && pendingCount > 0 && (
        <p className="mt-4 rounded-lg border border-[var(--color-gold-300)]/40 bg-[var(--color-ink-600)]/40 p-3 text-xs leading-relaxed text-[var(--color-parchment)]">
          <span className="font-semibold text-gilded">Còn {pendingCount} đạo hữu trong hàng chờ.</span>{" "}
          Mở cổng chỉ áp cho người bái sư từ giờ trở đi — những người đã dâng thiếp trước đó
          vẫn nằm nguyên trong hàng chờ. Duyệt họ trong bảng môn đồ bên dưới.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Môn Quy"}
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
