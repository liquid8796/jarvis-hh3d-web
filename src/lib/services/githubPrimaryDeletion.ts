import { eq } from "drizzle-orm";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { schema } from "@/lib/db/client";
import { withDatabaseDeadline } from "@/lib/db/deadline";
import { parseGithubSettingsForMutation, type AppSettings } from "./settings";
import { acquireGithubOwnerDeletionLease, mutateGithubState, type GithubSessionLease } from "./companionState";
import { githubPrimaryOwnerGroupFingerprint } from "@/lib/validation/githubPrimaryDeletion";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "jarvis-primary-removal";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BUDGET_MS = 120_000;
const MAX_BUDGET_MS = 240_000;
const MAX_BODY_BYTES = 16_384;

type GithubReply = { status: number; body: unknown; oauthScopes: string | null };
type DeletionLease = Pick<GithubSessionLease, "assertHeld" | "release">;

export type GithubPrimaryDeletionStage = "preflight" | "register" | "complete" | "attention";

export type GithubPrimaryDeletionResult = {
  ok: boolean;
  stage: GithubPrimaryDeletionStage;
  owner?: string;
  selectedSlug?: string;
  matched: number;
  deleted: number;
  alreadyAbsent: number;
  localOnly: boolean;
  message: string;
};

export type GithubPrimaryDeletionDependencies = {
  now?: () => number;
  deadlineAt?: number;
  read: (deadlineAt: number) => Promise<AppSettings>;
  mutate: (change: (settings: AppSettings) => void, deadlineAt: number) => Promise<void>;
  acquireLease: (owner: string, targets: readonly { slug: string; workerId: string }[], deadlineAt: number) => Promise<DeletionLease | null>;
  openPat: (stored: string) => string;
  request: (url: string, init: RequestInit) => Promise<Response>;
};

type PrimaryTarget = { owner: string; repo: string; slug: string; githubId?: number; workerId: string; verifiedDeletedGithubId?: number };
type Resolution = {
  owner: string;
  selectedSlug: string;
  targets: PrimaryTarget[];
  storedPats: string[];
  companionCount: number;
  fingerprint: string;
};

class SafeDeletionError extends Error {
  constructor(readonly stage: GithubPrimaryDeletionStage, message: string) {
    super(message);
  }
}

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

function targetFingerprint(targets: readonly PrimaryTarget[]): string {
  return targets
    .map((target) => `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}#${target.githubId ?? "?"}`)
    .sort()
    .join("\n");
}

/**
 * Resolve only primary rows from the authoritative register. Companion and pending names are
 * consulted solely as a collision guard; they can never become deletion targets.
 */
function resolveGroup(settings: AppSettings, selectedSlug: string): Resolution {
  const selected = settings.githubStations.filter((station) => same(`${station.owner}/${station.repo}`, selectedSlug));
  if (selected.length !== 1) {
    throw new SafeDeletionError("preflight", selected.length === 0
      ? `Không có kho「${selectedSlug}」trong sổ.`
      : `Sổ có nhiều dòng cùng định danh「${selectedSlug}」; chưa xóa gì.`);
  }

  const owner = selected[0].owner;
  const ownerStations = settings.githubStations.filter((station) => same(station.owner, owner));
  const targets: PrimaryTarget[] = ownerStations.map((station) => ({
    owner: station.owner,
    repo: station.repo,
    slug: `${station.owner}/${station.repo}`,
    githubId: station.githubId,
    workerId: station.workerId,
    verifiedDeletedGithubId: station.primaryDeleteVerifiedGithubId,
  }));
  const primaryNames = new Set(targets.map((target) => target.repo.toLowerCase()));
  if (primaryNames.size !== targets.length) {
    throw new SafeDeletionError("preflight", `Sổ tài khoản「${owner}」có tên repo chính bị trùng; chưa xóa gì.`);
  }

  const companionNames = ownerStations.flatMap((station) => [
    ...station.companionRepos.map((companion) => companion.repo),
    ...(station.nurturePending ? [station.nurturePending.repo] : []),
  ]);
  if (companionNames.some((repo) => primaryNames.has(repo.toLowerCase()))) {
    throw new SafeDeletionError(
      "preflight",
      `Sổ tài khoản「${owner}」đang dùng cùng một tên cho repo chính và repo phụ; chưa gửi yêu cầu xóa nào.`,
    );
  }

  return {
    owner,
    selectedSlug: `${selected[0].owner}/${selected[0].repo}`,
    targets,
    storedPats: ownerStations.map((station) => station.pat),
    companionCount: ownerStations.reduce((count, station) => count + station.companionRepos.length, 0),
    fingerprint: targetFingerprint(targets),
  };
}

