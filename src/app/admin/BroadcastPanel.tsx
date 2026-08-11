"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { broadcastNoticeAction } from "@/app/actions/notices";
import type { AdminResult } from "@/app/actions/admin";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/auth/permissions";
import {
  NOTICE_AUDIENCE_LABEL,
  NOTICE_MAX_LENGTH,
  NOTICE_WINDOW_DAYS,
  type NoticeAudienceKind,
} from "@/lib/validation/notices";
import type { PublicUser } from "@/lib/services/users";

/**
 * Tab PHÁT THÔNG BÁO — soạn một lời nhắn rồi bắn thành popup lên màn hình người khác.
 *
 * Ba phạm vi dùng CHUNG một form và cùng một nút, chỉ đổi phần chọn ở giữa: gói mỗi phạm vi
 * thành một form riêng thì ba nút "Phát" nằm cạnh nhau, và người vội bấm nhầm cái đầu tiên —
 * mà cái đầu tiên lại là「cả tông môn」.
 *
 * Danh sách người nhận đi vào bằng prop từ server (chỉ người ĐANG HOẠT ĐỘNG, không lọc theo ô
 * tìm kiếm của bảng môn đồ): người chờ duyệt và người bị đình quyền không vào được trang nào
 * để mà thấy popup, nên bày tên họ ra đây chỉ để người phát chọn nhầm.
 */
