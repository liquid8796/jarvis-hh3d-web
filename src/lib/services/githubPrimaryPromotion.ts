import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { reviewProvisionWorkerId } from "@/lib/validation/githubProvisioning";
import { stationSlug } from "@/lib/validation/githubStations";
import { CompanionGithub, type RepoInfo } from "./companionGithub";
import {
  acquireGithubPrimaryPromotionLease,
  mutateGithubState,
  type GithubSessionLease,
} from "./companionState";
import { getAppSettings, type AppSettings } from "./settings";

const DEFAULT_BUDGET_MS = 180_000;
const MAX_BUDGET_MS = 240_000;
const PROMOTION_COMMIT_MESSAGE = "feat(khoiloi): promote repository to primary";

type Station = AppSettings["githubStations"][number];
type Companion = Station["companionRepos"][number];
type PrimarySource = NonNullable<Station["primarySource"]>;
type PromotionLease = Pick<GithubSessionLease, "assertHeld" | "release">;
type PreparedPayload = {
  files: ReadonlyMap<string, Buffer>;
  workerToken: string;
  dispose: () => Promise<void>;
};

export type GithubPrimaryPromotionResult = {
  ok: boolean;
  message: string;
  oldSlug: string;
  newSlug?: string;
  warnings: string[];
};

export type GithubPrimaryPromotionRemote = {
  info(owner: string, repo: string): Promise<RepoInfo | null>;
  actionsEnabled(owner: string, repo: string): Promise<boolean>;
  disableActions(owner: string, repo: string): Promise<void>;
  enableActions(owner: string, repo: string): Promise<void>;
  installPayload(owner: string, repo: string, payload: ReadonlyMap<string, Buffer>): Promise<{ sha: string }>;
  setWorkerSecret(owner: string, repo: string, workerToken: string): Promise<void>;
  dispatch(owner: string, repo: string, workflowFile: string): Promise<void>;
};

export type GithubPrimaryPromotionDependencies = {
  now?: () => number;
  read: () => Promise<AppSettings>;
  mutate: (change: (settings: AppSettings) => void, deadlineAt: number) => Promise<void>;
  acquireLease: (owner: string, oldSlug: string, newSlug: string, workerId: string, deadlineAt: number) => Promise<PromotionLease | null>;
  openPat: (stored: string) => string;
  preparePayload: (station: Station, deadlineAt: number) => Promise<PreparedPayload>;
  remote: (pat: string, deadlineAt: number) => GithubPrimaryPromotionRemote;
};

type ResolvedPromotion = {
  station: Station;
  companion: Companion;
  oldSlug: string;
  newSlug: string;
};

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;


function primarySourceFromCompanion(
  companion: Companion,
  promotedAt: string,
  promotedFrom: string,
): PrimarySource {
  return {
    lastNurtureDay: companion.lastNurtureDay,
    pushesToday: companion.pushesToday,
    lastPushAt: companion.lastPushAt,
    lastPushOk: companion.lastPushOk,
    lastPushNote: "Đã promote thành repo chính; source dự án cũ được giữ nguyên và tiếp tục được nuôi.",
    managedBy: companion.managedBy,
    createdAt: companion.createdAt,
    nextDecisionAt: null,
    lastCommitSha: companion.lastCommitSha,
    topic: companion.topic,
    language: companion.language,
    sourcePaths: companion.sourcePaths,
    forkedFrom: companion.forkedFrom,
    promotedAt,
    promotedFrom,
  };
}

function demotedPrimaryCompanion(
  station: Station,
  oldInfo: RepoInfo,
  promotionTarget: string,
): Companion {
  const retained = station.primarySource;
  return {
    repo: station.repo,
    lastNurtureDay: retained?.lastNurtureDay ?? null,
    pushesToday: retained?.pushesToday ?? 0,
    lastPushAt: retained?.lastPushAt ?? null,
    lastPushOk: retained?.lastPushOk ?? null,
    lastPushNote: retained?.lastPushNote || `Được hạ từ repo chính khi promote ${promotionTarget}.`,
    managedBy: retained?.managedBy,
    githubId: oldInfo.id,
    createdAt: retained?.createdAt ?? oldInfo.created_at,
    nextDecisionAt: retained?.nextDecisionAt ?? null,
    lastCommitSha: retained?.lastCommitSha,
    topic: retained?.topic,
    language: retained?.language,
    sourcePaths: retained?.sourcePaths,
    forkedFrom: retained?.forkedFrom,
    actionsDisabled: true,
  };
}

