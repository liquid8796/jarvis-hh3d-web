"use client";

import { useRef, useState, useTransition } from "react";
import {
  addAccountAction,
  deleteAccountAction,
  renameAccountAction,
  toggleAccountAction,
  updateAccountCookieAction,
  type ActionResult,
} from "@/app/actions/automation";
import { useDashboardAccountLive } from "./DashboardLiveProvider";
import type { DashboardAccount } from "@/lib/realtime/dashboardTypes";

/**
 * Tài khoản hoathinh3d — số nhiều, như bản desktop. Danh sách sống bằng realtime: verdict
 * hạng do khôi lỗi dò được đẩy về qua SSE và huy hiệu đổi không cần F5.
 *
 * Component này đứng NGOÀI <form> của Ngọc Giản Cấu Hình (React 19 reset uncontrolled input
 * trong form sau mỗi action — draft cookie đang gõ không được phép bay theo một cú Khắc
 * Ngọc Giản). Vẫn giữ hai thói quen phòng thủ: nút đều type="button" và input không mang
 * `name`, để lỡ ai bọc lại vào form cũng không vỡ. Cookie đi MỘT CHIỀU: dán vào thì được,
 * không bao giờ đọc lại ra màn hình.
 */

function TierBadge({ tier }: { tier: DashboardAccount["accountTier"] }) {
  if (tier === "vip") {
    return <span className="badge badge-active">Hạng VIP</span>;
  }
  if (tier === "free") {
    return <span className="badge badge-active">Hạng thường</span>;
  }
  return <span className="badge badge-pending">Chưa dò hạng</span>;
}

