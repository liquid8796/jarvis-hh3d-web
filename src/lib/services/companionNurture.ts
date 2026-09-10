import { randomUUID } from "node:crypto";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { effectiveCompanionCount } from "@/lib/validation/githubNurture";
import { nurtureDayKey, stationSlug } from "@/lib/validation/githubStations";
import { inferCompanionLanguages } from "@/lib/validation/companionLanguages";
import { stripCompanionMarker } from "@/lib/validation/companionMetadata";
import { getAppSettings, type AppSettings } from "./settings";
import { mutateGithubState, withCompanionLease } from "./companionState";
import { CompanionGithub, assertCompanionTarget, type RepoInfo, type RepoSnapshot } from "./companionGithub";
import { planCompanion, type CompanionDecision } from "./ollamaCompanion";
import type { CompanionNurtureResult, CompanionNurtureSummary } from "./githubStations";

type Station = AppSettings["githubStations"][number];
type Companion = Station["companionRepos"][number];
type Options = { deadlineAt?: number; stationSlug?: string };
type Dependencies = {
  read: typeof getAppSettings;
  mutate: typeof mutateGithubState;
  lease: typeof withCompanionLease;
  plan: typeof planCompanion;
  github: (pat: string, deadline: number) => CompanionGithub;
};
const defaults: Dependencies = { read: getAppSettings, mutate: mutateGithubState, lease: withCompanionLease, plan: planCompanion, github: (pat, deadline) => new CompanionGithub(pat, deadline) };
const due = (iso?: string | null) => !iso || !Number.isFinite(Date.parse(iso)) || Date.parse(iso) <= Date.now();
const later = (minutes: number) => new Date(Date.now() + Math.max(5, Math.min(10080, minutes)) * 60_000).toISOString();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const findStation = (settings: AppSettings, slug: string) => settings.githubStations.find((s) => same(stationSlug(s), slug));
const patOf = (station: Station) => {
  if (!isEncrypted(station.pat)) throw new Error("PAT GitHub chưa được mã hóa hợp lệ.");
  try { return decryptSecret(station.pat); } catch { throw new Error("Không mở được PAT GitHub; kiểm tra cấu hình mã hóa."); }
};
function entryOf(info: RepoInfo, decision?: CompanionDecision): Companion {
  return { repo: info.full_name.split("/")[1], githubId: info.id, managedBy: "ollama", createdAt: new Date().toISOString(), nextDecisionAt: decision?.action === "fork" ? later(decision.nextCheckMinutes) : null, topic: stripCompanionMarker(decision?.description ?? info.description ?? ""), forkedFrom: info.parent?.full_name,
    language: decision?.action === "fork" ? info.language || undefined : decision?.language || info.language || inferCompanionLanguages(decision?.files ?? [])[0], sourcePaths: decision?.action === "fork" ? undefined : decision?.sourcePaths,
    lastNurtureDay: null, pushesToday: 0, lastPushAt: null, lastPushOk: null, lastPushNote: "Đã tạo kho; đang chuẩn bị source." };
}
function resultOf(station: Station, repo: string, note: string, ok = true, pushed = 0): CompanionNurtureResult {
  const day = nurtureDayKey(new Date());
  const companion = station.companionRepos.find((c) => same(c.repo, repo));
  return { stationSlug: stationSlug(station), repo, slug: `${station.owner}/${repo}`, day, target: station.dailyPushes, dueNow: 0,
    ordinal: (companion?.lastNurtureDay === day ? companion.pushesToday : 0) + pushed, pushed, ok, note: note.slice(0, 500), worthRecording: true };
}

