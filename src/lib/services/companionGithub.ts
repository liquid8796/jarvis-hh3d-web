import { createHash } from "node:crypto";
import { nurtureDayKey } from "@/lib/validation/githubStations";
import { isCompanionPathAllowed, isCompanionSourcePath } from "./ollamaCompanion";

type RegisteredStation = { owner: string; repo: string; companionRepos: Array<{ repo: string; githubId?: number }> };
export type SourceFile = { path: string; content: string | null };
type TreeFile = { sha: string; mode: string; content?: string };
export type RepoSnapshot = { branch: string; head: string | null; tree: string | null; files: Map<string, TreeFile>; context: string; githubId: number; complete?: boolean; todayCommits?: number };
export type RepoInfo = { id: number; full_name: string; default_branch: string; description?: string; private: boolean; parent?: { full_name: string }; license?: { spdx_id?: string }; created_at?: string };

function validRepo(repo: string) { return /^[\w.-]{1,100}$/.test(repo) && repo !== "." && repo !== ".."; }
export function assertCompanionTarget(stations: RegisteredStation[], station: RegisteredStation, repo: string): void {
  if (!validRepo(repo)) throw new Error("Tên kho phụ không hợp lệ.");
  if (stations.some((s) => s.owner.toLowerCase() === station.owner.toLowerCase() && s.repo.toLowerCase() === repo.toLowerCase())) throw new Error("Không được thay đổi kho chính bằng harness kho phụ.");
  if (!station.companionRepos.some((c) => c.repo.toLowerCase() === repo.toLowerCase())) throw new Error("Kho phụ không nằm trong sổ của kho này.");
  if (stations.some((s) => s.owner.toLowerCase() === station.owner.toLowerCase() && s.repo.toLowerCase() !== station.repo.toLowerCase() && s.companionRepos.some((c) => c.repo.toLowerCase() === repo.toLowerCase()))) throw new Error("Kho phụ đang được đăng ký ở nhiều station; cần sửa sổ trước khi thay đổi repo.");
}

export function safeSourcePath(path: string): boolean {
  return isCompanionPathAllowed(path) && !/(^|\/)(node_modules|vendor)(\/|$)/i.test(path);
}
const slugPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const blobSha = (content: string) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");

export class CompanionGithub {
  constructor(private pat: string, private deadlineAt: number, private request: typeof fetch = fetch) {}

