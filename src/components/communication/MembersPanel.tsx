"use client";

import { useMemo, useState } from "react";
import type { PresenceStatus } from "@/lib/validation/presence";
import { EmptyState, MemberRow, StatusDot } from "./Common";
import { matchesMember, type CommunicationSnapshot } from "./types";

export function MembersPanel({
  snapshot,
  statusSaving,
  onPresence,
  onMessage,
}: {
  snapshot: CommunicationSnapshot;
  statusSaving: boolean;
  onPresence: (status: PresenceStatus) => void;
  onMessage: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => snapshot.members.filter((member) => matchesMember(member, query)),
    [snapshot.members, query],
  );

  return (
    <>
      <header className="communication-panel-head">
        <span><small>Danh bạ tông môn</small><strong>Thành viên</strong></span>
        <b className="communication-count">{snapshot.members.length}</b>
      </header>
      <div className="communication-presence-picker">
        <span>Trạng thái của bạn</span>
        <div role="group" aria-label="Trạng thái hiện diện">
          {(["online", "busy", "offline"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={snapshot.me.selectedPresence === status ? "is-active" : ""}
              onClick={() => onPresence(status)}
              disabled={statusSaving}
            >
              <StatusDot status={status} />
              {status === "online" ? "Online" : status === "busy" ? "Đang bận" : "Offline"}
            </button>
          ))}
        </div>
      </div>
      <div className="communication-search-wrap">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo danh xưng hoặc đạo hiệu…"
          aria-label="Tìm thành viên"
        />
      </div>
      <div className="communication-list">
        {results.length > 0 ? results.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            mine={member.id === snapshot.me.id}
            onMessage={() => member.id !== snapshot.me.id && onMessage(member.id)}
          />
        )) : <EmptyState title="Không tìm thấy" body="Không có thành viên khớp từ khoá này." />}
      </div>
    </>
  );
}