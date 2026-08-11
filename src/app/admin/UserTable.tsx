"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  deleteUserAction,
  setStatusAction,
  updateUserAction,
  type AdminResult,
} from "@/app/actions/admin";
import {
  ASSIGNABLE_ROLES,
  canEditRoles,
  canManageUser,
  isOwner,
  ROLE_LABEL,
  type Role,
} from "@/lib/auth/permissions";
import { MAX_TAGS, MAX_TAG_LENGTH, TAG_PRESETS, parseTags, splitTags } from "@/lib/validation/tags";
import type { PublicUser } from "@/lib/services/users";
import { PageSizeSelect, Pager, usePageSize, usePaged } from "@/components/Pager";

/**
 * Bảng môn đồ. Ô tìm kiếm ghi vào URL (debounce 300ms) nên kết quả chia sẻ được và F5 vẫn
 * giữ; mọi nút hành động gọi thẳng server action rồi để `revalidatePath` vẽ lại — không có
 * bản sao danh sách nào sống trong client để mà lệch pha với server.
 */

/** Khoá riêng của bảng này trong localStorage — hàng đợi có khoá của nó, hai bên không giẫm nhau. */
const USERS_PAGE_SIZE_KEY = "jarvis:admin-users:per-page";

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  active: "Đã thu nhận",
  disabled: "Đình quyền",
};

/**
 * Màu huy hiệu theo HẠNG QUYỀN, không theo tên vai — nên hai vai bậc trị sự dùng chung một
 * màu là ĐÚNG, không phải lười: nhìn bảng mà đoán được ai đụng được ai thì màu phải nói về
 * quyền. Chữ trên huy hiệu đã đủ phân biệt Chưởng môn với Thái thượng trưởng lão.
 */
const ROLE_BADGE_CLASS: Record<Role, string> = {
  "gia-chu": "badge-owner",
  "thai-thuong-truong-lao": "badge-admin",
  "chuong-mon": "badge-admin",
  // Đệ tử không mang quyền nào, nên nó KHÔNG được đeo màu của bậc trị sự — mượn sắc nhã của
  // huy hiệu tag. Đúng theo luật ghi ở trên: màu nói về quyền, và vai này không mở gì cả.
  "de-tu": "badge-tag",
  // Cùng màu với Đệ tử, và đó là ĐÚNG theo luật ghi ở trên: màu nói về QUYỀN, mà cả hai vai
  // này đều không mở được việc gì. Chữ trên huy hiệu phân biệt「Phàm nhân」với「Đệ tử」.
  "pham-nhan": "badge-tag",
};

