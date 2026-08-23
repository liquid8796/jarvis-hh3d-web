"use client";

import { useActionState, useState } from "react";
import { saveDailyResetAction, type AdminResult } from "@/app/actions/admin";

/**
 * Luật「sang ngày mới thì chạy lại từ đầu」— một công tắc, và một lời cảnh báo phải đọc trước
 * khi bấm.
 *
 * Đứng chung tab Bảo Trì với Tên Miền Game và Trình Duyệt vì cùng loại: thứ trưởng môn chạm vào
 * để đổi nết của cả tông môn, chứ không phải thứ dùng hằng ngày.
 *
 * Cái giá hiện NGAY khi người ta gạt công tắc chứ không đợi tới lúc lưu: đây là luật duy nhất
 * trong trang này cắt ngang việc đang chạy của người khác, và một lời cảnh báo đọc được sau khi
 * đã bấm là một lời cảnh báo tới muộn.
 */
export function DailyResetForm({ enabled, lastRunDay }: { enabled: boolean; lastRunDay: string | null }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(saveDailyResetAction, null);
  const [on, setOn] = useState(enabled);

  return (
    <form action={action} className="card card-hairline p-6">
      <h2 className="h-display mb-5 text-lg font-semibold text-gilded">Sang Ngày Mới Thì Chạy Lại</h2>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="enabled"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--color-gold-400)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--color-parchment)]">
            Đúng 00:00 giờ Việt Nam, mọi đàn bỏ trạng thái cũ và vào vòng mới
          </span>
          <span className="mt-1 block text-xs text-[var(--color-mist)]">
            Đàn đang nghỉ thôi đếm ngược, vào vòng mới ngay. Đàn đang cày sẽ buông ở điểm an toàn
            kế tiếp rồi cũng chạy lại từ đầu.
          </span>
        </span>
      </label>

      {on && !enabled && (
        // Chỉ hiện đúng lúc người ta vừa gạt sang BẬT mà chưa lưu — tức đúng lúc lời này còn kịp
        // đổi ý ai đó. Hiện thường trực thì nó thành một dòng chữ người ta quen mắt rồi thôi đọc.
        <p className="mt-3 rounded-lg border border-[var(--color-gold-400)]/40 bg-[var(--color-ink-600)]/40 p-3 text-xs text-[var(--color-mist)]">
          Nên biết trước: vòng đang chạy dở lúc nửa đêm sẽ bị bỏ giữa chừng. Nhiệm vụ dài như Mê
          Cung mà đang đánh thì mất công trận đó. Đổi lại, không đàn nào còn cày tiếp cho cái ngày
          vừa qua.
        </p>
      )}

      <p className="mt-3 text-xs text-[var(--color-mist)]">
        {lastRunDay ? `Lượt gần nhất: ngày ${lastRunDay}.` : "Chưa chạy lượt nào."}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Lựa Chọn"}
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
