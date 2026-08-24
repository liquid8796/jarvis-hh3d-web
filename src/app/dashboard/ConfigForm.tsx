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
 * Những nhiệm vụ chỉ có công tắc — key khớp với configSchema và SIMPLE_QUESTS của engine.
 * (Không đếm số ở đây: dòng này từng ghi "Chín" trong khi danh sách đã mười, rồi mười một.)
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
  {
    key: "hySuDuong",
    name: "Hỷ Sự Đường",
    hint: "Chúc phúc và nhận lì xì ở các tiệc cưới.",
  },
  {
    key: "phanThuongHoatDong",
    name: "Phần Thưởng Hoạt Động",
    hint: "Mở hai rương mốc 75% và 100% trên trang nhiệm vụ ngày, sau khi các nhiệm vụ ngày khác đã cộng đủ tiến độ.",
  },
  // Khoáng Mạch KHÔNG còn ở đây: từ schema 58 nó có tuỳ chọn riêng (loại khoáng, tên mỏ,
  // đoạt mỏ) nên sống trong KhoangMachFieldset — cùng số phận rời-lưới với Luyện Đan Đường.
];

const FREE_QUEST_KEYS = new Set([
  "diemDanh",
  "hoangVuc",
  "phucLoiDuong",
  "thiLuyen",
  // Từ schema 67: hạng thường có đường riêng — hub bản thường chỉ có link "Đến Đánh ›" mở
  // trang /bi-canh-tong-mon/?nv_embed=1, nơi nút KHIÊU CHIẾN sống (bản ghi 18/08/2026). Trước
  // đó khoá này CHỈ có ở tab VIP vì hồ sơ không có twin nào để chạy.
  "biCanh",
  "vongQuay",
  "teLe",
  "vanDap",
  // Hai rương nằm ở THÂN trang nhiệm vụ ngày, không phải một nút quick-click của hạng VIP,
  // nên twin thường chạy đúng script ấy (hồ sơ schema 66). Hub bản thường mà không có mục
  // này thì lượt chạy nói ra rồi hẹn giờ — không đỏ, không tự khoá cả ngày.
  "phanThuongHoatDong",
  // Từ schema 71 có twin VIP: cả sảnh Hỷ Sự lẫn hai loại phòng cưới đều là trang chung,
  // không selector nào đổi theo hạng, nên một bộ bước phục vụ cả hai. Trước đó khoá này chỉ
  // hiện ở tab Thường vì hồ sơ không có bản VIP nào để chạy.
  "hySuDuong",
]);

/**
 * Lưới của tab Thường = những nhiệm vụ trên CÓ twin `-thuong` trong hồ sơ.
 *
 * Chiều ngược lại từng có một danh sách riêng (`FREE_ONLY_QUESTS`, cho nhiệm vụ chỉ hạng
 * thường), gỡ ở schema 71 khi Hỷ Sự Đường — thành viên cuối cùng — có bản VIP. Luật nó giữ vẫn
 * còn nguyên giá trị, nên chép lại đây: **một khoá chỉ được vào `SIMPLE_QUESTS` khi hồ sơ có
 * bản VIP để chạy**, bằng không ô tick ở tab VIP là lời hứa suông. Ngày nào lại có nhiệm vụ
 * chỉ-hạng-thường thì dựng lại danh sách riêng, đừng nhét nó vào `SIMPLE_QUESTS`.
 */
const FREE_QUESTS = SIMPLE_QUESTS.filter((quest) => FREE_QUEST_KEYS.has(quest.key));

/**
 * Luyện Đan Đường có HAI bản cấu hình — tab VIP khắc `luyenDan`, tab Thường khắc
 * `luyenDanThuong`. Bài học 05/08: hồi hai tab còn nhìn chung một bộ, khắc ngọc giản từ
 * tab này là lặng lẽ đè loại đan/mức phân giải của tab kia. Cùng một khuôn fieldset,
 * chỉ khác tiền tố tên field và bản config đằng sau — tiền tố khớp thẳng với key trong
 * configSchema nên saveConfigAction đọc không cần bảng dịch.
 */