export function AccountManager() {
  const { accounts } = useDashboardAccountLive();
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const addLabelRef = useRef<HTMLInputElement>(null);
  const addCookieRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const cookieRef = useRef<HTMLTextAreaElement>(null);

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    startTransition(async () => {
      const result = await fn();
      setNotice(result);
      if (result.ok) onOk?.();
    });
  };

  const addAccount = () => {
    const formData = new FormData();
    formData.set("label", addLabelRef.current?.value ?? "");
    formData.set("cookie", addCookieRef.current?.value ?? "");
    run(
      () => addAccountAction(formData),
      () => {
        if (addLabelRef.current) addLabelRef.current.value = "";
        if (addCookieRef.current) addCookieRef.current.value = "";
        setAdding(false);
      },
    );
  };

  const renameAccount = (accountId: string) => {
    const formData = new FormData();
    formData.set("accountId", accountId);
    formData.set("label", renameRef.current?.value ?? "");
    run(() => renameAccountAction(formData));
  };

  const replaceCookie = (accountId: string) => {
    const formData = new FormData();
    formData.set("accountId", accountId);
    formData.set("cookie", cookieRef.current?.value ?? "");
    run(
      () => updateAccountCookieAction(formData),
      () => {
        if (cookieRef.current) cookieRef.current.value = "";
        setEditingId(null);
      },
    );
  };

  const toggleAccount = (account: DashboardAccount, enabled: boolean) => {
    const formData = new FormData();
    formData.set("accountId", account.id);
    formData.set("enabled", enabled ? "on" : "off");
    run(() => toggleAccountAction(formData));
  };

  const deleteAccount = (account: DashboardAccount) => {
    if (
      !confirm(
        `Xoá「${account.label}」? Cookie và toàn bộ lịch sử chạy của tài khoản này sẽ mất, không lấy lại được.`,
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("accountId", account.id);
    run(
      () => deleteAccountAction(formData),
      () => setEditingId(null),
    );
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="label mb-0">
          Tài khoản hoathinh3d
          {accounts.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--color-mist)]">
              {accounts.filter((account) => account.enabled).length}/{accounts.length} đang bật
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-jade"
          disabled={pending}
          onClick={() => {
            setAdding((current) => !current);
            setEditingId(null);
            setNotice(null);
          }}
        >
          {adding ? "Đóng" : "＋ Thêm tài khoản"}
        </button>
      </div>

      {accounts.length === 0 && !adding && (
        <p className="mb-2 rounded-xl border border-dashed border-[var(--color-ink-600)] p-4 text-sm text-[var(--color-mist)]">
          Chưa có tài khoản nào. Bấm「＋ Thêm tài khoản」rồi dán chuỗi cookie đăng nhập —
          mỗi tài khoản một cookie, chạy được nhiều tài khoản cùng lúc.
        </p>
      )}

      {adding && (
        <div className="mb-3 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
          <label className="label" htmlFor="newAccountLabel">
            Tên gợi nhớ (không bắt buộc)
          </label>
          <input
            id="newAccountLabel"
            ref={addLabelRef}
            className="input mb-3"
            placeholder={`Ví dụ: Tài khoản ${accounts.length + 1}`}
            maxLength={60}
            disabled={pending}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
          <label className="label" htmlFor="newAccountCookie">
            Chuỗi cookie đăng nhập
          </label>
          <textarea
            id="newAccountCookie"
            ref={addCookieRef}
            className="input h-24 resize-y font-mono text-xs"
            placeholder="Dán chuỗi cookie đăng nhập vào đây ('a=1; b=2' từ DevTools hoặc bản xuất JSON)"
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Cookie giúp auto đăng nhập game thay bạn. Lưu xong sẽ được mã hoá và không bao giờ
            hiện lại trên màn hình.
          </p>
          <button
            type="button"
            className="btn btn-jade mt-3"
            disabled={pending}
            onClick={addAccount}
          >
            {pending ? "Đang lưu…" : "Lưu tài khoản"}
          </button>
        </div>
      )}

      {accounts.length > 0 && (
        <ul className="space-y-2">
          {accounts.map((account) => {
            const editing = editingId === account.id;
            return (
              <li
                key={account.id}
                className="rounded-xl border border-[var(--color-ink-600)]/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  {/* Công tắc "tài khoản này có ra trận không". Tắt giữa chừng thì đàn của
                      riêng nó được thu — các tài khoản khác không bị vạ lây. */}
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)]">
                    <input
                      type="checkbox"
                      checked={account.enabled}
                      disabled={pending}
                      onChange={(event) => toggleAccount(account, event.target.checked)}
                      className="h-4 w-4 accent-[var(--color-jade-400)]"
                    />
                    <span className={account.enabled ? "" : "opacity-50"}>{account.label}</span>
                  </label>
                  <TierBadge tier={account.accountTier} />
                  {!account.enabled && (
                    <span className="text-xs text-[var(--color-mist)]">đang tắt</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-ink-600)] px-2 py-0.5 text-xs text-[var(--color-mist)] transition-colors hover:text-[var(--color-gold-300)]"
                      disabled={pending}
                      onClick={() => {
                        setEditingId(editing ? null : account.id);
                        setAdding(false);
                        setNotice(null);
                      }}
                    >
                      {editing ? "Đóng" : "Sửa"}
                    </button>
                  </div>
                </div>

                {editing && (
                  <div className="mt-3 border-t border-[var(--color-ink-600)]/40 pt-3">
                    <label className="label" htmlFor={`rename-${account.id}`}>
                      Tên tài khoản
                    </label>
                    <div className="mb-3 flex gap-2">
                      <input
                        id={`rename-${account.id}`}
                        ref={renameRef}
                        className="input flex-1"
                        defaultValue={account.label}
                        maxLength={60}
                        disabled={pending}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            renameAccount(account.id);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => renameAccount(account.id)}
                      >
                        Lưu tên
                      </button>
                    </div>

                    <label className="label" htmlFor={`cookie-${account.id}`}>
                      Thay cookie
                    </label>
                    <textarea
                      id={`cookie-${account.id}`}
                      ref={cookieRef}
                      className="input h-20 resize-y font-mono text-xs"
                      placeholder="Dán chuỗi cookie MỚI để thay cho tài khoản này. Cookie cũ vẫn được giữ nếu để trống."
                      disabled={pending}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-jade"
                        disabled={pending}
                        onClick={() => replaceCookie(account.id)}
                      >
                        {pending ? "Đang lưu…" : "Lưu cookie mới"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger ml-auto"
                        disabled={pending}
                        onClick={() => deleteAccount(account)}
                      >
                        Xoá tài khoản
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notice && (
        <p
          role="status"
          className={`mt-2 text-sm ${notice.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}
