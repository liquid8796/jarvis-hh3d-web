"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PresenceStatus } from "@/lib/validation/presence";
import { fabBadge } from "@/lib/validation/chatRead";
import { DirectPanel } from "./DirectPanel";
import { MembersPanel } from "./MembersPanel";
import { DirectIcon, MembersIcon, RoomIcon } from "./Icons";
import { RoomPanel } from "./RoomPanel";
import type { CommunicationSnapshot, DockTab } from "./types";

const SNAPSHOT_POLL_MS = 25_000;
const ROOM_UNREAD_POLL_MS = 6_000;

/** Ba lối giao tiếp ở góc màn hình, không điều hướng người dùng khỏi trang đang làm việc. */
export function CommunicationDock() {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<CommunicationSnapshot | null>(null);
  const [tab, setTab] = useState<DockTab | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const refreshSnapshot = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/communication", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSnapshot(null);
        setTab(null);
        return;
      }
      if (!response.ok) return;
      setSnapshot((await response.json()) as CommunicationSnapshot);
    } catch {
      /* Giữ ảnh chụp gần nhất; nhịp kế tiếp tự thử lại. */
    }
  }, []);

  const refreshRoomUnread = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/chat?unread=1", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSnapshot(null);
        setTab(null);
        return;
      }
      if (!response.ok) return;
      const payload = (await response.json()) as { unread?: number };
      const unread = typeof payload.unread === "number" && Number.isFinite(payload.unread)
        ? Math.max(0, payload.unread)
        : 0;
      setSnapshot((current) => current
        ? { ...current, unread: { ...current.unread, room: unread } }
        : current);
    } catch {
      /* Giữ badge gần nhất; nhịp sau tự thử lại khi đường truyền ổn định. */
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
    void refreshRoomUnread();
    const snapshotTimer = window.setInterval(refreshSnapshot, SNAPSHOT_POLL_MS);
    const roomUnreadTimer = window.setInterval(refreshRoomUnread, ROOM_UNREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot();
        void refreshRoomUnread();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(snapshotTimer);
      window.clearInterval(roomUnreadTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshRoomUnread, refreshSnapshot]);

  useEffect(() => {
    if (!tab) return;
    const onPointer = (event: PointerEvent) => {
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) setTab(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTab(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [tab]);

  const clearDirectUnread = useCallback((selectedPeerId: string) => {
    setSnapshot((current) => {
      if (!current) return current;
      const removed = current.threads.find((thread) => thread.peerId === selectedPeerId)?.unread ?? 0;
      return {
        ...current,
        threads: current.threads.map((thread) =>
          thread.peerId === selectedPeerId ? { ...thread, unread: 0 } : thread,
        ),
        unread: { ...current.unread, direct: Math.max(0, current.unread.direct - removed) },
      };
    });
  }, []);

  const openMessage = useCallback((id: string) => {
    setPeerId(id);
    setTab("direct");
  }, []);

  const changePresence = useCallback(async (status: PresenceStatus) => {
    if (!snapshot || statusSaving || snapshot.me.selectedPresence === status) return;
    const previous = snapshot;
    setStatusSaving(true);
    setSnapshot({
      ...snapshot,
      me: { ...snapshot.me, selectedPresence: status },
      members: snapshot.members.map((member) =>
        member.id === snapshot.me.id
          ? { ...member, selectedPresence: status, presence: status }
          : member,
      ),
    });
    try {
      const response = await fetch("/api/communication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("presence update failed");
      await refreshSnapshot();
    } catch {
      setSnapshot(previous);
    } finally {
      setStatusSaving(false);
    }
  }, [snapshot, statusSaving, refreshSnapshot]);

  if (pathname.startsWith("/chat") || !snapshot) return null;

  const tabs: Array<{ id: DockTab; label: string; icon: React.ReactNode; badge: string | null; unread: number }> = [
    { id: "direct", label: "Trò chuyện", icon: <DirectIcon />, badge: fabBadge(snapshot.unread.direct), unread: snapshot.unread.direct },
    { id: "room", label: "Phòng chat", icon: <RoomIcon />, badge: fabBadge(snapshot.unread.room), unread: snapshot.unread.room },
    { id: "members", label: "Thành viên", icon: <MembersIcon />, badge: null, unread: 0 },
  ];

  return (
    <div className="communication-shell" ref={shellRef}>
      {tab && (
        <section id="communication-panel" className="communication-panel" aria-label="Trung tâm giao tiếp">
          {tab === "room" && (
            <RoomPanel
              meId={snapshot.me.id}
              unread={snapshot.unread.room}
              onChanged={() => void refreshRoomUnread()}
            />
          )}
          {tab === "direct" && (
            <DirectPanel
              snapshot={snapshot}
              peerId={peerId}
              onPeer={setPeerId}
              onRead={clearDirectUnread}
              refreshSnapshot={() => void refreshSnapshot()}
            />
          )}
          {tab === "members" && (
            <MembersPanel
              snapshot={snapshot}
              statusSaving={statusSaving}
              onPresence={(status) => void changePresence(status)}
              onMessage={openMessage}
            />
          )}
        </section>
      )}

      <nav className="communication-dock" aria-label="Giao tiếp">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab((current) => current === item.id ? null : item.id)}
            aria-expanded={tab === item.id}
            aria-controls="communication-panel"
            aria-label={item.unread > 0 ? `${item.label} — ${item.unread} tin chưa đọc` : item.label}
          >
            <span className="communication-tab-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge && <b aria-hidden="true">{item.badge}</b>}
          </button>
        ))}
      </nav>
    </div>
  );
}