export function UserTable({
  viewer,
  users,
  query,
  status,
  frameLabels,
}: {
  /** Người đang ngồi ghế trị sự — quyết định nút nào hiện ra. Luật thật vẫn gác ở server. */
  viewer: PublicUser;
  users: PublicUser[];
  query: string;
  status: string;
  /**
   * Nhãn của các khung tag đang có trong sổ — nguồn cho chip bấm-chọn ở hộp Sửa. Đi vào bằng
   * prop từ trang (server) chứ không tự fetch: sổ được quản ở tab Đàm Đạo, hai tab là hai
   * nhánh cây khác nhau, và cả hai phải nhìn đúng MỘT sổ. Xem TagFrameManager.
   */
  frameLabels: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(query);
  const [notice, setNotice] = useState<AdminResult | null>(null);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [pending, startTransition] = useTransition();

  const [perPage, setPerPage] = usePageSize(USERS_PAGE_SIZE_KEY);
  const paged = usePaged(users, perPage);
  const { setPage } = paged;

  /**
   * Đổi bộ lọc thì về trang đầu. Nghe theo `query`/`status` — thứ SERVER đã dùng để cắt danh
   * sách — chứ không nghe theo `users.length`: một đạo hữu vừa bị trục xuất cũng làm độ dài
   * đổi, mà lúc ấy người đang đọc trang 3 không có lý do gì bị ném về đầu. (Trang vượt tầm thì
   * đã có phép kẹp trong `usePaged` lo.)
   */
  useEffect(() => {
    setPage(1);
  }, [query, status, setPage]);

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

  // Chip tag trong hộp Sửa: nhãn từ sổ khung, và TAG_PRESETS khi sổ còn trống — chip không
  // được phép biến mất chỉ vì tông môn chưa gieo khung nào.
  const presets: readonly string[] = frameLabels.length > 0 ? frameLabels : TAG_PRESETS;

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
        {/* Con số tổng ở lại ĐÂY dù thanh điều trang cuối bảng cũng kể ("1–20 trong 26 đạo
            hữu"), và đó là chủ ý của đạo hữu (11/08/2026 — có bỏ đi một lượt rồi phải trả lại):
            đây là câu trả lời cho「tông môn có bao nhiêu người」, thứ người ta liếc một cái ở
            đầu bảng chứ không cuộn xuống chân bảng để tìm. Nó đếm đúng bộ ĐÃ LỌC, nên khi đang
            lọc thì nó nói về kết quả lọc — cùng con số mà thanh điều trang lấy làm tổng. */}
        {/* Cụm bên PHẢI của hàng công cụ: con số tổng, rồi ô chọn số dòng sát mép ngoài cùng.
            `ml-auto` nằm trên đứa ĐẦU cụm nên cả hai cùng bị đẩy sang phải như một khối — đặt
            lên đứa cuối thì con số bị bỏ lại giữa hàng. */}
        <span className="ml-auto text-sm text-[var(--color-mist)]">{users.length} đạo hữu</span>
        <PageSizeSelect perPage={perPage} onPerPage={setPerPage} unit="đạo hữu" />
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

            {paged.items.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-ink-600)]/50 align-middle">
                {/* `w-[38%]` là thứ làm huy hiệu XUỐNG DÒNG được, không phải `flex-wrap` bên
                    dưới. Bảng này auto-layout (`w-full min-w-[46rem]`) nằm trong một khung
                    `overflow-x-auto`: thiếu trần bề rộng thì cột cứ nới ra ôm trọn hàng huy
                    hiệu trên MỘT dòng rồi đẩy cả bảng trượt ngang — `flex-wrap` không có cớ
                    gì để gãy dòng. Dùng phần trăm chứ không phải một con số rem: nó co theo
                    bảng, và 38% của 46rem ≈ 17,5rem vẫn rộng hơn huy hiệu dài nhất
                    (「Thái thượng trưởng lão」≈ 11rem) nên auto-layout không có lý do ép ngược. */}
                <td className="w-[38%] px-3 py-3">
                  {/* `items-start` chứ không `items-center`: khi đã gãy hai dòng, căn giữa làm
                      danh xưng trôi xuống lửng lơ giữa khối huy hiệu. `gap-y` nhỏ hơn `gap-x`
                      vì hai dòng huy hiệu sát nhau vẫn đọc được, còn thưa quá thì hàng phình. */}
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                    <span className="font-semibold break-words text-[var(--color-parchment)]">{u.displayName}</span>
                    {/* Duyệt theo ASSIGNABLE_ROLES chứ không theo `u.roles`: thứ tự huy hiệu
                        khi ấy là thứ tự THANG VAI, giống nhau ở mọi hàng, không phụ thuộc
                        vào việc Gia chủ tick ô nào trước lúc lưu. */}
                    {ASSIGNABLE_ROLES.filter((role) => u.roles.includes(role)).map((role) => (
                      <span key={role} className={`badge ${ROLE_BADGE_CLASS[role]}`}>
                        {ROLE_LABEL[role]}
                      </span>
                    ))}
                    {u.tags.map((t) => (
                      <span key={t} className="badge badge-tag">{t}</span>
                    ))}
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
                  {!canManageUser(viewer, u) && u.id !== viewer.id ? (
                    <p className="text-right text-xs text-[var(--color-mist)]">Việc của Gia chủ</p>
                  ) : (
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
                    {u.id !== viewer.id && (
                      <button className="btn btn-danger" disabled={pending} onClick={() => confirmDelete(u)}>
                        Trục xuất
                      </button>
                    )}
                  </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager paged={paged} unit="đạo hữu" />

      {editing && (
        <EditDialog
          // `key` theo id: hộp thoại giờ mang state riêng (ô tag), và state khởi tạo MỘT LẦN
          // lúc mount. Hôm nay giữa hai lần mở luôn có một nhịp `editing = null` nên nó vẫn
          // mount lại — nhưng đó là may, không phải bảo đảm: bỏ nhịp ấy đi thì hộp thoại của
          // người sau hiện tag của người trước, và lưu đè lên thật.
          key={editing.id}
          viewer={viewer}
          user={editing}
          presets={presets}
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
  viewer,
  user,
  presets,
  onClose,
  onDone,
}: {
  viewer: PublicUser;
  user: PublicUser;
  /** Nhãn cho các chip tag — từ sổ khung, hoặc TAG_PRESETS khi sổ chưa về. */
  presets: readonly string[];
  onClose: () => void;
  onDone: (result: AdminResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mayEditRoles = canEditRoles(viewer);

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

          {mayEditRoles && (
            <fieldset className="mb-4">
              <legend className="label">Vai trò (một người có thể giữ nhiều vai)</legend>
              {/* Cờ "phần vai CÓ trong form" — thiếu nó, server không phân biệt được "bỏ hết
                  tick" (thu mọi vai) với "form không bày phần vai" (giữ nguyên). */}
              <input type="hidden" name="rolesSubmitted" value="1" />
              {/* `flex-wrap` là bắt buộc từ lúc có bốn vai:「Thái thượng trưởng lão」một mình
                  đã dài gần nửa hộp thoại, để một hàng cứng thì hai vai cuối bị đẩy khỏi mép. */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ASSIGNABLE_ROLES.map((role) => {
                  const lockedOwnSeat = role === "gia-chu" && user.id === viewer.id && isOwner(viewer);
                  return (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roles"
                        value={role}
                        defaultChecked={user.roles.includes(role)}
                        disabled={lockedOwnSeat}
                      />
                      {/* Checkbox disabled KHÔNG được trình duyệt gửi đi — thiếu dòng hidden
                          này thì Gia chủ sửa hồ sơ CHÍNH MÌNH (chỉ đổi tên thôi) cũng bị
                          server chặn oan vì "tự rời ngôi". Bắt được nhờ tự soi, không phải
                          nhờ may. */}
                      {lockedOwnSeat && <input type="hidden" name="roles" value="gia-chu" />}
                      {ROLE_LABEL[role]}
                    </label>
                  );
                })}
              </div>
              {isOwner(viewer) && user.id === viewer.id && (
                <p className="mt-1 text-xs text-[var(--color-mist)]">
                  Gia chủ không tự rời ngôi được — truyền ngôi cho người khác trước.
                </p>
              )}
            </fieldset>
          )}

          <div className="mb-4">
            <label className="label" htmlFor="edit-status">
              Trạng thái
            </label>
            <select id="edit-status" name="status" className="input" defaultValue={user.status}>
              <option value="pending">Chờ duyệt</option>
              <option value="active">Đã thu nhận</option>
              <option value="disabled">Đình quyền</option>
            </select>
          </div>

          <TagField initial={user.tags} presets={presets} />

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

/**
 * Ô tag: chip bấm chọn + ô gõ tự do, và CHỈ MỘT nguồn sự thật — chuỗi trong ô input.
 *
 * Vì sao không giữ một mảng tag trong state rồi dựng chuỗi lúc submit: người dùng vẫn phải gõ
 * được tag tuỳ ý, nên ô chữ là thứ bắt buộc phải có. Có cả mảng lẫn chuỗi là có hai bản chép
 * của cùng một dữ liệu, và câu hỏi "bên nào đúng khi hai bên lệch" không có câu trả lời hay.
 * Chip chỉ đọc chuỗi ra để biết cái nào đang bật, rồi ghi chuỗi mới về.
 *
 * So khớp KHÔNG phân biệt hoa thường, nhưng chèn vào theo đúng chính tả của preset: nếu không
 * thì gõ tay「chưởng môn」rồi bấm chip「Chưởng môn」sẽ ra hai tag trông y hệt nhau nằm cạnh
 * nhau, và người nhìn bảng không hiểu vì sao.
 */
function TagField({ initial, presets }: { initial: string[]; presets: readonly string[] }) {
  const [raw, setRaw] = useState(initial.join(", "));

  const current = splitTags(raw);
  const check = parseTags(raw);
  const full = current.length >= MAX_TAGS;

  const indexOfPreset = (preset: string) =>
    current.findIndex((t) => t.toLowerCase() === preset.toLowerCase());

  /**
   * Cập nhật theo HÀM chứ không theo `current` của lượt vẽ này — và trần cũng kiểm lại BÊN
   * TRONG. Đo được, không phải phòng xa: ba cú bấm rơi vào cùng một tick React thì cả ba cùng
   * đọc một state cũ, và chỉ cú cuối sống sót. Tay người khó bấm nhanh tới vậy, nhưng "đúng
   * nhờ kịp vẽ lại" thì không phải là đúng — thuộc tính `disabled` chỉ chặn ở lượt vẽ, còn
   * đây mới là chỗ luật「tối đa {MAX_TAGS}」thật sự được giữ.
   */
  const togglePreset = (preset: string) => {
    setRaw((prev) => {
      const list = splitTags(prev);
      const at = list.findIndex((t) => t.toLowerCase() === preset.toLowerCase());
      if (at < 0 && list.length >= MAX_TAGS) return prev;
      const next = at >= 0 ? list.filter((_, i) => i !== at) : [...list, preset];
      return next.join(", ");
    });
  };

  return (
    <div className="mb-4">
      <label className="label" htmlFor="edit-tags">
        Tag trang trí (tối đa {MAX_TAGS} × {MAX_TAG_LENGTH} ký tự)
      </label>

      <div className="mb-2 flex flex-wrap gap-2">
        {presets.map((preset) => {
          const on = indexOfPreset(preset) >= 0;
          return (
            <button
              key={preset}
              type="button"
              // Hết chỗ thì chip CHƯA bật bị khoá — thà không bấm được còn hơn bấm xong mới
              // biết bị từ chối; chip đang bật vẫn phải bấm được, vì đó là đường gỡ ra.
              disabled={!on && full}
              onClick={() => togglePreset(preset)}
              aria-pressed={on}
              // Chip chưa chọn là bản MỜ của chính cái nó sẽ thành, không phải một màu khác:
              // `badge-disabled` sẵn có là màu ĐỎ của trạng thái đình quyền, dùng ở đây thì
              // một cái tag chưa bấm trông như một lỗi.
              className={`badge badge-tag ${on ? "" : "opacity-45"} disabled:opacity-20`}
            >
              {on ? "✓ " : "+ "}
              {preset}
            </button>
          );
        })}
      </div>

      <input
        id="edit-tags"
        name="tags"
        className="input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Ví dụ: Trận pháp sư, Luyện đan"
        // Trần ký tự của cả ô, tính từ luật chứ không gõ tay một con số: đủ chỗ cho tối đa
        // ngần ấy tag dài hết cỡ, cộng phần ", " ngăn giữa chúng.
        maxLength={MAX_TAGS * MAX_TAG_LENGTH + (MAX_TAGS - 1) * 2}
      />
      {!check.ok && <p className="mt-1 text-xs text-[#f2a0a0]">{check.error}</p>}
    </div>
  );
}
