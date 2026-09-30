"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
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
  const endRef = useRef<HTMLDivElement>(null);
  const lastMarkedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
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
      setMessages(payload.messages);
      setAvatars(payload.avatars ?? {});
      setTyping(payload.typing ?? []);
      setError("");

      const latest = payload.messages.at(-1)?.createdAt ?? null;
      if (latest && latest !== lastMarkedRef.current) {
        lastMarkedRef.current = latest;
        await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "read", at: latest }),
        });
        onChanged();
      }
    } catch {
      setError("Mất kết nối tới Sảnh đàm đạo chung.");
    } finally {
      setLoading(false);
    }
  }, [onChanged]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

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

      <div className="communication-messages" aria-live="polite">
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
        <div ref={endRef} />
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
