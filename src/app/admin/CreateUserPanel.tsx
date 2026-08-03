"use client";

import { useActionState, useState } from "react";
import { createUserAction, type AdminResult } from "@/app/actions/admin";

/**
 * Thu nhận thẳng một đạo hữu, không qua cổng đăng ký. Panel gập lại mặc định vì đây là
 * việc hiếm — thứ admin mở trang này để làm hằng ngày là duyệt hàng chờ, không phải tạo
 * người mới.
 */
export function CreateUserPanel() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    createUserAction,
    null,
  );

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        + Thu nhận đạo hữu mới
      </button>
    );
  }

  return (
    <div className="card card-hairline p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="h-display text-lg font-semibold text-gilded">Thu Nhận Đạo Hữu</h2>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Thu lại
        </button>
      </div>

      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-username">
            Đạo hiệu
          </label>
          <input id="new-username" name="username" className="input font-mono" required />
        </div>
        <div>
          <label className="label" htmlFor="new-displayName">
            Danh xưng
          </label>
          <input id="new-displayName" name="displayName" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="new-email">
            Email
          </label>
          <input
            id="new-email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            required
            maxLength={254}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            Mật khẩu
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="new-role">
              Vai trò
            </label>
            <select id="new-role" name="role" className="input" defaultValue="user">
              <option value="user">Môn đồ</option>
              <option value="admin">Trưởng môn</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-status">
              Trạng thái
            </label>
            <select id="new-status" name="status" className="input" defaultValue="active">
              <option value="active">Đã thu nhận</option>
              <option value="pending">Chờ duyệt</option>
              <option value="disabled">Đình quyền</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:col-span-2">
          <button type="submit" className="btn btn-gold" disabled={pending}>
            {pending ? "Đang thu nhận…" : "Thu Nhận"}
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
      </form>
    </div>
  );
}
