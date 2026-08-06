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
  DashboardAccount,
  DashboardEvent,
  DashboardJob,
  DashboardLivePayload,
  DashboardMaintenance,
  DashboardPresence,
} from "@/lib/realtime/dashboardTypes";

type DashboardJobLiveValue = {
  /** Job mới nhất của từng tài khoản, theo thứ tự tạo tài khoản. */
  jobs: DashboardJob[];
  events: DashboardEvent[];
  connected: boolean;
  refresh: () => Promise<void>;
  clearEvents: () => void;
};

type DashboardPresenceLiveValue = {
  presence: DashboardPresence | null;
  refresh: () => Promise<void>;
};

type DashboardAccountLiveValue = {
  accounts: DashboardAccount[];
};

const DashboardJobLiveContext = createContext<DashboardJobLiveValue | null>(null);
const DashboardPresenceLiveContext = createContext<DashboardPresenceLiveValue | null>(null);
const DashboardAccountLiveContext = createContext<DashboardAccountLiveValue | null>(null);
const DashboardMaintenanceLiveContext = createContext<DashboardMaintenance | null>(null);

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

export function useDashboardAccountLive(): DashboardAccountLiveValue {
  const value = useContext(DashboardAccountLiveContext);
  if (!value) throw new Error("useDashboardAccountLive must be used inside DashboardLiveProvider");
  return value;
}

/** Trạng thái bế quan trùng tu — null chỉ khi component đứng ngoài provider. */
export function useDashboardMaintenanceLive(): DashboardMaintenance {
  const value = useContext(DashboardMaintenanceLiveContext);
  if (!value) throw new Error("useDashboardMaintenanceLive must be used inside DashboardLiveProvider");
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
 * Một EventSource duy nhất nuôi trạng thái đàn (mỗi tài khoản một dòng), nhật ký, sổ linh sứ
 * và danh sách tài khoản. Event ID chính là cursor job_events nên reconnect tiếp tục đúng
 * chỗ; poll một-lần chỉ còn là lưới an toàn.
 */
const MAINTENANCE_OFF: DashboardMaintenance = {
  active: false,
  startedAt: null,
  expectedEndAt: null,
  note: "",
};

export function DashboardLiveProvider({
  children,
  initialAccounts = [],
  initialMaintenance = MAINTENANCE_OFF,
}: {
  children: ReactNode;
  initialAccounts?: DashboardAccount[];
  /** SSR đưa sẵn để người MỚI VÀO thấy popup ngay từ frame đầu, không đợi feed. */
  initialMaintenance?: DashboardMaintenance;
}) {
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [presence, setPresence] = useState<DashboardPresence | null>(null);
  const [accounts, setAccounts] = useState<DashboardAccount[]>(initialAccounts);
  const [maintenance, setMaintenance] = useState<DashboardMaintenance>(initialMaintenance);
  const [connected, setConnected] = useState(false);
  const cursor = useRef(0);
  const refreshing = useRef(false);

  const applyPayload = useCallback((payload: DashboardLivePayload) => {
    setJobs(payload.jobs);
    setAccounts(payload.accounts);
    // Vắng mặt ≠ tắt: một frame từ bản deploy cũ (không biết trường này) không được phép
    // hạ popup mà một frame mới vừa dựng lên.
    if (payload.maintenance) {
      setMaintenance((previous) => {
        const next = payload.maintenance!;
        return previous.active === next.active &&
          previous.startedAt === next.startedAt &&
          previous.expectedEndAt === next.expectedEndAt &&
          previous.note === next.note
          ? previous
          : next;
      });
    }
    setPresence((previous) =>
      sameVisiblePresence(previous, payload.presence) ? previous : payload.presence,
    );

    if (payload.events.length > 0) {
      cursor.current = Math.max(cursor.current, payload.events[payload.events.length - 1].id);
    }

    setEvents((previous) => {
      // Chỉ server (topic events-cleared) mới được lệnh xoá màn hình. Không đoán "đợt Khai
      // Đàn mới" từ tập id job nữa: startJob tạo job TUẦN TỰ và mỗi INSERT một frame SSE,
      // nên frame giữa chừng luôn trộn id cũ/mới và phép đoán không bao giờ trúng với đội
      // nhiều tài khoản. Nhật ký cứ chảy liền mạch, có nhãn tài khoản, có nút Dọn.
      const base = payload.resetEvents ? [] : previous;
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
    () => ({ jobs, events, connected, refresh, clearEvents }),
    [jobs, events, connected, refresh, clearEvents],
  );
  const presenceValue = useMemo(() => ({ presence, refresh }), [presence, refresh]);
  const accountValue = useMemo(() => ({ accounts }), [accounts]);

  return (
    <DashboardJobLiveContext.Provider value={jobValue}>
      <DashboardPresenceLiveContext.Provider value={presenceValue}>
        <DashboardAccountLiveContext.Provider value={accountValue}>
          <DashboardMaintenanceLiveContext.Provider value={maintenance}>
            {children}
          </DashboardMaintenanceLiveContext.Provider>
        </DashboardAccountLiveContext.Provider>
      </DashboardPresenceLiveContext.Provider>
    </DashboardJobLiveContext.Provider>
  );
}
