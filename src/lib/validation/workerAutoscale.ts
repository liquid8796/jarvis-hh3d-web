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
  downscaleCooldownMinutes: z.number().int().min(10).max(1440).default(30),
  lastAppliedAt: z.string().nullable().default(null),
  lastError: z.string().max(500).default(""),
  managedSlugs: z.array(z.string().min(3).max(141)).max(100).default([]),
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
