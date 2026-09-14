import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publicIdentityForWorker } from "../../../scripts/githubPublicIdentity.mjs";
import {
  normalizeGithubProvisionInput,
  reviewNormalizedProvisionIdentity,
  reviewPrimaryRepoAgainstKhoiloiNames,
  reviewProvisionWorkerId,
  type GithubProvisionInput,
  type NormalizedGithubProvisionInput,
} from "../validation/githubProvisioning";

export type GithubProvisionStage = "preflight" | "create" | "publish" | "secret" | "register" | "complete" | "attention";
export type GithubProvisionStep =
  | "input_validation"
  | "github_identity"
  | "github_scopes"
  | "registry_names"
  | "repository_name"
  | "worker_identity"
  | "local_preflight"
  | "settings_check"
  | "worker_check"
  | "repository_probe"
  | "lease"
  | "local_stage"
  | "github_create"
  | "git_push"
  | "github_secret"
  | "registry_register";
export type GithubProvisionFailureCode =
  | "invalid_input"
  | "github_identity_unavailable"
  | "github_scopes_missing"
  | "registry_unavailable"
  | "repository_name_unavailable"
  | "worker_identity_unavailable"
  | "server_configuration_missing"
  | "server_git_unavailable"
  | "server_gh_unavailable"
  | "payload_unavailable"
  | "repository_name_conflict"
  | "station_conflict"
  | "worker_conflict"
  | "repository_exists"
  | "repository_state_unavailable"
  | "lease_unavailable"
  | "provisioning_busy"
  | "local_stage_failed"
  | "github_create_failed"
  | "git_push_failed"
  | "github_secret_failed"
  | "registry_register_failed"
  | "deadline_exceeded"
  | "unexpected_failure";
export type GithubProvisionFailureRecord = Readonly<{
  diagnosticId: string;
  stage: GithubProvisionStage;
  step: GithubProvisionStep;
  code: GithubProvisionFailureCode;
}>;

export type GithubProvisionResult = {
  ok: boolean;
  stage: GithubProvisionStage;
  slug?: string;
  message: string;
  warnings: string[];
  failureCode?: GithubProvisionFailureCode;
  diagnosticId?: string;
};
export type GithubProvisionBudget = { deadlineAt: number; now: () => number };
export type GithubProvisionContext = NormalizedGithubProvisionInput & { owner: string; slug: string } & GithubProvisionBudget;
type Prepared = { directory: string; encryptedPat: string; workerToken: string };
type Staged = { initialCommitSha: string };
type Lease = { assertHeld: (budget?: GithubProvisionBudget) => Promise<void>; release: () => Promise<void> };

/** Every effect is replaceable; injected lifecycle tests never import DB/network/process adapters. */
export type GithubProvisioningDependencies = {
  now?: () => number;
  deadlineAt?: number;
  generateRepoName: (owner: string, budget: GithubProvisionBudget, forbiddenNames: readonly string[]) => Promise<string>;
  generateWorkerId: (owner: string, repo: string, budget: GithubProvisionBudget, forbiddenNames: readonly string[]) => Promise<string>;
  listKhoiloiNames: (owner: string, budget: GithubProvisionBudget) => Promise<string[]>;
  whoami: (pat: string, budget: GithubProvisionBudget) => Promise<{ login: string; scopes: string | null }>;
  checkScopes: (scopes: string | null) => Promise<void>;
  localPreflight: (context: GithubProvisionContext) => Promise<Prepared>;
  checkSettings: (context: GithubProvisionContext, locked: boolean) => Promise<void>;
  checkWorker: (context: GithubProvisionContext, locked: boolean) => Promise<void>;
  probe: (context: GithubProvisionContext) => Promise<{ status: number }>;
  acquireLease: (context: GithubProvisionContext) => Promise<Lease | null>;
  stage: (context: GithubProvisionContext, prepared: Prepared) => Promise<Staged>;
  create: (context: GithubProvisionContext) => Promise<{ status: number; githubId?: number }>;
  push: (context: GithubProvisionContext, prepared: Prepared) => Promise<void>;
  setSecret: (context: GithubProvisionContext, prepared: Prepared) => Promise<void>;
  register: (context: GithubProvisionContext, prepared: Prepared, proof: Staged & { githubId: number }) => Promise<void>;
  cleanupSnapshot: (context: GithubProvisionContext) => Promise<{ githubId: number; head: string | null; referenced: boolean }>;
  deleteRepo: (context: GithubProvisionContext) => Promise<void>;
  dispatch: (context: GithubProvisionContext) => Promise<void>;
  ping: (context: GithubProvisionContext) => Promise<void>;
  nurture: (context: GithubProvisionContext) => Promise<void>;
  dispose: (prepared: Prepared) => Promise<void>;
  /** Receives finite, secret-free fields only. A recorder must never inspect the triggering error. */
  recordFailure?: (record: GithubProvisionFailureRecord) => void;
};
export type GithubProvisionDependencies = GithubProvisioningDependencies;
export type GithubProvisionPayloadSourceMode = "filesystem" | "git-head";