/**
 * Khoá của một khối gấp được. Hai bản VIP/Thường của CÙNG một nhiệm vụ dùng chung một khoá:
 * chúng là một nhiệm vụ, chỉ khác hạng tài khoản, nên gấp ở tab này thì tab kia cũng gấp —
 * người dùng không phải gấp hai lần cho một thứ. Ngược lại hai lưới nhiệm-vụ-ngày là hai
 * danh sách KHÁC nhau nên mỗi bên một khoá.
 */
type BlockKey = "simpleFree" | "meCung" | "luyenDan" | "khoangMach" | "simpleVip";

const COLLAPSE_STORAGE_KEY = "jvz.config.collapsed";

/**
 * Nhớ khối nào đang gấp, qua các lượt mở trang.
 *
 * Đọc `localStorage` trong `useEffect` chứ KHÔNG phải lúc render, và đó không phải chuyện gu:
 * máy chủ không có `localStorage`, nên đọc lúc render là hai bên dựng ra hai cây khác nhau và
 * React kêu hydration mismatch. Lượt vẽ đầu vì thế luôn là "mở hết" — đúng hành vi cũ — rồi
 * những khối đã gấp mới xếp lại ngay sau đó.
 *
 * Trình duyệt cấm `localStorage` (chế độ riêng tư, cookie bị chặn) thì ngọc giản vẫn dùng
 * được y nguyên; chỉ là lần sau mở lại thì mọi khối đều mở. Nên mọi phép đọc/ghi ở đây đều
 * nuốt lỗi có chủ ý.
 */
function useCollapsedBlocks() {
  const [collapsed, setCollapsed] = useState<Partial<Record<BlockKey, boolean>>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      // Khoá này có thể mang rác của một đời mã khác, hoặc của một tiện ích nào đó. Chỉ nhận
      // đúng hình dạng mình ghi ra; sai hình thì bỏ qua, đừng để nó ném giữa lượt dựng trang.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setCollapsed(parsed as Partial<Record<BlockKey, boolean>>);
      }
    } catch {
      /* không nhớ được thì thôi — xem ghi chú trên */
    }
  }, []);

  /**
   * Chỉ ghi xuống đĩa SAU một cú bấm thật. Không có cái chốt này thì lượt vẽ đầu tiên sẽ ghi
   * đè `{}` lên đúng thứ vừa đọc lên: hiệu ứng nạp ở trên gọi `setCollapsed`, nhưng lần render
   * mang giá trị mới chỉ tới ở nhịp sau — nên một hiệu ứng ghi chạy cùng nhịp ấy vẫn đang cầm
   * `{}`. Và phép ghi nằm ở đây chứ không trong hàm cập nhật state, để hàm ấy THUẦN: React gọi
   * nó hai lần ở chế độ nghiêm ngặt.
   */
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      /* như trên */
    }
  }, [collapsed]);

  const toggle = (key: BlockKey) => {
    touched.current = true;
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  };

  return { collapsed, toggle };
}

/**
 * Nút gấp/mở đứng cạnh tên khối.
 *
 * `type="button"` là BẮT BUỘC chứ không phải cho đủ lệ: nút trần trong một `<form>` mặc định
 * là `submit`, nên thiếu nó thì mỗi cú gấp là một lần khắc ngọc giản.
 */
function CollapseToggle({
  bodyId,
  collapsed,
  onToggle,
  label,
}: {
  bodyId: string;
  collapsed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      title={collapsed ? `Mở ${label}` : `Gấp ${label}`}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-mist)] transition hover:text-[var(--color-parchment)]"
    >
      <span
        aria-hidden="true"
        className={`text-[10px] leading-none transition-transform duration-200 ${
          collapsed ? "-rotate-90" : ""
        }`}
      >
        ▼
      </span>
      <span className="sr-only">{collapsed ? `Mở khối ${label}` : `Gấp khối ${label}`}</span>
    </button>
  );
}

