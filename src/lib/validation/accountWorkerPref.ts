/** Account-level worker routing; default inherits the user's live global choice. */
export const ACCOUNT_WORKER_PREFS = ["default", "sect", "mine"] as const;
export type AccountWorkerPref = (typeof ACCOUNT_WORKER_PREFS)[number];
export type WorkerPref = "any" | "sect" | "mine";

export function resolveAccountWorkerPref(value: unknown): AccountWorkerPref | null {
  return value === "default" || value === "sect" || value === "mine" ? value : null;
}

export function effectiveWorkerPref(override: unknown, global: WorkerPref): WorkerPref {
  return override === "sect" || override === "mine" ? override : global;
}