export class GithubProvisionCollisionError extends Error {
  constructor(readonly kind: "station" | "worker") {
    super("GitHub provisioning identity is already registered");
  }
}

/** Trusted operational classification. Its message is the finite code, never upstream text. */
export class GithubProvisionSafeError extends Error {
  constructor(readonly code: GithubProvisionFailureCode, readonly safeMessage?: string) {
    super(code);
    this.name = "GithubProvisionSafeError";
  }
}

function rethrowSafe(error: unknown, fallback: GithubProvisionFailureCode): never {
  if (error instanceof GithubProvisionSafeError) throw error;
  throw new GithubProvisionSafeError(fallback);
}

const CLEANUP_RESERVE_MS = 30_000;
function remaining(budget: GithubProvisionBudget, cap = Number.MAX_SAFE_INTEGER): number {
  const ms = Math.min(cap, budget.deadlineAt - budget.now());
  if (ms <= 0) throw new GithubProvisionSafeError("deadline_exceeded");
  return ms;
}
async function bounded<T>(budget: GithubProvisionBudget, operation: () => Promise<T>, lateCleanup?: (value: T) => Promise<void>): Promise<T> {
  const ms = remaining(budget);
  let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
  const work = operation().then(async value => { if (timedOut && lateCleanup) await lateCleanup(value); return value; });
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { timedOut = true; reject(new GithubProvisionSafeError("deadline_exceeded")); }, ms); })]);
  } finally { clearTimeout(timer); }
}

