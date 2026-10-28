"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { getAppSettings } from "@/lib/services/settings";
import { mutateGithubState } from "@/lib/services/companionState";
import { runWorkerAutoscale, type AutoscaleResult } from "@/lib/services/workerAutoscale";
import { workerAutoscaleSchema, type WorkerAutoscaleSettings } from "@/lib/validation/workerAutoscale";

export type AutoscaleInput = Pick<WorkerAutoscaleSettings, "enabled" | "mode" | "minWorkers" | "manualWorkers" | "schedule" | "dynamicMaxWorkers" | "jobsPerWorker" | "downscaleCooldownMinutes">;
export type AutoscaleActionResult = { ok: boolean; message: string; result?: AutoscaleResult };
export async function saveWorkerAutoscaleAction(input: AutoscaleInput): Promise<AutoscaleActionResult> {
  const viewer = await requireAdmin();
  if (!hasPermission(viewer, "github_station.manage")) throw Error("Không có quyền điều chỉnh GitHub Actions.");
  const current = (await getAppSettings()).workerAutoscale;
  const validation = workerAutoscaleSchema.safeParse({
    ...current, ...input, lastError: "",
  });
  if (!validation.success) return { ok: false, message: validation.error.issues[0]?.message ?? "Cấu hình không hợp lệ." };
  await mutateGithubState(settings => {
    // Never replace another request's checkpoint/ownership fields with stale client values.
    settings.workerAutoscale = { ...settings.workerAutoscale, ...input, lastError: "",
      ...(!input.enabled ? { drainingWorkerIds: settings.githubStations
        .filter(station => settings.workerAutoscale.manualDisabledSlugs.includes(station.owner + "/" + station.repo))
        .map(station => station.workerId) } : {}),
    };
  });
  const result = input.enabled ? await runWorkerAutoscale() : null;
  revalidatePath("/admin");
  return { ok: result?.ok ?? true, message: result?.message ?? "Đã lưu và tắt auto scaling; không có workflow nào bị thay đổi.", ...(result ? { result } : {}) };
}
export async function reconcileWorkerAutoscaleAction(): Promise<AutoscaleActionResult> {
  const viewer = await requireAdmin();
  if (!hasPermission(viewer, "github_station.manage")) throw Error("Không có quyền điều chỉnh GitHub Actions.");
  const result = await runWorkerAutoscale();
  revalidatePath("/admin");
  return { ok: result.ok, message: result.message, result };
}
