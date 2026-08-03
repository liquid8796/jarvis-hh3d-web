"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DashboardEvent,
  DashboardJob,
  DashboardLivePayload,
  DashboardPresence,
} from "@/lib/realtime/dashboardTypes";

type DashboardJobLiveValue = {
  job: DashboardJob | null;
  events: DashboardEvent[];
  connected: boolean;
  refresh: () => Promise<void>;
  clearEvents: () => void;
};

type DashboardPresenceLiveValue = {
  presence: DashboardPresence | null;
  refresh: () => Promise<void>;
};

const DashboardJobLiveContext = createContext<DashboardJobLiveValue | null>(null);
const DashboardPresenceLiveContext = createContext<DashboardPresenceLiveValue | null>(null);

export function useDashboardJobLive(): DashboardJobLiveValue {
  const value = useContext(DashboardJobLiveContext);
  if (!value) throw new Error("useDashboardJobLive must be used inside DashboardLiveProvider");
  return value;
}

export function useDashboardPresenceLive(): DashboardPresenceLiveValue {
  const value = useContext(DashboardPresenceLiveContext);
  if (!value) throw new Error("useDashboardPresenceLive must be used inside DashboardLiveProvider");
  return value;
}

function sameVisiblePresence(left: DashboardPresence | null, right: DashboardPresence): boolean {
  if (!left || left.sectOnline !== right.sectOnline || left.mine.length !== right.mine.length) {
    return false;
  }
  return left.mine.every((worker, index) => {
    const next = right.mine[index];
    return (
      worker.id === next?.id &&
      worker.online === next.online &&
      (worker.online || worker.lastSeen === next.lastSeen)
    );
  });
}

/**
 * Một EventSource duy nhất nuôi cả trạng thái đàn, nhật ký và sổ linh sứ. Event ID chính là
 * cursor job_events nên reconnect tiếp tục đúng chỗ; poll một-lần chỉ còn là lưới an toàn.
 */
export function DashboardLiveProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<DashboardJob | null>(null);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [presence, setPresence] = useState<DashboardPresence | null>(null);
  const [connected, setConnected] = useState(false);
  const cursor = useRef(0);
  const jobId = useRef<string | null>(null);
  const refreshing = useRef(false);

  const applyPayload = useCallback((payload: DashboardLivePayload) => {
    const nextJobId = payload.job?.id ?? null;
    const changedJob = nextJobId !== jobId.current;
    jobId.current = nextJobId;
    setJob(payload.job);
    setPresence((previous) =>
      sameVisiblePresence(previous, payload.presence) ? previous : payload.presence,
    );

    if (payload.events.length > 0) {
      cursor.current = Math.max(cursor.current, payload.events[payload.events.length - 1].id);
    }

    setEvents((previous) => {
      const base = changedJob || payload.resetEvents ? [] : previous;
      const byId = new Map(base.map((event) => [event.id, event]));
      for (const event of payload.events) byId.set(event.id, event);
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-400);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch(`/api/dashboard/feed?after=${cursor.current}`, {
        cache: "no-store",
      });
      if (response.ok) applyPayload((await response.json()) as DashboardLivePayload);
    } catch {
      // Mạng chớp tắt: giữ ảnh cũ, EventSource hoặc nhịp dự phòng kế tiếp sẽ bù vào.
    } finally {
      refreshing.current = false;
    }
  }, [applyPayload]);

  useEffect(() => {
    void refresh();

    const source = new EventSource(`/api/dashboard/stream?after=${cursor.current}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("dashboard", (raw) => {
      try {
        applyPayload(JSON.parse((raw as MessageEvent<string>).data) as DashboardLivePayload);
      } catch {
        // Một frame hỏng không được phép giết stream; frame kế tiếp vẫn là một snapshot đầy đủ.
      }
    });

    return () => {
      source.close();
    };
  }, [applyPayload, refresh]);

  useEffect(() => {
    // Khi SSE sống, 30 giây mới soát một lần. Khi nó rớt, poll 2 giây giữ UI nhanh cho tới
    // lúc EventSource tự reconnect (trình duyệt đã lo backoff và Last-Event-ID).
    const timer = setInterval(() => void refresh(), connected ? 30_000 : 2_000);
    return () => clearInterval(timer);
  }, [connected, refresh]);

  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    };
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [refresh]);

  const clearEvents = useCallback(() => setEvents([]), []);
  const jobValue = useMemo(
    () => ({ job, events, connected, refresh, clearEvents }),
    [job, events, connected, refresh, clearEvents],
  );
  const presenceValue = useMemo(() => ({ presence, refresh }), [presence, refresh]);

  return (
    <DashboardJobLiveContext.Provider value={jobValue}>
      <DashboardPresenceLiveContext.Provider value={presenceValue}>
        {children}
      </DashboardPresenceLiveContext.Provider>
    </DashboardJobLiveContext.Provider>
  );
}