function remaining(deadlineAt: number, now: () => number, cap = REQUEST_TIMEOUT_MS): number {
  const left = Math.min(cap, deadlineAt - now());
  if (left <= 0) throw new SafeDeletionError("attention", "Lượt xóa đã hết thời gian; sổ được giữ nguyên.");
  return Math.max(1, Math.floor(left));
}

async function boundedBody(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SafeDeletionError("preflight", "GitHub trả dữ liệu quá lớn; sổ được giữ nguyên.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

async function callGithub(
  deps: GithubPrimaryDeletionDependencies,
  pat: string | null,
  method: "GET" | "DELETE",
  path: string,
  deadlineAt: number,
  now: () => number,
): Promise<GithubReply> {
  const timeoutMs = remaining(deadlineAt, now);
  let response: Response;
  try {
    response = await deps.request(`${API_ROOT}${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": USER_AGENT,
        ...(pat ? { authorization: `Bearer ${pat}` } : {}),
      },
    });
  } catch {
    throw new SafeDeletionError("attention", "Không kết nối được GitHub; sổ và các repo được giữ nguyên.");
  }
  return { status: response.status, body: await boundedBody(response), oauthScopes: response.headers.get("x-oauth-scopes") };
}

function objectBody(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function explicitDisabledAccount(body: unknown): boolean {
  const message = objectBody(body)?.message;
  if (typeof message !== "string" || message.length > 1_000) return false;
  return /(?:account.{0,60}(?:suspended|disabled)|(?:suspended|disabled).{0,60}account)/i.test(message);
}

function unchangedGroup(settings: AppSettings, original: Resolution): Resolution {
  const fresh = resolveGroup(settings, original.selectedSlug);
  if (!same(fresh.owner, original.owner) || fresh.fingerprint !== original.fingerprint) {
    throw new SafeDeletionError("register", "Sổ GitHub đã thay đổi trong lúc xóa; chưa gỡ dòng nào khỏi sổ.");
  }
  return fresh;
}

async function productionRead(deadlineAt: number): Promise<AppSettings> {
  const rows = await withDatabaseDeadline(deadlineAt, (database) => database
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.id, "global"))
    .limit(1));
  return parseGithubSettingsForMutation(rows[0]?.value ?? {});
}

export const productionGithubPrimaryDeletionDependencies: GithubPrimaryDeletionDependencies = {
  read: productionRead,
  mutate: (change, deadlineAt) => mutateGithubState(change, { deadlineAt }),
  acquireLease: (owner, targets, deadlineAt) => acquireGithubOwnerDeletionLease(owner, targets, deadlineAt),
  openPat: (stored) => isEncrypted(stored) ? decryptSecret(stored) : stored,
  request: fetch,
};

/**
 * Delete every registered primary repository owned by the selected station's GitHub account.
 * The remote set is fully checked before the first DELETE, and the local registry is removed
 * only after every deletion is verified. Companion and pending repositories are never requested.
 */
export async function deletePrimaryGithubAccountGroup(
  selectedSlug: string,
  expectedGroup: string,
  deps: GithubPrimaryDeletionDependencies = productionGithubPrimaryDeletionDependencies,
): Promise<GithubPrimaryDeletionResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadlineAt = Math.min(deps.deadlineAt ?? startedAt + DEFAULT_BUDGET_MS, startedAt + MAX_BUDGET_MS);
  let stage: GithubPrimaryDeletionStage = "preflight";
  let resolution: Resolution | undefined;
  let lease: DeletionLease | null = null;
  let deleted = 0;
  let alreadyAbsent = 0;
  let localOnly = false;

  try {
    if (!selectedSlug.trim()) throw new SafeDeletionError("preflight", "Thiếu định danh kho GitHub cần xóa.");
    resolution = resolveGroup(await deps.read(deadlineAt), selectedSlug.trim());
    if (!expectedGroup || githubPrimaryOwnerGroupFingerprint(resolution.targets, resolution.owner) !== expectedGroup) {
      throw new SafeDeletionError("preflight", "Danh sách repo chính của tài khoản đã thay đổi. Tải lại trang và xác nhận lại; chưa xóa gì.");
    }
    lease = await deps.acquireLease(
      resolution.owner,
      resolution.targets.map((target) => ({ slug: target.slug, workerId: target.workerId })),
      deadlineAt,
    );
    if (!lease) throw new SafeDeletionError("preflight", `Tài khoản「${resolution.owner}」đang được một lượt khác xử lý; thử lại sau.`);
    await lease.assertHeld({ deadlineAt });
    const locked = unchangedGroup(await deps.read(deadlineAt), resolution);
    resolution = locked;

    const credentials: string[] = [];
    const seenCredentials = new Set<string>();
    for (const storedPat of locked.storedPats) {
      try {
        const pat = deps.openPat(storedPat).trim();
        if (pat && !seenCredentials.has(pat)) { seenCredentials.add(pat); credentials.push(pat); }
      } catch { /* A broken envelope must not prevent trying another PAT for the same owner. */ }
    }

    const ownerPats: Array<{ pat: string; fullRepoRead: boolean }> = [];
    let credentialUnavailable = false;
    let ambiguousCredential = false;
    for (const pat of credentials) {
      let identity: GithubReply;
      try {
        identity = await callGithub(deps, pat, "GET", "/user", deadlineAt, now);
      } catch {
        ambiguousCredential = true;
        continue;
      }
      const login = objectBody(identity.body)?.login;
      if (identity.status === 200 && typeof login === "string" && same(login, locked.owner)) {
        const scopes = new Set(identity.oauthScopes?.split(",").map((scope) => scope.trim().toLowerCase()).filter(Boolean) ?? []);
        ownerPats.push({ pat, fullRepoRead: scopes.has("repo") });
      } else if (identity.status === 451 || (identity.status === 403 && explicitDisabledAccount(identity.body))) {
        credentialUnavailable = true;
      } else if (identity.status !== 401 && !(identity.status === 200 && typeof login === "string")) {
        ambiguousCredential = true;
      }
    }

    if (ownerPats.length === 0) {
      if (ambiguousCredential) {
        throw new SafeDeletionError(
          "preflight",
          `GitHub trả trạng thái chưa rõ cho PAT của「${locked.owner}」; sổ và các repo được giữ nguyên.`,
        );
      } else if (credentialUnavailable) {
        localOnly = true;
      } else {
        const publicAccount = await callGithub(deps, null, "GET", `/users/${encodeURIComponent(locked.owner)}`, deadlineAt, now);
        if (publicAccount.status === 404 || publicAccount.status === 451 || (publicAccount.status === 403 && explicitDisabledAccount(publicAccount.body))) {
          localOnly = true;
        } else {
          throw new SafeDeletionError(
            "preflight",
            `Không xác minh được quyền truy cập tài khoản GitHub「${locked.owner}」; sổ và các repo được giữ nguyên.`,
          );
        }
      }
    }

    const existing: Array<{ target: PrimaryTarget; observedGithubId: number; pats: Array<{ pat: string; isPrivate: boolean }> }> = [];
    if (ownerPats.length > 0) {
      for (const target of locked.targets) {
        const targetPats: Array<{ pat: string; isPrivate: boolean }> = [];
        let observedGithubId: number | undefined;
        let targetAmbiguous = false;
        for (const credential of ownerPats) {
          const { pat } = credential;
          let probe: GithubReply;
          try {
            probe = await callGithub(deps, pat, "GET", repoPath(target.owner, target.repo), deadlineAt, now);
          } catch {
            targetAmbiguous = true;
            continue;
          }
          if (probe.status === 404 || probe.status === 451) continue;
          if (probe.status !== 200) {
            targetAmbiguous = true;
            continue;
          }
          const info = objectBody(probe.body);
          const fullName = info?.full_name;
          const githubId = info?.id;
          const isPrivate = info?.private;
          const expectedGithubId = target.githubId ?? target.verifiedDeletedGithubId;
          if (typeof fullName !== "string" || !same(fullName, target.slug)
            || !Number.isSafeInteger(githubId) || Number(githubId) <= 0
            || typeof isPrivate !== "boolean"
            || (expectedGithubId !== undefined && githubId !== expectedGithubId)) {
            throw new SafeDeletionError("preflight", `Không xác minh được định danh repo chính「${target.slug}」; chưa gửi yêu cầu xóa nào.`);
          }
          if (targetPats.some((candidate) => candidate.isPrivate !== isPrivate)) {
            throw new SafeDeletionError("preflight", `GitHub trả trạng thái hiển thị không nhất quán cho repo「${target.slug}」; chưa xóa repo nào.`);
          }
          if (observedGithubId !== undefined && observedGithubId !== githubId) {
            throw new SafeDeletionError("preflight", `GitHub trả ID không nhất quán cho repo「${target.slug}」; chưa xóa repo nào.`);
          }
          observedGithubId = Number(githubId);
          targetPats.push({ pat, isPrivate });
        }
        if (targetPats.length) {
          existing.push({ target, observedGithubId: observedGithubId!, pats: targetPats });
          continue;
        }
        if (targetAmbiguous) {
          throw new SafeDeletionError("preflight", `GitHub trả trạng thái chưa rõ khi đọc repo chính「${target.slug}」; chưa xóa repo nào.`);
        }
        const publicProbe = await callGithub(deps, null, "GET", repoPath(target.owner, target.repo), deadlineAt, now);
        const checkpointMatches = target.verifiedDeletedGithubId !== undefined
          && (target.githubId === undefined || target.verifiedDeletedGithubId === target.githubId);
        if ((publicProbe.status === 404 || publicProbe.status === 451)
          && (checkpointMatches || ownerPats.some((credential) => credential.fullRepoRead))) {
          alreadyAbsent += 1;
          continue;
        }
        throw new SafeDeletionError(
          "preflight",
          publicProbe.status === 200
            ? `Repo chính「${target.slug}」vẫn tồn tại nhưng các PAT hiện tại không quản lý được; chưa xóa repo nào.`
            : `Không xác minh được trạng thái repo chính「${target.slug}」; chưa xóa repo nào.`,
        );
      }

      stage = "attention";
      for (const item of existing) {
        const { target, observedGithubId, pats } = item;
        let completed = false;
        let sawNotFound = false;
        let verifiedGone = false;
        for (const candidate of pats) {
          const { pat, isPrivate } = candidate;
          await lease.assertHeld({ deadlineAt });
          const removed = await callGithub(deps, pat, "DELETE", repoPath(target.owner, target.repo), deadlineAt, now);
          if (removed.status !== 204 && removed.status !== 403 && removed.status !== 404 && removed.status !== 451) {
            throw new SafeDeletionError("attention", `Không xóa được repo chính「${target.slug}」; sổ được giữ nguyên để có thể thử lại.`);
          }
          if (removed.status === 451 || (removed.status === 403 && explicitDisabledAccount(removed.body))) {
            localOnly = true;
            completed = true;
            break;
          }
          const verified = await callGithub(deps, isPrivate ? pat : null, "GET", repoPath(target.owner, target.repo), deadlineAt, now);
          if (verified.status === 404 || verified.status === 451) {
            if (removed.status === 204) {
              deleted += 1;
              completed = true;
              verifiedGone = true;
              break;
            }
            if (removed.status === 404 && !isPrivate) sawNotFound = true;
            continue;
          }
          if (verified.status !== 200) {
            throw new SafeDeletionError("attention", `GitHub chưa xác nhận trạng thái repo「${target.slug}」; sổ được giữ nguyên.`);
          }
          // A readable repo after 403/404 means this PAT cannot delete it; try another saved PAT.
          if (removed.status === 204) {
            throw new SafeDeletionError("attention", `GitHub chưa xác nhận repo「${target.slug}」đã biến mất; sổ được giữ nguyên.`);
          }
        }
        if (!completed && sawNotFound) {
          alreadyAbsent += 1;
          completed = true;
          verifiedGone = true;
        }
        if (!completed) {
          throw new SafeDeletionError("attention", `Không PAT nào hiện có xóa được repo chính「${target.slug}」; sổ được giữ nguyên để thử lại.`);
        }
        if (verifiedGone) {
          await deps.mutate((settings) => {
            const fresh = unchangedGroup(settings, locked);
            const row = fresh.targets.find((candidate) => same(candidate.slug, target.slug));
            const station = settings.githubStations.find((candidate) => same(`${candidate.owner}/${candidate.repo}`, target.slug));
            if (!row || !station || (station.githubId !== undefined && station.githubId !== observedGithubId)) {
              throw new SafeDeletionError("register", "Định danh repo thay đổi khi lưu tiến độ xóa; sổ được giữ nguyên.");
            }
            station.primaryDeleteVerifiedGithubId = observedGithubId;
            station.primaryDeleteVerifiedAt = new Date(now()).toISOString();
          }, deadlineAt);
        }
        if (localOnly) break;
      }
    }

    stage = "register";
    await lease.assertHeld({ deadlineAt });
    await deps.mutate((settings) => {
      const fresh = unchangedGroup(settings, locked);
      settings.githubStations = settings.githubStations.filter((station) => !same(station.owner, fresh.owner));
    }, deadlineAt);

    stage = "complete";
    const companionNote = `${locked.companionCount} repo phụ không nhận yêu cầu xóa.`;
    return {
      ok: true,
      stage,
      owner: locked.owner,
      selectedSlug: locked.selectedSlug,
      matched: locked.targets.length,
      deleted,
      alreadyAbsent,
      localOnly,
      message: localOnly
        ? `Tài khoản GitHub「${locked.owner}」không còn truy cập được; đã gỡ ${locked.targets.length} kho chính cùng owner khỏi sổ. ${companionNote}`
        : `Đã xóa ${deleted} repo chính của「${locked.owner}」và gỡ ${locked.targets.length} kho cùng owner khỏi sổ${alreadyAbsent ? `; ${alreadyAbsent} repo đã không còn hoặc bị GitHub chặn` : ""}. ${companionNote}`,
    };
  } catch (error) {
    const safe = error instanceof SafeDeletionError ? error : new SafeDeletionError(
      stage,
      stage === "attention"
        ? "Lượt xóa không hoàn tất; sổ được giữ nguyên để thử lại an toàn."
        : "Không hoàn tất được lượt xóa repo chính; sổ và các repo phụ được giữ nguyên.",
    );
    const progress = deleted || alreadyAbsent
      ? ` Trước khi dừng, đã xác nhận ${deleted} repo bị xóa và ${alreadyAbsent} repo đã vắng; các dòng sổ vẫn được giữ để chạy lại.`
      : "";
    return {
      ok: false,
      stage: safe.stage,
      ...(resolution ? { owner: resolution.owner, selectedSlug: resolution.selectedSlug, matched: resolution.targets.length } : { matched: 0 }),
      deleted,
      alreadyAbsent,
      localOnly,
      message: safe.message + progress,
    };
  } finally {
    if (lease) {
      try { await lease.release(); } catch { /* Session close was requested; no registry mutation follows. */ }
    }
  }
}
