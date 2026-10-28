import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";

/** Same attempt count shown on the queue board as "vòng N". */
export const MAX_STOP_ROUNDS = 1_000_000;
export function parseBulkStopRounds(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,6}$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_STOP_ROUNDS ? count : null;
}
export function bulkStopMatches(status: string, attempts: number, rounds: number): boolean {
  return (status === "queued" || status === "running") && attempts >= rounds;
}
export type BulkStopResult = { stoppedImmediately: number; stoppingSafely: number; total: number };

/** Atomic, all-users stop with per-job audit. No hard-kill of current cycle.
 * Clearing restart_after_stop prevents a midnight-reset flag from reviving it.
 */
export async function stopJobsByRoundThreshold(rounds: number, actorName: string): Promise<BulkStopResult> {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > MAX_STOP_ROUNDS) {
    throw new Error("Số vòng không hợp lệ.");
  }
  const notice = "Bậc trị sự「" + actorName.slice(0, 100) + "」đã yêu cầu dừng mọi đàn từ " + rounds + " vòng.";
  const changed = await db().execute(sql`
    with changed as (
      update automation_jobs set
        status = case when status = 'queued' then 'stopped'::job_status else 'stopping'::job_status end,
        finished_at = case when status = 'queued' then now() else finished_at end,
        next_run_at = case when status = 'queued' then now() else next_run_at end,
        restart_after_stop = false
      where status in ('queued', 'running') and attempts >= ${rounds}
      returning id, user_id, status
    ), logged as (
      insert into job_events (job_id, level, message)
      select id, 'warning', ${notice} from changed
      returning job_id
    )
    select changed.user_id, changed.status
    from changed join logged on logged.job_id = changed.id
  `);
  const rows = (changed.rows ?? []) as Array<{ user_id: string; status: string }>;
  for (const userId of new Set(rows.map(row => row.user_id))) {
    try { await notifyDashboard({ userId, topic: "job" }); }
    catch (error) { console.error("stopJobsByRoundThreshold: notify failed", error); }
  }
  const stoppedImmediately = rows.filter(row => row.status === "stopped").length;
  const stoppingSafely = rows.filter(row => row.status === "stopping").length;
  return { stoppedImmediately, stoppingSafely, total: rows.length };
}