function LuyenDanFieldset({
  prefix,
  accentClass,
  config,
  enabled,
  onToggle,
  collapsed,
  onToggleCollapse,
}: {
  prefix: "luyenDan" | "luyenDanThuong";
  accentClass: string;
  config: EditableConfig["quests"]["luyenDan"];
  enabled: boolean;
  onToggle: (value: boolean) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
      {/* <span> chứ không phải <div>: nội dung hợp lệ của <legend> là phrasing content, mà
          <div> là flow content. Trình duyệt vẫn vẽ ra, nhưng đó là markup sai — và flex chạy
          y hệt trên <span>. */}
      <legend className="px-2">
        <span className="flex items-center gap-2">
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
          <CollapseToggle
            bodyId={`${prefix}-body`}
            collapsed={collapsed}
            onToggle={onToggleCollapse}
            label="Luyện Đan Đường"
          />
        </span>
      </legend>

      <div
        id={`${prefix}-body`}
        hidden={collapsed}
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
  accentClass,
  config,
  enabled,
  onToggle,
  collapsed,
  onToggleCollapse,
}: {
  prefix: "khoangMach" | "khoangMachThuong";
  accentClass: string;
  config: EditableConfig["quests"]["khoangMach"];
  enabled: boolean;
  onToggle: (value: boolean) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  /**
   * Ô「Đoạt mỏ」là công tắc của cả cụm bên dưới nó, nên nó phải sống trong state chứ không
   * thể nằm im ở `defaultChecked` như những ô còn lại: hai tuỳ chọn kia phải sáng/tắt ngay
   * lúc bấm, không đợi tới lượt lưu. State nằm TRONG component nên hai bản VIP/Thường mỗi
   * bản một cái, y như `enabled` của mỗi fieldset.
   */
  const [hostMode, setHostMode] = useState(config.hostMode);
  /**
   * Mờ cụm con CHỈ khi khung cha đang sáng. Cả fieldset đã mang `opacity-40` lúc nhiệm vụ
   * tắt, mà hai lớp opacity lồng nhau thì NHÂN với nhau — 0.16 đọc như một lỗi vẽ chứ không
   * như một ô đang tắt. Phần khoá thao tác thì không cần điều kiện: cha đã `pointer-events-none`.
   */
  const subDimmed = enabled && !hostMode;

  return (
    <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
      {/* <span> chứ không phải <div>: nội dung hợp lệ của <legend> là phrasing content, mà
          <div> là flow content. Trình duyệt vẫn vẽ ra, nhưng đó là markup sai — và flex chạy
          y hệt trên <span>. */}
      <legend className="px-2">
        <span className="flex items-center gap-2">
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
          <CollapseToggle
            bodyId={`${prefix}-body`}
            collapsed={collapsed}
            onToggle={onToggleCollapse}
            label="Khoáng Mạch"
          />
        </span>
      </legend>

      <div
        id={`${prefix}-body`}
        hidden={collapsed}
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
            hạn ngày.
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
            /* Tên BỊA, và phải giữ nguyên như vậy. Ô này để trống nghĩa là「đào tiếp mỏ đang
               ở」, nên placeholder chỉ có một việc: cho thấy HÌNH DẠNG của một cái tên. Dùng
               tên mỏ có thật thì nó đọc ra thành một lời gợi ý — người ta gõ theo, hoặc tưởng
               đó là mặc định — mà mỏ thật thì đổi theo mùa và theo hạng, nên lời gợi ý ấy sai
               ngay từ ngày mai. "Huyễn" (ảo) là chỗ cái tên tự khai mình không có thật. */
            placeholder="vd: Huyễn Nguyệt Kiếm Phái"
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

        {/* Cụm ĐOẠT MỎ — công tắc và hai thứ chỉ có nghĩa khi công tắc ấy bật, gói chung một
            khung để không ai phải đoán cái nào thuộc về cái nào. Chiếm trọn hàng vì nó cao gần
            gấp ba một ô thường; để nó nằm nửa hàng thì ô bên cạnh bị kéo giãn theo. */}
        <div className="rounded-lg border border-[var(--color-ink-600)]/60 p-3 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)]">
            <input
              type="checkbox"
              name={`${prefix}HostMode`}
              defaultChecked={config.hostMode}
              onChange={(e) => setHostMode(e.target.checked)}
              className={`h-4 w-4 ${accentClass}`}
            />
            Đoạt mỏ (làm chủ)
          </label>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Chỉ đoạt khi khai thác đã đạt tối đa và bonus mỏ đủ ngưỡng dưới đây — site cho 3
            lượt tấn công mỗi ngày.
          </p>

          <div className={`mt-3 grid gap-4 sm:grid-cols-2 ${subDimmed ? "opacity-40" : ""}`}>
            {/* Ô phù khoá bằng `disabled` THẬT, và đó là điều khác nhau giữa hai ô dưới đây.
                Một checkbox `disabled` không đi cùng form, mà action đọc「vắng mặt」thành
                `false` — nên tắt Đoạt mỏ rồi lưu là khôi lỗi thật sự thôi mua phù, đúng như
                màn hình đang nói. Đây là tiền thật mỗi ngày, nên vế an toàn phải là vế mặc
                định của một ô đang mờ. */}
            <div>
              <label
                className={`flex items-center gap-2 text-sm text-[var(--color-parchment)] ${
                  hostMode ? "cursor-pointer" : "cursor-not-allowed"
                }`}
              >
                <input
                  type="checkbox"
                  name={`${prefix}BuyPhu`}
                  defaultChecked={config.buyPhu}
                  disabled={!hostMode}
                  className={`h-4 w-4 ${accentClass}`}
                />
                Mua Linh Quang Phù (tối đa 1 lá/ngày)
              </label>
              <p className="mt-1 text-xs text-[var(--color-mist)]">
                +20% tu vi trong 1 giờ, mua ngay trước lúc nhận thưởng — tiền thật, nên mỗi ngày
                khôi lỗi chỉ mua đúng một lá.
              </p>
            </div>

            {/* Ngưỡng thì `readOnly`, KHÔNG `disabled`: một ô số vắng mặt sẽ được action đọc
                thành 100 (mặc định của nó), nên `disabled` ở đây là âm thầm ghi đè con số đạo
                hữu đã chọn mỗi lượt lưu. `readOnly` vẫn gửi giá trị đi, nên tắt rồi bật lại
                Đoạt mỏ là thấy đúng ngưỡng cũ. Engine cũng chỉ đọc số này bên trong nhánh đoạt,
                nên để nguyên nó không làm gì cả. */}
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
                readOnly={!hostMode}
                aria-disabled={!hostMode}
              />
              <p className="mt-1 text-xs text-[var(--color-mist)]">
                Chỉ đoạt khi bonus tu vi của mỏ đạt mức này trở lên; dưới ngưỡng thì chỉ đào.
              </p>
            </div>
          </div>
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
 * Phúc Lợi VIP cho người chỉ định bật đủ nhiệm vụ của tài khoản thường — và ngược lại, bật
 * cả Hỷ Sự Đường (thứ chỉ tab Thường có) từ tab VIP. (Bí Cảnh từng đứng cùng Phúc Lợi VIP
 * trong câu này; từ schema 67 nó có twin hạng thường nên đã vào lưới của cả hai tab.)
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
  /**
   * Khối nào đang gấp. Gấp là chuyện của MẮT, không phải của dữ liệu: thân khối chỉ bị ẩn
   * bằng thuộc tính `hidden`, mọi input vẫn nằm nguyên trong DOM và vẫn được nộp lên. Dựng
   * lại thân khối theo điều kiện là cách chắc chắn nhất để xoá sạch cấu hình của người ta
   * trong im lặng — form này uncontrolled, giá trị sống trong DOM chứ không trong state.
   */
  const { collapsed, toggle: toggleCollapsed } = useCollapsedBlocks();
  /** Nhiệm vụ đang khoá mà người dùng vừa bấm vào — `null` là không có popup nào. */
  const [lockedQuest, setLockedQuest] = useState<SimpleQuest | null>(null);
  const [simpleEnabled, setSimpleEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SIMPLE_QUESTS.map((quest) => [
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

      {/* Một input thật cho mỗi config key, cho ĐỦ bộ nhiệm vụ chứ không theo lưới đang hiện:
          checkbox ở hai tab chỉ là hai mặt của cùng một state. */}
      {SIMPLE_QUESTS.map((quest) =>
        simpleEnabled[quest.key] ? (
          <input key={quest.key} type="hidden" name={`q_${quest.key}`} value="on" />
        ) : null,
      )}

      <div hidden={questTab !== "free"}>
        <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
          <legend className="px-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
              Nhiệm vụ tài khoản thường
              <CollapseToggle
                bodyId="simpleFree-body"
                collapsed={collapsed.simpleFree === true}
                onToggle={() => toggleCollapsed("simpleFree")}
                label="Nhiệm vụ tài khoản thường"
              />
            </span>
          </legend>
          <div id="simpleFree-body" hidden={collapsed.simpleFree === true}>
            <SimpleQuestGrid
              quests={FREE_QUESTS}
              enabled={simpleEnabled}
              onToggle={toggleSimpleQuest}
              onToggleMany={toggleQuests}
              onLocked={setLockedQuest}
            />
          </div>
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
          <span className="flex items-center gap-2">
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
            <CollapseToggle
              bodyId="meCung-body"
              collapsed={collapsed.meCung === true}
              onToggle={() => toggleCollapsed("meCung")}
              label="Mê Cung"
            />
          </span>
        </legend>

        <div
          id="meCung-body"
          hidden={collapsed.meCung === true}
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
          collapsed={collapsed.luyenDan === true}
          onToggleCollapse={() => toggleCollapsed("luyenDan")}
          accentClass="accent-[var(--color-gold-400)]"
          config={config.quests.luyenDan}
          enabled={luyenDan}
          onToggle={setLuyenDan}
        />
      </div>
      <div hidden={questTab !== "free"}>
        <LuyenDanFieldset
          prefix="luyenDanThuong"
          collapsed={collapsed.luyenDan === true}
          onToggleCollapse={() => toggleCollapsed("luyenDan")}
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
          collapsed={collapsed.khoangMach === true}
          onToggleCollapse={() => toggleCollapsed("khoangMach")}
          accentClass="accent-[var(--color-gold-400)]"
          config={config.quests.khoangMach}
          enabled={khoangMach}
          onToggle={setKhoangMach}
        />
      </div>
      <div hidden={questTab !== "free"}>
        <KhoangMachFieldset
          prefix="khoangMachThuong"
          collapsed={collapsed.khoangMach === true}
          onToggleCollapse={() => toggleCollapsed("khoangMach")}
          accentClass="accent-[var(--color-jade-400)]"
          config={config.quests.khoangMachThuong}
          enabled={khoangMachThuong}
          onToggle={setKhoangMachThuong}
        />
      </div>

      {/* ------------------------------------------------------ Nhiệm vụ ngày còn lại */}
      <div hidden={questTab !== "vip"}>
      <fieldset className="mb-6 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
        <legend className="px-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-parchment)]">
            Nhiệm vụ ngày
            <CollapseToggle
              bodyId="simpleVip-body"
              collapsed={collapsed.simpleVip === true}
              onToggle={() => toggleCollapsed("simpleVip")}
              label="Nhiệm vụ ngày"
            />
          </span>
        </legend>
        <div id="simpleVip-body" hidden={collapsed.simpleVip === true}>
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
        </div>
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
