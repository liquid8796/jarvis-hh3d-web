"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { broadcastNoticeAction } from "@/app/actions/notices";
import type { AdminResult } from "@/app/actions/admin";
import { ASSIGNABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/auth/permissions";
import {
  formatLifetime,
  lifetimeToHours,
  NOTICE_AUDIENCE_LABEL,
  NOTICE_DEFAULT_LIFETIME_DAYS,
  NOTICE_LIFETIME_UNIT_LABEL,
  NOTICE_LIFETIME_UNITS,
  NOTICE_MAX_LENGTH,
  NOTICE_MAX_LIFETIME_DAYS,
  NOTICE_MAX_LIFETIME_HOURS,
  NOTICE_MIN_LIFETIME_HOURS,
  type NoticeAudienceKind,
  type NoticeLifetimeUnit,
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
/**
 * Hai nhánh RỜI nhau: có giờ thì không có lời phàn nàn, và ngược lại. Khai thành hợp rời để chỗ
 * vẽ khỏi phải bịa một giá trị dự phòng cho nhánh không bao giờ chạy — `hours ?? 0` là một
 * con số không có thật, và nó sẽ lặng lẽ in ra「Hết 0 giờ」vào ngày ai đó đổi một nhánh ở trên.
 */
type LifetimeState = { hours: number; problem: null } | { hours: null; problem: string };

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
  /**
   * Thời hạn giữ dạng CHUỖI y như người ta gõ, không phải số: một ô số ép về `number` thì lúc
   * người dùng xoá trắng để gõ lại, giá trị nhảy về 0 hoặc NaN và ô tự nhồi lại một con số họ
   * không gõ. Phép đổi sang số nằm ở `lifetime` bên dưới, cùng chỗ với phép kiểm.
   */
  const [lifetimeValue, setLifetimeValue] = useState(String(NOTICE_DEFAULT_LIFETIME_DAYS));
  const [lifetimeUnit, setLifetimeUnit] = useState<NoticeLifetimeUnit>("days");

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
   * Thời hạn đã quy về giờ, hoặc lý do vì sao chưa quy được.
   *
   * Kiểm ở đây là lớp SỚM cho người gõ; hàng rào thật vẫn là `noticeInputSchema` phía server —
   * cùng ba ngưỡng, cùng một chỗ định nghĩa, nên hai lớp không thể trôi khỏi nhau.
   *
   * `^\d+$` chứ không `Number.isInteger(Number(raw))`: `Number("")` là 0 và `Number(" 7 ")` là 7,
   * nên phép sau nhận cả ô rỗng lẫn khoảng trắng — hai thứ mà `<input type="number">` cho phép
   * tồn tại trên màn hình.
   */
  const lifetime = useMemo((): LifetimeState => {
    const raw = lifetimeValue.trim();
    if (!/^\d+$/.test(raw)) {
      return { hours: null, problem: "Thời hạn phải là một số nguyên dương." };
    }
    const hours = lifetimeToHours(Number(raw), lifetimeUnit);
    if (hours < NOTICE_MIN_LIFETIME_HOURS) {
      return { hours: null, problem: `Ngắn nhất là ${NOTICE_MIN_LIFETIME_HOURS} giờ.` };
    }
    if (hours > NOTICE_MAX_LIFETIME_HOURS) {
      return { hours: null, problem: `Dài nhất là ${NOTICE_MAX_LIFETIME_DAYS} ngày.` };
    }
    return { hours, problem: null };
  }, [lifetimeValue, lifetimeUnit]);

  /**
   * Số người sẽ nhận, ước lượng NGAY TRÊN FORM. Server vẫn đếm lại và câu trả lời của nó mới
   * là con số thật — chỗ này chỉ để người phát thấy「0 đạo hữu」trước khi bấm, chứ không phải
   * sau khi bấm.
   */
  const willReach = useMemo(() => {
    // `null` = KHÔNG ĐẾM ĐƯỢC, khác hẳn 0 = đếm rồi và không có ai. Khách vãng lai không có
    // dòng nào trong sổ để mà đếm — xem `countRecipients` phía server, nơi luật này là gốc.
    if (audienceKind === "guests") return null;
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
  // `willReach === 0` khoá nút để không ai phát vào một nhóm rỗng. `null` KHÔNG bị khoá: nó
  // nghĩa là「không đếm được」, mà không đếm được thì không có cớ gì để cấm phát.
  const blocked =
    pending || body.trim().length === 0 || tooLong || willReach === 0 || lifetime.hours === null;

  return (
    <form
      action={action}
      className="card card-hairline p-6"
      onSubmit={(event) => {
        // Hỏi lại ở HAI ca, và cả hai vì cùng một lẽ: chúng là phạm vi RỘNG chỉ cách một cú bấm,
        // trong khi hai phạm vi kia đã đòi một lượt chọn có ý thức (tick từng vai, tick từng
        // người).「Khách chưa đăng nhập」còn rộng hơn cả tông môn — nó hiện cho bất kỳ ai mở
        // trang, kể cả người chưa từng là môn đồ — nên câu hỏi phải nói đúng điều ấy.
        // Thời hạn đi kèm trong câu hỏi: với hai phạm vi rộng này,「sống bao lâu」là nửa còn lại
        // của cái giá — một lời nhắn cho người lạ treo ba mươi ngày khác hẳn cùng lời nhắn ấy
        // treo ba giờ.
        const song = lifetime.hours === null ? "" : ` Lời nhắn sống ${formatLifetime(lifetime.hours)}.`;
        const hoi =
          audienceKind === "all"
            ? `Phát thông báo này tới TẤT CẢ ${recipients.length} đạo hữu đang hoạt động?${song}`
            : audienceKind === "guests"
              ? `Phát cho KHÁCH CHƯA ĐĂNG NHẬP? Lời nhắn sẽ hiện với bất kỳ ai mở trang, kể cả người lạ.${song}`
              : null;
        if (hoi !== null && !window.confirm(hoi)) {
          event.preventDefault();
        }
      }}
    >
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Phát Thông Báo</h2>
      <p className="mb-5 text-xs leading-relaxed text-[var(--color-mist)]">
        Lời nhắn hiện thành popup ngay trên màn hình những ai đang mở web. Ai đang offline sẽ
        thấy ở lần vào sau, trong thời hạn đặt bên dưới.
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

      {/* Thời hạn đứng cạnh NỘI DUNG chứ không cạnh phạm vi: nó là thuộc tính của lời nhắn —
          tin bảo trì tối nay sống vài giờ dù gửi cho ai — nên nó thuộc về nửa「nhắn gì」của form,
          không thuộc nửa「nhắn cho ai」. */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <label
            className="mb-1 block text-xs uppercase tracking-wider text-[var(--color-mist)]"
            htmlFor="notice-lifetime"
          >
            Thời hạn tồn tại
          </label>
          <div className="flex items-center gap-2">
            <input
              id="notice-lifetime"
              name="lifetimeValue"
              type="number"
              inputMode="numeric"
              min={1}
              max={lifetimeUnit === "days" ? NOTICE_MAX_LIFETIME_DAYS : NOTICE_MAX_LIFETIME_HOURS}
              step={1}
              className="input min-w-[6rem] max-w-[6rem] font-mono"
              value={lifetimeValue}
              onChange={(event) => setLifetimeValue(event.target.value)}
            />
            <select
              name="lifetimeUnit"
              aria-label="Đơn vị thời hạn"
              /* min-w BẰNG max-w để ghim hẳn bề rộng, không phải cho đẹp: hàng này là flex và
                  dòng chú thích bên phải co kéo hết chỗ, nên hai ô bị bóp lại — chữ「ngày」cụt
                  mất cái đuôi (đo bằng ảnh chụp 22/08/2026). Không dùng `w-` được: `.input` khai
                  `width: 100%` ngoài mọi `@layer` nên nó thắng mọi utility bề rộng của Tailwind;
                  `min-w`/`max-w` là thuộc tính khác nên không phải cãi nhau với luật ấy. */
              className="input min-w-[7rem] max-w-[7rem]"
              value={lifetimeUnit}
              onChange={(event) => setLifetimeUnit(event.target.value as NoticeLifetimeUnit)}
            >
              {NOTICE_LIFETIME_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {NOTICE_LIFETIME_UNIT_LABEL[unit]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p
          className={`pb-2 text-xs ${lifetime.problem ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}
        >
          {lifetime.problem === null
            ? `Hết ${formatLifetime(lifetime.hours)} thì popup thôi hiện, kể cả với người chưa kịp bấm「Đã hiểu」.`
            : lifetime.problem}
        </p>
      </div>

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
          {willReach === null
            ? `Khách vãng lai — không đếm được bao nhiêu người. Popup hiện ở lần tải trang kế tiếp của họ, KHÔNG tức thì.`
            : willReach === 0
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
