import {
  DEFAULT_DAILY_PUSHES,
  DEFAULT_WORKFLOW_FILE,
  MAX_DAILY_PUSHES,
  MIN_DAILY_PUSHES,
  reviewStationIdentity,
} from "./githubStations";

export type GithubProvisionInput = {
  pat: string;
  repo?: string;
  workflowFile?: string;
  dailyPushes?: string | number;
  /** Chỉ đăng ký tài khoản + nuôi repo phụ; repo chính/workflow chờ user mở lại sau. */
  deferPrimary?: boolean;
  /** Internal-only: materialize a previously deferred station without losing companion repos. */
  activateDeferredSlug?: string;
  /** Internal-only: keep the worker identity reserved by a deferred station. */
  workerId?: string;
  dryRun?: boolean;
  ownerForDryRun?: string;
};

export type NormalizedGithubProvisionInput = {
  pat: string;
  repo: string;
  workflowFile: string;
  dailyPushes: number;
  /** Filled after the owner and repository name are known. */
  workerId: string;
  generatedRepo: boolean;
  deferPrimary: boolean;
  activateDeferredSlug?: string;
};

const SAFE_WORKFLOW_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:ya?ml)$/;
const WORKER_ID_RE = /^[A-Za-z0-9._-]+$/;

function normalizedDailyPushes(value: GithubProvisionInput["dailyPushes"]): number {
  if (value === undefined || value === "" || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_DAILY_PUSHES;
  }

  const parsed = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < MIN_DAILY_PUSHES || parsed > MAX_DAILY_PUSHES) {
    throw new Error(`dailyPushes must be an integer from ${MIN_DAILY_PUSHES} to ${MAX_DAILY_PUSHES}.`);
  }
  return parsed;
}

function normalizedWorkflowFile(value: string | undefined): string {
  const workflowFile = value?.trim() || DEFAULT_WORKFLOW_FILE;
  if (workflowFile.includes("/") || workflowFile.includes("\\") || !SAFE_WORKFLOW_BASENAME.test(workflowFile)) {
    throw new Error("workflowFile must be a safe .yml or .yaml basename.");
  }
  return workflowFile;
}

/**
 * Normalize the CLI/form boundary before the caller identifies the GitHub owner.
 * A blank repo stays unresolved until the service asks Ollama after PAT validation.
 */
export function normalizeGithubProvisionInput(
  input: GithubProvisionInput,
): NormalizedGithubProvisionInput {
  if (!input.pat || /\s/.test(input.pat)) {
    throw new Error("PAT must not be empty or contain whitespace.");
  }

  const suppliedRepo = input.repo?.trim() ?? "";
  const generatedRepo = suppliedRepo.length === 0;
  const repo = suppliedRepo;
  const workflowFile = normalizedWorkflowFile(input.workflowFile);

  return {
    pat: input.pat,
    repo,
    workflowFile,
    dailyPushes: normalizedDailyPushes(input.dailyPushes),
    workerId: input.workerId?.trim() ?? "",
    generatedRepo,
    deferPrimary: input.deferPrimary === true,
    ...(input.activateDeferredSlug?.trim() ? { activateDeferredSlug: input.activateDeferredSlug.trim() } : {}),
  };
}

/** Run after the PAT lookup resolves the real GitHub owner. */
export function reviewNormalizedProvisionIdentity(
  owner: string,
  input: Pick<NormalizedGithubProvisionInput, "repo" | "workflowFile">,
): string | null {
  return reviewStationIdentity(owner, input.repo, input.workflowFile);
}

export function reviewProvisionWorkerId(workerId: string, repo: string): string | null {
  if (workerId.length === 0 || workerId.length > 100 || !WORKER_ID_RE.test(workerId) || workerId === "." || workerId === "..") {
    return "Tên khôi lỗi: 1-100 ký tự chữ/số/dấu chấm/gạch ngang/gạch dưới.";
  }
  if (workerId.toLowerCase() === repo.toLowerCase()) {
    return "Tên repo chính không được trùng tên khôi lỗi.";
  }
  return null;
}

export function reviewPrimaryRepoAgainstKhoiloiNames(repo: string, names: readonly string[]): string | null {
  const match = names.find((name) => name.trim().length > 0 && name.toLowerCase() === repo.toLowerCase());
  return match ? `Tên repo chính không được trùng tên khôi lỗi「${match}」. Chọn tên repo khác.` : null;
}