export function BroadcastPanel({ recipients }: { recipients: PublicUser[] }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(
    broadcastNoticeAction,
    null,
  );

  const [audienceKind, setAudienceKind] = useState<NoticeAudienceKind>("all");
  const [roles, setRoles] = useState<Role[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [body, setBody] = useState("");

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return recipients;
    return recipients.filter(
      (user) =>
        user.displayName.toLowerCase().includes(needle) ||
        user.username.toLowerCase().includes(needle),
    );
  }, [filter, recipients]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  /**
   * Số người sẽ nhận, ước lượng NGAY TRÊN FORM. Server vẫn đếm lại và câu trả lời của nó mới
   * là con số thật — chỗ này chỉ để người phát thấy「0 đạo hữu」trước khi bấm, chứ không phải
   * sau khi bấm.
   */
  const willReach = useMemo(() => {
    if (audienceKind === "all") return recipients.length;
    if (audienceKind === "users") return userIds.length;
    return recipients.filter((user) => user.roles.some((role) => roles.includes(role as Role))).length;
  }, [audienceKind, recipients, roles, userIds]);

  /**
   * Phát xong thì DỌN ô soạn.
   *
   * Không phải để cho gọn: `useActionState` giữ nguyên form sau khi action trả về, nên nội
   * dung vừa gửi vẫn nằm đó cùng một cái nút đã bật lại — người phát liếc thấy chữ còn nguyên
   * rất dễ tưởng chưa gửi được và bấm lần nữa, và lần ấy là một popup thứ hai y hệt trên màn
   * hình cả tông môn. Chỉ dọn khi THÀNH CÔNG: gửi hỏng thì phải giữ chữ lại cho người ta sửa.
   *
   * `lastHandled` để hiệu ứng chỉ chạy một lần cho mỗi kết quả, không phải mỗi lần vẽ lại.
   */
  const lastHandled = useRef<AdminResult | null>(null);
  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) {
      setBody("");
      setUserIds([]);
      setRoles([]);
    }
  }, [state]);

  const tooLong = body.length > NOTICE_MAX_LENGTH;
  const blocked = pending || body.trim().length === 0 || tooLong || willReach === 0;

  return (
    <form
      action={action}
      className="card card-hairline p-6"
      onSubmit={(event) => {
        // Hỏi lại đúng MỘT ca: gửi cho cả tông môn. Hai phạm vi kia đã là một lượt chọn có ý
        // thức (tick từng vai, tick từng người), còn「cả tông môn」thì chỉ cách một cú bấm.
        if (audienceKind === "all" && !window.confirm(`Phát thông báo này tới TẤT CẢ ${recipients.length} đạo hữu đang hoạt động?`)) {
          event.preventDefault();
        }
      }}
    >
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Phát Thông Báo</h2>
      <p className="mb-5 text-xs leading-relaxed text-[var(--color-mist)]">
        Lời nhắn hiện thành popup ngay trên màn hình những ai đang mở web. Ai đang offline sẽ
        thấy ở lần vào sau, trong vòng {NOTICE_WINDOW_DAYS} ngày.
      </p>

      <label className="mb-1 block text-xs uppercase tracking-wider text-[var(--color-mist)]">
        Nội dung
      </label>
      <textarea
        name="body"
        rows={4}
        className="input"
        placeholder="Ví dụ: Tối nay 21h tông môn bế quan trùng tu khoảng 15 phút…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <p className={`mt-1 text-right text-xs ${tooLong ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}>
        {body.length}/{NOTICE_MAX_LENGTH}
      </p>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs uppercase tracking-wider text-[var(--color-mist)]">
          Gửi cho
        </legend>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(NOTICE_AUDIENCE_LABEL) as NoticeAudienceKind[]).map((kind) => (
            <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="audienceKind"
                value={kind}
                checked={audienceKind === kind}
                onChange={() => setAudienceKind(kind)}
                className="h-4 w-4 accent-[var(--color-gold-400)]"
              />
              {NOTICE_AUDIENCE_LABEL[kind]}
            </label>
          ))}
        </div>
      </fieldset>

      {audienceKind === "roles" && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-[var(--color-ink-600)]/60 p-3">
          {ASSIGNABLE_ROLES.map((role) => (
            <label key={role} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="audience"
                value={role}
                checked={roles.includes(role)}
                onChange={() => setRoles((current) => toggle(current, role))}
                className="h-4 w-4 accent-[var(--color-gold-400)]"
              />
              {ROLE_LABEL[role]}
            </label>
          ))}
        </div>
      )}

      {audienceKind === "users" && (
        <div className="mt-3 rounded-lg border border-[var(--color-ink-600)]/60 p-3">
          <input
            className="input mb-3 max-w-xs"
            placeholder="Lọc theo đạo hiệu hoặc danh xưng…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {/* Cuộn trong khung riêng: danh sách dài không được đẩy nút Phát ra khỏi tầm mắt. */}
          <div className="max-h-64 overflow-y-auto pr-1">
            {shown.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--color-mist)]">
                Không có đạo hữu nào khớp.
              </p>
            ) : (
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {shown.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="audience"
                      value={user.id}
                      checked={userIds.includes(user.id)}
                      onChange={() => setUserIds((current) => toggle(current, user.id))}
                      className="h-4 w-4 accent-[var(--color-gold-400)]"
                    />
                    <span className="text-[var(--color-parchment)]">{user.displayName}</span>
                    <span className="font-mono text-xs text-[var(--color-mist)]">@{user.username}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {/* Ô ẩn cho những người đã tick rồi bị BỘ LỌC che đi: checkbox không nằm trong DOM
              thì không đi theo form, nên không có dòng này thì gõ vào ô lọc là lặng lẽ bỏ rơi
              một nửa danh sách vừa chọn. */}
          {userIds
            .filter((id) => !shown.some((user) => user.id === id))
            .map((id) => (
              <input key={id} type="hidden" name="audience" value={id} />
            ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-gold" disabled={blocked}>
          {pending ? "Đang phát…" : "Phát thông báo"}
        </button>
        <span className="text-xs text-[var(--color-mist)]">
          {willReach === 0
            ? "Chưa chọn ai — nút Phát đang khoá."
            : `Sẽ tới ${willReach} đạo hữu đang hoạt động.`}
        </span>
      </div>

      {state && (
        <p
          role="status"
          className={`mt-4 text-sm ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
