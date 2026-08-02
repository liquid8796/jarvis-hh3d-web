"use client";

import { useActionState, useState, useTransition } from "react";
import {
  clearCookieAction,
  saveConfigAction,
  type ActionResult,
} from "@/app/actions/automation";
import type { EditableConfig } from "@/lib/services/configs";

/**
 * Ngọc giản cấu hình. Uncontrolled inputs với defaultValue từ server — form chỉ là tấm
 * gương của JSONB, nộp lên là zod ở server quyết định đúng sai. Hai mảnh state duy nhất là
 * hai công tắc nhiệm vụ, và chúng chỉ để LÀM MỜ phần tuỳ chọn bên dưới: giá trị vẫn được
 * gửi đi đầy đủ, nên tắt rồi bật lại không mất những gì đã chọn.
 */
export function ConfigForm({
  config,
  canUseSandbox,
}: {
  config: EditableConfig;
  /** Tông chủ mới mở được sandbox — xem `sandboxAllowedFor`. Ở đây chỉ để LÀM MỜ lựa chọn;
      quyền thật được quyết lại ở server, cả lúc lưu lẫn lúc khai đàn. */
  canUseSandbox: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveConfigAction,
    null,
  );
  const [meCung, setMeCung] = useState(config.quests.meCung.enabled);
  const [luyenDan, setLuyenDan] = useState(config.quests.luyenDan.enabled);
  const [clearing, startClearing] = useTransition();
  const [cleared, setCleared] = useState(false);
  const hasCookie = config.hasCookie && !cleared;

  // Hai tab nhiệm vụ, theo đúng cách site chia tài khoản. Tab chỉ ĐỔI HIỂN THỊ (display:
  // none), không unmount: các ô nhập phải luôn nằm trong DOM để FormData lúc submit gom đủ
  // giá trị — unmount tab VIP rồi bấm lưu từ tab Thường là lặng lẽ tắt hết nhiệm vụ.
  const [questTab, setQuestTab] = useState<"vip" | "free">("vip");

  return (
    <form action={action} className="card card-hairline p-6">
      <h2 className="h-display mb-5 text-xl font-semibold text-gilded">Ngọc Giản Cấu Hình</h2>

      <div className="mb-6">
        <label className="label" htmlFor="gameCookie">
          Pháp Khí — cookie đăng nhập hoathinh3d
        </label>

        {/* Cookie đi MỘT CHIỀU: nhập vào thì được, đọc ra thì không. Đã mã hoá trong
            database rồi mà vẫn trả về trình duyệt mỗi lần mở trang thì coi như chưa mã hoá. */}
        <div className="mb-2 flex flex-wrap items-center gap-3">
          {hasCookie ? (
            <>
              <span className="badge badge-active">Đã cất pháp khí (đã mã hoá)</span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={clearing}
                onClick={() =>
                  startClearing(async () => {
                    await clearCookieAction();
                    setCleared(true);
                  })
                }
              >
                Xoá pháp khí
              </button>
            </>
          ) : (
            <span className="badge badge-pending">Chưa có pháp khí</span>
          )}
        </div>

        <textarea
          id="gameCookie"
          name="gameCookie"
          className="input h-24 resize-y font-mono text-xs"
          placeholder={
            hasCookie
              ? "Để trống nếu giữ nguyên cookie đang dùng — dán chuỗi mới để thay thế"
              : "Dán chuỗi cookie (wordpress_logged_in_…) tại đây"
          }
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-[var(--color-mist)]">
          Cookie được mã hoá AES-256-GCM trước khi vào database và chỉ được giải mã đúng lúc
          linh sứ nhận việc — nó không bao giờ quay lại trình duyệt, kể cả của chính đạo hữu.
          {hasCookie && " Để trống ô này khi lưu thì cookie cũ vẫn nguyên."}
        </p>
      </div>

      <div className="mb-6">
        <label className="label" htmlFor="runner">
          Nơi vận hành đàn pháp
        </label>
        <select
          id="runner"
          name="runner"
          className="input"
          defaultValue={canUseSandbox ? config.runner : "local"}
        >
          <option value="local">Linh sứ máy nhà (máy chạy liên tục)</option>
          <option value="sandbox" disabled={!canUseSandbox}>
            Sandbox trên Vercel (không cần máy riêng)
            {!canUseSandbox && " — đang thử nghiệm, chỉ tông chủ"}
          </option>
        </select>
        <p className="mt-1 text-xs text-[var(--color-mist)]">
          {!canUseSandbox && (
            <>
              <span className="text-[var(--color-gold-300)]">Sandbox đang trong thời gian
              thử nghiệm</span> nên tạm thời chỉ tông chủ mở được — mỗi lát chạy là một máy ảo
              tính tiền trên tài khoản chung, và chừng nào chưa đo được chi phí theo từng
              người thì cánh cửa còn hẹp. Đàn pháp của đạo hữu chạy trên linh sứ máy nhà.{" "}
            </>
          )}
          Sandbox dựng máy ảo theo từng lượt — hợp với Luyện Đan Đường vì mỗi lượt ghé chỉ
          vài phút. <span className="text-[var(--color-gold-300)]">Mê Cung luôn cần linh sứ
          máy nhà</span>: nó phải chờ đủ 5 người thật rồi đánh liền tới 35 phút, dài hơn tuổi
          thọ một sandbox. Bật Mê Cung thì hệ thống tự chuyển và ghi rõ lý do trong nhật ký.
        </p>
      </div>

      {/* ------------------------------------------------------- Hai tab nhiệm vụ */}
      <div className="mb-4 flex gap-1 rounded-xl border border-[var(--color-ink-600)]/60 p-1">
        {(
          [
            ["vip", "Nhiệm vụ VIP"],
            ["free", "Nhiệm vụ Thường"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setQuestTab(key)}
            aria-pressed={questTab === key}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              questTab === key
                ? "bg-[var(--color-ink-600)]/70 text-[var(--color-gold-300)]"
                : "text-[var(--color-mist)] hover:text-[var(--color-parchment)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-[var(--color-mist)]">
        Linh sứ tự nhận ra hạng tài khoản khi ghé hub nhiệm vụ (thẻ Phúc Lợi VIP chỉ hiện cho
        tài khoản VIP) — tài khoản thường sẽ tự bỏ qua nhiệm vụ VIP, không cần khai gì ở đây.
      </p>

      {/* Tab Thường: thành thật là chỗ giữ chỗ, chứ không phải một tab trống vô cớ. */}
      <div hidden={questTab !== "free"}>
        <div className="mb-6 rounded-xl border border-dashed border-[var(--color-ink-600)] p-6 text-center">
          <p className="text-sm text-[var(--color-mist)]">
            Chưa có gì ở đây — mọi nhiệm vụ hiện có đều được ghi trên tài khoản VIP nên nằm cả
            bên tab VIP. Flow cho tài khoản thường sẽ về tab này sau; phần nhận diện hạng thì
            đã chạy rồi.
          </p>
        </div>
      </div>

      <div hidden={questTab !== "vip"}>
      {/* ---------------------------------------------------------------- Mê Cung */}
      <fieldset className="mb-5 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
        <legend className="px-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
            <input
              type="checkbox"
              name="meCungEnabled"
              defaultChecked={config.quests.meCung.enabled}
              onChange={(e) => setMeCung(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-jade-400)]"
            />
            Mê Cung
          </label>
        </legend>

        <div
          className={`grid gap-4 transition-opacity duration-300 sm:grid-cols-2 ${
            meCung ? "opacity-100" : "pointer-events-none opacity-40"
          }`}
        >
          <div>
            <label className="label" htmlFor="meCungMode">
              Độ khó phòng
            </label>
            <select
              id="meCungMode"
              name="meCungMode"
              className="input"
              defaultValue={config.quests.meCung.mode}
            >
              <option value="is-normal">Thường</option>
              <option value="is-hard">Khó</option>
              <option value="is-nightmare">Ác Mộng</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="meCungKickHp">
              Trục xuất theo HP
            </label>
            <input
              id="meCungKickHp"
              name="meCungKickHp"
              type="number"
              min={0}
              step={10000}
              className="input font-mono"
              defaultValue={config.quests.meCung.kickHp}
            />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              0 = không trục xuất ai. Khác 0 = đá thành viên có HP dưới mức này để dành chỗ
              cho người mạnh hơn.
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)] sm:col-span-2">
            <input
              type="checkbox"
              name="meCungCapCheck"
              defaultChecked={config.quests.meCung.capCheck}
              className="h-4 w-4 accent-[var(--color-jade-400)]"
            />
            Dừng khi đã đủ huyền tinh trong ngày
            <span className="text-xs text-[var(--color-mist)]">
              (tắt = đánh tới hết trần lượt)
            </span>
          </label>
        </div>
      </fieldset>

      {/* ----------------------------------------------------------- Luyện Đan Đường */}
      <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
        <legend className="px-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
            <input
              type="checkbox"
              name="luyenDanEnabled"
              defaultChecked={config.quests.luyenDan.enabled}
              onChange={(e) => setLuyenDan(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-gold-400)]"
            />
            Luyện Đan Đường
          </label>
        </legend>

        <div
          className={`grid gap-4 transition-opacity duration-300 sm:grid-cols-2 ${
            luyenDan ? "opacity-100" : "pointer-events-none opacity-40"
          }`}
        >
          <div>
            <label className="label" htmlFor="luyenDanTier">
              Loại đan
            </label>
            <select
              id="luyenDanTier"
              name="luyenDanTier"
              className="input"
              defaultValue={config.quests.luyenDan.tier}
            >
              <option>Hạ Phẩm</option>
              <option>Trung Phẩm</option>
              <option>Thượng Phẩm</option>
              <option>Cực Phẩm</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              Mỗi mẻ tốn dược liệu + 20 Tiên Ngọc.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="luyenDanKeepStars">
              Phân giải đan
            </label>
            <select
              id="luyenDanKeepStars"
              name="luyenDanKeepStars"
              className="input"
              defaultValue={config.quests.luyenDan.keepStarsFrom}
            >
              <option value={0}>Phân giải tất cả</option>
              <option value={4}>Giữ 4 sao, phân giải 3 sao trở xuống</option>
              <option value={3}>Giữ từ 3 sao, phân giải 2 sao trở xuống</option>
              <option value={2}>Giữ từ 2 sao, chỉ phân giải 1 sao</option>
              {/* 1, không phải 5. Con số là "giữ từ N sao trở lên", mà đan chỉ rơi 1–4 sao —
                  nên "giữ từ 1" là giữ sạch, còn "giữ từ 5" sẽ phân giải sạch. Đúng ngược. */}
              <option value={1}>Không phân giải (giữ tất cả)</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              Đan rơi từ 1–4 sao. Chỉ viên bị phân giải mới hoàn lại dược liệu.
            </p>
          </div>
        </div>
      </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang khắc…" : "Khắc Ngọc Giản"}
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
  );
}
