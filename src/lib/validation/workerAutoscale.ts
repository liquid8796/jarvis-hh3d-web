import { z } from "zod";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const workerAutoscaleSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["manual", "scheduler", "dynamic"]).default("manual"),
  minWorkers: z.number().int().min(1).max(100).default(2),
  manualWorkers: z.number().int().min(1).max(100).default(2),
  schedule: z.array(z.object({ time: clock, workers: z.number().int().min(1).max(100) })).min(1).max(24).default([{ time: "00:00", workers: 2 }]),
  dynamicMaxWorkers: z.number().int().min(1).max(100).default(8),
  jobsPerWorker: z.number().int().min(1).max(20).default(2),
  downscaleCooldownMinutes: z.number().int().min(0).max(1440).default(30),
  lastAppliedAt: z.string().nullable().default(null),
  lastError: z.string().max(500).default(""),
  managedSlugs: z.array(z.string().min(3).max(141)).max(100).default([]),
  manualDisabledSlugs: z.array(z.string().min(3).max(141)).max(100).default([]),
  drainingWorkerIds: z.array(z.string().min(1).max(64)).max(100).default([]),
  queueRecoveryAt: z.record(z.string(), z.string().datetime()).default({}),
}).superRefine((data, ctx) => {
  if (new Set(data.schedule.map(p => p.time)).size !== data.schedule.length) ctx.addIssue({ code: "custom", path: ["schedule"], message: "Duplicate schedule time" });
  if (data.dynamicMaxWorkers < data.minWorkers) ctx.addIssue({ code: "custom", path: ["dynamicMaxWorkers"], message: "Maximum must be >= minimum" });
});
export type WorkerAutoscaleSettings = z.infer<typeof workerAutoscaleSchema>;
export type AutoscaleSchedulePoint = WorkerAutoscaleSettings["schedule"][number];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** All daily times are interpreted in Asia/Ho_Chi_Minh (UTC+7). */
export function autoscaleScheduleTarget(points: readonly AutoscaleSchedulePoint[], now: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const minute = Number(parts.find(p => p.type === "hour")?.value ?? "0") * 60 + Number(parts.find(p => p.type === "minute")?.value ?? "0");
  const sorted = [...points].sort((a, b) => a.time.localeCompare(b.time));
  return [...sorted].reverse().find(p => Number(p.time.slice(0,2)) * 60 + Number(p.time.slice(3)) <= minute)?.workers ?? sorted.at(-1)?.workers ?? 2;
}
export function autoscaleDesiredWorkers(c: WorkerAutoscaleSettings, queued: number, running: number, now: number): number {
  if (c.mode === "manual") return Math.max(c.minWorkers, c.manualWorkers);
  if (c.mode === "scheduler") return Math.max(c.minWorkers, autoscaleScheduleTarget(c.schedule, now));
  return clamp(Math.ceil((Math.max(0, queued) + Math.max(0, running)) / c.jobsPerWorker), c.minWorkers, Math.max(c.minWorkers, c.dynamicMaxWorkers));
}
export function chooseWorkflowTransitions(active: readonly string[], inactive: readonly string[], requested: number) {
  const count = clamp(Math.floor(requested), 0, active.length + inactive.length);
  const selected = [...active.slice(0, count), ...inactive.slice(0, Math.max(0, count - active.length))];
  return { enable: selected.filter(slug => inactive.includes(slug)), disable: active.slice(count), selected };
}

/**
 * GitHub workflow "active" only means schedule is enabled; no runner may exist.
 * Only awaken a workflow with no requested/queued/running runs. A recently
 * completed failure gets 15 minutes of backoff to prevent dispatch storms.
 * Unknown response state is fail-closed.
 */
export function shouldDispatchIdleWorkflow(
  runs: readonly { status: string; created_at: string }[],
  nowMs: number,
): boolean {
  if (runs.some(run => ["in_progress", "queued", "requested", "waiting", "pending"].includes(run.status))) return false;
  if (runs.some(run => run.status !== "completed")) return false;
  if (runs.length === 0) return true;
  const latest = Math.max(...runs.map(run => Date.parse(run.created_at)));
  return Number.isFinite(latest) && nowMs - latest >= 15 * 60_000;
}


/** Persisted backend stop-list. Operator-scoped worker IDs only. */
export function isDrainingWorkerId(workerIds: readonly string[], workerId: string): boolean {
  return workerId.length > 0 && workerIds.includes(workerId);
}

/** Compute desired drains for ALL excluded stations, including already disabled workflows. */
export function workerDrainIdsForSelection(
  stations: readonly { slug: string; workerId: string }[],
  retainedSlugs: readonly string[],
): string[] {
  const known = new Set<string>();
  for (const station of stations) {
    if (!station.workerId || station.workerId.length > 64) throw Error("Thiếu workerId hợp lệ trong kho GitHub: " + station.slug);
    if (known.has(station.workerId)) throw Error("Trùng workerId giữa các kho GitHub: " + station.workerId);
    known.add(station.workerId);
  }
  const selected = new Set(retainedSlugs);
  return stations.filter(s => !selected.has(s.slug)).map(s => s.workerId);
}


/** GitHub Actions can leave a dispatch queued with zero jobs for hours.
 * Safe recovery candidate only if no runner is online and no execution is underway.
 * This is merely a candidate: caller MUST check run jobs and repository activity
 * before cancelling anything.
 */
export function stuckQueuedRunForRecovery(
  runs: readonly { id: number; status: string; created_at: string }[],
  workerOnline: boolean,
  lastRecoveryAt: string | undefined,
  nowMs: number,
): number | null {
  if (workerOnline || runs.length === 0) return null;
  if (runs.some(run => ["in_progress", "requested", "waiting", "pending"].includes(run.status))) return null;
  if (runs.some(run => !["completed", "queued"].includes(run.status))) return null;
  const latest = runs[0];
  if (!latest || latest.status !== "queued" || !Number.isSafeInteger(latest.id) || latest.id <= 0) return null;
  const at = Date.parse(latest.created_at);
  if (!Number.isFinite(at) || nowMs - at < 30 * 60_000) return null;
  const recovered = lastRecoveryAt ? Date.parse(lastRecoveryAt) : NaN;
  if (Number.isFinite(recovered) && nowMs - recovered < 60 * 60_000) return null;
  return latest.id;
}

/** Persistent operator pause has priority over scale-out. */
export function autoscaleEligibleStations<T extends { owner: string; repo: string }>(
  stations: readonly T[], manuallyDisabled: readonly string[],
): T[] {
  const paused = new Set(manuallyDisabled);
  return stations.filter(s => !paused.has(s.owner + "/" + s.repo));
}
