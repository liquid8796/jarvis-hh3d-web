"use client";

import { useEffect, useRef, useState } from "react";
import type { Gif } from "@/lib/services/gif";

/**
 * Khay chọn STICKER / EMOJI / GIF của sảnh đàm đạo.
 *
 * Ba tab trong MỘT khay thay vì ba nút mở ba bảng rời: người dùng mở khay ra là thấy hết
 * những gì gửi được, và đổi ý giữa chừng không phải đóng cái này để mở cái kia.
 *
 * Tách khỏi `ChatRoom.tsx` vì hai thứ có nhịp sống khác hẳn nhau: ChatRoom lo poll, cuộn,
 * hoà tin; khay này lo tab, cuộn theo mục, và một ô tìm GIF có nhịp gõ riêng. Nhồi chung thì
 * mỗi lần khay đổi trạng thái là cả sảnh vẽ lại.
 *
 * `import type { Gif }` là type-only nên bị xoá lúc biên dịch — service GIF (có khoá API,
 * có `process.env`) KHÔNG bao giờ lọt vào gói client.
 */

export type PickerTab = "sticker" | "emoji" | "gif";

const TABS: Array<{ id: PickerTab; label: string }> = [
  { id: "sticker", label: "STICKER" },
  { id: "emoji", label: "EMOJI" },
  { id: "gif", label: "GIF" },
];

type EmojiCategory = { id: string; label: string; icon: string; emojis: string[] };

/**
 * Cùng bộ emoji như trước, chỉ chia mục — không thêm không bớt, để người quen tay không phải
 * đi tìm lại cái mặt cười mình vẫn dùng.
 */
const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "faces",
    label: "Cảm xúc",
    icon: "😀",
    emojis: "😀 😄 😆 🤣 😊 😍 🤩 😘 😜 🤔 🤨 😐 😴 🥱 😷 🤯 🥳 😎 🤗 😇 😅 😭 😤 😡 🤬 😱 🥺 😳 🙃 🫡".split(" "),
  },
  { id: "hands", label: "Cử chỉ", icon: "👍", emojis: "👍 👎 👏 🙏 💪 🤝 👊 ✌️ 🤞 🖐️".split(" ") },
  { id: "hearts", label: "Trái tim", icon: "❤️", emojis: "❤️ 💛 💚 💙 💜 🖤 💔 💯".split(" ") },
  { id: "nature", label: "Trời đất", icon: "✨", emojis: "✨ ⚡ 💥 🔥 ⭐ 🌙 ☀️ 🌸 🍀".split(" ") },
  { id: "sect", label: "Tông môn", icon: "⚔️", emojis: "⚔️ 🛡️ 🐉 🧧 🍵 🎉 🎁".split(" ") },
];

const STICKERS = "🐉 ⚔️ 🛡️ 🧙 🧝 🌪️ ⚡ 🔥 ❄️ 🌊 🏔️ 🌸 🍵 🧧 🀄 🏮 🎐 📜 🗡️ 🏹 💎 🪙 🌕 ☯️".split(" ");

const RECENT_STORAGE_KEY = "jarvis.chat.recent-emoji";
const RECENT_MAX = 24;
const RECENT_ID = "recent";
const RECENT_ICON = "🕘";

/** Chờ tay ngừng gõ rồi mới hỏi GIPHY — gõ "mèo" mà bắn 4 request là tự tiêu hạn mức của mình. */
const GIF_DEBOUNCE_MS = 300;

type GifState = "loading" | "ready" | "closed" | "error";

export type ChatPickerProps = {
  tab: PickerTab;
  onTabChange: (tab: PickerTab) => void;
  onEmoji: (emoji: string) => void;
  onSticker: (emoji: string) => void;
  onGif: (gif: Gif) => void;
};

