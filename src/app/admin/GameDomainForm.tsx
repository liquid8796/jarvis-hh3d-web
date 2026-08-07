"use client";

import { useActionState } from "react";
import { saveGameDomainAction, type AdminResult } from "@/app/actions/admin";

/**
 * Tên miền hoathinh3d đang sống — ô cấu hình mà cả tông môn phụ thuộc vào.
 *
 * Đứng chung tab Bảo Trì vì cùng một loại việc: thứ trưởng môn chạm vào khi hệ thống đang
 * trục trặc. Và hai thứ ấy thường đi cùng nhau — dời tên miền là một dịp nên bế quan.
 *
 * Cảnh báo về cookie nằm ngay trên nút bấm, không nằm trong thông báo sau khi lưu: hậu quả
 * cần được đọc TRƯỚC khi bấm, vì sau đó thì mọi tài khoản đã mất phiên rồi.
 */
export function GameDomainForm({ baseUrl }: { baseUrl: string }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveGameDomainAction,
    null,
  );

  return (
    <form action={action} className="card card-hairline p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Tên Miền Game</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        hoathinh3d đổi tên miền định kỳ. Đổi ở đây là mọi linh sứ — cả trên VM tông môn lẫn máy
        nhà từng đạo hữu — dùng tên miền mới ngay từ vòng chạy kế, không ai phải cài lại gì.
      </p>

      <label className="label" htmlFor="baseUrl">
        Tên miền đang dùng
      </label>
      <input
        id="baseUrl"
        name="baseUrl"
        type="text"
        required
        maxLength={200}
        defaultValue={baseUrl}
        placeholder="hoathinh3d.one"
        className="input font-mono"
        spellCheck={false}
        autoComplete="off"
      />
      <p className="mt-1 text-xs text-[var(--color-mist)]">
        Gõ kiểu nào cũng được — <span className="font-mono">hoathinh3d.one</span> hay{" "}
        <span className="font-mono">https://hoathinh3d.one/</span> — đều được chuẩn hoá về đúng
        một origin.
      </p>

      {/* Hậu quả phải đọc được TRƯỚC khi bấm. */}
      <p className="mt-4 rounded-lg border border-[var(--color-gold-300)]/40 bg-[var(--color-ink-600)]/40 p-3 text-xs leading-relaxed text-[var(--color-parchment)]">
        <span className="font-semibold text-gilded">Đổi tên miền là mọi cookie đã lưu mất hiệu lực.</span>{" "}
        Cookie gắn chặt vào tên miền nên chúng không đi theo được — sau khi đổi, từng đạo hữu
        phải vào Linh Đài dán lại chuỗi cookie lấy từ tên miền MỚI. Đàn đang chạy sẽ báo hết
        phiên đăng nhập cho tới khi việc đó xong.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Lưu Tên Miền"}
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