/** Only direct, real, non-symlink provisioning directories under the system temp root are owned. */
export async function resolveGithubProvisioningTemp(candidate: string): Promise<string | null> {
  const root = await realpath(tmpdir());
  const absolute = path.resolve(candidate);
  const key = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (!path.isAbsolute(candidate) || key(path.dirname(absolute)) !== key(root) || !/^github-provision-[A-Za-z0-9]+$/.test(path.basename(absolute))) throw Error("Unowned provisioning directory");
  let stat;
  try { stat = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unowned provisioning directory");
  const resolved = await realpath(absolute);
  if (key(resolved) !== key(absolute) || key(path.dirname(resolved)) !== key(root)) throw Error("Unowned provisioning directory");
  return resolved;
}
export async function removeGithubProvisioningTemp(candidate: string): Promise<void> {
  const resolved = await resolveGithubProvisioningTemp(candidate);
  if (resolved) await rm(resolved, { recursive: true, force: true });
}

const messages = {
  preflight: "Không thể chuẩn bị kho GitHub. Kiểm tra PAT, quyền repo/workflow/delete_repo, cấu hình máy chủ và tên kho chưa được sử dụng.",
  create: "GitHub từ chối tạo kho. Không có kho nào được nhận làm mục tiêu rollback.",
  publish: "Không thể đẩy gói khôi lỗi lên kho GitHub.",
  secret: "Không thể cài WORKER_TOKEN cho kho GitHub.",
  register: "Không thể đăng ký kho GitHub vào sổ.",
  complete: "Đã tạo và đăng ký kho GitHub.",
  attention: "Cần kiểm tra kho GitHub thủ công trước khi thử lại. Không tự động tạo lại hoặc xoá kho chưa xác minh.",
} as const;

const failureMessages: Record<GithubProvisionFailureCode, string> = {
  invalid_input: "Dữ liệu tạo kho không hợp lệ. Kiểm tra tên kho, tên workflow và giới hạn lượt đẩy.",
  github_identity_unavailable: "Không xác minh được PAT với GitHub. Kiểm tra token còn hiệu lực rồi thử lại.",
  github_scopes_missing: "PAT thiếu ít nhất một quyền bắt buộc: repo, workflow hoặc delete_repo.",
  registry_unavailable: "Không đọc được sổ GitHub trên máy chủ. Thử lại sau.",
  repository_name_unavailable: "Không chọn được tên kho hợp lệ. Nhập tên kho cụ thể rồi thử lại.",
  worker_identity_unavailable: "Không tạo được WORKER_ID riêng cho kho. Thử lại sau.",
  server_configuration_missing: "Máy chủ thiếu cấu hình nội bộ cần thiết để tạo kho GitHub.",
  server_git_unavailable: "Máy chủ không chạy được Git để chuẩn bị kho.",
  server_gh_unavailable: "Máy chủ không chạy được GitHub CLI để chuẩn bị kho.",
  payload_unavailable: "Gói provisioning của bản phát hành không dùng được. Cần dựng và triển khai lại backend.",
  repository_name_conflict: "Tên kho trùng với một danh tính khôi lỗi đang có. Chọn tên khác.",
  station_conflict: "Tên kho hoặc WORKER_ID đã có trong sổ GitHub. Chọn tên kho khác; không có repo nào được ghi đè.",
  worker_conflict: "WORKER_ID này đang được một khôi lỗi sử dụng. Chọn tên kho khác; không có repo nào được ghi đè.",
  repository_exists: "Kho GitHub đã tồn tại. Không có thay đổi nào được thực hiện.",
  repository_state_unavailable: "Không xác định được kho GitHub có tồn tại hay không. Không có thay đổi nào được thực hiện.",
  lease_unavailable: "Không mở được khoá độc quyền để tạo kho GitHub. Thử lại sau.",
  provisioning_busy: "Tài khoản hoặc tên kho đang được một lượt provisioning khác xử lý. Thử lại sau.",
  local_stage_failed: "Không dựng được commit ban đầu trên máy chủ; chưa tạo repo GitHub.",
  github_create_failed: messages.create,
  git_push_failed: messages.publish,
  github_secret_failed: messages.secret,
  registry_register_failed: messages.register,
  deadline_exceeded: "Lượt tạo kho vượt quá thời gian cho phép và đã dừng an toàn.",
  unexpected_failure: messages.preflight,
};

const failureCodeForStep: Record<GithubProvisionStep, GithubProvisionFailureCode> = {
  input_validation: "invalid_input",
  github_identity: "github_identity_unavailable",
  github_scopes: "github_scopes_missing",
  registry_names: "registry_unavailable",
  repository_name: "repository_name_unavailable",
  worker_identity: "worker_identity_unavailable",
  local_preflight: "payload_unavailable",
  settings_check: "registry_unavailable",
  worker_check: "registry_unavailable",
  repository_probe: "repository_state_unavailable",
  lease: "lease_unavailable",
  local_stage: "local_stage_failed",
  github_create: "github_create_failed",
  git_push: "git_push_failed",
  github_secret: "github_secret_failed",
  registry_register: "registry_register_failed",
};

/** Production journal entry deliberately contains no exception, request value or repository identity. */
function recordProductionFailure(record: GithubProvisionFailureRecord): void {
  if (process.env.NODE_ENV === "production") {
    console.error("[github-provisioning-failure]", JSON.stringify(record));
  }
}

export async function provisionGithubStation(input: GithubProvisionInput, deps: GithubProvisioningDependencies = productionGithubProvisionDependencies): Promise<GithubProvisionResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadlineAt = Math.min(deps.deadlineAt ?? startedAt + 240_000, startedAt + 240_000);
  const budget = { now, deadlineAt: deadlineAt - CLEANUP_RESERVE_MS };
  const cleanupBudget = { now, deadlineAt };
  const work = <T>(operation: () => Promise<T>) => bounded(budget, operation);
  let stage: GithubProvisionResult["stage"] = "preflight";
  let step: GithubProvisionStep = "input_validation";
  let context: GithubProvisionContext | undefined, prepared: Prepared | undefined, staged: Staged | undefined, lease: Lease | null = null;
  let githubId: number | undefined, registered = false, createUncertain = false;
  const warnings: string[] = [];
  let safeMessage: string | undefined;
  let safeFailureCode: GithubProvisionFailureCode | undefined;
  const requireAbsent = async (ctx: GithubProvisionContext) => {
    let status: number | undefined;
    try { status = (await work(() => deps.probe(ctx))).status; } catch { /* Unknown is distinct from existing. */ }
    if (status === 404) return;
    safeMessage = status === 200 ? "Kho GitHub đã tồn tại. Không có thay đổi nào được thực hiện." : "Không xác định được kho GitHub có tồn tại hay không. Không có thay đổi nào được thực hiện.";
    safeFailureCode = status === 200 ? "repository_exists" : "repository_state_unavailable";
    throw Error("repository not proven absent");
  };
  let result: GithubProvisionResult;
  try {
    // CLI handles offline dry runs separately; this service never mutates for a dry run.
    if (input.dryRun) throw Error("dry run is an adapter concern");
    let normalized: NormalizedGithubProvisionInput;
    try {
      normalized = normalizeGithubProvisionInput(input);
    } catch (error) {
      safeFailureCode = "invalid_input";
      if (!input.pat || /\s/.test(input.pat)) {
        safeMessage = "PAT trống hoặc chứa khoảng trắng/xuống dòng. Chép lại classic PAT rồi thử lại.";
      } else if (error instanceof Error && error.message.includes("workflowFile")) {
        safeMessage = "Tên tệp workflow phải là một basename kết thúc bằng .yml hoặc .yaml, không kèm đường dẫn.";
      } else if (error instanceof Error && error.message.includes("dailyPushes")) {
        safeMessage = "Giới hạn lượt đẩy mỗi ngày phải là số nguyên từ 0 đến 24.";
      }
      throw new GithubProvisionSafeError("invalid_input");
    }
    step = "github_identity";
    const identity = await work(() => deps.whoami(normalized.pat, budget));
    step = "github_scopes";
    await work(() => deps.checkScopes(identity.scopes));
    step = "registry_names";
    const khoiloiNames = await work(() => deps.listKhoiloiNames(identity.login, budget));
    if (normalized.generatedRepo) {
      step = "repository_name";
      try {
        const namingBudget = { ...budget, deadlineAt: Math.min(budget.deadlineAt, now() + 45_000) };
        const repo = await bounded(namingBudget, () => deps.generateRepoName(identity.login, namingBudget, khoiloiNames));
        if (
          typeof repo !== "string"
          || reviewNormalizedProvisionIdentity(identity.login, { ...normalized, repo })
          || reviewPrimaryRepoAgainstKhoiloiNames(repo, khoiloiNames)
        ) throw Error("invalid model name");
        normalized.repo = repo;
      } catch {
        safeMessage = "Không thể nhờ Ollama đặt tên kho. Kiểm tra model, API key và kết nối, hoặc nhập tên kho để tạo; chưa tạo repo nào.";
        safeFailureCode = "repository_name_unavailable";
        throw Error("Ollama naming failed");
      }
    }
    const khoiloiCollision = reviewPrimaryRepoAgainstKhoiloiNames(normalized.repo, khoiloiNames);
    if (khoiloiCollision) {
      safeMessage = khoiloiCollision;
      safeFailureCode = "repository_name_conflict";
      throw Error("repository collides with worker name");
    }
    const identityComplaint = reviewNormalizedProvisionIdentity(identity.login, normalized);
    if (identityComplaint) {
      safeMessage = identityComplaint;
      throw new GithubProvisionSafeError("invalid_input");
    }
    step = "worker_identity";
    normalized.workerId = await work(() => deps.generateWorkerId(identity.login, normalized.repo, budget, khoiloiNames));
    const workerComplaint = reviewProvisionWorkerId(normalized.workerId, normalized.repo);
    if (workerComplaint) {
      safeMessage = workerComplaint;
      throw new GithubProvisionSafeError("worker_identity_unavailable");
    }
    context = { ...normalized, ...budget, owner: identity.login, slug: `${identity.login}/${normalized.repo}` };
    const ctx = context;
    step = "local_preflight";
    prepared = await bounded(budget, () => deps.localPreflight(ctx), deps.dispose);
    step = "settings_check";
    await work(() => deps.checkSettings(ctx, false));
    step = "worker_check";
    await work(() => deps.checkWorker(ctx, false));
    step = "repository_probe";
    await requireAbsent(ctx);
    step = "lease";
    lease = await bounded(budget, () => deps.acquireLease(ctx), async late => { await late?.release(); });
    if (!lease) throw new GithubProvisionSafeError("provisioning_busy");
    step = "settings_check";
    await work(() => deps.checkSettings(ctx, true));
    step = "worker_check";
    await work(() => deps.checkWorker(ctx, true));
    step = "repository_probe";
    await requireAbsent(ctx);
    const local = prepared;
    step = "local_stage";
    staged = await work(() => deps.stage(ctx, local));
    step = "lease";
    await work(() => lease!.assertHeld(budget));
    stage = "create";
    step = "github_create";
    createUncertain = true;
    const created = await work(() => deps.create(ctx));
    // A 4xx rejection is definitive. A 5xx/malformed success may have created the repository.
    if (created.status >= 400 && created.status < 500) createUncertain = false;
    if (created.status !== 201 || !Number.isSafeInteger(created.githubId) || created.githubId! <= 0) throw Error("create not confirmed");
    githubId = created.githubId;
    createUncertain = false;
    stage = "publish";
    step = "lease";
    await work(() => lease!.assertHeld(budget));
    step = "git_push";
    await work(() => deps.push(ctx, local));
    stage = "secret";
    step = "lease";
    await work(() => lease!.assertHeld(budget));
    step = "github_secret";
    await work(() => deps.setSecret(ctx, local));
    stage = "register";
    step = "lease";
    await work(() => lease!.assertHeld(budget));
    const proof = { ...staged, githubId: githubId! };
    step = "registry_register";
    await work(() => deps.register(ctx, local, proof));
    registered = true;
    for (const [operation, warning] of [
      [deps.dispatch, "Kho đã đăng ký; chưa khởi chạy được workflow."],
      [deps.ping, "Kho đã đăng ký; chưa xác minh được trạng thái workflow."],
      [deps.nurture, "Kho đã đăng ký; vòng tạo kho phụ Ollama cần chạy lại sau."],
    ] as const) {
      try { await work(() => operation(ctx)); } catch { warnings.push(warning); }
    }
    result = { ok: true, stage: "complete", slug: context.slug, message: messages.complete, warnings };
  } catch (error) {
    if (error instanceof GithubProvisionCollisionError) {
      safeFailureCode = error.kind === "station" ? "station_conflict" : "worker_conflict";
      safeMessage = error.kind === "station"
        ? "Tên kho hoặc WORKER_ID đã có trong sổ GitHub. Chọn tên kho khác; không có repo nào được ghi đè."
        : "WORKER_ID này đang được một khôi lỗi sử dụng. Chọn tên kho khác; không có repo nào được ghi đè.";
    }
    if (!registered && githubId !== undefined && context && staged) {
      try {
        const cleanupContext = { ...context, ...cleanupBudget };
        await bounded(cleanupBudget, () => lease!.assertHeld(cleanupBudget));
        const snapshot = await bounded(cleanupBudget, () => deps.cleanupSnapshot(cleanupContext));
        // Empty HEAD is valid before a push; the staged SHA also handles lost push acknowledgements.
        if (snapshot.referenced || snapshot.githubId !== githubId || (snapshot.head !== null && snapshot.head !== staged.initialCommitSha)) throw Error("cleanup ownership changed");
        await bounded(cleanupBudget, () => lease!.assertHeld(cleanupBudget));
        await bounded(cleanupBudget, () => deps.deleteRepo(cleanupContext));
        if ((await bounded(cleanupBudget, () => deps.probe(cleanupContext))).status !== 404) throw Error("deletion not verified");
      } catch { stage = "attention"; warnings.push("Không xác minh được rollback hoàn tất an toàn; cần kiểm tra kho GitHub."); }
    }
    if (createUncertain) stage = "attention";
    const failureCode = safeFailureCode ?? (error instanceof GithubProvisionSafeError ? error.code : failureCodeForStep[step] ?? "unexpected_failure");
    if (!safeMessage && error instanceof GithubProvisionSafeError && error.safeMessage) {
      safeMessage = error.safeMessage;
    }
    const diagnosticId = randomBytes(8).toString("hex");
    const record = Object.freeze({ diagnosticId, stage, step, code: failureCode });
    try { deps.recordFailure?.(record); } catch { /* Diagnostics must never affect provisioning or rollback. */ }
    result = {
      ok: false,
      stage,
      ...(context ? { slug: context.slug } : {}),
      message: stage === "attention" ? messages.attention : safeMessage ?? failureMessages[failureCode],
      warnings,
      failureCode,
      diagnosticId,
    };
  } finally {
    // Start mandatory release/disposal even at an exhausted deadline; they own no primary mutation.
    try { if (lease) { const release = lease.release(); void release.catch(() => {}); await bounded(cleanupBudget, () => release); } } catch { warnings.push("Không xác nhận được việc giải phóng khoá provisioning; đã yêu cầu đóng kết nối."); }
    try { if (prepared) { const disposal = deps.dispose(prepared); void disposal.catch(() => {}); await bounded(cleanupBudget, () => disposal); } } catch { warnings.push("Không xác nhận được việc dọn thư mục tạm trên máy chủ."); }
  }
  return result;
}

