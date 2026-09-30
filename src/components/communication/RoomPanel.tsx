"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { isNearChatBottom } from "@/lib/validation/chatRead";
import { SendIcon } from "./Icons";
import { EmptyState } from "./Common";
import type { RoomMessage } from "./types";

const POLL_MS = 2_500;

function clock(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function RoomPanel({
  meId,
  unread,
  onChanged,
}: {
  meId: string;
  unread: number;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const pinnedToBottomRef = useRef(true);
  const latestLoadedRef = useRef<string | null>(null);
  const lastMarkedRef = useRef<string | null>(null);
  const markInFlightRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const markLatestRead = useCallback(async (latestAt: string | null) => {
    if (
      !latestAt ||
      document.visibilityState !== "visible" ||
      latestAt === lastMarkedRef.current ||
      latestAt === markInFlightRef.current
    ) return;

    markInFlightRef.current = latestAt;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "read", at: latestAt }),
      });
      if (!response.ok) return;
      lastMarkedRef.current = latestAt;
      onChanged();
    } finally {
      if (markInFlightRef.current === latestAt) markInFlightRef.current = null;
    }
  }, [onChanged]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const firstLoad = !initializedRef.current;
    try {
      const response = await fetch("/api/chat", { cache: "no-store" });
      const payload = (await response.json()) as {
        messages?: RoomMessage[];
        avatars?: Record<string, string>;
        typing?: string[];
        error?: string;
      };
      if (!response.ok || !payload.messages) {
        setError(payload.error ?? "Không tải được Sảnh đàm đạo chung.");
        return;
      }

      const latestMessage = payload.messages.at(-1) ?? null;
      const latestIdentity = latestMessage ? `${latestMessage.id}:${latestMessage.createdAt}` : null;
      const receivedNew =
        latestIdentity !== null &&
        latestLoadedRef.current !== null &&
        latestIdentity !== latestLoadedRef.current;
      latestLoadedRef.current = latestIdentity;

      setMessages(payload.messages);
      setAvatars(payload.avatars ?? {});
      setTyping(payload.typing ?? []);
      setError("");
      initializedRef.current = true;

      requestAnimationFrame(() => {
        const scroller = scrollRef.current;
        if (scroller && (firstLoad || pinnedToBottomRef.current)) {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
          pinnedToBottomRef.current = true;
          void markLatestRead(latestMessage?.createdAt ?? null);
        } else if (receivedNew) {
          // Người dùng đang đọc tin cũ: giữ nguyên vị trí và chỉ làm mới huy hiệu chưa đọc.
          onChanged();
        }
      });
    } catch {
      setError("Mất kết nối tới Sảnh đàm đạo chung.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [markLatestRead, onChanged]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const atBottom = isNearChatBottom(
      scroller.scrollHeight,
      scroller.scrollTop,
      scroller.clientHeight,
    );
    pinnedToBottomRef.current = atBottom;
    if (atBottom) void markLatestRead(messages.at(-1)?.createdAt ?? null);
  }, [markLatestRead, messages]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pinnedToBottomRef.current) {
        void markLatestRead(messages.at(-1)?.createdAt ?? null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markLatestRead, messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "send",
          body: { text: body, attachments: [], replyTo: null, sticker: null },
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Không gửi được tin vào sảnh.");
        return;
      }
      setText("");
      pinnedToBottomRef.current = true;
      await load();
      onChanged();
    } catch {
      setError("Mất kết nối khi gửi tin.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="communication-panel-head">
        <span><small>Phòng chat</small><strong>Sảnh đàm đạo chung</strong></span>
        {unread > 0 && <b className="communication-count">{unread}</b>}
      </header>

      <div ref={scrollRef} className="communication-messages" aria-live="polite" onScroll={handleScroll}>
        {loading && messages.length === 0 && <EmptyState title="Đang mở sảnh…" body="Đang gọi những lời đàm đạo mới nhất." />}
        {!loading && messages.length === 0 && !error && <EmptyState title="Sảnh đang yên tĩnh" body="Hãy là người mở lời đầu tiên." />}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`communication-room-message${message.userId === meId ? " is-mine" : ""}`}
          >
            <Avatar name={message.author} url={avatars[message.userId]} size={30} />
            <div>
              <header className="communication-message-meta">
                <strong>{message.author}</strong>
                {message.isAdmin && <em>Quản trị</em>}
                <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
              </header>
              <div className="communication-message-bubble">
                {message.deleted ? <i>Tin đã được thu hồi.</i> : (
                  <>
                    {message.replyTo && <blockquote>{message.replyTo.author} · {message.replyTo.excerpt}</blockquote>}
                    {message.sticker && <span className="communication-sticker">{message.sticker}</span>}
                    {message.text && <p>{message.text}</p>}
                    {message.attachments.map((attachment) =>
                      attachment.type.startsWith("image/") ? (
                        <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={attachment.url} alt={attachment.name} loading="lazy" />
                        </a>
                      ) : (
                        <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
                          📎 {attachment.name}
                        </a>
                      ),
                    )}
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="communication-typing">
        {typing.length > 0 ? `${typing.slice(0, 2).join(", ")} đang nhập…` : ""}
      </p>
      {error && <p className="communication-error" role="status">{error}</p>}

      <form className="communication-composer" onSubmit={send}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Nhắn lên Sảnh đàm đạo chung…"
          maxLength={4000}
          aria-label="Nhắn lên Sảnh đàm đạo chung"
        />
        <button type="submit" disabled={sending || !text.trim()} aria-label="Gửi lên sảnh"><SendIcon /></button>
      </form>
    </>
  );
}
