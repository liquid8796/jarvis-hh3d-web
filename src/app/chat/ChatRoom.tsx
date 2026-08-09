"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPicker, type PickerTab } from "./ChatPicker";
import { Avatar } from "@/components/Avatar";
import { frameForTags, normalizeTagLabel, type TagFrame } from "@/lib/validation/tags";
import type { Gif } from "@/lib/services/gif";

/**
 * Phòng Chat — client của sảnh đàm đạo.
 *
 * Realtime bằng POLLING, và đó là lựa chọn có chủ ý: mỗi nhịp ~2.5s client xin lại NGUYÊN
 * TRANG tin mới nhất rồi hoà vào kho theo id. Xin nguyên trang thay vì chỉ "tin sau mốc X"
 * vì tin cũ cũng biến động — sửa, thu hồi, thả cảm xúc — và một cursor chỉ-tiến sẽ mù hết
 * những chuyện đó. Ở quy mô một tông môn, một trang 50 tin mỗi 2.5 giây là cái giá rẻ cho
 * việc không bao giờ phải đồng bộ trạng thái từng phần.
 *
 * Cuộn ngược lấy trang cũ hơn qua cursor `before`; các trang cũ đã tải nằm yên trong kho.
 */

type Attachment = { url: string; name: string; size: number; type: string };
type Message = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
  tags: string[];
  text: string;
  sticker: string | null;
  attachments: Attachment[];
  replyTo: { id: string; author: string; excerpt: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

const POLL_MS = 2500;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/** GIF của GIPHY gửi đi dưới dạng đính kèm — bong bóng đã biết vẽ mọi `image/*` thành ảnh. */
const GIF_MIME = "image/gif";

/**
 * Hai dấu này gác phép "bấm ra ngoài thì đóng": thân khay mang `data-chat-popup`, nút mở khay
 * mang `data-chat-popup-trigger`.
 *
 * Đánh dấu bằng thuộc tính chứ không phải bằng một rừng ref: khay cảm xúc mọc TRONG từng bong
 * bóng tin, nên số popup bằng số tin đang hiển thị — giữ ref cho từng cái là giữ một Map phải
 * dọn tay mỗi lần danh sách tin đổi. Một câu `closest()` thì không quan tâm có bao nhiêu cái.
 *
 * Nút mở cũng phải được tha: không thì bấm nút lúc khay đang mở sẽ bị đóng bởi tay này rồi
 * mở lại ngay bởi `onClick` — khay không bao giờ tắt được bằng chính nút đã mở nó.
 */
const POPUP_ATTR = "data-chat-popup";
const TRIGGER_ATTR = "data-chat-popup-trigger";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

/**
 * Ảnh đại diện của những người có mặt trong trang tin, tra theo userId — server gửi kèm mỗi
 * lượt trả feed. Không đóng băng vào tin nhắn: đổi ảnh là xoá object cũ, nên một URL nằm sẵn
 * trong tin cũ sẽ thành ảnh vỡ. Xem `avatarsByUserId` bên services/users.ts.
 */
type AvatarMap = Record<string, string>;

/**
 * Hoà bản đồ ảnh mới vào bản đang giữ, và điều quan trọng nằm ở phép XOÁ.
 *
 * Server chỉ kể những người CÓ ảnh, nên một người vừa bỏ ảnh sẽ đơn giản là vắng mặt trong
 * bản đồ mới. Hoà theo kiểu `{...cũ, ...mới}` thì URL cũ của họ sống mãi trong tab này — trỏ
 * vào một object đã bị xoá, tức một ô ảnh vỡ. Nên với MỌI người có mặt trong trang tin vừa
 * nhận, ta lấy giá trị mới hoặc bỏ hẳn khoá; người không có mặt trong trang này (tác giả của
 * các trang cũ đã cuộn lên) thì giữ nguyên, vì trang ấy không nói gì về họ.
 */
function mergeAvatars(current: AvatarMap, messages: Message[], incoming: AvatarMap): AvatarMap {
  const next = { ...current };
  for (const message of messages) {
    const url = incoming[message.userId];
    if (url) next[message.userId] = url;
    else delete next[message.userId];
  }
  return next;
}

export function ChatRoom({
  me,
  tagFrames,
}: {
  me: { id: string; name: string };
  /** Sổ khung tag từ app_settings — server đưa lúc render, xem ghi chú bên page.tsx. */
  tagFrames: TagFrame[];
}) {
  const [store, setStore] = useState<Map<string, Message>>(new Map());
  const [avatars, setAvatars] = useState<AvatarMap>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [panel, setPanel] = useState<PickerTab | "none">("none");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedTop, setReachedTop] = useState(false);
  /** Kho MongoDB chưa được tông chủ tạo — sảnh treo biển thay vì giả vờ trống. */
  const [storeClosed, setStoreClosed] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const stuckRef = useRef(true);
  stuckRef.current = stuck;

  const messages = useMemo(
    () =>
      [...store.values()].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    [store],
  );

  const merge = useCallback((incoming: Message[], incomingAvatars: AvatarMap = {}) => {
    // Bản đồ ảnh vẫn phải được hoà kể cả khi trang tin RỖNG? Không — trang rỗng thì không có
    // ai để nói về, và `mergeAvatars` sẽ không đụng tới khoá nào. Ra sớm cho khỏi vẽ lại.
    if (incoming.length === 0) return;
    setStore((prev) => {
      const next = new Map(prev);
      for (const msg of incoming) next.set(msg.id, msg);
      return next;
    });
    setAvatars((prev) => mergeAvatars(prev, incoming, incomingAvatars));
  }, []);

  // ---- Nhịp poll -----------------------------------------------------------------------
  const knownIds = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (!alive) return;
        if (res.status === 503) {
          const data = await res.json().catch(() => ({}));
          setStoreClosed(String(data.error ?? "Tàng thư đàm đạo chưa khai mở."));
          return;
        }
        if (!res.ok) return;
        setStoreClosed(null);
        const data: { messages: Message[]; typing: string[]; avatars?: AvatarMap } = await res.json();

        const fresh = data.messages.filter((m) => !knownIds.current.has(m.id));
        for (const m of data.messages) knownIds.current.add(m.id);

        merge(data.messages, data.avatars ?? {});
        setTyping(data.typing);

        // Người đang đọc lại quá khứ thì đừng giật họ xuống đáy — chỉ đếm tin mới cho cái
        // nút "về cuối" kể.
        if (!stuckRef.current && fresh.length > 0) {
          setUnseen((u) => u + fresh.length);
        }
      } catch {
        /* mạng chớp — nhịp sau gặp lại */
      }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [merge]);

  // ---- Bấm ra ngoài thì đóng khay ------------------------------------------------------
  const popupOpen = panel !== "none" || pickerFor !== null;

  /** Mở khay này thì đóng khay kia — hai cái cùng bung ra một lúc là rối, không phải tính năng. */
  const openPanel = (tab: PickerTab) => {
    setPickerFor(null);
    setPanel((current) => (current === tab ? "none" : tab));
  };

  const openReactionPicker = (id: string) => {
    setPanel("none");
    setPickerFor((current) => (current === id ? null : id));
  };

  useEffect(() => {
    if (!popupOpen) return;

    const closeAll = () => {
      setPanel("none");
      setPickerFor(null);
    };

    // `pointerdown` chứ không phải `click`: chuột nhấn xuống là đã có ý rời khay, và một cú
    // kéo bắt đầu ngoài khay sẽ không bao giờ sinh ra `click` để mà đóng. Nó cũng bao luôn
    // màn cảm ứng, khỏi phải nghe thêm `touchstart`.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${POPUP_ATTR}], [${TRIGGER_ATTR}]`)) return;
      closeAll();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popupOpen]);

  // Dính đáy: mỗi khi có tin mới và người xem đang ở đáy, cuộn theo.
  useEffect(() => {
    if (stuck && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUnseen(0);
    }
  }, [messages, typing, stuck]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setStuck(atBottom);
    if (atBottom) setUnseen(0);
    if (el.scrollTop < 80 && !loadingOlder && !reachedTop && messages.length > 0) {
      void loadOlder();
    }
  };

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const res = await fetch(
        `/api/chat?beforeAt=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data: { messages: Message[]; avatars?: AvatarMap } = await res.json();
      if (data.messages.length === 0) setReachedTop(true);
      // Trang cũ không phải "tin mới" — ghi danh trước khi merge để nút về-cuối không đếm nhầm.
      for (const m of data.messages) knownIds.current.add(m.id);
      merge(data.messages, data.avatars ?? {});
      // Giữ nguyên chỗ đang đọc: bù đúng phần chiều cao vừa mọc thêm phía trên.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  // ---- Thao tác ------------------------------------------------------------------------
  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(String(data.error ?? "Có trắc trở — thử lại."));
      setTimeout(() => setNotice(""), 3500);
    }
    return res.ok;
  };

  const refresh = async () => {
    const res = await fetch("/api/chat", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      merge(data.messages, data.avatars ?? {});
      setTyping(data.typing);
    }
  };

  const send = async () => {
    const clean = text.trim();
    if (!clean && staged.length === 0) return;
    const ok = await post({
      op: "send",
      body: { text: clean, attachments: staged, replyTo: replyTo?.id ?? null },
    });
    if (ok) {
      setText("");
      setStaged([]);
      setReplyTo(null);
      setPanel("none");
      setStuck(true);
      void post({ op: "typing", typing: false });
      await refresh();
      inputRef.current?.focus();
    }
  };

  const sendSticker = async (emoji: string) => {
    setPanel("none");
    if (await post({ op: "send", body: { text: "", sticker: emoji, replyTo: replyTo?.id ?? null } })) {
      setReplyTo(null);
      setStuck(true);
      await refresh();
    }
  };

  /**
   * GIF đi đường ĐÍNH KÈM, không phải đường sticker: bytes ở lại CDN của GIPHY và tin chỉ giữ
   * URL, nên bong bóng vẽ nó bằng đúng nhánh `image/*` đã có sẵn — không thêm một hình dạng
   * tin nào để mọi chỗ khác phải học.
   */
  const sendGif = async (gif: Gif) => {
    setPanel("none");
    const ok = await post({
      op: "send",
      body: {
        text: "",
        attachments: [{ url: gif.url, name: gif.name, size: gif.size, type: GIF_MIME }],
        replyTo: replyTo?.id ?? null,
      },
    });
    if (ok) {
      setReplyTo(null);
      setStuck(true);
      await refresh();
    }
  };

  const onType = (value: string) => {
    setText(value);
    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      void post({ op: "typing", typing: true });
    }
  };

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of [...files].slice(0, 6 - staged.length)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/chat/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setStaged((prev) => [...prev, data as Attachment]);
        } else {
          setNotice(String(data.error ?? "Không gửi được file."));
          setTimeout(() => setNotice(""), 5000);
          break;
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const react = async (id: string, emoji: string) => {
    setPickerFor(null);
    // Lạc quan: đảo tại chỗ cho tay bấm thấy liền; nhịp poll kế sẽ nói sự thật.
    setStore((prev) => {
      const next = new Map(prev);
      const msg = next.get(id);
      if (!msg) return prev;
      const existing = msg.reactions.find((r) => r.emoji === emoji);
      const reactions = existing
        ? msg.reactions
            .map((r) =>
              r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r,
            )
            .filter((r) => r.count > 0)
        : [...msg.reactions, { emoji, count: 1, mine: true }];
      next.set(id, { ...msg, reactions });
      return next;
    });
    await post({ op: "react", id, emoji });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await post({ op: "edit", id: editing.id, text: editing.text })) {
      setEditing(null);
      await refresh();
    }
  };

  const remove = async (id: string) => {
    if (await post({ op: "delete", id })) await refresh();
  };

  // ---- Vẽ ------------------------------------------------------------------------------
  let lastDay = "";
  let lastAuthor = "";
  let lastAt = 0;

  return (
    <div
      className="chat-shell card card-hairline"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      {/* Hoa văn của khung — bốn ngoặc góc và ấn ở đỉnh. Là phần TRANG TRÍ thuần nên nằm
          ngoài dòng chảy nội dung, pointer-events tắt trong CSS; SVG tự vẽ để không tải
          thêm một asset nào. */}
      <i className="chat-corners" aria-hidden />
      <span className="chat-finial" aria-hidden>
        <svg viewBox="0 0 120 34" width="120" height="34">
          <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            {/* hai nhánh mây đối xứng */}
            <path d="M10 22 C 26 12, 40 12, 50 18" />
            <path d="M110 22 C 94 12, 80 12, 70 18" />
            <path d="M18 24 C 30 18, 40 18, 48 22" opacity="0.55" />
            <path d="M102 24 C 90 18, 80 18, 72 22" opacity="0.55" />
          </g>
          {/* ấn giữa: kim châm trên một cánh hoa */}
          <path d="M60 4 L67 15 L60 28 L53 15 Z" fill="currentColor" opacity="0.9" />
          <path d="M60 9 L63.5 15 L60 22 L56.5 15 Z" fill="#0b0e20" />
        </svg>
      </span>

      <header className="chat-head">
        <div>
          <h1 className="h-display text-3xl font-semibold text-gilded">Phòng Chat</h1>
          <p className="text-xs text-[var(--color-mist)]">
            Sảnh đàm đạo chung — mọi môn đồ đã nhập môn đều nghe thấy nhau.
          </p>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="chat-scroll">
        {reachedTop && messages.length > 0 && (
          <p className="chat-top-note">— Khởi nguồn của sảnh —</p>
        )}
        {loadingOlder && <p className="chat-top-note">Đang lật trang cũ…</p>}
        {storeClosed && (
          <div className="chat-closed">
            <span>🏮</span>
            <p>{storeClosed}</p>
          </div>
        )}
        {!storeClosed && messages.length === 0 && (
          <p className="chat-top-note">Sảnh còn tĩnh lặng — hãy là người khai bút.</p>
        )}

        {messages.map((msg) => {
          const day = new Date(msg.createdAt).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;

          const at = new Date(msg.createdAt).getTime();
          const grouped = !showDay && msg.author === lastAuthor && at - lastAt < 5 * 60 * 1000;
          lastAuthor = msg.author;
          lastAt = at;

          const own = msg.userId === me.id;

          return (
            <div key={msg.id}>
              {showDay && <div className="chat-day"><span>{fmtDay(msg.createdAt)}</span></div>}

              <div className={`chat-row ${own ? "own" : ""} ${grouped ? "grouped" : ""}`}>
                {!own && (
                  <Avatar
                    name={msg.author}
                    url={avatars[msg.userId]}
                    // 78 — đo bằng MẮT trên ảnh chụp thật: ở 56px chân dung lọt thỏm cạnh
                    // bài vị và cả hàng trông chật. Vẫn nhỉnh hơn bài vị (64px) một bậc, vì
                    // nó là mặt người còn bài vị chỉ là danh xưng đi kèm.
                    size={78}
                    // Tin nối tiếp cùng người thì vòng tròn ẨN mà vẫn CHIẾM chỗ, để mọi bong
                    // bóng của cùng một người thẳng một hàng lề.
                    className={grouped ? "invisible" : ""}
                  />
                )}

                <div className="chat-bubble-col">
                  {!own && !grouped && (() => {
                    // Mỗi người MỘT bài vị, như trong thiết kế: tag đầu tiên có khung thắng;
                    // các tag còn lại vẫn là huy hiệu chữ; không tag nào có khung thì đeo
                    // khung mặc định (bài vị「Đệ tử」). Sổ trống là sảnh vẽ y như trước.
                    const frame = frameForTags(msg.tags, tagFrames);
                    const plainTags = frame
                      ? msg.tags.filter((t) => normalizeTagLabel(t) !== normalizeTagLabel(frame.label))
                      : msg.tags;
                    return (
                      <span className="chat-author">
                        {msg.author}
                        {msg.isAdmin && !frame && <em className="chat-crown" title="Tông chủ">✦</em>}
                        {frame && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="chat-tagframe" src={frame.url} alt={frame.label} title={frame.label} loading="lazy" decoding="async" />
                        )}
                        {plainTags.map((t) => (
                          <i key={t} className="chat-tag">{t}</i>
                        ))}
                      </span>
                    );
                  })()}

                  <div className={`chat-bubble ${msg.sticker ? "sticker" : ""}`}>
                    {msg.replyTo && (
                      <div className="chat-quote">
                        <b>{msg.replyTo.author}</b>
                        <span>{msg.replyTo.excerpt || "…"}</span>
                      </div>
                    )}

                    {msg.deleted ? (
                      <span className="chat-deleted">tin đã được thu hồi</span>
                    ) : editing?.id === msg.id ? (
                      <span className="chat-editbox">
                        <textarea
                          value={editing.text}
                          onChange={(e) => setEditing({ id: msg.id, text: e.target.value })}
                          rows={2}
                          autoFocus
                        />
                        <span className="chat-editbtns">
                          <button type="button" onClick={saveEdit}>Lưu</button>
                          <button type="button" onClick={() => setEditing(null)}>Thôi</button>
                        </span>
                      </span>
                    ) : (
                      <>
                        {msg.sticker && <span className="chat-sticker">{msg.sticker}</span>}
                        {msg.text && <span className="chat-text">{msg.text}</span>}
                        {msg.attachments.map((a) =>
                          a.type.startsWith("image/") ? (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="chat-img">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} loading="lazy" />
                            </a>
                          ) : (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="chat-file">
                              📎 <span>{a.name}</span> <small>{fmtSize(a.size)}</small>
                            </a>
                          ),
                        )}
                      </>
                    )}

                    <span className="chat-meta">
                      {fmtTime(msg.createdAt)}
                      {msg.editedAt && !msg.deleted && <i> · đã sửa</i>}
                    </span>

                    {!msg.deleted && (
                      <span className="chat-actions">
                        <button type="button" title="Thả cảm xúc" data-chat-popup-trigger onClick={() => openReactionPicker(msg.id)}>😊</button>
                        <button type="button" title="Trả lời" onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}>↩</button>
                        {own && !msg.sticker && (
                          <button type="button" title="Sửa" onClick={() => setEditing({ id: msg.id, text: msg.text })}>✎</button>
                        )}
                        {own && (
                          <button type="button" title="Thu hồi" onClick={() => void remove(msg.id)}>🗑</button>
                        )}
                      </span>
                    )}

                    {pickerFor === msg.id && (
                      <span className="chat-quickpick" data-chat-popup>
                        {QUICK_REACTIONS.map((e) => (
                          <button key={e} type="button" onClick={() => void react(msg.id, e)}>{e}</button>
                        ))}
                      </span>
                    )}
                  </div>

                  {msg.reactions.length > 0 && (
                    <div className="chat-reactions">
                      {msg.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          className={r.mine ? "mine" : ""}
                          onClick={() => void react(msg.id, r.emoji)}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {typing.length > 0 && (
          <p className="chat-typing">
            <span className="chat-dots"><i /><i /><i /></span>
            {typing.slice(0, 3).join(", ")} đang chấp bút…
          </p>
        )}
      </div>

      {!stuck && (
        <button type="button" className="chat-jump" onClick={() => { setStuck(true); }}>
          ↓ Về cuối {unseen > 0 && <b>{unseen} tin mới</b>}
        </button>
      )}

      {notice && <p className="chat-notice">{notice}</p>}

      {replyTo && (
        <div className="chat-replybar">
          <span>↩ Trả lời <b>{replyTo.author}</b>: {replyTo.text.slice(0, 60) || replyTo.sticker || "📎"}</span>
          <button type="button" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="chat-staged">
          {staged.map((a, i) => (
            <span key={a.url}>
              {a.type.startsWith("image/") ? "🖼" : "📎"} {a.name}
              <button type="button" onClick={() => setStaged(staged.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Khay nằm TRONG thanh soạn để neo theo mép trên của nó — thanh cao lên khi ô nhập
          xuống dòng, và khay phải trôi theo. Nó `position: absolute` nên không chen vào hàng
          nút. */}
      <footer className="chat-composer">
        {panel !== "none" && (
          <ChatPicker
            tab={panel}
            onTabChange={setPanel}
            onEmoji={(e) => {
              setText((t) => t + e);
              inputRef.current?.focus();
            }}
            onSticker={(e) => void sendSticker(e)}
            onGif={(g) => void sendGif(g)}
          />
        )}
        <button type="button" className="chat-tool" title="Emoji, sticker & GIF" data-chat-popup-trigger onClick={() => openPanel("emoji")}>💬</button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }}
        />
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // Enter gửi; Alt+Enter xuống dòng. Alt+Enter không tự chèn newline trong
            // textarea nên phải tự tay đặt nó vào đúng vị trí con trỏ.
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.altKey) {
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b, value } = el;
              const next = value.slice(0, a) + "\n" + value.slice(b);
              onType(next);
              requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
            } else {
              void send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); void upload(files); }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Truyền âm cho cả tông môn… (Enter gửi, Alt+Enter xuống dòng)"
          className="chat-input"
        />
        {/* Hai nút tròn bên phải theo bản thiết kế: kẹp file và ấn Truyền Âm (mũi tên).
            Nút gửi là ICON chứ không còn chữ — chữ nằm ở title/aria cho ai cần đọc. */}
        <button type="button" className="chat-tool" title="Gửi file" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "…" : "📎"}
        </button>
        <button
          type="button"
          className="chat-send"
          title="Truyền Âm (Enter)"
          aria-label="Truyền Âm"
          onClick={() => void send()}
          disabled={uploading}
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden>
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </footer>
    </div>
  );
}