  async call<T>(method: string, path: string, body?: unknown, accepted = [200, 201, 202, 204]): Promise<T> {
    const remaining = this.deadlineAt - Date.now();
    if (remaining < 100) throw new Error("Hết thời gian dành cho lượt nuôi kho; sẽ tiếp tục lượt sau.");
    let response: Response;
    try {
      response = await this.request(`https://api.github.com${path}`, {
        method, headers: { authorization: `Bearer ${this.pat}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "jarvis-companion", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(Math.min(10_000, remaining)),
      });
    } catch { throw new Error("Không kết nối được GitHub hoặc đã hết thời gian."); }
    if (!accepted.includes(response.status)) throw new Error(`GitHub HTTP ${response.status}${response.status === 403 || response.status === 429 ? ": kiểm tra quyền hoặc giới hạn API; thử lại sau" : ""}.`);
    if (response.status === 204 || response.status === 404) return null as T;
    try { return await response.json() as T; } catch { throw new Error("GitHub trả dữ liệu không hợp lệ."); }
  }

  async info(owner: string, repo: string): Promise<RepoInfo | null> {
    const info = await this.call<RepoInfo | null>("GET", slugPath(owner, repo), undefined, [200, 404]);
    if (info && info.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) throw new Error("Định danh kho GitHub đã thay đổi; cần kiểm tra lại sổ.");
    return info;
  }

  async snapshot(owner: string, repo: string, contextWindow: number): Promise<RepoSnapshot | null> {
    const info = await this.info(owner, repo);
    if (!info) return null;
    const base = slugPath(owner, repo);
    const ref = await this.call<{ object?: { sha: string } } | null>("GET", `${base}/git/ref/heads/${encodeURIComponent(info.default_branch)}`, undefined, [200, 404, 409]);
    const files = new Map<string, TreeFile>();
    if (!ref?.object?.sha) return { branch: info.default_branch || "main", head: null, tree: null, files, context: "Empty repository: write the initial working source files.", githubId: info.id, complete: true, todayCommits: 0 };
    const commit = await this.call<{ tree: { sha: string } }>("GET", `${base}/git/commits/${ref.object.sha}`);
    const listing = await this.call<{ tree: Array<{ path: string; type: string; sha: string; size?: number; mode: string }>; truncated?: boolean }>("GET", `${base}/git/trees/${commit.tree.sha}?recursive=1`);
    for (const entry of listing.tree) if (entry.type === "blob" || entry.mode === "160000") files.set(entry.path, { sha: entry.sha, mode: entry.mode });
    const history = await this.call<Array<{ commit: { message: string } }>>("GET", `${base}/commits?per_page=5`);
    const since = new Date(`${nurtureDayKey(new Date())}T00:00:00+07:00`).toISOString();
    // 100 entries is enough to prove exhaustion of the supported <=24 daily cap.
    // Read the pinned head so the count and source describe one repository state.
    const today = await this.call<unknown[]>("GET", `${base}/commits?sha=${encodeURIComponent(ref.object.sha)}&per_page=100&since=${encodeURIComponent(since)}`);
    const budget = Math.min(180_000, Math.max(3000, contextWindow * 2));
    const context = `Repository: ${info.full_name}\nDescription: ${info.description ?? ""}\nRecent commits:\n${history.map((c) => c.commit.message.slice(0, 500)).join("\n")}\nFiles${listing.truncated ? " (partial tree; additions are blocked)" : ""}:\n${Array.from(files.keys()).filter(safeSourcePath).join("\n").slice(0, Math.floor(budget / 4))}\n`;
    const candidates = listing.tree.filter((e) => e.type === "blob" && e.mode !== "120000" && safeSourcePath(e.path) && (e.size ?? Infinity) < 32_000 && (isCompanionSourcePath(e.path) || /\.(md|json|toml|yaml|yml|txt)$/i.test(e.path)))
      .sort((a, b) => Number(/readme|package.json|pyproject|cargo.toml|go.mod/i.test(b.path)) - Number(/readme|package.json|pyproject|cargo.toml|go.mod/i.test(a.path))).slice(0, 16);
    let sourceBytes = 0;
    for (const entry of candidates) {
      if (this.deadlineAt - Date.now() < 5000) break;
      if (sourceBytes + (entry.size ?? 0) > budget) continue;
      const blob = await this.call<{ content: string; encoding: string }>("GET", `${base}/git/blobs/${entry.sha}`);
      if (blob.encoding !== "base64") continue;
      const content = Buffer.from(blob.content, "base64").toString("utf8");
      if (content.includes("\0")) continue;
      files.get(entry.path)!.content = content;
      sourceBytes += Buffer.byteLength(content, "utf8");
    }
    return { branch: info.default_branch, head: ref.object.sha, tree: commit.tree.sha, files, context, githubId: info.id, complete: !listing.truncated, todayCommits: today.length };
  }

  async commit(owner: string, repo: string, snapshot: RepoSnapshot, changes: SourceFile[], message: string, readPaths?: readonly string[], maxCommits = 2): Promise<{ sha: string; pushed: number; partial?: boolean }> {
    if (!changes.length || changes.length > 24 || changes.some((f) => !safeSourcePath(f.path)) || changes.reduce((n, f) => n + Buffer.byteLength(f.content ?? ""), 0) > 262144) throw new Error("Danh sách tệp do model trả về không hợp lệ.");
    const selected = changes.filter((f) => f.content === null ? snapshot.files.has(f.path) : snapshot.files.get(f.path)?.content !== f.content && snapshot.files.get(f.path)?.sha !== blobSha(f.content));
    for (const f of selected) {
      const old = snapshot.files.get(f.path);
      if ([...snapshot.files.keys()].some((path) => path !== f.path && (path.startsWith(`${f.path}/`) || f.path.startsWith(`${path}/`)))) throw new Error("Không thay đổi cấu trúc tệp/thư mục chứa nội dung chưa được model đọc.");
      if (!old && snapshot.complete === false) throw new Error("Tree chưa đầy đủ; không thể xác minh đường dẫn mới trước khi ghi.");
      if (old?.mode === "120000" || old?.mode === "160000" || (old && old.content === undefined)) throw new Error(`Model cần đọc đầy đủ ${f.path} trước khi sửa hoặc xóa.`);
      if (old && readPaths && !readPaths.includes(f.path)) throw new Error("Model chưa được đọc đầy đủ tệp này trong context; không ghi hoặc xóa.");
      if (/^(license|copying|notice)(\.|$)/i.test(f.path) && old) throw new Error("Giữ nguyên giấy phép và thông tin tác giả của dự án.");
      if (f.content && f.path.endsWith(".json")) { try { JSON.parse(f.content); } catch { throw new Error(`JSON không hợp lệ trong ${f.path}.`); } }
    }
    if (!selected.length) return { sha: snapshot.head ?? "", pushed: 0 };
    if (!selected.some((file) => file.content !== null && isCompanionSourcePath(file.path))) throw new Error("Commit cần có source thực sự thay đổi; không dùng source giữ nguyên để tạo commit chỉ sửa tài liệu.");
    if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 24) throw new Error("Đã hết hạn mức commit cho lượt này.");
    const base = slugPath(owner, repo);
    let head = snapshot.head;
    let tree = snapshot.tree;
    let pushed = 0;
    if (!head) {
      const first = selected.find((f) => f.content !== null && isCompanionSourcePath(f.path)) ?? selected.find((f) => f.content !== null);
      if (!first) throw new Error("Kho mới cần ít nhất một tệp source.");
      const seed = await this.call<{ commit: { sha: string } }>("PUT", `${base}/contents/${first.path.split("/").map(encodeURIComponent).join("/")}`, { message, content: Buffer.from(first.content!).toString("base64"), branch: snapshot.branch });
      head = seed.commit.sha;
      pushed++;
      selected.splice(selected.indexOf(first), 1);
      if (!selected.length) return { sha: head, pushed };
      if (maxCommits === 1) return { sha: head, pushed, partial: true };
      const baseCommit = await this.call<{ tree: { sha: string } }>("GET", `${base}/git/commits/${head}`);
      tree = baseCommit.tree.sha;
    }
    const nextTree = await this.call<{ sha: string }>("POST", `${base}/git/trees`, { base_tree: tree, tree: selected.map((f) => ({ path: f.path, mode: snapshot.files.get(f.path)?.mode ?? "100644", type: "blob", ...(f.content === null ? { sha: null } : { content: f.content }) })) });
    const nextCommit = await this.call<{ sha: string }>("POST", `${base}/git/commits`, { message, tree: nextTree.sha, parents: [head] });
    await this.call("PATCH", `${base}/git/refs/heads/${encodeURIComponent(snapshot.branch)}`, { sha: nextCommit.sha, force: false });
    return { sha: nextCommit.sha, pushed: pushed + 1 };
  }

  async create(owner: string, repo: string, description: string): Promise<RepoInfo> {
    const user = await this.call<{ login: string }>("GET", "/user");
    const path = user.login.toLowerCase() === owner.toLowerCase() ? "/user/repos" : `/orgs/${encodeURIComponent(owner)}/repos`;
    return this.call("POST", path, { name: repo, description: description.slice(0, 350), private: false, auto_init: false, has_issues: true });
  }

  async fork(owner: string, repo: string, source: string): Promise<RepoInfo> {
    if (!/^[\w-]+\/[\w.-]+$/.test(source)) throw new Error("Nguồn fork phải có dạng owner/repo.");
    const [sourceOwner, sourceRepo] = source.split("/");
    const info = await this.info(sourceOwner, sourceRepo);
    if (!info || info.private) throw new Error("Chỉ tự fork kho công khai qua GitHub.");
    const user = await this.call<{ login: string }>("GET", "/user");
    return this.call("POST", `${slugPath(sourceOwner, sourceRepo)}/forks`, { name: repo, default_branch_only: true, ...(user.login.toLowerCase() === owner.toLowerCase() ? {} : { organization: owner }) });
  }

  async disableActions(owner: string, repo: string) { await this.call("PUT", `${slugPath(owner, repo)}/actions/permissions`, { enabled: false }); }
  async delete(owner: string, repo: string) { await this.call("DELETE", slugPath(owner, repo), undefined, [204]); }
}
