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
/**
 * Mười nhiệm vụ chỉ có công tắc — key khớp với configSchema và SIMPLE_QUESTS của engine.
 * Mô tả viết cho người chơi, không phải cho người đọc mã.
 */
const SIMPLE_QUESTS: ReadonlyArray<{ key: string; name: string; hint: string }> = [
  { key: "diemDanh", name: "Điểm Danh", hint: "Ghi danh mỗi ngày, nhận thưởng chuyên cần." },
  { key: "hoangVuc", name: "Hoang Vực", hint: "Quét boss Hoang Vực theo lượt trong ngày." },
  { key: "phucLoiDuong", name: "Phúc Lợi Đường", hint: "Lĩnh 4 phần phúc lợi mỗi ngày." },
  { key: "thiLuyen", name: "Thí Luyện Tông Môn", hint: "3 lượt thí luyện mỗi ngày." },
  { key: "biCanh", name: "Bí Cảnh Tông Môn", hint: "Quét bí cảnh 5 lượt mỗi ngày." },
  { key: "teLe", name: "Tế Lễ Tông Môn", hint: "Tế 10 Tinh Thạch cho tông môn." },
  { key: "phucLoiVip", name: "Phúc Lợi VIP", hint: "Nhận thêm lượt khắc trận văn theo hạng." },
  { key: "vongQuay", name: "Vòng Quay Phúc Vận", hint: "Quay hết lượt phúc vận trong ngày." },
  { key: "vanDap", name: "Vấn Đáp", hint: "Trả lời câu đã thuộc; câu lạ để dành cho đạo hữu." },
  { key: "khoangMach", name: "Khoáng Mạch", hint: "Thu khoáng theo chu kỳ trong ngày." },
];

export function ConfigForm({ config }: { config: EditableConfig }) {
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
          Pháp khí được niêm phong trước khi cất vào tàng khố và chỉ được mở đúng khoảnh khắc
          linh sứ nhận việc — nó không bao giờ quay lại trình duyệt, kể cả của chính đạo hữu.
          {hasCookie && " Để trống ô này khi lưu thì pháp khí cũ vẫn nguyên."}
        </p>
      </div>

      <div className="mb-6">
        <label className="label" htmlFor="runner">
          Nơi vận hành đàn pháp
        </label>
        {/* KHOÁ toàn phần theo yêu cầu: chỉ một hình thức vận hành đang mở. `disabled` ở đây
            là trang trí — action lưu tự ép giá trị, không tin form. */}
        <select id="runner" name="runner" className="input" defaultValue="local" disabled>
          <option value="local">Linh sứ túc trực (đang phụng sự)</option>
          <option value="sandbox">Linh sứ viễn du — chưa xuất quan</option>
        </select>
        <p className="mt-1 text-xs text-[var(--color-mist)]">
          Mỗi đàn pháp do một linh sứ túc trực ngày đêm đảm nhiệm, đạo hữu không cần bận tâm
          hậu trường. Các hình thức vận hành khác đang được tôi luyện — khi nào xuất quan sẽ
          mở cho chọn tại đây.
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
        Linh sứ tự nhận ra tài khoản của đạo hữu là VIP hay thường ngay khi ghé bảng nhiệm vụ
        — tài khoản thường sẽ tự bỏ qua nhiệm vụ VIP, không cần khai gì ở đây.
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
              0 = không trục xuất ai. Khác 0 = mời thành viên có HP dưới mức này ra để dành
              chỗ cho người mạnh hơn.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="meCungKickIdle">
              Trục xuất nếu không sẵn sàng sau (giây)
            </label>
            <input
              id="meCungKickIdle"
              name="meCungKickIdle"
              type="number"
              min={0}
              max={3600}
              step={5}
              className="input font-mono"
              defaultValue={config.quests.meCung.kickIdleSec}
            />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              0 = không giục ai. Khác 0 = thành viên ngồi trong phòng quá số giây này mà chưa
              bấm sẵn sàng sẽ bị mời ra — ghế của người chưa sẵn sàng là ghế người khác không
              ngồi được. Đồng hồ tính từ lúc linh sứ nhìn thấy họ lần đầu.
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

      {/* ------------------------------------------------------ Nhiệm vụ ngày còn lại */}
      <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
        <legend className="px-2 text-sm font-semibold text-[var(--color-parchment)]">
          Nhiệm vụ ngày
        </legend>
        <p className="mb-3 text-xs text-[var(--color-mist)]">
          Những việc mỗi ngày một lần — bật là linh sứ tự lo, không cần chỉnh gì thêm.
        </p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {SIMPLE_QUESTS.map((q) => (
            <label
              key={q.key}
              className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--color-parchment)]"
            >
              <input
                type="checkbox"
                name={`q_${q.key}`}
                defaultChecked={
                  (config.quests as Record<string, { enabled?: boolean }>)[q.key]?.enabled === true
                }
                className="mt-0.5 h-4 w-4 accent-[var(--color-jade-400)]"
              />
              <span>
                {q.name}
                <span className="block text-xs leading-snug text-[var(--color-mist)]">{q.hint}</span>
              </span>
            </label>
          ))}
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