export function planGithubPromotionHistory(
  defaultHead: string | null,
  mainHead: string | null,
): { baseHead: string | null; parents: string[] } {
  const baseHead = mainHead ?? defaultHead;
  const parents = [...new Set([mainHead, defaultHead].filter((value): value is string => !!value))];
  return { baseHead, parents };
}

function remaining(deadlineAt: number, cap = Number.MAX_SAFE_INTEGER): number {
  const left = Math.min(cap, deadlineAt - Date.now());
  if (left <= 0) throw new Error("Promotion deadline reached");
  return left;
}

function resolvePromotion(settings: AppSettings, slug: string, repo: string): ResolvedPromotion {
  const station = settings.githubStations.find((entry) => same(stationSlug(entry), slug));
  if (!station) throw new Error("station-missing");
  const companion = station.companionRepos.find((entry) => same(entry.repo, repo));
  if (!companion) throw new Error("companion-missing");
  if (companion.pendingDelete) throw new Error("companion-pending-delete");
  const workerComplaint = reviewProvisionWorkerId(station.workerId, companion.repo);
  if (workerComplaint) throw new Error("identity-conflict");
  const owner = station.owner;
  const newSlug = `${owner}/${companion.repo}`;
  if (settings.githubStations.some((entry) =>
    !same(stationSlug(entry), slug)
    && same(entry.owner, owner)
    && (same(entry.repo, companion.repo) || entry.companionRepos.some((item) => same(item.repo, companion.repo)))
  )) throw new Error("repo-registered-elsewhere");
  return { station, companion, oldSlug: stationSlug(station), newSlug };
}

async function runChild(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; deadlineAt: number; timeout?: number },
): Promise<void> {
  const timeout = remaining(options.deadlineAt, options.timeout ?? 60_000);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(new Error("child-timeout"));
    }, timeout);
    child.once("error", () => done(new Error("child-failed")));
    child.once("close", (code) => done(code === 0 ? undefined : new Error("child-failed")));
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

async function collectFiles(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (directory: string, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.set(relative.replaceAll("\\", "/"), await readFile(absolute));
      else throw new Error("payload-entry-invalid");
    }
  };
  await visit(root);
  return files;
}

