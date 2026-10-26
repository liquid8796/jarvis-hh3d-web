import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { acquireGithubAutoscaleLease, mutateGithubState } from "@/lib/services/companionState";
import { getAppSettings, type AppSettings } from "@/lib/services/settings";
import { autoscaleDesiredWorkers, chooseWorkflowTransitions } from "@/lib/validation/workerAutoscale";
import { stationSlug } from "@/lib/validation/githubStations";

type Station = AppSettings["githubStations"][number];
type Workflow = { station: Station; slug: string; state: string; pat: string };
export type AutoscaleResult = {
  ok: boolean; message: string; mode: string; desired: number; active: number;
  enabled: string[]; disabled: string[]; queued: number; running: number; checkedAt: string;
};
const root = "https://api.github.com";
function pathOf(station: Station) {
  return `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}`;
}
async function github(pat: string, path: string, method: "GET" | "PUT", deadline: number) {
  const left = deadline - Date.now();
  if (left <= 0) throw Error("Hết thời gian điều khiển GitHub; thử lại ở lượt sau.");
  const response = await fetch(root + path, {
    method,
    headers: { authorization: `Bearer ${pat}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "auto-hh3d-worker-autoscale" },
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1, Math.min(9000, left))),
  });
  const body = method === "GET" && response.ok ? await response.json() as { state?: string } : null;
  if (response.status !== (method === "GET" ? 200 : 204)) throw Error(`GitHub trả HTTP ${response.status} khi ${method} ${path}`);
  return body;
}
export async function readAutoscaleDemand() {
  const result = await db().execute(sql`
    select count(*) filter (where status = 'queued' and next_run_at <= now())::int as queued,
      count(*) filter (where status in ('running','stopping') and last_heartbeat > now() - interval '3 minutes')::int as running
    from automation_jobs
  `);
  return { queued: Number(result.rows[0]?.queued ?? 0), running: Number(result.rows[0]?.running ?? 0) };
}

/** Serialized, GitHub-observed reconciliation; never starts a worker on the OCI host. */
export async function runWorkerAutoscale(): Promise<AutoscaleResult> {
  const checkedAt = new Date().toISOString();
  const deadline = Date.now() + 105_000;
  const lease = await acquireGithubAutoscaleLease(deadline);
  if (!lease) return { ok: false, message: "Một lượt autoscale khác đang chạy.", mode: "-", desired: 0, active: 0, enabled: [], disabled: [], queued: 0, running: 0, checkedAt };
  let mode = "manual", desired = 0, active = 0, queued = 0, running = 0;
  const enabled: string[] = [], disabled: string[] = [];
  try {
    const settings = await getAppSettings();
    const config = settings.workerAutoscale;
    mode = config.mode;
    if (!config.enabled) return { ok: true, message: "Auto scaling đang tắt; không thay đổi GitHub.", mode, desired: 0, active: 0, enabled, disabled, queued, running, checkedAt };
    const demand = await readAutoscaleDemand();
    queued = demand.queued; running = demand.running;
    desired = autoscaleDesiredWorkers(config, queued, running, Date.now());
    const stations = settings.githubStations.filter(s => s.enabled && s.purpose === "worker" && !s.primaryDeferred);
    if (stations.length < config.minWorkers) throw Error(`Chỉ có ${stations.length} kho Khôi Lỗi hợp lệ, thấp hơn mức tối thiểu ${config.minWorkers}. Không thay đổi workflow.`);
    const workflows: Workflow[] = [];
    // Observe ALL states before changing one. Failed reads must never cause mass scale-in.
    for (const station of stations) {
      if (!isEncrypted(station.pat)) throw Error(`PAT chưa mã hóa cho ${stationSlug(station)}.`);
      const pat = decryptSecret(station.pat);
      const state = (await github(pat, pathOf(station), "GET", deadline))?.state;
      if (state !== "active" && state !== "disabled_manually" && state !== "disabled_inactivity") {
        throw Error(`Workflow ${stationSlug(station)} ở trạng thái ${state || "không rõ"}; không scale khi dữ liệu chưa chắc chắn.`);
      }
      workflows.push({ station, slug: stationSlug(station), state, pat });
    }
    const currentlyActive = workflows.filter(w => w.state === "active");
    active = currentlyActive.length;
    const available = workflows.filter(w => w.state !== "active");
    // A count is an upper bound; workflows may take some minutes to launch a runner after enable.
    const target = Math.min(desired, workflows.length);
    if (mode === "dynamic" && target < active && config.lastAppliedAt
      && Date.now() - Date.parse(config.lastAppliedAt) < config.downscaleCooldownMinutes * 60_000) {
      return { ok: true, message: "Đang trong thời gian chống dao động; giữ nguyên số workflow.", mode, desired: target, active, enabled, disabled, queued, running, checkedAt };
    }
    const plan = chooseWorkflowTransitions(currentlyActive.map(w => w.slug), available.map(w => w.slug), target);
    // Prefer additions before reductions; keep the minimum intact even if a GitHub request fails.
    for (const [action, slugs, state] of [
      ["enable", plan.enable, "active"],
      ["disable", plan.disable, "disabled_manually"],
    ] as const) {
      for (const slug of slugs) {
        const workflow = workflows.find(w => w.slug === slug)!;
        await github(workflow.pat, pathOf(workflow.station) + "/" + action, "PUT", deadline);
        await mutateGithubState(current => {
          const station = current.githubStations.find(s => stationSlug(s) === slug);
          if (station) station.workflowState = state;
          current.workerAutoscale.managedSlugs = [...new Set([...current.workerAutoscale.managedSlugs, slug])];
          current.workerAutoscale.lastAppliedAt = new Date().toISOString();
          current.workerAutoscale.lastError = "";
        }, { deadlineAt: deadline });
        (action === "enable" ? enabled : disabled).push(slug);
      }
    }
    await mutateGithubState(current => {
      for (const wf of workflows) {
        const station = current.githubStations.find(s => stationSlug(s) === wf.slug);
        if (station && !enabled.includes(wf.slug) && !disabled.includes(wf.slug)) station.workflowState = wf.state;
      }
      current.workerAutoscale.lastError = "";
    }, { deadlineAt: deadline });
    return { ok: true, message: `Mục tiêu ${target}/${workflows.length} workflow. Đã bật ${enabled.length}, tắt ${disabled.length}.`, mode, desired: target, active: active + enabled.length - disabled.length, enabled, disabled, queued, running, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 470) : "Autoscale không thể hoàn tất.";
    try { await mutateGithubState(s => { s.workerAutoscale.lastError = message; }); } catch { /* preserve original error */ }
    return { ok: false, message, mode, desired, active, enabled, disabled, queued, running, checkedAt };
  } finally {
    await lease.release();
  }
}
