import { eventsForJobs, getCurrentJobsPerAccount } from "./jobs";
import { listAccounts } from "./accounts";
import { getAppSettings } from "./settings";
import { getPresence, ONLINE_WINDOW_MS } from "./workers";
import type {
  DashboardEvent,
  DashboardJob,
  DashboardLivePayload,
  DashboardMaintenance,
  DashboardPresence,
} from "@/lib/realtime/dashboardTypes";

/**
 * Feed của Lư Khai Đàn: job mới nhất của TỪNG tài khoản + nhật ký gộp của cả bộ, mỗi dòng
 * mang nhãn tài khoản để người đọc còn biết ai đang kể. Con trỏ `after` là id bigserial
 * toàn cục của job_events nên một con trỏ phục vụ mọi job.
 */
export async function getJobsFeed(
  userId: string,
  after: number,
): Promise<{ jobs: DashboardJob[]; events: DashboardEvent[] }> {
  const current = await getCurrentJobsPerAccount(userId);
  if (current.length === 0) return { jobs: [], events: [] };

  const labelByJob = new Map(current.map((job) => [job.id, job.accountLabel]));
  const events = await eventsForJobs(current.map((job) => job.id), after);

  return {
    jobs: current.map((job) => ({
      id: job.id,
      accountId: job.accountId,
      accountLabel: job.accountLabel,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      nextRunAt: job.nextRunAt.toISOString(),
      attempts: job.attempts,
      workerId: job.workerId,
    })),
    events: events.map((event) => ({
      id: event.id,
      at: event.at.toISOString(),
      level: event.level as DashboardEvent["level"],
      message: event.message,
      accountLabel: labelByJob.get(event.jobId) ?? null,
    })),
  };
}

export async function getPresenceFeed(userId: string): Promise<DashboardPresence> {
  const presence = await getPresence(userId);
  const cutoff = Date.now() - ONLINE_WINDOW_MS;

  return {
    sectOnline: presence.sectOnline,
    sectLastSeen: presence.sectLastSeen?.toISOString() ?? null,
    mine: presence.mine.map((worker) => ({
      id: worker.id,
      lastSeen: worker.lastSeen.toISOString(),
      online: worker.lastSeen.getTime() > cutoff,
    })),
  };
}

/** Bản chiếu nhánh maintenance cho client — chỉ lộ những trường popup cần. */
export async function getMaintenanceFeed(): Promise<DashboardMaintenance> {
  const { maintenance } = await getAppSettings();
  return {
    active: maintenance.active,
    startedAt: maintenance.startedAt,
    expectedEndAt: maintenance.expectedEndAt,
    note: maintenance.note,
  };
}

/** Một ảnh chụp nhất quán về phần "sống" của Linh Đài, dùng cho cả SSE lẫn poll dự phòng. */
export async function getDashboardFeed(
  userId: string,
  after: number,
): Promise<DashboardLivePayload> {
  const [feed, presence, accounts, maintenance] = await Promise.all([
    getJobsFeed(userId, after),
    getPresenceFeed(userId),
    listAccounts(userId),
    getMaintenanceFeed(),
  ]);
  return { ...feed, presence, accounts, maintenance };
}