async function prepareProductionPayload(station: Station, deadlineAt: number): Promise<PreparedPayload> {
  const workerToken = process.env.WORKER_TOKEN?.trim();
  if (!workerToken) throw new Error("worker-token-missing");
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "github-promotion-"));
  try {
    await runChild(process.execPath, [path.join(process.cwd(), "scripts", "githubProvisioningPayload.mjs")], {
      deadlineAt,
      input: JSON.stringify({
        root: process.cwd(),
        directory,
        workerId: station.workerId,
        workflowFile: station.workflowFile,
        sourceMode: "filesystem",
      }),
    });
    const files = await collectFiles(directory);
    const workflowPath = ".github/workflows/" + station.workflowFile;
    if (files.size !== 1 || !files.has(workflowPath)) {
      throw new Error("promotion-payload-must-be-workflow-only");
    }
    return {
      files,
      workerToken,
      dispose: async () => { await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function setProductionWorkerSecret(
  pat: string,
  owner: string,
  repo: string,
  workerToken: string,
  deadlineAt: number,
): Promise<void> {
  await runChild("gh", ["secret", "set", "WORKER_TOKEN", "--repo", `${owner}/${repo}`], {
    deadlineAt,
    input: workerToken,
    env: { ...process.env, GH_TOKEN: pat, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1" },
  });
}

class ProductionPromotionRemote implements GithubPrimaryPromotionRemote {
  private client: CompanionGithub;

  constructor(private pat: string, private deadlineAt: number) {
    this.client = new CompanionGithub(pat, deadlineAt);
  }

  info(owner: string, repo: string) {
    return this.client.info(owner, repo);
  }

  async actionsEnabled(owner: string, repo: string): Promise<boolean> {
    const body = await this.client.call<{ enabled?: unknown }>("GET", `${repoPath(owner, repo)}/actions/permissions`);
    if (typeof body?.enabled !== "boolean") throw new Error("actions-state-invalid");
    return body.enabled;
  }

  disableActions(owner: string, repo: string) {
    return this.client.disableActions(owner, repo);
  }

  async enableActions(owner: string, repo: string): Promise<void> {
    await this.client.call("PUT", `${repoPath(owner, repo)}/actions/permissions`, { enabled: true }, [204]);
  }

  async installPayload(owner: string, repo: string, payload: ReadonlyMap<string, Buffer>): Promise<{ sha: string }> {
    const base = repoPath(owner, repo);
    const info = await this.client.info(owner, repo);
    if (!info) throw new Error("target-missing");

    const readHead = async (branch: string): Promise<string | null> => {
      const ref = await this.client.call<{ object?: { sha?: unknown } } | null>(
        "GET",
        `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
        undefined,
        [200, 404, 409],
      );
      return typeof ref?.object?.sha === "string" ? ref.object.sha : null;
    };

    const defaultHead = await readHead(info.default_branch || "main");
    const mainHead = same(info.default_branch || "", "main") ? defaultHead : await readHead("main");
    // If main already exists, preserve its working tree. The old default branch stays in history
    // as a second parent; using it as base_tree would silently discard files unique to existing main.
    const { baseHead, parents } = planGithubPromotionHistory(defaultHead, mainHead);
    let baseTree: string | null = null;
    if (baseHead) {
      const commit = await this.client.call<{ tree?: { sha?: unknown } }>("GET", `${base}/git/commits/${encodeURIComponent(baseHead)}`);
      if (typeof commit?.tree?.sha !== "string") throw new Error("base-tree-missing");
      baseTree = commit.tree.sha;
    }

    const entries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (const [filePath, bytes] of payload) {
      const blob = await this.client.call<{ sha?: unknown }>("POST", `${base}/git/blobs`, {
        content: bytes.toString("base64"),
        encoding: "base64",
      });
      if (typeof blob?.sha !== "string") throw new Error("blob-sha-missing");
      entries.push({ path: filePath, mode: "100644", type: "blob", sha: blob.sha });
    }

    const tree = await this.client.call<{ sha?: unknown }>("POST", `${base}/git/trees`, {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: entries,
    });
    if (typeof tree?.sha !== "string") throw new Error("tree-sha-missing");

    // main is the branch we move, so its previous head stays first; a different default branch
    // is the merge parent that preserves the companion's pre-promotion history.
    const commit = await this.client.call<{ sha?: unknown }>("POST", `${base}/git/commits`, {
      message: PROMOTION_COMMIT_MESSAGE,
      tree: tree.sha,
      parents,
    });
    if (typeof commit?.sha !== "string") throw new Error("commit-sha-missing");

    if (mainHead) {
      await this.client.call("PATCH", `${base}/git/refs/heads/main`, { sha: commit.sha, force: false });
    } else {
      await this.client.call("POST", `${base}/git/refs`, { ref: "refs/heads/main", sha: commit.sha });
    }
    await this.client.call("PATCH", base, { default_branch: "main" });

    const verifiedRef = await this.client.call<{ object?: { sha?: unknown } }>("GET", `${base}/git/ref/heads/main`);
    const verifiedInfo = await this.client.info(owner, repo);
    if (verifiedRef?.object?.sha !== commit.sha || !verifiedInfo || !same(verifiedInfo.default_branch, "main")) {
      throw new Error("promotion-commit-not-verified");
    }
    return { sha: commit.sha };
  }

  setWorkerSecret(owner: string, repo: string, workerToken: string) {
    return setProductionWorkerSecret(this.pat, owner, repo, workerToken, this.deadlineAt);
  }

  async dispatch(owner: string, repo: string, workflowFile: string): Promise<void> {
    await this.client.call(
      "POST",
      `${repoPath(owner, repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
      { ref: "main" },
      [204],
    );
  }
}

export const productionGithubPrimaryPromotionDependencies: GithubPrimaryPromotionDependencies = {
  read: getAppSettings,
  mutate: (change, deadlineAt) => mutateGithubState(change, { deadlineAt }),
  acquireLease: acquireGithubPrimaryPromotionLease,
  openPat: (stored) => isEncrypted(stored) ? decryptSecret(stored) : stored,
  preparePayload: prepareProductionPayload,
  remote: (pat, deadlineAt) => new ProductionPromotionRemote(pat, deadlineAt),
};

export async function promoteGithubCompanionToPrimary(
  slug: string,
  repo: string,
  deps: GithubPrimaryPromotionDependencies = productionGithubPrimaryPromotionDependencies,
): Promise<GithubPrimaryPromotionResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadlineAt = Math.min(startedAt + DEFAULT_BUDGET_MS, startedAt + MAX_BUDGET_MS);
  const warnings: string[] = [];
  let lease: PromotionLease | null = null;
  let prepared: PreparedPayload | null = null;
  let resolved: ResolvedPromotion | null = null;
  let targetActionsWereEnabled = false;
  let targetPaused = false;
  let oldActionsWereEnabled = false;
  let oldPaused = false;
  let targetEnabledForCutover = false;
  let registered = false;

  try {
    resolved = resolvePromotion(await deps.read(), slug, repo);
    lease = await deps.acquireLease(
      resolved.station.owner,
      resolved.oldSlug,
      resolved.newSlug,
      resolved.station.workerId,
      deadlineAt,
    );
    if (!lease) throw new Error("promotion-busy");
    await lease.assertHeld({ deadlineAt });

    resolved = resolvePromotion(await deps.read(), resolved.oldSlug, resolved.companion.repo);
    const { station, companion, oldSlug, newSlug } = resolved;
    const owner = station.owner;
    const pat = deps.openPat(station.pat);
    const remote = deps.remote(pat, deadlineAt);

    const targetInfo = await remote.info(owner, companion.repo);
    if (!targetInfo) throw new Error("target-missing");
    if (companion.githubId && companion.githubId !== targetInfo.id) throw new Error("target-id-changed");

    let oldInfo: RepoInfo | null = null;
    if (!station.primaryDeferred) {
      oldInfo = await remote.info(owner, station.repo);
      if (!oldInfo) throw new Error("old-primary-missing");
      if (station.githubId && station.githubId !== oldInfo.id) throw new Error("old-primary-id-changed");
    }

    targetActionsWereEnabled = await remote.actionsEnabled(owner, companion.repo);
    if (targetActionsWereEnabled) {
      await remote.disableActions(owner, companion.repo);
      targetPaused = true;
    }

    prepared = await deps.preparePayload(station, deadlineAt);
    await lease.assertHeld({ deadlineAt });
    const installed = await remote.installPayload(owner, companion.repo, prepared.files);
    await remote.setWorkerSecret(owner, companion.repo, prepared.workerToken);

    if (oldInfo) {
      oldActionsWereEnabled = await remote.actionsEnabled(owner, station.repo);
      if (oldActionsWereEnabled) {
        await remote.disableActions(owner, station.repo);
        oldPaused = true;
      }
    }

    await lease.assertHeld({ deadlineAt });
    await remote.enableActions(owner, companion.repo);
    targetEnabledForCutover = true;
    targetPaused = false;

    const promotedAt = new Date(now()).toISOString();
    await deps.mutate((settings) => {
      const fresh = resolvePromotion(settings, oldSlug, companion.repo);
      if (!same(fresh.station.workerId, station.workerId) || fresh.station.primaryDeferred !== station.primaryDeferred) {
        throw new Error("station-changed");
      }
      const freshTarget = fresh.station.companionRepos.find((entry) => same(entry.repo, companion.repo));
      if (!freshTarget || (freshTarget.githubId && freshTarget.githubId !== targetInfo.id)) throw new Error("target-changed");

      const nextCompanions = fresh.station.companionRepos.filter((entry) => !same(entry.repo, companion.repo));
      if (oldInfo) nextCompanions.push(demotedPrimaryCompanion(fresh.station, oldInfo, companion.repo));

      fresh.station.primarySource = primarySourceFromCompanion(
        freshTarget,
        promotedAt,
        owner + "/" + freshTarget.repo,
      );
      fresh.station.repo = companion.repo;
      fresh.station.primaryDeferred = false;
      fresh.station.provisionedBy = "jarvis";
      fresh.station.githubId = targetInfo.id;
      fresh.station.initialCommitSha = installed.sha;
      delete fresh.station.primaryDeleteVerifiedGithubId;
      delete fresh.station.primaryDeleteVerifiedAt;
      fresh.station.companionRepos = nextCompanions;
      fresh.station.lastPingAt = null;
      fresh.station.lastCommitAt = promotedAt;
      fresh.station.lastPingOk = null;
      fresh.station.lastPingNote =
        `Vừa promote từ kho phụ; source dự án cũ được giữ nguyên, chỉ workflow khôi lỗi được thêm hoặc cập nhật. ` +
        (oldInfo ? `Repo chính cũ ${station.repo} đã thành repo phụ.` : "Station trước đó tạm hoãn nên không có repo cũ để hạ.");
      fresh.station.workflowState = "";
      fresh.station.nurtureNextAt = null;
      fresh.station.nurtureLastNote = oldInfo
        ? `Đã promote ${companion.repo} làm repo chính và chuyển ${station.repo} thành repo phụ.`
        : `Đã promote ${companion.repo} làm repo chính; station trước đó chưa có repo chính thật.`;
    }, deadlineAt);
    registered = true;

    try {
      await remote.dispatch(owner, companion.repo, station.workflowFile);
    } catch {
      warnings.push("Đã đổi vai trò repo nhưng chưa phát được lượt workflow đầu tiên; lịch Actions vẫn đã bật và có thể chạy ở lượt kế tiếp.");
    }

    return {
      ok: true,
      oldSlug,
      newSlug,
      warnings,
      message: oldInfo
        ? `Đã promote ${owner}/${companion.repo} thành repo chính; ${owner}/${station.repo} đã thành repo phụ và Actions đã tắt.`
        : `Đã promote ${owner}/${companion.repo} thành repo chính. Station trước đó chưa có repo chính thật nên không có repo cũ để hạ xuống.`,
    };
  } catch {
    if (!registered && resolved) {
      const remote = (() => {
        try { return deps.remote(deps.openPat(resolved!.station.pat), deadlineAt); } catch { return null; }
      })();
      if (remote) {
        if (targetEnabledForCutover || targetPaused) {
          try {
            await remote.disableActions(resolved.station.owner, resolved.companion.repo);
            targetPaused = true;
          } catch {
            warnings.push("Không xác nhận được repo được chọn đã dừng Actions sau lỗi; cần kiểm tra GitHub trước khi thử lại.");
          }
        }
        if (oldPaused && oldActionsWereEnabled) {
          try { await remote.enableActions(resolved.station.owner, resolved.station.repo); }
          catch { warnings.push("Không bật lại được Actions của repo chính cũ sau lỗi; cần bật tay trước khi thử lại."); }
        }
      }
    }
    return {
      ok: false,
      oldSlug: resolved?.oldSlug ?? slug,
      warnings,
      message: warnings.length
        ? "Không hoàn tất được việc promote repo. Hệ thống đã ưu tiên chặn hai repo chạy khôi lỗi cùng lúc; kiểm tra cảnh báo rồi thử lại."
        : "Không promote được repo phụ. Kiểm tra repo còn tồn tại đúng GitHub ID, PAT có quyền repo/workflow, WORKER_TOKEN và không có vòng nuôi khác đang xử lý station rồi thử lại.",
    };
  } finally {
    if (prepared) await prepared.dispose().catch(() => {});
    if (lease) await lease.release().catch(() => {});
  }
}
