import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { acquireGithubAutoscaleLease, mutateGithubState } from "@/lib/services/companionState";
import { getAppSettings, type AppSettings } from "@/lib/services/settings";
import { autoscaleDesiredWorkers, chooseWorkflowTransitions, shouldDispatchIdleWorkflow, workerDrainIdsForSelection } from "@/lib/validation/workerAutoscale";
import { stationSlug } from "@/lib/validation/githubStations";

type Station = AppSettings["githubStations"][number];
type Workflow = { station: Station; slug: string; state: string; pat: string };
export type AutoscaleResult = {
  ok: boolean; message: string; mode: string; desired: number; active: number;
  enabled: string[]; disabled: string[]; dispatched: string[]; queued: number; running: number; checkedAt: string;
};
const root = "https://api.github.com";
function pathOf(station: Station) {
  return `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}`;
}
async function github(pat: string, path: string, method: "GET" | "PUT" | "POST", deadline: number, payload?: { ref: string }) {
  const left = deadline - Date.now();
  if (left <= 0) throw Error("Hết thời gian điều khiển GitHub; thử lại ở lượt sau.");
  const response = await fetch(root + path, {
    method,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    headers: { authorization: `Bearer ${pat}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "auto-hh3d-worker-autoscale", "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1, Math.min(9000, left))),
  });
  const body = method === "GET" && response.ok ? await response.json() as { state?: string; default_branch?: string; workflow_runs?: { status: string; created_at: string }[] } : null;
  if (response.status !== (method === "GET" ? 200 : 204)) throw Error(`GitHub trả HTTP ${response.status} khi ${method} ${path}`);
  return body;
}
export async function readAutoscaleDemand() {
  // A queued job is runnable only after its scheduled cooldown has expired.
  // Never forecast future cooldown jobs, even if their next_run_at is very close.
  // Count only jobs eligible for sect GitHub workers, not private PC workers.
  const result = await db().execute(sql`
    select
      count(*) filter (
        where job.status = 'queued'
          and job.next_run_at <= now()
          and (job.account_id is null or account.enabled)
      )::int as queued,
      count(*) filter (
        where job.status = 'running'
          and job.last_heartbeat > now() - interval '3 minutes'
          and (job.worker_id is null or assignee.user_id is null)
      )::int as running
    from automation_jobs as job
    left join game_accounts as account
      on account.id = job.account_id and account.user_id = job.user_id
    left join user_configs as pref on pref.user_id = job.user_id
    left join workers as assignee on assignee.id = job.worker_id
    where coalesce(
      case when account.worker_pref_override in ('sect', 'mine')
        then account.worker_pref_override else null end,
      pref.config->>'workerPref',
      'any'
    ) <> 'mine'
  `);
  return {
    queued: Number(result.rows[0]?.queued ?? 0),
    running: Number(result.rows[0]?.running ?? 0),
  };
}

/** Serialized, GitHub-observed reconciliation; never starts a worker on the OCI host. */
export async function runWorkerAutoscale(): Promise<AutoscaleResult> {
  const checkedAt = new Date().toISOString();
  const deadline = Date.now() + 105_000;
  const lease = await acquireGithubAutoscaleLease(deadline);
  if (!lease) return { ok: false, message: "Một lượt autoscale khác đang chạy.", mode: "-", desired: 0, active: 0, enabled: [], disabled: [], dispatched: [], queued: 0, running: 0, checkedAt };
  let mode = "manual", desired = 0, active = 0, queued = 0, running = 0;
  const enabled: string[] = [], disabled: string[] = [], dispatched: string[] = [];
  try {
    const settings = await getAppSettings();
    const config = settings.workerAutoscale;
    mode = config.mode;
    if (!config.enabled) return { ok: true, message: "Auto scaling đang tắt; không thay đổi GitHub.", mode, desired: 0, active: 0, enabled, disabled, dispatched, queued, running, checkedAt };
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
    const requested = Math.min(desired, workflows.length);
    const retainDuringCooldown = mode === "dynamic" && requested < active && Boolean(config.lastAppliedAt)
      && Date.now() - Date.parse(config.lastAppliedAt!) < config.downscaleCooldownMinutes * 60_000;
    // Cooldown prevents scale-IN, but must never block idle-workflow recovery.
    const target = retainDuringCooldown ? active : requested;
    const plan = chooseWorkflowTransitions(currentlyActive.map(w => w.slug), available.map(w => w.slug), target);
    // Persist draining identities BEFORE disabling GitHub. This also targets
    // previously-disabled repos whose old runners are still online. During
    // scale-out the kept identities are removed BEFORE enabling dispatch.
    // Reconcile every time (even if there are zero workflow transitions).
    const drainingWorkerIds = workerDrainIdsForSelection(
      workflows.map(w => ({ slug: w.slug, workerId: w.station.workerId })),
      plan.selected,
    );
    await mutateGithubState(current => {
      current.workerAutoscale.drainingWorkerIds = drainingWorkerIds;
    }, { deadlineAt: deadline });
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
    // Enabling a workflow does not start a GitHub runner. Observe actual runs,
    // then dispatch only when there is no active/pending run (15 min failure backoff).
    // Respect the same selected set; never revive a workflow being scaled down.
    for (const slug of plan.selected) {
      const workflow = workflows.find(w => w.slug === slug)!;
      const runs = await github(workflow.pat, pathOf(workflow.station) + "/runs?per_page=5", "GET", deadline);
      if (!Array.isArray(runs?.workflow_runs)) throw Error(`Cannot read Actions runs for ${slug}; refusing blind dispatch.`);
      if (!shouldDispatchIdleWorkflow(runs.workflow_runs, Date.now())) continue;
      const repository = await github(
        workflow.pat,
        `/repos/${encodeURIComponent(workflow.station.owner)}/${encodeURIComponent(workflow.station.repo)}`,
        "GET", deadline,
      );
      const branch = repository?.default_branch;
      if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch)) throw Error(`Invalid default branch for ${slug}.`);
      await github(workflow.pat, pathOf(workflow.station) + "/dispatches", "POST", deadline, { ref: branch });
      dispatched.push(slug);
    }
    await mutateGithubState(current => {
      for (const wf of workflows) {
        const station = current.githubStations.find(s => stationSlug(s) === wf.slug);
        if (station && !enabled.includes(wf.slug) && !disabled.includes(wf.slug)) station.workflowState = wf.state;
      }
      current.workerAutoscale.lastError = "";
    }, { deadlineAt: deadline });
    return { ok: true, message: `Mục tiêu ${target}/${workflows.length} workflow. Đã bật ${enabled.length}, tắt ${disabled.length}, phát lượt chạy ${dispatched.length}, yêu cầu rút lui ${drainingWorkerIds.length} Khôi Lỗi. Chờ nhận ngay: ${queued} job; đang chạy: ${running} job. Job cooldown không được tính.`, mode, desired: target, active: active + enabled.length - disabled.length, enabled, disabled, dispatched, queued, running, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 470) : "Autoscale không thể hoàn tất.";
    try { await mutateGithubState(s => { s.workerAutoscale.lastError = message; }); } catch { /* preserve original error */ }
    return { ok: false, message, mode, desired, active, enabled, disabled, dispatched, queued, running, checkedAt };
  } finally {
    await lease.release();
  }
}
