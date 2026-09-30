"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PRESENCE_LABEL } from "@/lib/validation/presence";
import { DirectThread } from "./DirectThread";
import { EmptyState, StatusDot } from "./Common";
import { matchesMember, type CommunicationSnapshot, type DirectThread as Thread } from "./types";

function shortTime(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}p`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}g`;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date);
}

export function DirectPanel({
  snapshot,
  peerId,
  onPeer,
  onRead,
  refreshSnapshot,
}: {
  snapshot: CommunicationSnapshot;
  peerId: string | null;
  onPeer: (id: string | null) => void;
  onRead: (id: string) => void;
  refreshSnapshot: () => void;
}) {
  const [query, setQuery] = useState("");
  const membersById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.id, member])),
    [snapshot.members],
  );
  const peer = peerId ? membersById.get(peerId) ?? null : null;

  const recent = useMemo(
    () => snapshot.threads
      .map((thread) => ({ thread, member: membersById.get(thread.peerId) }))
      .filter((item): item is { thread: Thread; member: NonNullable<typeof item.member> } => Boolean(item.member)),
    [snapshot.threads, membersById],
  );

  const candidates = useMemo(
    () => snapshot.members.filter(
      (member) => member.id !== snapshot.me.id && matchesMember(member, query),
    ),
    [snapshot.members, snapshot.me.id, query],
  );

  if (peer) {
    return (
      <DirectThread
        meId={snapshot.me.id}
        peer={peer}
        onBack={() => onPeer(null)}
        onRead={() => onRead(peer.id)}
        onChanged={refreshSnapshot}
      />
    );
  }

  const row = (member: (typeof snapshot.members)[number], thread?: Thread) => {
    const mine = thread?.latest.senderId === snapshot.me.id;
    const preview = thread ? `${mine ? "Bạn: " : ""}${thread.latest.text}` : PRESENCE_LABEL[member.presence];
    return (
      <button
        key={member.id}
        type="button"
        className="communication-thread-row"
        onClick={() => onPeer(member.id)}
      >
        <Avatar name={member.displayName} url={member.avatarUrl} size={40} />
        <span>
          <strong>{member.displayName}{member.isAdmin ? " · Quản trị" : ""}</strong>
          <small>{preview}</small>
        </span>
        {thread && <time dateTime={thread.latest.createdAt}>{shortTime(thread.latest.createdAt)}</time>}
        {thread && thread.unread > 0 && <b>{thread.unread > 99 ? "99+" : thread.unread}</b>}
        {!thread && <StatusDot status={member.presence} />}
      </button>
    );
  };

  return (
    <>
      <header className="communication-panel-head">
        <span><small>Tin nhắn riêng</small><strong>Trò chuyện</strong></span>
        {snapshot.unread.direct > 0 && <b className="communication-count">{snapshot.unread.direct}</b>}
      </header>

      <div className="communication-search-wrap">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm đạo hữu để trò chuyện…"
          aria-label="Tìm người trò chuyện"
        />
      </div>

      <div className="communication-list">
        {snapshot.storeClosed ? (
          <EmptyState title="Tàng thư chưa khai mở" body="Tin nhắn riêng sẽ sẵn sàng sau khi kho MongoDB được cấu hình." />
        ) : query.trim() ? (
          candidates.length ? candidates.map((member) =>
            row(member, snapshot.threads.find((thread) => thread.peerId === member.id)),
          ) : <EmptyState title="Không tìm thấy" body="Không có đạo hữu khớp từ khoá này." />
        ) : (
          <>
            <p className="communication-list-label">Gần đây</p>
            {recent.length ? recent.map(({ member, thread }) => row(member, thread)) : (
              <EmptyState title="Chưa có cuộc trò chuyện" body="Chọn một đạo hữu ở danh sách bên dưới để mở lời." />
            )}
            <p className="communication-list-label">Bắt đầu trò chuyện</p>
            {candidates.slice(0, 8).map((member) => row(member))}
          </>
        )}
      </div>
    </>
  );
}
