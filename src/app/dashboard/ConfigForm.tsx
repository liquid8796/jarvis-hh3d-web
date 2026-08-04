"use client";

import { useActionState, useState } from "react";
import { saveConfigAction, type ActionResult } from "@/app/actions/automation";
import type { EditableConfig } from "@/lib/services/configs";
import { AccountManager } from "./AccountManager";
import { useDashboardAccountLive } from "./DashboardLiveProvider";

/**
 * Ngọc giản cấu hình. Uncontrolled inputs với defaultValue từ server — form chỉ là tấm
 * gương của JSONB, nộp lên là zod ở server quyết định đúng sai. Hai mảnh state duy nhất là
 * hai công tắc nhiệm vụ, và chúng chỉ để LÀM MỜ phần tuỳ chọn bên dưới: giá trị vẫn được
 * gửi đi đầy đủ, nên tắt rồi bật lại không mất những gì đã chọn.
 *
 * Cấu hình nhiệm vụ là MỘT bộ chung cho mọi tài khoản (y như bản desktop dùng một
 * quests.json toàn cục): tab VIP áp cho các tài khoản hạng VIP, tab Thường cho các tài
 * khoản hạng thường — mỗi tài khoản chỉ chạy đúng những nhiệm vụ thuộc hạng của nó.
 */
/**
 * Mười nhiệm vụ chỉ có công tắc — key khớp với configSchema và SIMPLE_QUESTS của engine.
 * Mô tả viết cho người chơi, không phải cho người đọc mã.
 */
type SimpleQuest = { key: string; name: string; hint: string };

const SIMPLE_QUESTS: ReadonlyArray<SimpleQuest> = [
  { key: "diemDanh", name: "Điểm Danh", hint: "Ghi danh mỗi ngày, nhận thưởng chuyên cần." },
  { key: "hoangVuc", name: "Hoang Vực", hint: "Quét boss Hoang Vực theo lượt trong ngày." },
  { key: "phucLoiDuong", name: "Phúc Lợi Đường", hint: "Lĩnh 4 phần phúc lợi mỗi ngày." },
  { key: "thiLuyen", name: "Thí Luyện Tông Môn", hint: "3 lượt thí luyện mỗi ngày." },
  { key: "biCanh", name: "Bí Cảnh Tông Môn", hint: "Quét bí cảnh 5 lượt mỗi ngày." },
  { key: "teLe", name: "Tế Lễ Tông Môn", hint: "Tế 10 Tinh Thạch cho tông môn." },
  { key: "phucLoiVip", name: "Phúc Lợi VIP", hint: "Nhận thêm lượt khắc trận văn theo hạng." },
  { key: "vongQuay", name: "Vòng Quay Phúc Vận", hint: "Quay hết lượt phúc vận trong ngày." },
  {
    key: "vanDap",
    name: "Vấn Đáp",
    hint: "Tra danh sách đáp án cộng đồng. Câu không có trong danh sách sẽ để bạn tự làm.",
  },
  { key: "khoangMach", name: "Khoáng Mạch", hint: "Thu khoáng theo chu kỳ trong ngày." },
];

const FREE_QUEST_KEYS = new Set([
  "diemDanh",
  "hoangVuc",
  "phucLoiDuong",
  "thiLuyen",
  "vongQuay",
  "teLe",
  "vanDap",
]);
const FREE_QUESTS = SIMPLE_QUESTS.filter((quest) => FREE_QUEST_KEYS.has(quest.key));

