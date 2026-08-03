"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  deleteUserAction,
  setStatusAction,
  updateUserAction,
  type AdminResult,
} from "@/app/actions/admin";
import type { PublicUser } from "@/lib/services/users";

/**
 * Bảng môn đồ. Ô tìm kiếm ghi vào URL (debounce 300ms) nên kết quả chia sẻ được và F5 vẫn
 * giữ; mọi nút hành động gọi thẳng server action rồi để `revalidatePath` vẽ lại — không có
 * bản sao danh sách nào sống trong client để mà lệch pha với server.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  active: "Đã thu nhận",
  disabled: "Đình quyền",
};

export function UserTable({
  users,
  query,
  status,
}: {
  users: PublicUser[];
  query: string;
  status: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(query);
  const [notice, setNotice] = useState<AdminResult | null>(null);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [pending, startTransition] = useTransition();

  // Debounce: gõ tới đâu URL đổi tới đó, nhưng không phải mỗi phím một lần điều hướng.
  useEffect(() => {
    if (search === query) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set("q", search);
      else next.delete("q");
      router.replace(`/admin?${next.toString()}`);
    }, 300);
    return () => clearTimeout(id);
  }, [search, query, params, router]);

  const setStatusFilter = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("status", value);
    else next.delete("status");
    router.replace(`/admin?${next.toString()}`);
  };

  const act = (fn: () => Promise<AdminResult>) => {
    startTransition(async () => setNotice(await fn()));
  };

  const confirmDelete = (user: PublicUser) => {
    if (!window.confirm(`Trục xuất「${user.displayName}」khỏi tông môn? Mọi cấu hình và nhật ký sẽ mất theo.`)) {
      return;
    }
    act(() => deleteUserAction(user.id));
  };

  return (
    <section className="card card-hairline p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
        placeholder="Tìm đạo hiệu, danh xưng hoặc email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input max-w-[11rem]" value={status} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="pending">Chờ duyệt</option>
          <option value="active">Đã thu nhận</option>
          <option value="disabled">Đình quyền</option>
        </select>
        <span className="ml-auto text-sm text-[var(--color-mist)]">{users.length} đạo hữu</span>
      </div>

      {notice && (
        <p
          role="status"
          className={`mb-4 text-sm ${notice.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
        >
          {notice.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-mist)]">
              <th className="px-3 py-2">Đạo hữu</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Nhập môn</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-[var(--color-mist)]">
                  Không tìm thấy đạo hữu nào khớp.
                </td>
              </tr>
            )}

            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-ink-600)]/50 align-middle">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-parchment)]">{u.displayName}</span>
                    {u.role === "admin" && <span className="badge badge-admin">Trưởng môn</span>}
                  </div>
                  <span className="font-mono text-xs text-[var(--color-mist)]">@{u.username}</span>
                  <span className="block text-xs text-[var(--color-mist)]">
                    {u.email ?? "Chưa có email"}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={`badge badge-${u.status}`}>{STATUS_LABEL[u.status]}</span>
                </td>
                <td className="px-3 py-3 text-[var(--color-mist)]">
                  {new Date(u.createdAt).toLocaleDateString("vi-VN")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    {u.status !== "active" && (
                      <button
                        className="btn btn-jade"
                        disabled={pending}
                        onClick={() => act(() => setStatusAction(u.id, "active"))}
                      >
                        Thu nhận
                      </button>
                    )}
                    {u.status === "active" && (
                      <button
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => act(() => setStatusAction(u.id, "disabled"))}
                      >
                        Đình quyền
                      </button>
                    )}
                    <button className="btn btn-ghost" disabled={pending} onClick={() => setEditing(u)}>
                      Sửa
                    </button>
                    <button className="btn btn-danger" disabled={pending} onClick={() => confirmDelete(u)}>
                      Trục xuất
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          user={editing}
          onClose={() => setEditing(null)}
          onDone={(result) => {
            setNotice(result);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

/** Hộp sửa một đạo hữu — form thường, submit qua server action. */
function EditDialog({
  user,
  onClose,
  onDone,
}: {
  user: PublicUser;
  onClose: () => void;
  onDone: (result: AdminResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="card card-hairline w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="h-display mb-4 text-lg font-semibold text-gilded">
          Sửa đạo hữu @{user.username}
        </h3>

        <form
          action={(formData) =>
            startTransition(async () => {
              const result = await updateUserAction(null, formData);
              if (result.ok) onDone(result);
              else setError(result.message);
            })
          }
        >
          <input type="hidden" name="userId" value={user.id} />

          <label className="label" htmlFor="edit-displayName">
            Danh xưng
          </label>
          <input
            id="edit-displayName"
            name="displayName"
            className="input mb-4"
            defaultValue={user.displayName}
            required
          />

          <label className="label" htmlFor="edit-email">
            Email
          </label>
          <input
            id="edit-email"
            name="email"
            type="email"
            className="input mb-4"
            defaultValue={user.email ?? ""}
            autoComplete="email"
            required
            maxLength={254}
          />

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="edit-role">
                Vai trò
              </label>
              <select id="edit-role" name="role" className="input" defaultValue={user.role}>
                <option value="user">Môn đồ</option>
                <option value="admin">Trưởng môn</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="edit-status">
                Trạng thái
              </label>
              <select id="edit-status" name="status" className="input" defaultValue={user.status}>
                <option value="pending">Chờ duyệt</option>
                <option value="active">Đã thu nhận</option>
                <option value="disabled">Đình quyền</option>
              </select>
            </div>
          </div>

          <label className="label" htmlFor="edit-password">
            Mật khẩu mới
          </label>
          <input
            id="edit-password"
            name="password"
            type="password"
            className="input mb-1"
            placeholder="Để trống nếu giữ nguyên"
            autoComplete="new-password"
          />
          <p className="mb-4 text-xs text-[var(--color-mist)]">
            Bỏ trống thì mật khẩu cũ được giữ nguyên.
          </p>

          {error && <p className="mb-3 text-sm text-[#f2a0a0]">{error}</p>}

          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Thôi
            </button>
            <button type="submit" className="btn btn-gold" disabled={pending}>
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
