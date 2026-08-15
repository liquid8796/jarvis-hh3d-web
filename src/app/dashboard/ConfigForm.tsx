"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveConfigAction, type ActionResult } from "@/app/actions/automation";
import type { EditableConfig } from "@/lib/services/configs";
import { AccountManager } from "./AccountManager";
import { useDashboardAccountLive } from "./DashboardLiveProvider";

/**
 * Ngọc giản cấu hình. Uncontrolled inputs với defaultValue từ server — form chỉ là tấm
 * gương của JSONB, nộp lên là zod ở server quyết định đúng sai. Mấy mảnh state công tắc
 * nhiệm vụ (Mê Cung + hai bản Luyện Đan) chỉ để LÀM MỜ phần tuỳ chọn bên dưới: giá trị
 * vẫn được gửi đi đầy đủ, nên tắt rồi bật lại không mất những gì đã chọn.
 *
 * Đúng MỘT ô đi ngược luật ấy và có kiểm soát:「Dừng khi đã đủ huyền tinh」của Mê Cung. Nó
 * là ô duy nhất server có quyền phủ quyết, nên nó phải vẽ được cái phủ quyết đó ra — xem
 * CapLockDialog. Mọi ô còn lại vẫn thuần uncontrolled.
 *
 * Cấu hình nhiệm vụ là MỘT bộ chung cho mọi tài khoản (y như bản desktop dùng một
 * quests.json toàn cục): tab VIP áp cho các tài khoản hạng VIP, tab Thường cho các tài
 * khoản hạng thường — mỗi tài khoản chỉ chạy đúng những nhiệm vụ thuộc hạng của nó.
 * Riêng Luyện Đan Đường và Khoáng Mạch mang HAI bản tuỳ chọn, mỗi tab một bản (xem
 * LuyenDanFieldset / KhoangMachFieldset).
 */
/**
 * Chín nhiệm vụ chỉ có công tắc — key khớp với configSchema và SIMPLE_QUESTS của engine.
 * Mô tả viết cho người chơi, không phải cho người đọc mã.
 */
/**
 * `unavailable` = lý do nhiệm vụ này chưa dùng được. Có mặt nghĩa là KHOÁ: ô tick mờ đi và
 * bấm vào thì hiện lời giải thích. Để nguyên chuỗi lý do tại chỗ khai báo, đừng nhét vào một
 * bảng riêng — người thêm nhiệm vụ mới đọc đúng một dòng là biết luật.
 */
type SimpleQuest = { key: string; name: string; hint: string; unavailable?: string };

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
  // Khoáng Mạch KHÔNG còn ở đây: từ schema 58 nó có tuỳ chọn riêng (loại khoáng, tên mỏ,
  // đoạt mỏ) nên sống trong KhoangMachFieldset — cùng số phận rời-lưới với Luyện Đan Đường.
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

/**
 * Nhiệm vụ CHỈ có ở hạng thường — hồ sơ không có twin VIP, nên không được hiện ở lưới
 * "Nhiệm vụ ngày" của tab VIP: engine không bao giờ chạy nó cho tài khoản VIP, một ô tick
 * ở đó là lời hứa suông. Vẫn đi chung state và hidden input với mười nhiệm vụ kia.
 */
const FREE_ONLY_QUESTS: ReadonlyArray<SimpleQuest> = [
  {
    key: "hySuDuong",
    name: "Hỷ Sự Đường",
    hint: "Chúc phúc các tiệc cưới đang mở bên Tiên Duyên — mỗi lời chúc tốn 30 Tiên Ngọc, nhận 120 Tu Vi.",
  },
];

const FREE_QUESTS = [
  ...SIMPLE_QUESTS.filter((quest) => FREE_QUEST_KEYS.has(quest.key)),
  ...FREE_ONLY_QUESTS,
];

/** Đủ bộ nhiệm vụ một-công-tắc — nguồn cho state và hidden input, bất kể lưới nào hiện gì. */
const ALL_SIMPLE_QUESTS: ReadonlyArray<SimpleQuest> = [...SIMPLE_QUESTS, ...FREE_ONLY_QUESTS];

