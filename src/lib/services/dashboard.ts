import { eventsAfter, getLatestJob } from "./jobs";
import { getEditableConfig } from "./configs";
import { getPresence, ONLINE_WINDOW_MS } from "./workers";
import type {
  DashboardEvent,
  DashboardJob,
  DashboardLivePayload,
  DashboardPresence,
} from "@/lib/realtime/dashboardTypes";

export async function getJobFeed(
  userId: string,
  after: number,
): Promise<{ job: DashboardJob | null; events: DashboardEvent[] }> {
  const job = await getLatestJob(userId);
  if (!job) return { job: null, events: [] };

  const events = await eventsAfter(job.id, after);
  return {
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      nextRunAt: job.nextRunAt.toISOString(),
      attempts: job.attempts,
      workerId: job.workerId,
    },
    events: events.map((event) => ({
      id: event.id,
      at: event.at.toISOString(),
      level: event.level as DashboardEvent["level"],
      message: event.message,
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

/** Một ảnh chụp nhất quán về phần "sống" của Linh Đài, dùng cho cả SSE lẫn poll dự phòng. */
export async function getDashboardFeed(
  userId: string,
  after: number,
): Promise<DashboardLivePayload> {
  const [feed, presence, config] = await Promise.all([
    getJobFeed(userId, after),
    getPresenceFeed(userId),
    getEditableConfig(userId),
  ]);
  return { ...feed, presence, accountTier: config.accountTier };
}
