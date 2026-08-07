"use client";

import { useActionState } from "react";
import { saveGameDomainAction, type AdminResult } from "@/app/actions/admin";

/**
 * Tên miền hoathinh3d đang sống — ô cấu hình mà cả tông môn phụ thuộc vào.
 *
 * Đứng chung tab Bảo Trì vì cùng một loại việc: thứ trưởng môn chạm vào khi hệ thống đang
 * trục trặc. Và hai thứ ấy thường đi cùng nhau — dời tên miền là một dịp nên bế quan.
 *
 * Hậu quả「đổi tên miền là mọi cookie đã lưu chết theo」KHÔNG còn nằm trên nút bấm nữa —
 * form giữ đúng phần thao tác. Lời nhắc ấy vẫn còn nguyên ở hai chỗ nó thật sự cần đến:
 * thông báo trả về sau khi lưu (`saveGameDomainAction`), và dòng lỗi mà chính vòng chạy nói
 * ra khi phiên đăng nhập không còn dùng được.
 */
export function GameDomainForm({ baseUrl }: { baseUrl: string }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    saveGameDomainAction,
    null,
  );

  return (
    <form action={action} className="card card-hairline p-6">
      {/* `mb-5` chứ không `mb-2`: dòng dẫn nhập bên dưới tiêu đề đã bỏ, nên chính tiêu đề
          phải gánh khoảng thở trước ô nhập. */}
      <h2 className="h-display mb-5 text-lg font-semibold text-gilded">Tên Miền Game</h2>

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
