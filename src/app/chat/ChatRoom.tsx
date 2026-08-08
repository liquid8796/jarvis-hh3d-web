"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Nghị Sự Đường — client của sảnh đàm đạo.
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
const EMOJIS =
  "😀 😄 😆 🤣 😊 😍 🤩 😘 😜 🤔 🤨 😐 😴 🥱 😷 🤯 🥳 😎 🤗 😇 😅 😭 😤 😡 🤬 😱 🥺 😳 🙃 🫡 👍 👎 👏 🙏 💪 🤝 👊 ✌️ 🤞 🖐️ 💯 🔥 ✨ ⚡ 💥 ❤️ 💛 💚 💙 💜 🖤 💔 ⭐ 🌙 ☀️ 🌸 🍀 🎉 🎁 ⚔️ 🛡️ 🐉 🧧 🍵".split(" ");
const STICKERS = "🐉 ⚔️ 🛡️ 🧙 🧝 🌪️ ⚡ 🔥 ❄️ 🌊 🏔️ 🌸 🍵 🧧 🀄 🏮 🎐 📜 🗡️ 🏹 💎 🪙 🌕 ☯️".split(" ");

const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** Màu avatar suy từ tên — ổn định giữa các lần tải, không cần lưu đâu cả. */
function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

export function ChatRoom({ me }: { me: { id: string; name: string; isAdmin: boolean } }) {
  const [store, setStore] = useState<Map<string, Message>>(new Map());
  const [typing, setTyping] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [panel, setPanel] = useState<"none" | "emoji" | "sticker">("none");
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

  const merge = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setStore((prev) => {
      const next = new Map(prev);
      for (const msg of incoming) next.set(msg.id, msg);
      return next;
    });
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
        const data: { messages: Message[]; typing: string[] } = await res.json();

        const fresh = data.messages.filter((m) => !knownIds.current.has(m.id));
        for (const m of data.messages) knownIds.current.add(m.id);

        merge(data.messages);
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
      const data: { messages: Message[] } = await res.json();
      if (data.messages.length === 0) setReachedTop(true);
      // Trang cũ không phải "tin mới" — ghi danh trước khi merge để nút về-cuối không đếm nhầm.
      for (const m of data.messages) knownIds.current.add(m.id);
      merge(data.messages);
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
      merge(data.messages);
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
      <header className="chat-head">
        <div>
          <h1 className="h-display text-lg font-semibold text-gilded">Nghị Sự Đường</h1>
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
                  <span
                    className="chat-avatar"
                    style={{ visibility: grouped ? "hidden" : "visible", background: `hsl(${hueOf(msg.author)} 45% 32%)` }}
                  >
                    {initialOf(msg.author)}
                  </span>
                )}

                <div className="chat-bubble-col">
                  {!own && !grouped && (
                    <span className="chat-author">
                      {msg.author}
                      {msg.isAdmin && <em className="chat-crown" title="Tông chủ">✦</em>}
                    </span>
                  )}

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
                        <button type="button" title="Thả cảm xúc" onClick={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}>😊</button>
                        <button type="button" title="Trả lời" onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}>↩</button>
                        {own && !msg.sticker && (
                          <button type="button" title="Sửa" onClick={() => setEditing({ id: msg.id, text: msg.text })}>✎</button>
                        )}
                        {(own || me.isAdmin) && (
                          <button type="button" title="Thu hồi" onClick={() => void remove(msg.id)}>🗑</button>
                        )}
                      </span>
                    )}

                    {pickerFor === msg.id && (
                      <span className="chat-quickpick">
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

      {panel !== "none" && (
        <div className="chat-panel">
          {(panel === "emoji" ? EMOJIS : STICKERS).map((e) => (
            <button
              key={e}
              type="button"
              className={panel === "sticker" ? "big" : ""}
              onClick={() => (panel === "emoji" ? (setText((t) => t + e), inputRef.current?.focus()) : void sendSticker(e))}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <footer className="chat-composer">
        <button type="button" className="chat-tool" title="Emoji" onClick={() => setPanel(panel === "emoji" ? "none" : "emoji")}>😊</button>
        <button type="button" className="chat-tool" title="Sticker" onClick={() => setPanel(panel === "sticker" ? "none" : "sticker")}>🀄</button>
        <button type="button" className="chat-tool" title="Gửi file" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "…" : "📎"}
        </button>
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
        <button type="button" className="btn btn-gold chat-send" onClick={() => void send()} disabled={uploading}>
          Truyền Âm
        </button>
      </footer>
    </div>
  );
}
