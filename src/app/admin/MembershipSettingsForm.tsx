"use client";

import { useActionState, useState } from "react";
import { saveMembershipSettingsAction, type AdminResult } from "@/app/actions/admin";

/**
 * Môn quy — một công tắc: cổng bái sư có người gác hay không.
 *
 * Đặt ở tab Môn Đồ chứ không tách tab riêng, vì nó cai quản đúng cái hàng chờ nằm ngay bên
 * dưới. Trưởng môn gạt công tắc và nhìn thấy hậu quả trong cùng một màn hình.
 *
 * Dựng như một CỤM ĐIỀU KHIỂN, không phải một thẻ có tiêu đề: nó đứng chung hàng với nút
 * "Thu nhận đạo hữu mới" trên thanh công cụ của tab (xem admin/page.tsx), mà một thẻ có h2
 * thì không thể ngang hàng với một cái nút. Tiêu đề cũ「Môn Quy — Cổng Bái Sư」và dòng dẫn
 * nhập bỏ đi vì trùng nghĩa, không phải vì thiếu chỗ: nhãn ô tick đã nói đúng việc nó làm,
 * còn dòng trạng thái ngay dưới nói CỤ THỂ HƠN cả dòng dẫn nhập — nó kể tình trạng đang có
 * thật, chứ không mô tả chung chung.
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
    // `min-w-0` vì đây là một flex item trên thanh công cụ: thiếu nó, dòng trạng thái dài
    // sẽ chống cụm này phình ra và đẩy nút thu nhận rớt xuống hàng dưới.
    <form action={action} className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
          <input
            type="checkbox"
            name="requireApproval"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="h-4 w-4 accent-[var(--color-jade-400)]"
          />
          Xét duyệt thành viên mới
        </label>

        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Môn Quy"}
        </button>

        {state && (
          <p role="status" className={`text-sm ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
            {state.message}
          </p>
        )}
      </div>

      <p className="mt-2 text-xs text-[var(--color-mist)]">
        {checked
          ? "ĐANG BẬT — người mới bái sư dừng ở phòng chờ tới khi trưởng môn điểm danh."
          : "ĐANG TẮT — người mới bái sư được thu nhận ngay và vào thẳng Auto."}
      </p>

      {/* Tắt cổng KHÔNG với tay ngược về quá khứ: ai đã đứng sẵn trong hàng chờ vẫn đứng đó,
          và sẽ đứng mãi nếu không ai nói cho trưởng môn biết họ còn ở đấy. */}
      {!checked && pendingCount > 0 && (
        <p className="mt-3 max-w-xl rounded-lg border border-[var(--color-gold-300)]/40 bg-[var(--color-ink-600)]/40 p-3 text-xs leading-relaxed text-[var(--color-parchment)]">
          <span className="font-semibold text-gilded">Còn {pendingCount} đạo hữu trong hàng chờ.</span>{" "}
          Mở cổng chỉ áp cho người bái sư từ giờ trở đi — những người đã dâng thiếp trước đó
          vẫn nằm nguyên trong hàng chờ. Duyệt họ trong bảng môn đồ bên dưới.
        </p>
      )}
    </form>
  );
}
