"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileResult } from "@/app/actions/profile";

export function ProfileForm({
  username,
  displayName,
  email,
}: {
  username: string;
  displayName: string;
  email: string | null;
}) {
  const [state, action, pending] = useActionState<ProfileResult, FormData>(
    updateProfileAction,
    null,
  );

  return (
    <form action={action} className="card card-hairline mt-6 flex flex-col gap-4 p-6 sm:p-8">
      <div>
        <label className="label" htmlFor="profile-username">
          Đạo hiệu
        </label>
        <input
          id="profile-username"
          className="input font-mono opacity-70"
          value={username}
          readOnly
          aria-describedby="profile-username-note"
        />
        <p id="profile-username-note" className="mt-1 text-xs text-[var(--color-mist)]">
          Đạo hiệu dùng để đăng nhập nên không đổi tại đây.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="profile-displayName">
          Danh xưng hiển thị
        </label>
        <input
          id="profile-displayName"
          name="displayName"
          className="input"
          defaultValue={displayName}
          autoComplete="nickname"
          required
          minLength={2}
          maxLength={64}
        />
      </div>

      <div>
        <label className="label" htmlFor="profile-email">
          Email
        </label>
        <input
          id="profile-email"
          name="email"
          type="email"
          className="input"
          defaultValue={email ?? ""}
          autoComplete="email"
          required
          maxLength={254}
        />
        {!email && (
          <p className="mt-1 text-xs text-[var(--color-gold-300)]">
            Tài khoản cũ chưa có email — hãy bổ sung để hoàn thiện hồ sơ.
          </p>
        )}
      </div>

      {state && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            state.ok
              ? "border-emerald-400/30 bg-emerald-500/10 text-[var(--color-jade-300)]"
              : "border-red-400/30 bg-red-500/10 text-red-300"
          }`}
        >
          {state.message}
        </p>
      )}

      <button type="submit" className="btn btn-gold mt-2 self-start" disabled={pending}>
        {pending ? "Đang lưu…" : "Lưu Hồ Sơ"}
      </button>
    </form>
  );
}
