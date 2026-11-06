"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PRESENCE_LABEL } from "@/lib/validation/presence";
import { BackIcon } from "./Icons";
import { StatusDot } from "./Common";
import { AttachmentComposer } from "./AttachmentComposer";
import { MessageAttachments } from "./MessageAttachments";
import type { RoomAttachment } from "./types";
import type { DirectMessage, Member } from "./types";

const POLL_MS = 2_500;

function clock(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function DirectThread({
  meId,
  peer,
  onBack,
  onRead,
  onChanged,
}: {
  meId: string;
  peer: Member;
  onBack: () => void;
  onRead: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/direct-messages?peer=${encodeURIComponent(peer.id)}`, { cache: "no-store" });
      const payload = (await response.json()) as { messages?: DirectMessage[]; markedRead?: number; error?: string };
      if (!response.ok || !payload.messages) {
        setError(payload.error ?? "Không tải được cuộc trò chuyện.");
        return;
      }
      setMessages(payload.messages);
      setError("");
      if ((payload.markedRead ?? 0) > 0) {
        onRead();
        onChanged();
      }
    } catch {
      setError("Mất kết nối tới cuộc trò chuyện.");
    } finally {
      setLoading(false);
    }
  }, [peer.id, onRead, onChanged]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(text: string, attachments: RoomAttachment[]) {
    const response = await fetch("/api/direct-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "send", peer: peer.id, text, attachments }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Không gửi được tin nhắn.");
    await load();
    onChanged();
  }

  return (
    <AttachmentComposer key={peer.id} peerId={peer.id} placeholder={`Nhắn cho ${peer.displayName}…`} sendLabel="Gửi tin nhắn" onSend={send}>
      <header className="communication-panel-head">
        <button type="button" className="communication-back" onClick={onBack}>
          <BackIcon /> Quay lại
        </button>
        <span><small>Tin nhắn riêng</small><strong>{peer.displayName}</strong></span>
      </header>

      <div className="communication-peer-strip">
        <Avatar name={peer.displayName} url={peer.avatarUrl} size={36} />
        <span>
          <strong>{peer.displayName}{peer.isAdmin ? " · Quản trị" : ""}</strong>
          <small><StatusDot status={peer.presence} />{PRESENCE_LABEL[peer.presence]} · @{peer.username}</small>
        </span>
      </div>

      <div className="communication-direct-messages" aria-live="polite">
        {loading && messages.length === 0 && <EmptyLine text="Đang mở cuộc trò chuyện…" />}
        {!loading && messages.length === 0 && <EmptyLine text={`Gửi lời chào tới ${peer.displayName}.`} />}
        {messages.map((message) => {
          const mine = message.senderId === meId;
          return (
            <div key={message.id} className={`communication-direct-message${mine ? " is-mine" : ""}`}>
              {message.text && <p>{message.text}</p>}
              <MessageAttachments attachments={message.attachments} />
              <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="communication-error" role="status">{error}</p>}
    </AttachmentComposer>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="communication-empty"><span aria-hidden="true">✦</span><strong>{text}</strong></div>;
}