/**
 * Luyện Đan Đường có HAI bản cấu hình — tab VIP khắc `luyenDan`, tab Thường khắc
 * `luyenDanThuong`. Bài học 05/08: hồi hai tab còn nhìn chung một bộ, khắc ngọc giản từ
 * tab này là lặng lẽ đè loại đan/mức phân giải của tab kia. Cùng một khuôn fieldset,
 * chỉ khác tiền tố tên field và bản config đằng sau — tiền tố khớp thẳng với key trong
 * configSchema nên saveConfigAction đọc không cần bảng dịch.
 */
function LuyenDanFieldset({
  prefix,
  note,
  accentClass,
  config,
  enabled,
  onToggle,
}: {
  prefix: "luyenDan" | "luyenDanThuong";
  note: string;
  accentClass: string;
  config: EditableConfig["quests"]["luyenDan"];
  enabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
      <legend className="px-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
          <input
            type="checkbox"
            name={`${prefix}Enabled`}
            defaultChecked={config.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className={`h-4 w-4 ${accentClass}`}
          />
          Luyện Đan Đường
        </label>
      </legend>

      <p className="mb-3 text-xs text-[var(--color-mist)]">{note}</p>

      <div
        className={`grid gap-4 transition-opacity duration-300 sm:grid-cols-2 ${
          enabled ? "opacity-100" : "pointer-events-none opacity-40"
        }`}
      >
        <div>
          <label className="label" htmlFor={`${prefix}Tier`}>
            Loại đan
          </label>
          <select
            id={`${prefix}Tier`}
            name={`${prefix}Tier`}
            className="input"
            defaultValue={config.tier}
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
          <label className="label" htmlFor={`${prefix}KeepStars`}>
            Phân giải đan
          </label>
          <select
            id={`${prefix}KeepStars`}
            name={`${prefix}KeepStars`}
            className="input"
            defaultValue={config.keepStarsFrom}
          >
            <option value={0}>Phân giải tất cả</option>
            <option value={4}>Giữ 4 sao, phân giải 3 sao trở xuống</option>
            <option value={3}>Giữ từ 3 sao, phân giải 2 sao trở xuống</option>
            <option value={2}>Giữ từ 2 sao, chỉ phân giải 1 sao</option>
            {/* 1, không phải 5. Con số là "giữ từ N sao", mà đan chỉ rơi 1–4 sao —
                nên "giữ từ 1" là giữ sạch, còn "giữ từ 5" sẽ phân giải sạch. Đúng ngược. */}
            <option value={1}>Không phân giải (giữ tất cả)</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Đan rơi từ 1–4 sao. Chỉ viên bị phân giải mới hoàn lại dược liệu.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Khoáng Mạch — cùng khuôn hai-bản-một-fieldset với Luyện Đan Đường ngay trên: tab VIP khắc
 * `khoangMach`, tab Thường khắc `khoangMachThuong`, tiền tố tên field khớp thẳng key trong
 * configSchema. Bốn tuỳ chọn dựng từ bản ghi khoang-mach-20260814-133812; riêng cụm đoạt mỏ
 * nói rõ giá tiền ngay tại chỗ — người bật phải biết mỗi cú đoạt kèm một Linh Quang Phù.
 */
function KhoangMachFieldset({
  prefix,
  note,
  accentClass,
  config,
  enabled,
  onToggle,
}: {
  prefix: "khoangMach" | "khoangMachThuong";
  note: string;
  accentClass: string;
  config: EditableConfig["quests"]["khoangMach"];
  enabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
      <legend className="px-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
          <input
            type="checkbox"
            name={`${prefix}Enabled`}
            defaultChecked={config.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className={`h-4 w-4 ${accentClass}`}
          />
          Khoáng Mạch
        </label>
      </legend>

      <p className="mb-3 text-xs text-[var(--color-mist)]">{note}</p>

      <div
        className={`grid gap-4 transition-opacity duration-300 sm:grid-cols-2 ${
          enabled ? "opacity-100" : "pointer-events-none opacity-40"
        }`}
      >
        <div>
          <label className="label" htmlFor={`${prefix}MineType`}>
            Loại khoáng
          </label>
          <select
            id={`${prefix}MineType`}
            name={`${prefix}MineType`}
            className="input"
            defaultValue={config.mineType}
          >
            <option value="1">Thượng — Khoáng Vàng</option>
            <option value="2">Trung — Khoáng Bạc</option>
            <option value="3">Hạ — Khoáng Đồng (Tân Thủ)</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Vào mỏ, đợi từng chu kỳ 30 phút rồi nhận Tu Vi + Tinh Thạch — đào tới khi đầy giới
            hạn ngày (giới hạn đổi mỗi ngày, khôi lỗi tự đọc trên trang).
          </p>
        </div>

        <div>
          <label className="label" htmlFor={`${prefix}MineName`}>
            Tên mỏ
          </label>
          <input
            id={`${prefix}MineName`}
            name={`${prefix}MineName`}
            className="input"
            type="text"
            maxLength={60}
            defaultValue={config.mineName}
            placeholder="vd: Thông Thiên Kiếm Phái"
          />
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Gõ một phần tên cũng khớp, không cần đủ dấu. Bỏ trống = đào tiếp mỏ đang ở.
          </p>
        </div>

        <div>
          <label className="label" htmlFor={`${prefix}MinBonus`}>
            Ngưỡng % tu vi để đào
          </label>
          <input
            id={`${prefix}MinBonus`}
            name={`${prefix}MinBonus`}
            className="input"
            type="number"
            min={0}
            max={500}
            defaultValue={config.minBonus}
          />
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Chỉ nhận thưởng khi bonus tu vi của mỏ đạt mức này trở lên; dưới ngưỡng thì phần đã
            đào cứ treo, chờ lượt sau mỏ khá hơn. Để 0 = luôn nhận.
          </p>
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)]">
            <input
              type="checkbox"
              name={`${prefix}BuyPhu`}
              defaultChecked={config.buyPhu}
              className={`h-4 w-4 ${accentClass}`}
            />
            Mua Linh Quang Phù (tối đa 1 lá/ngày)
          </label>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            +20% tu vi trong 1 giờ, mua ngay trước lúc nhận thưởng — tiền thật, nên mỗi ngày
            khôi lỗi chỉ mua đúng một lá.
          </p>
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)]">
            <input
              type="checkbox"
              name={`${prefix}HostMode`}
              defaultChecked={config.hostMode}
              className={`h-4 w-4 ${accentClass}`}
            />
            Đoạt mỏ (làm chủ)
          </label>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Chỉ đoạt khi khai thác đã đạt tối đa và bonus mỏ đủ ngưỡng dưới đây — site cho 3
            lượt tấn công mỗi ngày.
          </p>
        </div>

        <div>
          <label className="label" htmlFor={`${prefix}HostMinBonus`}>
            Ngưỡng % tu vi để đoạt
          </label>
          <input
            id={`${prefix}HostMinBonus`}
            name={`${prefix}HostMinBonus`}
            className="input"
            type="number"
            min={0}
            max={500}
            defaultValue={config.hostMinBonus}
          />
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Chỉ đoạt khi bonus tu vi của mỏ đạt mức này trở lên; dưới ngưỡng thì chỉ đào.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Một lưới nhiệm vụ một-công-tắc, kèm ô「Chọn tất cả」ở đầu.
 *
 * Ô tổng chỉ đụng ĐÚNG những nhiệm vụ của lưới đang hiện. Điều đó quan trọng vì hai lưới
 * dùng CHUNG một state và chỉ giao nhau một phần: một ô tổng quét cả bảng sẽ lặng lẽ bật
 * Bí Cảnh và Phúc Lợi VIP cho người chỉ định bật đủ nhiệm vụ của tài khoản thường — và
 * ngược lại, bật cả Hỷ Sự Đường (thứ chỉ tab Thường có) từ tab VIP.
 *
 * Ba trạng thái, không phải hai: bật hết → tick, tắt hết → trống, bật một phần →
 * `indeterminate` (gạch ngang). React không có prop cho trạng thái ấy nên phải đặt thẳng
 * lên DOM node; thiếu nó thì "bật 9/10" trông y hệt "chưa bật gì".
 */
function SimpleQuestGrid({
  quests,
  enabled,
  onToggle,
  onToggleMany,
  onLocked,
}: {
  quests: ReadonlyArray<SimpleQuest>;
  enabled: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
  onToggleMany: (keys: string[], value: boolean) => void;
  onLocked: (quest: SimpleQuest) => void;
}) {
  // Nhiệm vụ đang khoá đứng NGOÀI mọi phép đếm và ngoài「Chọn tất cả」. Tính cả nó thì
  // `allOn` không bao giờ đạt được — ô tổng mãi ở trạng thái lỡ dở, và người bấm「Chọn tất
  // cả」sẽ thấy nó cứ bật lại lưng chừng mà không hiểu vì sao.
  const openQuests = quests.filter((quest) => !quest.unavailable);
  const selected = openQuests.filter((quest) => enabled[quest.key] === true).length;
  const allOn = openQuests.length > 0 && selected === openQuests.length;
  const someOn = selected > 0 && !allOn;
  const master = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (master.current) master.current.indeterminate = someOn;
  }, [someOn]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-ink-600)]/40 pb-2">
        {/* Không có thuộc tính `name`: nguồn FormData duy nhất vẫn là các hidden input ở
            ConfigForm. Ô này chỉ lái state, đúng như mọi checkbox nhiệm vụ khác. */}
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-[var(--color-parchment)]">
          <input
            ref={master}
            type="checkbox"
            checked={allOn}
            onChange={(event) =>
              onToggleMany(
                openQuests.map((quest) => quest.key),
                event.target.checked,
              )
            }
            className="h-4 w-4 accent-[var(--color-gold-400)]"
          />
          Chọn tất cả
        </label>
        <span className="text-xs text-[var(--color-mist)]">
          {selected}/{openQuests.length} đang bật
        </span>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {quests.map((quest) => (
          <label
            key={quest.key}
            className={`flex items-start gap-2.5 text-sm ${
              quest.unavailable
                ? "cursor-not-allowed text-[var(--color-mist)]"
                : "cursor-pointer text-[var(--color-parchment)]"
            }`}
            // Ô input `disabled` KHÔNG phát sự kiện click, nên người bấm vào nó sẽ không nhận
            // được lời giải thích nào — bắt ở nhãn bao ngoài thì cả hàng đều bấm được.
            onClick={quest.unavailable ? () => onLocked(quest) : undefined}
          >
            <input
              type="checkbox"
              checked={enabled[quest.key] === true}
              disabled={quest.unavailable !== undefined}
              onChange={(event) => onToggle(quest.key, event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-jade-400)] disabled:opacity-50"
            />
            <span>
              {quest.name}
              {quest.unavailable && (
                <em className="ml-1.5 rounded px-1.5 py-0.5 align-[1px] text-[0.62rem] not-italic tracking-wide text-[var(--color-gold-300)] ring-1 ring-[var(--color-gold-400)]/40">
                  chưa mở
                </em>
              )}
              <span className="block text-xs leading-snug text-[var(--color-mist)]">
                {quest.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}

/**
 * Hộp cảnh báo khi đạo hữu thường thử gỡ khoá「Dừng khi đã đủ huyền tinh」.
 *
 * Là một hộp thật chứ không phải một dòng chữ đỏ nhỏ bên dưới: hành động vừa rồi ĐÃ BỊ TỪ
 * CHỐI, và một lời từ chối trôi qua trong ngoại vi tầm mắt sẽ bị đọc thành "tôi bấm hụt" —
 * người ta bấm lại, lại hụt, rồi kết luận là trang hỏng.
 */
function CapLockDialog({ onClose }: { onClose: () => void }) {
  // Esc đóng được: hộp này chỉ để báo tin, giam bàn phím lại trong nó là bất lịch sự.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cap-lock-title"
      onClick={onClose}
    >
      <div className="card card-hairline w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 id="cap-lock-title" className="h-display mb-3 text-lg font-semibold text-gilded">
          Tuỳ chọn này đã bị khoá
        </h3>
        <p className="mb-3 text-sm leading-relaxed text-[var(--color-parchment)]">
          Mỗi lượt Mê Cung giữ một phiên trình duyệt hàng chục phút. Khôi lỗi tông môn chỉ có
          vài ghế và cả tông môn dùng chung, nên bỏ tick này là mở đường cho vài đàn đánh hết
          lượt chiếm sạch chỗ — những đạo hữu còn lại xếp hàng cả ngày mà không hiểu vì sao.
        </p>
        <p className="mb-5 text-sm leading-relaxed text-[var(--color-mist)]">
          Vì vậy「Dừng khi đã đủ huyền tinh trong ngày」luôn được bật. Chỉ tông chủ mới gỡ
          được khoá này.
        </p>
        {/* type="button" là bắt buộc: hộp này nằm TRONG <form>, mà một <button> trần mặc
            định là submit — bấm "Đã hiểu" sẽ khắc luôn ngọc giản. */}
        <button type="button" className="btn btn-gold" onClick={onClose} autoFocus>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}

/**
 * Hộp báo một nhiệm vụ chưa mở. Cùng khuôn với `CapLockDialog` ngay trên — hai hộp cùng nói
 * "chỗ này bấm không được, và đây là lý do", nên chúng phải trông và cư xử giống hệt nhau.
 */
function QuestLockedDialog({ quest, onClose }: { quest: SimpleQuest; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="quest-locked-title"
      onClick={onClose}
    >
      <div className="card card-hairline w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 id="quest-locked-title" className="h-display mb-3 text-lg font-semibold text-gilded">
          {quest.name} — chưa mở
        </h3>
        <p className="mb-5 text-sm leading-relaxed text-[var(--color-parchment)]">
          {quest.unavailable}
        </p>
        {/* type="button" là bắt buộc: hộp này nằm TRONG <form>, mà một <button> trần mặc
            định là submit — bấm "Đã hiểu" sẽ khắc luôn ngọc giản. */}
        <button type="button" className="btn btn-gold" onClick={onClose} autoFocus>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}

export function ConfigForm({ config, isAdmin }: { config: EditableConfig; isAdmin: boolean }) {
  const { accounts } = useDashboardAccountLive();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveConfigAction,
    null,
  );
  const [meCung, setMeCung] = useState(config.quests.meCung.enabled);
  /**
   * Ô「Dừng khi đã đủ huyền tinh」là ô DUY NHẤT có kiểm soát trong khối này, vì nó là ô duy
   * nhất có luật. Với đạo hữu thường nó khởi đầu bằng `true` bất kể trong ngọc giản đang ghi
   * gì: document cũ có thể còn mang `false` từ trước khi có luật, và vẽ ra một ô chưa tick
   * là hứa một điều mà cửa phát việc sẽ không giữ.
   */
  const [capCheck, setCapCheck] = useState(isAdmin ? config.quests.meCung.capCheck : true);
  const [capLocked, setCapLocked] = useState(false);
  const [luyenDan, setLuyenDan] = useState(config.quests.luyenDan.enabled);
  const [luyenDanThuong, setLuyenDanThuong] = useState(config.quests.luyenDanThuong.enabled);
  const [khoangMach, setKhoangMach] = useState(config.quests.khoangMach.enabled);
  const [khoangMachThuong, setKhoangMachThuong] = useState(config.quests.khoangMachThuong.enabled);
  /** Nhiệm vụ đang khoá mà người dùng vừa bấm vào — `null` là không có popup nào. */
  const [lockedQuest, setLockedQuest] = useState<SimpleQuest | null>(null);
  const [simpleEnabled, setSimpleEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      ALL_SIMPLE_QUESTS.map((quest) => [
        quest.key,
        // Nhiệm vụ đang khoá luôn khởi sinh TẮT, kể cả khi cấu hình cũ trong database còn
        // bật: server đã ép tắt ở cửa phát việc, nên vẽ nó đang bật là nói dối người xem về
        // thứ sắp chạy. (Danh sách khoá hiện rỗng — cơ chế ở lại cho nhiệm vụ tương lai.)
        quest.unavailable === undefined &&
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

  // Một đường ghi duy nhất cho cả một ô lẫn cả lưới: ô「Chọn tất cả」bật mười công tắc
  // trong MỘT lần cập nhật state, không phải mười lần gọi vòng quanh.
  const toggleQuests = (keys: string[], value: boolean) => {
    setSimpleEnabled((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = value;
      return next;
    });
  };
  const toggleSimpleQuest = (key: string, value: boolean) => toggleQuests([key], value);

  return (
    <section className="card card-hairline p-6 xl:p-8">
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
            ["vip", "Tài khoản VIP"],
            ["free", "Tài khoản thường"],
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
      {/* Điều kiện bọc CẢ thẻ <p>, không phải chỉ phần chữ bên trong: chưa có tài khoản nào
          thì đây là một đoạn rỗng, mà một đoạn rỗng vẫn mang nguyên `mb-4` — tức một khoảng
          trống 1rem không ai hiểu từ đâu ra. */}
      {accounts.length > 0 && (
        <p className="mb-4 text-xs text-[var(--color-mist)]">
          {`Đội hình hiện tại: ${[
            vipCount > 0 ? `${vipCount} VIP` : null,
            freeCount > 0 ? `${freeCount} thường` : null,
            unknownCount > 0 ? `${unknownCount} chưa dò hạng` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`}
        </p>
      )}

      {/* Một input thật cho mỗi config key. Checkbox ở hai tab chỉ là hai mặt của cùng state. */}
      {ALL_SIMPLE_QUESTS.map((quest) =>
        simpleEnabled[quest.key] ? (
          <input key={quest.key} type="hidden" name={`q_${quest.key}`} value="on" />
        ) : null,
      )}

      <div hidden={questTab !== "free"}>
        <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
          <legend className="px-2 text-sm font-semibold text-[var(--color-parchment)]">
            Nhiệm vụ tài khoản thường
          </legend>
          <SimpleQuestGrid
            quests={FREE_QUESTS}
            enabled={simpleEnabled}
            onToggle={toggleSimpleQuest}
            onToggleMany={toggleQuests}
            onLocked={setLockedQuest}
          />
        </fieldset>
      </div>

      {/* -------- Mê Cung: hiện ở MỌI tab, không nằm trong div ẩn nào --------
          Từ schema 45 nó có twin thường (me-cung-thuong) dùng chung script và chung
          option — một bộ input duy nhất phục vụ cả hai hạng. Nhét vào cả hai tab là
          nhân đôi input cùng name, đúng cái bẫy comment đầu file cấm. Luyện Đan Đường
          thì NGƯỢC LẠI: hai bản config riêng, mỗi tab một fieldset với tên field riêng
          (xem LuyenDanFieldset) — nên nó nằm TRONG div của từng tab, ngay bên dưới. */}
      <p className="mb-2 text-xs text-[var(--color-mist)]">
        Mê Cung chạy được cho cả hai hạng tài khoản — một bộ tuỳ chọn chung.
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

          <div>
            <label className="label" htmlFor="meCungChatLobby">
              Lời nhắn khi mở phòng
            </label>
            <input
              id="meCungChatLobby"
              name="meCungChatLobby"
              type="text"
              maxLength={200}
              className="input"
              defaultValue={config.quests.meCung.chatLobby}
              placeholder="để trống = không nhắn"
            />
          </div>

          <div>
            <label className="label" htmlFor="meCungChatFight">
              Lời nhắn khi vào trận
            </label>
            <input
              id="meCungChatFight"
              name="meCungChatFight"
              type="text"
              maxLength={200}
              className="input"
              defaultValue={config.quests.meCung.chatFight}
              placeholder="để trống = không nhắn"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)] sm:col-span-2">
            {/* CỐ Ý không dùng `disabled`. Một ô bị khoá cứng nuốt luôn cú bấm: không có
                sự kiện nào để mà cảnh báo, và người dùng chỉ thấy một ô không nhúc nhích.
                Ô này nhận cú bấm, từ chối nó, rồi NÓI vì sao.

                Việc ô tự tick lại là hợp đồng của input có kiểm soát trong React: handler
                không đổi state thì React khôi phục DOM về đúng `checked` — nên chỉ cần
                không gọi setCapCheck là ô quay lại như cũ. */}
            <input
              type="checkbox"
              name="meCungCapCheck"
              checked={capCheck}
              onChange={(event) => {
                if (!isAdmin && !event.target.checked) {
                  setCapLocked(true);
                  return;
                }
                setCapCheck(event.target.checked);
              }}
              className="h-4 w-4 accent-[var(--color-jade-400)]"
            />
            Dừng khi đã đủ huyền tinh trong ngày
            <span className="text-xs text-[var(--color-mist)]">
              {isAdmin
                ? "(bỏ tick để đánh hết lượt)"
                : "(khoá bật — Mê Cung giữ ghế khôi lỗi tông môn rất lâu)"}
            </span>
          </label>
        </div>
      </fieldset>

      {/* ----------------------------------------------------------- Luyện Đan Đường
          Hai bản trong hai div tab — KHÔNG phải một bản dùng chung như trước. Cả hai vẫn
          luôn nằm trong DOM (div chỉ `hidden`) nên cả hai bộ field cùng được nộp lên,
          mỗi bộ một tiền tố tên riêng — không có input nào trùng name. */}
      <div hidden={questTab !== "vip"}>
        <LuyenDanFieldset
          prefix="luyenDan"
          note="Bản riêng cho tài khoản VIP — chỉnh ở đây không đụng tab Thường."
          accentClass="accent-[var(--color-gold-400)]"
          config={config.quests.luyenDan}
          enabled={luyenDan}
          onToggle={setLuyenDan}
        />
      </div>
      <div hidden={questTab !== "free"}>
        <LuyenDanFieldset
          prefix="luyenDanThuong"
          note="Bản riêng cho tài khoản thường — chỉnh ở đây không đụng tab VIP."
          accentClass="accent-[var(--color-jade-400)]"
          config={config.quests.luyenDanThuong}
          enabled={luyenDanThuong}
          onToggle={setLuyenDanThuong}
        />
      </div>

      {/* ------------------------------------------------------------- Khoáng Mạch
          Cùng khuôn hai-bản-hai-tab với Luyện Đan Đường ngay trên — mỗi tab một tiền tố
          tên field riêng, không input nào trùng name. */}
      <div hidden={questTab !== "vip"}>
        <KhoangMachFieldset
          prefix="khoangMach"
          note="Bản riêng cho tài khoản VIP — chỉnh ở đây không đụng tab Thường."
          accentClass="accent-[var(--color-gold-400)]"
          config={config.quests.khoangMach}
          enabled={khoangMach}
          onToggle={setKhoangMach}
        />
      </div>
      <div hidden={questTab !== "free"}>
        <KhoangMachFieldset
          prefix="khoangMachThuong"
          note="Bản riêng cho tài khoản thường — chỉnh ở đây không đụng tab VIP."
          accentClass="accent-[var(--color-jade-400)]"
          config={config.quests.khoangMachThuong}
          enabled={khoangMachThuong}
          onToggle={setKhoangMachThuong}
        />
      </div>

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
          onToggleMany={toggleQuests}
          onLocked={setLockedQuest}
        />
      </fieldset>
      </div>

      {/* Ô tick「Chạy song song các nhiệm vụ」đã gỡ ngày 12/08/2026: mọi vòng nay chạy tuần tự,
          nên không còn gì để bật/tắt. Xem `parallelQuests` trong services/configs.ts. */}

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

      {capLocked && <CapLockDialog onClose={() => setCapLocked(false)} />}
      {lockedQuest && <QuestLockedDialog quest={lockedQuest} onClose={() => setLockedQuest(null)} />}
    </section>
  );
}
