"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label className="label" htmlFor="username">
          Đạo hiệu
        </label>
        <input id="username" name="username" className="input" autoComplete="username" required />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Mật khẩu
        </label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>

      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-gold mt-2" disabled={pending}>
        {pending ? "Đang khai môn…" : "Nhập Môn"}
      </button>
    </form>
  );
}
