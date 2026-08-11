import { cache } from "react";
import pkg from "../../../package.json";
import { eventsForJobs, getCurrentJobsPerAccount } from "./jobs";
import { listAccounts } from "./accounts";
import { getRenderSettings } from "./settings";
import { getPresence, ONLINE_WINDOW_MS } from "./workers";
import type {
  DashboardEvent,
  DashboardJob,
  DashboardLivePayload,
  DashboardMaintenance,
  DashboardPresence,
} from "@/lib/realtime/dashboardTypes";

/**
 * Feed của Tế đàn auto: job mới nhất của TỪNG tài khoản + nhật ký gộp của cả bộ, mỗi dòng
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
    webVersion: pkg.version.trim() || null,
    mine: presence.mine.map((worker) => ({
      id: worker.id,
      lastSeen: worker.lastSeen.toISOString(),
      online: worker.lastSeen.getTime() > cutoff,
      version: worker.version,
    })),
  };
}

/**
 * Bản chiếu nhánh maintenance cho client — chỉ lộ những trường bảng/dải bế quan cần.
 *
 * Người đọc là MaintenanceGate (layout gốc), `requireUser()` và /api/maintenance. KHÔNG còn nằm
 * trong payload của Auto: xem ghi chú tại `DashboardMaintenance` trong dashboardTypes.ts.
 *
 * `cache()` của React: MỘT lượt đọc cho mỗi request, dù cửa bế quan ở layout và guard của trang
 * đều hỏi. Hai chỗ ấy chạy trong cùng một lượt dựng nên chúng luôn nhận cùng một câu trả lời —
 * điều này còn quan trọng hơn việc tiết kiệm một câu truy vấn: nếu trưởng môn gạt công tắc đúng
 * vào khoảnh khắc giữa hai phép đọc, layout và trang sẽ không bao giờ mâu thuẫn nhau.
 *
 * Ngoài lượt dựng của React (script kiểm chứng chẳng hạn) thì `cache()` chỉ đơn giản là gọi
 * thẳng — không ghi nhớ gì, và cũng không cần.
 */
export const getMaintenanceFeed = cache(async function getMaintenanceFeed(): Promise<DashboardMaintenance> {
  const { maintenance } = await getRenderSettings();
  return {
    active: maintenance.active,
    startedAt: maintenance.startedAt,
    expectedEndAt: maintenance.expectedEndAt,
    note: maintenance.note,
  };
});

/** Một ảnh chụp nhất quán về phần "sống" của Auto, dùng cho cả SSE lẫn poll dự phòng. */
export async function getDashboardFeed(
  userId: string,
  after: number,
): Promise<DashboardLivePayload> {
  const [feed, presence, accounts] = await Promise.all([
    getJobsFeed(userId, after),
    getPresenceFeed(userId),
    listAccounts(userId),
  ]);
  return { ...feed, presence, accounts };
}
