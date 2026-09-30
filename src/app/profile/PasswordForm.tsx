"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  updatePasswordAction,
  type PasswordResult,
} from "@/app/actions/profile";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordResult, FormData>(
    updatePasswordAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card card-hairline mt-6 flex flex-col gap-4 p-6 sm:p-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.14em] text-[var(--color-gold-300)]">
          Bảo mật tài khoản
        </p>
        <h2 className="h-display mt-1 text-xl font-bold text-[var(--color-parchment)]">
          Đổi mật khẩu
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-mist)]">
          Xác nhận mật khẩu hiện tại rồi đặt mật khẩu mới từ 8 ký tự.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="current-password">Mật khẩu hiện tại</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-password">Mật khẩu mới</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">Nhập lại mật khẩu mới</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
        </div>
      </div>

      {state && (
        <p
          role="status"
          className={
            "rounded-lg border px-3 py-2 text-sm " +
            (state.ok
              ? "border-emerald-400/30 bg-emerald-500/10 text-[var(--color-jade-300)]"
              : "border-red-400/30 bg-red-500/10 text-red-300")
          }
        >
          {state.message}
        </p>
      )}

      <button type="submit" className="btn btn-gold self-start" disabled={pending}>
        {pending ? "Đang cập nhật…" : "Cập Nhật Mật Khẩu"}
      </button>
    </form>
  );
}