function SimpleQuestGrid({
  quests,
  enabled,
  onToggle,
}: {
  quests: ReadonlyArray<SimpleQuest>;
  enabled: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {quests.map((quest) => (
        <label
          key={quest.key}
          className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--color-parchment)]"
        >
          <input
            type="checkbox"
            checked={enabled[quest.key] === true}
            onChange={(event) => onToggle(quest.key, event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-jade-400)]"
          />
          <span>
            {quest.name}
            <span className="block text-xs leading-snug text-[var(--color-mist)]">
              {quest.hint}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function ConfigForm({ config }: { config: EditableConfig }) {
  const { accounts } = useDashboardAccountLive();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveConfigAction,
    null,
  );
  const [meCung, setMeCung] = useState(config.quests.meCung.enabled);
  const [luyenDan, setLuyenDan] = useState(config.quests.luyenDan.enabled);
  const [simpleEnabled, setSimpleEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SIMPLE_QUESTS.map((quest) => [
        quest.key,
        (config.quests as Record<string, { enabled?: boolean }>)[quest.key]?.enabled === true,
      ]),
    ),
  );

  // Hai tab nhiệm vụ, theo đúng cách site chia tài khoản. Không tab nào bị khoá: một đạo
  // hữu có thể nuôi cùng lúc tài khoản VIP lẫn tài khoản thường, engine tự chọn đúng bộ cho
  // từng tài khoản theo hạng đã dò. Mở sẵn tab Thường khi cả đội hình đều là hạng thường.
  const [questTab, setQuestTab] = useState<"vip" | "free">(() =>
    accounts.length > 0 && accounts.every((account) => account.accountTier === "free")
      ? "free"
      : "vip",
  );
  const vipCount = accounts.filter((account) => account.accountTier === "vip").length;
  const freeCount = accounts.filter((account) => account.accountTier === "free").length;
  const unknownCount = accounts.length - vipCount - freeCount;

  const toggleSimpleQuest = (key: string, value: boolean) => {
    setSimpleEnabled((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display mb-5 text-xl font-semibold text-gilded">Ngọc Giản Cấu Hình</h2>

      {/* AccountManager đứng NGOÀI <form>: React 19 reset mọi uncontrolled input trong form
          sau mỗi lần form action chạy xong — nếu để trong, một cú Khắc Ngọc Giản là chuỗi
          cookie/tên tài khoản đang gõ dở bị xoá trắng. */}
      <AccountManager />

      {/* noValidate: hai tab dùng `hidden`, một input số invalid nằm trong tab đang ẩn sẽ
          bị native validation chặn submit mà không hiện được bong bóng lỗi nào — nút bấm
          câm lặng. Zod ở server mới là trọng tài, và nó biết nói lỗi ra lời. */}
      <form action={action} noValidate>
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
        Một bộ cấu hình chung cho cả đội: tài khoản hạng VIP chạy tab VIP, hạng thường chạy
        tab Thường — không tài khoản nào chạy nhầm bộ của hạng kia.
        {accounts.length > 0 &&
          ` Đội hình hiện tại: ${[
            vipCount > 0 ? `${vipCount} VIP` : null,
            freeCount > 0 ? `${freeCount} thường` : null,
            unknownCount > 0 ? `${unknownCount} chưa dò hạng` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`}
      </p>

      {/* Một input thật cho mỗi config key. Checkbox ở hai tab chỉ là hai mặt của cùng state. */}
      {SIMPLE_QUESTS.map((quest) =>
        simpleEnabled[quest.key] ? (
          <input key={quest.key} type="hidden" name={`q_${quest.key}`} value="on" />
        ) : null,
      )}

      <div hidden={questTab !== "free"}>
        <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
          <legend className="px-2 text-sm font-semibold text-[var(--color-parchment)]">
            Nhiệm vụ tài khoản thường
          </legend>
          <p className="mb-3 text-xs text-[var(--color-mist)]">
            Bảy nhiệm vụ chạy trên trang riêng của từng mục — hub tài khoản thường không có
            nút bấm nhanh, nên auto đi thẳng vào trang. Mê Cung và Luyện Đan Đường nằm ở khối
            dưới cùng: chúng chạy được cho cả hai hạng.
          </p>
          <SimpleQuestGrid
            quests={FREE_QUESTS}
            enabled={simpleEnabled}
            onToggle={toggleSimpleQuest}
          />
        </fieldset>
      </div>

      {/* -------- Hai hoạt động dài: hiện ở MỌI tab, không nằm trong div ẩn nào --------
          Từ schema 45 chúng có twin thường (me-cung-thuong, luyen-dan-duong-thuong) dùng
          chung script và chung option — một bộ input duy nhất phục vụ cả hai hạng. Nhét
          vào cả hai tab là nhân đôi input cùng name, đúng cái bẫy comment đầu file cấm. */}
      <p className="mb-2 text-xs text-[var(--color-mist)]">
        Hai hoạt động dài dưới đây chạy được cho cả hai hạng tài khoản.
      </p>
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
              Ai có HP thấp hơn mức này sẽ bị mời ra để nhường chỗ cho người khoẻ hơn.
              Để 0 nếu không muốn đuổi ai.
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
              Ai vào phòng mà chờ quá lâu không bấm sẵn sàng sẽ bị mời ra, để phòng khỏi kẹt.
              Để 0 nếu không muốn giục.
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
              (bỏ tick để đánh hết lượt)
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
      <div hidden={questTab !== "vip"}>
      <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
        <legend className="px-2 text-sm font-semibold text-[var(--color-parchment)]">
          Nhiệm vụ ngày
        </legend>
        <p className="mb-3 text-xs text-[var(--color-mist)]">
          Mỗi ngày một lần. Tick là xong, không phải chỉnh gì thêm.
        </p>
        <SimpleQuestGrid
          quests={SIMPLE_QUESTS}
          enabled={simpleEnabled}
          onToggle={toggleSimpleQuest}
        />
      </fieldset>
      </div>

      {/* --------------------------------------------------------------- Vận hành */}
      <label className="mb-6 flex cursor-pointer items-start gap-2.5 text-sm text-[var(--color-parchment)]">
        <input
          type="checkbox"
          name="parallelQuests"
          defaultChecked={config.parallelQuests}
          className="mt-0.5 h-4 w-4 accent-[var(--color-jade-400)]"
        />
        <span>
          Chạy song song các nhiệm vụ
          <span className="block text-xs leading-snug text-[var(--color-mist)]">
            Mỗi nhiệm vụ một tab riêng trong cùng phiên — vòng chạy nhanh bằng nhiệm vụ chậm
            nhất thay vì cộng dồn. Bỏ tick để làm lần lượt từng nhiệm vụ nếu site trở chứng.
          </span>
        </span>
      </label>

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
    </section>
  );
}