/** Dependencies make destructive/lifecycle behavior testable without credentials or a database. */
export function createCompanionEngine(deps: Dependencies = defaults) {
  const patchStation = async (slug: string, change: (station: Station, all: AppSettings) => void) => deps.mutate((all) => {
    const station = findStation(all, slug);
    if (!station) throw new Error("Kho GitHub đã được gỡ khỏi sổ.");
    change(station, all);
  });

  async function persistKeyHealth(config: AppSettings["githubNurture"], before: AppSettings["githubNurture"]["apiKeys"]) {
    await deps.mutate((all) => {
      for (const observed of config.apiKeys) {
        const previous = before.find((key) => key.id === observed.id);
        if (previous && previous.lastUsedAt === observed.lastUsedAt && previous.lastError === observed.lastError && previous.cooldownUntil === observed.cooldownUntil && previous.disabled === observed.disabled) continue;
        const fresh = all.githubNurture.apiKeys.find((k) => k.id === observed.id && k.secret === observed.secret);
        if (!fresh || (fresh.lastUsedAt && (!observed.lastUsedAt || fresh.lastUsedAt > observed.lastUsedAt))) continue;
        fresh.lastUsedAt = observed.lastUsedAt;
        fresh.lastError = observed.lastError;
        fresh.cooldownUntil = observed.cooldownUntil;
        fresh.disabled = fresh.disabled || observed.disabled;
      }
    });
  }

  async function plan(all: AppSettings, station: Station, mode: "create" | "maintain", deadlineAt: number, snapshot?: RepoSnapshot, companion?: Companion) {
    const healthBefore = structuredClone(all.githubNurture.apiKeys);
    try {
      return await deps.plan({ config: all.githubNurture, station: { owner: station.owner, repo: station.repo, allowCompanionFork: station.allowCompanionFork, allowCompanionDelete: station.allowCompanionDelete },
        existingRepos: all.githubStations.filter((s) => same(s.owner, station.owner)).flatMap((s) => [s.repo, ...s.companionRepos.map((c) => c.repo)]),
        languageHistory: all.githubStations.flatMap((s) => s.companionRepos).filter((c) => c.language?.trim())
          .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0)).map((c) => c.language!).slice(0, 8),
        language: companion?.language || snapshot?.language, declaredSourcePaths: companion?.sourcePaths,
        mode, repo: companion?.repo, context: snapshot ? `${snapshot.context}\nExisting primary language: ${companion?.language || snapshot.language || inferCompanionLanguages([...snapshot.files.keys()])[0] || "inspect the source"}. Preserve the project's existing language and architecture. Declared implementation paths: ${JSON.stringify(companion?.sourcePaths ?? [])}.`
          : `Creative seed: ${randomUUID()}. Independently choose an original useful software project in any benign subject. Existing topics: ${station.companionRepos.map((c) => `${c.repo}: ${stripCompanionMarker(c.topic ?? "")}`).join("; ")}. Choose a language distinct from the most recent and dominant languages in languageHistory, then its subject, name, architecture and initial files yourself; do not use the seed in names, code, or commits.`,
        contextFiles: snapshot ? Object.fromEntries([...snapshot.files].filter(([, file]) => file.content !== undefined).map(([path, file]) => [path, file.content!])) : undefined, deadlineAt });
    } finally { await persistKeyHealth(all.githubNurture, healthBefore); }
  }

  async function deleteInside(slug: string, repo: string, automated: boolean, deadline: number) {
    const all = await deps.read();
    const station = findStation(all, slug);
    if (!station) throw new Error("Không tìm thấy kho GitHub.");
    assertCompanionTarget(all.githubStations, station, repo);
    const companion = station.companionRepos.find((c) => same(c.repo, repo))!;
    if (automated && !station.allowCompanionDelete) throw new Error("Chưa bật quyền tự xóa kho phụ.");
    const github = deps.github(patOf(station), deadline);
    const info = await github.info(station.owner, companion.repo);
    if (!info && !companion.pendingDelete) throw new Error("GitHub không trả về kho này; cần kiểm tra quyền truy cập trước khi gỡ sổ.");
    if (info && companion.githubId && companion.githubId !== info.id) throw new Error("ID repo đã thay đổi; dừng xóa để bảo vệ kho thay thế.");
    await patchStation(slug, (fresh, settings) => {
      assertCompanionTarget(settings.githubStations, fresh, repo);
      if (automated && !fresh.allowCompanionDelete) throw new Error("Quyền tự xóa vừa được tắt.");
      const target = fresh.companionRepos.find((c) => same(c.repo, repo))!;
      target.pendingDelete = true;
      if (info) target.githubId = info.id;
    });
    if (info) await github.delete(station.owner, companion.repo);
    await patchStation(slug, (fresh) => {
      fresh.companionRepos = fresh.companionRepos.filter((c) => !same(c.repo, repo));
      fresh.nurtureNextAt = null;
      fresh.nurtureLastNote = `Đã xóa ${repo}; Ollama sẽ tạo bù theo số lượng cấu hình ở lượt tiếp theo.`;
    });
  }

  async function recoverPending(station: Station, github: CompanionGithub) {
    const pending = station.nurturePending;
    if (!pending) return;
    const info = await github.info(station.owner, pending.repo);
    if (!info) {
      const startedAt = Number(pending.operationId.split("-")[0]);
      if (Number.isFinite(startedAt) && Date.now() - startedAt < 5 * 60_000) throw new Error("GitHub đang chuẩn bị repo; giữ yêu cầu tạo để kiểm tra lại lượt sau.");
      // Clear the reservation and let the next model decision choose a fresh name.
      await patchStation(stationSlug(station), (fresh) => { delete fresh.nurturePending; fresh.nurtureNextAt = later(15); });
      throw new Error("Chưa thấy repo của lượt tạo trước; đã giữ lịch thử lại, không nhận repo khác cùng tên.");
    }
    const startedAt = Number(pending.operationId.split("-")[0]);
    const createdAt = Date.parse(info.created_at ?? "");
    const matchingFork = pending.kind === "fork" && !!pending.source && same(info.parent?.full_name ?? "", pending.source)
      && Number.isFinite(startedAt) && createdAt >= startedAt - 5000 && createdAt <= startedAt + 10 * 60_000;
    // New operations use private GitHub IDs. A lost response without an ID needs review;
    // never adopt a same-name repo using its description or creation time as a guess.
    const verified = pending.githubId ? pending.githubId === info.id : pending.metadataVersion === 2 ? false
      : pending.kind === "create" ? info.description?.endsWith(`[companion:${pending.operationId}]`) : matchingFork;
    if (!verified) throw new Error("Lượt tạo trước chưa xác minh được ID repo; cần kiểm tra trước khi tiếp tục.");
    await patchStation(stationSlug(station), (fresh, all) => {
      if (all.githubStations.some((s) => same(s.owner, station.owner) && same(s.repo, pending.repo))) throw new Error("Repo trùng kho chính.");
      if (all.githubStations.some((s) => same(s.owner, station.owner) && !same(stationSlug(s), stationSlug(station)) && s.companionRepos.some((c) => same(c.repo, pending.repo)))) throw new Error("Repo này đã được đăng ký ở kho GitHub khác.");
      if (!fresh.companionRepos.some((c) => same(c.repo, pending.repo))) fresh.companionRepos.push({ ...entryOf(info), language: pending.language || info.language || undefined, sourcePaths: pending.sourcePaths });
      delete fresh.nurturePending;
      fresh.nurtureNextAt = null;
    });
  }

  async function createOne(all: AppSettings, station: Station, deadline: number): Promise<CompanionNurtureResult> {
    const slug = stationSlug(station);
    await patchStation(slug, (fresh) => { fresh.nurtureNextAt = later(15); });
    const decision = await plan(all, station, "create", deadline);
    if (decision.action === "wait") {
      await patchStation(slug, (fresh) => { fresh.nurtureNextAt = later(decision.nextCheckMinutes); fresh.nurtureLastNote = decision.reason.slice(0, 1000); });
      return resultOf(station, station.repo, decision.reason);
    }
    if (!["create", "fork"].includes(decision.action)) throw new Error("Model trả hành động không phù hợp khi tạo repo.");
    const fresh = await deps.read();
    const current = findStation(fresh, slug)!;
    if (!current?.enabled || current.dailyPushes === 0 || current.companionRepos.length >= effectiveCompanionCount(current, fresh.githubNurture)) return resultOf(station, decision.repo, "Cấu hình đã thay đổi; bỏ lượt tạo.");
    if (decision.action === "fork" && !current.allowCompanionFork) throw new Error("Quyền fork đang tắt.");
    if (!/^[\w.-]{1,100}$/.test(decision.repo) || [".", ".."].includes(decision.repo) || fresh.githubStations.some((s) => same(s.owner, station.owner) && [s.repo, ...s.companionRepos.map((c) => c.repo)].some((r) => same(r, decision.repo)))) throw new Error("Model chọn tên repo không hợp lệ hoặc đã có trong sổ.");
    const github = deps.github(patOf(current), deadline);
    if (await github.info(current.owner, decision.repo)) throw new Error("Tên repo do model chọn đã tồn tại; không nhận hoặc ghi đè kho đó.");
    const operationId = `${Date.now()}-${randomUUID()}`;
    await patchStation(slug, (row) => { row.nurturePending = { repo: decision.repo, operationId, metadataVersion: 2, kind: decision.action as "create" | "fork", source: decision.forkFrom, language: decision.language, sourcePaths: decision.sourcePaths }; });
    const info = decision.action === "fork" ? await github.fork(current.owner, decision.repo, decision.forkFrom ?? "")
      : await github.create(current.owner, decision.repo, stripCompanionMarker(decision.description));
    if (!same(info.full_name, `${current.owner}/${decision.repo}`)) throw new Error("GitHub trả tên kho khác tên đã yêu cầu.");
    await patchStation(slug, (row) => { if (row.nurturePending) row.nurturePending.githubId = info.id; });
    await patchStation(slug, (row) => { row.companionRepos.push(entryOf(info, decision)); delete row.nurturePending; row.nurtureNextAt = null; row.nurtureLastNote = decision.reason.slice(0, 1000); });
    // Forked Actions remain disabled; generated code never gets workflow permissions.
    await github.disableActions(current.owner, decision.repo);
    await patchStation(slug, (row) => { row.companionRepos.find((c) => same(c.repo, decision.repo))!.actionsDisabled = true; });
    if (decision.action === "fork") return resultOf(station, decision.repo, `Đã fork ${decision.forkFrom}; lượt tiếp theo đọc source để phát triển.`);
    const snapshot: RepoSnapshot = { branch: info.default_branch || "main", head: null, tree: null, files: new Map(), context: "", githubId: info.id };
    const commit = await github.commit(current.owner, decision.repo, snapshot, decision.files, decision.commitMessage, decision.readPaths, current.dailyPushes, decision.sourcePaths);
    await recordCommit(slug, decision.repo, decision, commit);
    return resultOf(station, decision.repo, `Đã tạo repo và ghi ${commit.pushed} commit source${current.dailyPushes === 1 && decision.files.length > 1 ? "; phần còn lại chờ lượt phát triển tiếp theo do giới hạn 1 commit/ngày" : ""}: ${decision.reason}`, true, commit.pushed);
  }

  async function recordCommit(slug: string, repo: string, decision: CompanionDecision, commit: { pushed: number; sha: string; partial?: boolean }) {
    await patchStation(slug, (fresh) => {
      const c = fresh.companionRepos.find((item) => same(item.repo, repo));
      if (!c) return;
      const day = nurtureDayKey(new Date());
      c.pushesToday = Math.min(24, (c.lastNurtureDay === day ? c.pushesToday : 0) + commit.pushed);
      c.lastNurtureDay = day;
      if (commit.pushed) c.lastPushAt = new Date().toISOString();
      c.lastCommitSha = commit.sha;
      c.lastPushOk = true;
      c.lastPushNote = (commit.partial ? "Đã khởi tạo một tệp source. Phần còn lại chờ lượt phát triển tiếp theo vì giới hạn commit/ngày. " : "") + decision.reason.slice(0, commit.partial ? 350 : 500);
      c.nextDecisionAt = later(decision.nextCheckMinutes);
      if (decision.action === "create" || decision.action === "commit") {
        c.language ||= decision.language || inferCompanionLanguages(decision.files)[0];
        const deleted = new Set(decision.files.filter((file) => file.content === null).map((file) => file.path));
        c.sourcePaths = [...new Set([...(c.sourcePaths ?? []), ...(decision.sourcePaths ?? [])])].filter((path) => !deleted.has(path)).slice(-256);
      }
    });
  }

  async function maintainOne(all: AppSettings, station: Station, companion: Companion, deadline: number): Promise<CompanionNurtureResult> {
    const slug = stationSlug(station);
    assertCompanionTarget(all.githubStations, station, companion.repo);
    if (companion.pendingDelete) {
      await deleteInside(slug, companion.repo, false, deadline);
      return resultOf(station, companion.repo, "Hoàn tất lượt xóa đã được yêu cầu trước đó.");
    }
    const github = deps.github(patOf(station), deadline);
    const snapshot = await github.snapshot(station.owner, companion.repo, all.githubNurture.contextWindow, companion.sourcePaths);
    if (!snapshot) throw new Error("Không đọc được repo; kiểm tra quyền PAT hoặc repo bị xóa ngoài hệ thống.");
    if (companion.githubId && companion.githubId !== snapshot.githubId) throw new Error("ID repo đã đổi; không ghi vào một repo thay thế cùng tên.");
    const observedLanguage = companion.language || snapshot.language || inferCompanionLanguages([...snapshot.files].map(([path, file]) => ({ path, content: file.content })))[0];
    if (!companion.language && observedLanguage) {
      await patchStation(slug, (fresh) => { const c = fresh.companionRepos.find((item) => same(item.repo, companion.repo))!; c.language ||= observedLanguage; });
      companion.language = observedLanguage;
    }
    const today = nurtureDayKey(new Date());
    const used = Math.max(companion.lastNurtureDay === today ? companion.pushesToday : 0, snapshot.todayCommits ?? 0);
    if (used >= station.dailyPushes) {
      await patchStation(slug, (fresh) => { const c = fresh.companionRepos.find((item) => same(item.repo, companion.repo))!; c.lastNurtureDay = today; c.pushesToday = Math.min(24, used); });
      return resultOf(station, companion.repo, "Đã đạt giới hạn commit trong ngày; chờ ngày sau.");
    }
    await patchStation(slug, (fresh) => { const c = fresh.companionRepos.find((item) => same(item.repo, companion.repo))!; c.githubId = snapshot.githubId; c.nextDecisionAt = later(15); });
    if ((companion.managedBy === "ollama" || companion.forkedFrom) && !companion.actionsDisabled) {
      await github.disableActions(station.owner, companion.repo);
      await patchStation(slug, (fresh) => { fresh.companionRepos.find((c) => same(c.repo, companion.repo))!.actionsDisabled = true; });
    }
    const decision = await plan(all, station, "maintain", deadline, snapshot, companion);
    if (!same(decision.repo, companion.repo)) throw new Error("Model chọn sai repo cho lượt cập nhật.");
    const updated = await deps.read();
    const current = findStation(updated, slug);
    if (!current?.enabled || current.dailyPushes === 0) return resultOf(station, companion.repo, "Kho đã tạm dừng trong lúc model suy nghĩ.");
    assertCompanionTarget(updated.githubStations, current, companion.repo);
    if (decision.action === "delete") {
      await deleteInside(slug, companion.repo, true, deadline);
      return resultOf(station, companion.repo, `Model đã xóa repo: ${decision.reason}`);
    }
    if (decision.action === "wait") {
      await recordCommit(slug, companion.repo, decision, { pushed: 0, sha: snapshot.head ?? "" });
      return resultOf(station, companion.repo, decision.reason);
    }
    if (decision.action !== "commit") throw new Error("Hành động không hợp lệ khi cập nhật repo.");
    const available = current.dailyPushes - used;
    if (available <= 0) return resultOf(station, companion.repo, "Giới hạn commit vừa được giảm; chờ ngày sau.");
    const declaredChanges = [...new Set([...(companion.sourcePaths ?? []), ...(decision.sourcePaths ?? [])])].filter((path) => decision.files.some((file) => file.path === path));
    const commit = await github.commit(station.owner, companion.repo, snapshot, decision.files, decision.commitMessage, decision.readPaths, available, declaredChanges);
    await recordCommit(slug, companion.repo, decision, commit);
    return resultOf(station, companion.repo, decision.reason, true, commit.pushed);
  }

  async function run(options: Options = {}): Promise<CompanionNurtureSummary> {
    const deadline = Math.min(options.deadlineAt ?? Date.now() + 120_000, Date.now() + 240_000);
    const summary: CompanionNurtureSummary = { checked: 0, pushed: 0, completed: 0, failed: 0, skipped: 0, results: [] };
    const locked = await deps.lease("all-runners", async () => {
      const initial = await deps.read();
      const stations = initial.githubStations.filter((s) => s.enabled && s.dailyPushes > 0 && (!options.stationSlug || same(stationSlug(s), options.stationSlug)))
        .sort((a, b) => (Date.parse(a.nurtureLastRunAt ?? "") || 0) - (Date.parse(b.nurtureLastRunAt ?? "") || 0));
      for (const candidate of stations) {
        if (deadline - Date.now() < 10_000) { summary.skipped++; continue; }
        const slug = stationSlug(candidate);
        const held = await deps.lease(slug, async () => {
          let workRepo = candidate.repo;
          try {
            let all = await deps.read();
            let station = findStation(all, slug)!;
            if (!station?.enabled || station.dailyPushes === 0) return;
            await patchStation(slug, (row) => { row.nurtureLastRunAt = new Date().toISOString(); });
            if (station.nurturePending) { await recoverPending(station, deps.github(patOf(station), deadline)); all = await deps.read(); station = findStation(all, slug)!; }
            const deleting = station.companionRepos.find((c) => c.pendingDelete);
            if (deleting) {
              workRepo = deleting.repo;
              await deleteInside(slug, deleting.repo, false, deadline);
              summary.results.push(resultOf(station, deleting.repo, "Hoàn tất lượt xóa đã được yêu cầu trước đó."));
              return;
            }
            if (!all.githubNurture.apiKeys.some((k) => !k.disabled && due(k.cooldownUntil))) throw new Error("Chưa có API key Ollama sẵn sàng; nhập key hoặc chờ hết thời gian nghỉ.");
            let result: CompanionNurtureResult | undefined;
            if (station.companionRepos.length < effectiveCompanionCount(station, all.githubNurture) && due(station.nurtureNextAt)) {
              result = await createOne(all, station, deadline);
            } else {
              const day = nurtureDayKey(new Date());
              const c = [...station.companionRepos].filter((item) => item.pendingDelete || (due(item.nextDecisionAt) && (item.lastNurtureDay !== day || item.pushesToday < station.dailyPushes)))
                .sort((a, b) => (Date.parse(a.nextDecisionAt ?? "") || 0) - (Date.parse(b.nextDecisionAt ?? "") || 0))[0];
              if (c) { workRepo = c.repo; result = await maintainOne(all, station, c, deadline); }
            }
            if (result) summary.results.push(result); else summary.skipped++;
          } catch (error) {
            // Provider adapters expose fixed, secret-free errors. Unknown errors stay generic.
            const message = error instanceof Error ? error.message : "";
            const note = /^(?:Ollama |No eligible Ollama|All eligible Ollama|Invalid Ollama|Kho |Không |Chưa |Đã |Hết |Model |GitHub |Tên |Quyền |ID |Lượt |Repo |Danh |JSON |PAT |Giữ )/.test(message)
              ? message.slice(0, 500) : "Lượt nuôi kho chưa hoàn tất; kiểm tra kết nối và cấu hình máy chủ.";
            // A removed station or a failed checkpoint must not hide results from other stations.
            try {
              await deps.mutate((settings) => {
                const row = findStation(settings, slug);
                if (!row) return;
                row.nurtureLastNote = note;
                row.nurtureNextAt = later(15);
                const c = row.companionRepos.find((item) => same(item.repo, workRepo));
                if (c) { c.lastPushOk = false; c.lastPushNote = note; c.nextDecisionAt = later(15); }
              });
            } catch { /* The next run recovers durable operation intent from the last checkpoint. */ }
            summary.results.push(resultOf(candidate, workRepo, note, false));
          }
        });
        if (held === null) summary.skipped++;
      }
    });
    if (locked === null) summary.skipped++;
    summary.checked = summary.results.length;
    summary.pushed = summary.results.reduce((n, r) => n + r.pushed, 0);
    summary.failed = summary.results.filter((r) => !r.ok).length;
    summary.completed = summary.results.filter((r) => r.ok).length;
    return summary;
  }

  async function remove(slug: string, repo: string): Promise<void> {
    const outcome = await deps.lease(slug, async () => { await deleteInside(slug, repo, false, Date.now() + 30_000); return true; });
    if (outcome === null) throw new Error("Kho đang có lượt nuôi chạy; thử xóa lại sau khi lượt đó kết thúc.");
  }
  return { run, remove };
}

export const runLlmCompanionNurture = (options: Options = {}) => createCompanionEngine(options.deadlineAt === undefined ? defaults : {
  ...defaults,
  read: () => getAppSettings({ deadlineAt: options.deadlineAt }),
  mutate: change => mutateGithubState(change, { deadlineAt: options.deadlineAt }),
  lease: (slug, work) => withCompanionLease(slug, work, { deadlineAt: options.deadlineAt }),
}).run(options);
export const deleteManagedCompanion = (slug: string, repo: string) => createCompanionEngine().remove(slug, repo);