/** Async, shell-free child runner. Output has a hard cap, timeout and never crosses the UI boundary. */
async function run(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number; budget: GithubProvisionBudget }): Promise<string> {
  const timeout = remaining(options.budget, options.timeout ?? 60_000);
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", size = 0, failed = false;
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, timeout);
    child.stdout.on("data", (bytes: Buffer) => { size += bytes.length; if (size > 1024 * 1024) stop(); else output += bytes.toString("utf8"); });
    child.stderr.on("data", (bytes: Buffer) => { size += bytes.length; if (size > 1024 * 1024) stop(); });
    child.on("error", () => { clearTimeout(timer); reject(Error("child operation failed")); });
    child.on("close", code => { clearTimeout(timer); if (failed || code !== 0) reject(Error("child operation failed")); else resolve(output.trim()); });
    child.stdin.on("error", () => { /* EPIPE is represented by child close. */ });
    child.stdin.end(options.input ?? "");
  });
}

async function request(pat: string, budget: GithubProvisionBudget, endpoint: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    method, redirect: "error", signal: AbortSignal.timeout(remaining(budget, 30_000)), cache: "no-store",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "station-provisioner", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const repoEndpoint = (ctx: GithubProvisionContext) => `/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type Settings = import("./settings").AppSettings;
function references(settings: Settings, ctx: GithubProvisionContext): boolean {
  return settings.githubStations.some(s =>
    same(s.workerId, ctx.workerId)
    || same(s.workerId, ctx.repo)
    || same(s.repo, ctx.workerId)
    || (same(s.owner, ctx.owner) && (same(s.repo, ctx.repo) || s.companionRepos.some(c => same(c.repo, ctx.repo)) || same(s.nurturePending?.repo ?? "", ctx.repo)))
  );
}
async function readFreshGithubSettings(deadlineAt: number): Promise<Settings> {
  // Do not use getAppSettings' display fallback: a malformed register must fail closed here.
  const { schema } = await import("../db/client");
  const { withDatabaseDeadline } = await import("../db/deadline");
  const { eq } = await import("drizzle-orm");
  const { parseGithubSettingsForMutation } = await import("./settings");
  const [row] = await withDatabaseDeadline(deadlineAt, database => database.select().from(schema.appSettings).where(eq(schema.appSettings.id, "global")).limit(1));
  return parseGithubSettingsForMutation(row?.value ?? {});
}
async function freshSettings(ctx: GithubProvisionContext): Promise<Settings> {
  return readFreshGithubSettings(ctx.deadlineAt);
}
async function assertWorkerFree(ctx: GithubProvisionContext): Promise<void> {
  const { schema } = await import("../db/client");
  const { withDatabaseDeadline } = await import("../db/deadline");
  const { inArray, sql } = await import("drizzle-orm");
  const wanted = [ctx.workerId.toLowerCase(), ctx.repo.toLowerCase()];
  const rows = await withDatabaseDeadline(ctx.deadlineAt, database => database.select({ id: schema.workers.id }).from(schema.workers).where(inArray(sql`lower(${schema.workers.id})`, wanted)).limit(1));
  if (rows.length) throw new GithubProvisionCollisionError("worker");
}

async function readKhoiloiNames(deadlineAt: number): Promise<string[]> {
  const { schema } = await import("../db/client");
  const { withDatabaseDeadline } = await import("../db/deadline");
  const settings = await readFreshGithubSettings(deadlineAt);
  const rows = await withDatabaseDeadline(deadlineAt, database => database.select({ id: schema.workers.id }).from(schema.workers));
  return [
    ...settings.githubStations.map(station => station.workerId),
    ...rows.map(row => row.id),
  ].filter(name => name.trim().length > 0);
}

function randomWorkerId(forbiddenNames: readonly string[], repo: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const forbidden = new Set([...forbiddenNames, repo].map(name => name.toLowerCase()));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = randomBytes(20);
    const value = Array.from(bytes, (byte, index) => {
      const source = index === 0 ? "abcdefghijklmnopqrstuvwxyz" : alphabet;
      return source[byte % source.length];
    }).join("");
    if (!forbidden.has(value.toLowerCase()) && !reviewProvisionWorkerId(value, repo)) return value;
  }
  throw new Error("Could not draw a distinct worker id");
}

async function productionLocalPreflight(ctx: GithubProvisionContext, sourceMode: GithubProvisionPayloadSourceMode): Promise<Prepared> {
    let encryptedPat: string;
    try {
      const { encryptSecret } = await import("../crypto/secretBox");
      encryptedPat = encryptSecret(ctx.pat);
    } catch (error) {
      rethrowSafe(error, "server_configuration_missing");
    }
    const workerToken = process.env.WORKER_TOKEN?.trim();
    if (!workerToken || !process.env.DATABASE_URL) throw new GithubProvisionSafeError("server_configuration_missing");
    const root = process.cwd();
    try { await run("git", ["--version"], { budget: ctx }); }
    catch (error) { rethrowSafe(error, "server_git_unavailable"); }
    try { await run("gh", ["--version"], { budget: ctx }); }
    catch (error) { rethrowSafe(error, "server_gh_unavailable"); }
    let directory: string;
    try { directory = await mkdtemp(path.join(await realpath(tmpdir()), "github-provision-")); }
    catch (error) { rethrowSafe(error, "payload_unavailable"); }
    try {
      await run(process.execPath, [path.join(root, "scripts", "githubProvisioningPayload.mjs")], {
        budget: ctx,
        input: JSON.stringify({ root, directory, workerId: ctx.workerId, workflowFile: ctx.workflowFile, sourceMode }),
        // The payload helper needs no credentials, only source bytes.
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: process.env.NODE_ENV },
      });
      return { directory, encryptedPat, workerToken };
    } catch (error) {
      try { await removeGithubProvisioningTemp(directory); } catch { /* Preserve the classified preparation failure. */ }
      rethrowSafe(error, "payload_unavailable");
    }
}

export const productionGithubProvisionDependencies: GithubProvisioningDependencies = {
  async generateRepoName(owner, budget, forbiddenNames) {
    const { generatePrimaryRepoName } = await import("./ollamaRepoNaming");
    return generatePrimaryRepoName(owner, budget, forbiddenNames);
  },
  async generateWorkerId(_owner, repo, _budget, forbiddenNames) {
    return randomWorkerId(forbiddenNames, repo);
  },
  async listKhoiloiNames(_owner, budget) {
    return readKhoiloiNames(budget.deadlineAt);
  },
  async whoami(pat, budget) {
    try {
      const response = await request(pat, budget, "/user");
      if (response.status !== 200) {
        const message = response.status === 401
          ? "GitHub từ chối PAT (HTTP 401). Token sai, hết hạn hoặc đã bị thu hồi."
          : `GitHub chưa xác minh được PAT (HTTP ${response.status}). Kiểm tra trạng thái GitHub rồi thử lại.`;
        throw new GithubProvisionSafeError("github_identity_unavailable", message);
      }
      const user = await response.json() as { login?: string };
      if (!user.login) throw new GithubProvisionSafeError("github_identity_unavailable");
      return { login: user.login, scopes: response.headers.get("x-oauth-scopes") };
    } catch (error) {
      rethrowSafe(error, "github_identity_unavailable");
    }
  },
  async checkScopes(scopes) {
    const granted = new Set(scopes?.split(",").map(value => value.trim()));
    const missing = ["repo", "workflow", "delete_repo"].filter(scope => !granted.has(scope));
    if (missing.length > 0) {
      throw new GithubProvisionSafeError(
        "github_scopes_missing",
        `Classic PAT còn thiếu scope: ${missing.join(", ")}. Bổ sung đúng scope rồi thử lại; chưa có repo nào được tạo.`,
      );
    }
  },
  async localPreflight(ctx) { return productionLocalPreflight(ctx, "filesystem"); },
  async checkSettings(ctx) { if (references(await freshSettings(ctx), ctx)) throw new GithubProvisionCollisionError("station"); },
  async checkWorker(ctx) { await assertWorkerFree(ctx); },
  async probe(ctx) { const response = await request(ctx.pat, ctx, repoEndpoint(ctx)); await response.body?.cancel(); return { status: response.status }; },
  async acquireLease(ctx) { const { acquireGithubProvisioningLease } = await import("./companionState"); return acquireGithubProvisioningLease(ctx.slug, ctx.workerId, ctx.deadlineAt); },
  async stage(ctx, prepared) {
    const git = (args: string[]) => run("git", args, { cwd: prepared.directory, budget: ctx });
    await git(["init", "--initial-branch=main"]);
    await git(["config", "user.name", "Project maintainer"]);
    await git(["config", "user.email", "maintainer@users.noreply.github.com"]);
    await git(["config", "core.autocrlf", "false"]);
    await git(["add", "--all"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-m", "Initialize project"]);
    const initialCommitSha = await git(["rev-parse", "HEAD"]);
    if (!/^[a-f0-9]{40}$/.test(initialCommitSha)) throw Error("invalid commit proof");
    return { initialCommitSha };
  },
  async create(ctx) {
    const response = await request(ctx.pat, ctx, "/user/repos", "POST", {
      name: ctx.repo,
      private: false,
      auto_init: false,
      description: publicIdentityForWorker(ctx.workerId).aboutDescription,
    });
    if (response.status !== 201) { await response.body?.cancel(); return { status: response.status }; }
    const info = await response.json() as { id?: number; full_name?: string };
    if (!info.full_name || !same(info.full_name, ctx.slug)) throw Error("create identity mismatch");
    return { status: response.status, githubId: info.id };
  },
  async push(ctx, prepared) {
    // Git's config-env carries authorization only through the child's environment, never argv or disk.
    await run("git", ["-c", "credential.helper=", "--config-env=http.https://github.com/.extraheader=JARVIS_GIT_AUTH", "push", `https://github.com/${ctx.slug}.git`, "HEAD:refs/heads/main"], {
      cwd: prepared.directory, timeout: 120_000, budget: ctx,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", JARVIS_GIT_AUTH: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${ctx.pat}`).toString("base64")}` },
    });
  },
  async setSecret(ctx, prepared) {
    await run("gh", ["secret", "set", "WORKER_TOKEN", "--repo", ctx.slug], { budget: ctx, input: prepared.workerToken, env: { ...process.env, GH_TOKEN: ctx.pat, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1" } });
  },
  async register(ctx, prepared, proof) {
    const { mutateGithubState } = await import("./companionState");
    await assertWorkerFree(ctx);
    await mutateGithubState(settings => {
      remaining(ctx);
      if (references(settings, ctx)) throw new GithubProvisionCollisionError("station");
      settings.githubStations.push({ owner: ctx.owner, repo: ctx.repo, workflowFile: ctx.workflowFile, workerId: ctx.workerId, pat: prepared.encryptedPat,
        enabled: true, companionRepos: [], companionCountOverride: null, dailyPushes: ctx.dailyPushes,
        lastPingAt: null, lastCommitAt: null, lastPingOk: null, lastPingNote: "", workflowState: "",
        provisionedBy: "jarvis", githubId: proof.githubId, initialCommitSha: proof.initialCommitSha });
    }, { deadlineAt: ctx.deadlineAt });
  },
  async cleanupSnapshot(ctx) {
    const referenced = references(await freshSettings(ctx), ctx);
    const response = await request(ctx.pat, ctx, repoEndpoint(ctx));
    if (response.status !== 200) throw Error("cleanup identity unavailable");
    const info = await response.json() as { id: number; default_branch?: string; full_name?: string };
    if (!info.full_name || !same(info.full_name, ctx.slug) || info.default_branch !== "main") throw Error("cleanup identity changed");
    const headResponse = await request(ctx.pat, ctx, `${repoEndpoint(ctx)}/commits?per_page=1&sha=main`);
    let head: string | null;
    if (headResponse.status === 409) {
      const body = await headResponse.json() as { message?: string };
      if (body.message !== "Git Repository is empty.") throw Error("unknown head");
      head = null;
    } else {
      if (headResponse.status !== 200) throw Error("unknown head");
      const commits = await headResponse.json() as { sha?: string }[];
      if (!commits[0]?.sha) throw Error("unknown head");
      head = commits[0].sha;
    }
    return { githubId: info.id, head, referenced };
  },
  async deleteRepo(ctx) { if (references(await freshSettings(ctx), ctx)) throw Error("repository newly referenced"); const response = await request(ctx.pat, ctx, repoEndpoint(ctx), "DELETE"); await response.body?.cancel(); if (response.status !== 204) throw Error("delete failed"); },
  async dispatch(ctx) { const response = await request(ctx.pat, ctx, `${repoEndpoint(ctx)}/actions/workflows/${encodeURIComponent(ctx.workflowFile)}/dispatches`, "POST", { ref: "main" }); await response.body?.cancel(); if (response.status !== 204) throw Error("dispatch failed"); },
  async ping(ctx) { const { pingStationBySlug } = await import("./githubStations"); if (!(await pingStationBySlug(ctx.slug, false, { deadlineAt: ctx.deadlineAt })).ok) throw Error("ping failed"); },
  async nurture(ctx) { const { runLlmCompanionNurture } = await import("./companionNurture"); remaining(ctx); const summary = await runLlmCompanionNurture({ stationSlug: ctx.slug, deadlineAt: ctx.deadlineAt }); if (summary.failed > 0) throw Error("nurture incomplete"); },
  async dispose(prepared) { await removeGithubProvisioningTemp(prepared.directory); },
  recordFailure: recordProductionFailure,
};

/** The CLI explicitly stages committed HEAD; deployed web releases use immutable filesystem bytes. */
export function githubProvisioningDependenciesForPayloadSource(sourceMode: GithubProvisionPayloadSourceMode): GithubProvisioningDependencies {
  return { ...productionGithubProvisionDependencies, localPreflight: ctx => productionLocalPreflight(ctx, sourceMode) };
}