export function ChatPicker({ tab, onTabChange, onEmoji, onSticker, onGif }: ChatPickerProps) {
  const [recent, setRecent] = useState<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  // localStorage chỉ có ở trình duyệt. Đọc lúc render đầu thì bản dựng ở server và bản ở máy
  // khách khác nhau — React sẽ kêu lệch hydrate. Nên đọc trong effect, sau khi đã gắn.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setRecent(parsed.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX));
      }
    } catch {
      // localStorage bị chặn (chế độ riêng tư) hoặc dữ liệu cũ hỏng — coi như chưa dùng lần nào.
    }
  }, []);

  const remember = (emoji: string) => {
    setRecent((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
      try {
        window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Không ghi được thì thôi — danh sách vẫn đúng trong phiên này, chỉ không sống qua lần sau.
      }
      return next;
    });
  };

  const pickEmoji = (emoji: string) => {
    remember(emoji);
    onEmoji(emoji);
  };

  /**
   * Nhảy tới mục. Đo bằng `getBoundingClientRect` chứ không dùng `offsetTop`: offsetTop tính
   * theo tổ tiên ĐƯỢC ĐỊNH VỊ gần nhất, nên chỉ cần một `position` đổi ở đâu đó là nhảy sai
   * chỗ mà chẳng ai hiểu vì sao. `scrollIntoView` thì lại kéo cả trang phía sau.
   */
  const jumpTo = (id: string) => {
    const body = bodyRef.current;
    const section = sectionRefs.current.get(id);
    if (!body || !section) return;
    body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top;
  };

  const keepSection = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  };

  // ---- GIF ------------------------------------------------------------------------------
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifState, setGifState] = useState<GifState>("loading");
  const [gifNotice, setGifNotice] = useState("");

  useEffect(() => {
    if (tab !== "gif") return;

    let alive = true;
    const controller = new AbortController();
    setGifState("loading");

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/gif?q=${encodeURIComponent(gifQuery)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!alive) return;
        const data = await res.json().catch(() => ({}));

        if (res.status === 503) {
          setGifNotice(String(data.error ?? "Kho GIF chưa khai mở."));
          setGifState("closed");
          return;
        }
        if (!res.ok) {
          setGifNotice(String(data.error ?? `Hỏng ở bước hỏi GIF (HTTP ${res.status}).`));
          setGifState("error");
          return;
        }

        setGifs(Array.isArray(data.gifs) ? (data.gifs as Gif[]) : []);
        setGifState("ready");
      } catch (err) {
        // Huỷ vì gõ tiếp hay đổi tab thì KHÔNG phải lỗi — đừng vẽ chữ đỏ lên một request mình
        // tự tay bỏ.
        if (!alive || controller.signal.aborted) return;
        setGifNotice(err instanceof Error ? err.message : "Mạng chớp — thử lại.");
        setGifState("error");
      }
    }, GIF_DEBOUNCE_MS);

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, gifQuery]);

  // ---- Vẽ -------------------------------------------------------------------------------
  const emojiSections = [
    ...(recent.length > 0 ? [{ id: RECENT_ID, label: "Gần đây", icon: RECENT_ICON, emojis: recent }] : []),
    ...EMOJI_CATEGORIES,
  ];

  return (
    <div className="chat-picker" data-chat-popup>
      <div className="chat-picker-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "gif" && (
        <div className="chat-picker-search">
          <input
            type="search"
            value={gifQuery}
            onChange={(e) => setGifQuery(e.target.value)}
            placeholder="Tìm GIF…"
            aria-label="Tìm GIF"
          />
        </div>
      )}

      <div className="chat-picker-body" ref={bodyRef}>
        {tab === "emoji" &&
          emojiSections.map((section) => (
            <section key={section.id} ref={keepSection(section.id)}>
              <h4>{section.label}</h4>
              <div className="chat-picker-grid">
                {section.emojis.map((e) => (
                  <button key={`${section.id}-${e}`} type="button" onClick={() => pickEmoji(e)} title={e}>
                    {e}
                  </button>
                ))}
              </div>
            </section>
          ))}

        {tab === "sticker" && (
          <section>
            <h4>Tông môn</h4>
            <div className="chat-picker-grid big">
              {STICKERS.map((e) => (
                <button key={e} type="button" onClick={() => onSticker(e)} title={e}>
                  {e}
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === "gif" && (
          <>
            {gifState === "loading" && <p className="chat-picker-note">Đang tìm…</p>}
            {gifState === "closed" && <p className="chat-picker-note">🏮 {gifNotice}</p>}
            {gifState === "error" && <p className="chat-picker-note error">{gifNotice}</p>}
            {gifState === "ready" && gifs.length === 0 && (
              <p className="chat-picker-note">Không có GIF nào khớp.</p>
            )}
            {gifState === "ready" && gifs.length > 0 && (
              <div className="chat-picker-gifs">
                {gifs.map((g) => (
                  <button key={g.id} type="button" onClick={() => onGif(g)} title={g.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.previewUrl} alt={g.name} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {tab === "emoji" && (
        <div className="chat-picker-cats">
          {emojiSections.map((section) => (
            <button key={section.id} type="button" title={section.label} onClick={() => jumpTo(section.id)}>
              {section.icon}
            </button>
          ))}
        </div>
      )}

      {/* Điều khoản của GIPHY BẮT BUỘC hiện dòng này ở nơi API được dùng — không phải trang
          trí, và không được bỏ. Giấu đi là dùng API sai giấy phép.
          Riêng lúc kho chưa khai mở thì không hiện: khi ấy chưa gọi GIPHY lần nào. */}
      {tab === "gif" && gifState !== "closed" && (
        <div className="chat-picker-credit">Powered By GIPHY</div>
      )}
    </div>
  );
}
