"use client";

import { useActionState } from "react";
import { registerAction, type FormState } from "@/app/actions/auth";

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="username">
          Đạo hiệu (tên đăng nhập)
        </label>
        <input id="username" name="username" className="input" autoComplete="username" required minLength={3} maxLength={32} />
      </div>

      <div>
        <label className="label" htmlFor="displayName">
          Danh xưng hiển thị
        </label>
        <input id="displayName" name="displayName" className="input" autoComplete="nickname" required minLength={2} maxLength={64} />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Mật khẩu
        </label>
        <input id="password" name="password" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Nhập lại mật khẩu
        </label>
        <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </div>

      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-gold mt-2" disabled={pending}>
        {pending ? "Đang dâng thiếp bái sư…" : "Bái Sư"}
      </button>
    </form>
  );
}
