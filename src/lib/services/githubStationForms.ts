import type { AppSettings } from "./settings";
import type { GithubProvisionBudget, GithubProvisionResult } from "./githubProvisioning";
import type { GithubProvisionInput } from "../validation/githubProvisioning";
import { DEFAULT_WORKFLOW_FILE, MAX_DAILY_PUSHES, MIN_DAILY_PUSHES, reviewStationIdentity, stationSlug } from "../validation/githubStations";

export type GithubStationFormResult = {
  ok: boolean;
  message: string;
  slug?: string;
  stage?: GithubProvisionResult["stage"];
  failureCode?: GithubProvisionResult["failureCode"];
  diagnosticId?: string;
  warnings?: string[];
};

/** The production actions and offline checks execute this same form boundary. */
export type GithubStationFormDependencies = {
  requireManage: () => Promise<unknown>;
  provision: (input: GithubProvisionInput) => Promise<GithubProvisionResult>;
  activateDeferred?: (
    station: AppSettings["githubStations"][number],
    options: { pat?: string; dailyPushes?: number },
  ) => Promise<GithubProvisionResult>;
  getSettings: () => Promise<AppSettings>;
  mutate: (change: (settings: AppSettings) => void) => Promise<void>;
  whoami: (pat: string, budget: GithubProvisionBudget) => Promise<{ login: string }>;
  encrypt: (pat: string) => string;
  isEncrypted: (pat: string) => boolean;
  ping: (slug: string) => Promise<{ ok: boolean }>;
  invalidate: (slug?: string) => void;
};

const denied = { ok: false, message: "Bạn không có quyền quản lý kho GitHub. Tải lại trang để kiểm tra phiên đăng nhập." };
const read = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
function safeSlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [owner, repo, extra] = value.split("/");
  return extra === undefined && repo && !reviewStationIdentity(owner, repo, DEFAULT_WORKFLOW_FILE) ? value : undefined;
}
function redact(message: string, pat: string): string {
  return (pat ? message.split(pat).join("[PAT đã ẩn]") : message)
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[PAT đã ẩn]");
}

export function createGithubStationFormHandlers(deps: GithubStationFormDependencies) {
  async function allowed() {
    try { await deps.requireManage(); return true; } catch { return false; }
  }
  function invalidate(slug?: string) {
    // A refresh failure must not turn a completed external mutation into a retry prompt.
    try { deps.invalidate(slug); } catch { /* The next page load reads the committed state. */ }
  }

  async function provision(form: FormData): Promise<GithubStationFormResult> {
    if (!await allowed()) return denied;
    const pat = read(form, "pat");
    try {
      // No owner, workerId, enabled, or companion fields cross the create boundary.
      const result = await deps.provision({
        pat,
        repo: read(form, "repo"),
        workflowFile: read(form, "workflowFile"),
        dailyPushes: read(form, "dailyPushes"),
        deferPrimary: read(form, "deferPrimary") === "on",
      });
      const slug = safeSlug(result.slug);
      const response = {
        ...result,
        slug: slug && !(pat && slug.includes(pat)) ? slug : undefined,
        message: redact(result.message, pat),
        warnings: result.warnings.map((warning) => redact(warning, pat)),
      };
      if (result.ok) invalidate(slug);
      return response;
    } catch {
      return { ok: false, stage: "attention", message: "Lượt tạo kho bị gián đoạn. Kiểm tra sổ và trạng thái kho GitHub trước khi thử lại.", warnings: [] };
    }
  }

  async function update(form: FormData, legacy = false): Promise<GithubStationFormResult> {
    if (!await allowed()) return denied;
    const submittedSlug = legacy && !form.has("slug")
      ? `${read(form, "owner").trim()}/${read(form, "repo").trim()}`
      : read(form, "slug").trim();
    if (!safeSlug(submittedSlug)) return { ok: false, message: "Không xác định được kho cần sửa. Tải lại trang rồi chọn Sửa." };
    let settings: AppSettings;
    try { settings = await deps.getSettings(); } catch { return { ok: false, message: "Không đọc được sổ kho GitHub. Thử lại sau." }; }
    const existing = settings.githubStations.find((station) => stationSlug(station) === submittedSlug);
    if (!existing) return { ok: false, slug: submittedSlug, message: "Kho chưa có trong sổ hoặc vừa bị xoá. Dùng form Tạo kho GitHub mới để tạo repo và workflow." };
    const slug = stationSlug(existing);
    const pat = read(form, "pat");
    if (pat && /\s/.test(pat)) return { ok: false, slug, message: "PAT có khoảng trắng. Chép lại token, không kèm dấu xuống dòng." };
    let dailyPushes: number | undefined;
    if (form.has("dailyPushes")) {
      const raw = read(form, "dailyPushes").trim();
      dailyPushes = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isSafeInteger(dailyPushes) || dailyPushes < MIN_DAILY_PUSHES || dailyPushes > MAX_DAILY_PUSHES) {
        return { ok: false, slug, message: `Giới hạn lượt đẩy phải là số nguyên từ ${MIN_DAILY_PUSHES} đến ${MAX_DAILY_PUSHES}.` };
      }
    }
    const deferPrimary = form.has("deferPrimaryPresent")
      ? read(form, "deferPrimary") === "on"
      : existing.primaryDeferred;
    if (!existing.primaryDeferred && deferPrimary) {
      return { ok: false, slug, message: "Repo chính đã tồn tại; không thể quay ngược station về chế độ chưa tạo repo chính." };
    }
    if (existing.primaryDeferred && !deferPrimary) {
      if (!deps.activateDeferred) return { ok: false, slug, message: "Máy chủ chưa hỗ trợ mở repo chính cho station đang tạm hoãn." };
      try {
        const result = await deps.activateDeferred(existing, { pat: pat || undefined, dailyPushes });
        const response = {
          ...result,
          slug: safeSlug(result.slug) ?? slug,
          message: redact(result.message, pat),
          warnings: result.warnings.map((warning) => redact(warning, pat)),
        };
        if (result.ok) invalidate(slug);
        return response;
      } catch {
        return { ok: false, slug, stage: "attention", message: "Không mở được repo chính an toàn. Station vẫn giữ nguyên chế độ chỉ nuôi repo phụ.", warnings: [] };
      }
    }

    const workflowFile = form.has("workflowFile") ? read(form, "workflowFile").trim() : undefined;
    const workerId = form.has("workerId") ? read(form, "workerId").trim() : undefined;
    function reviewEditable(station: AppSettings["githubStations"][number]): string | null {
      if (station.provisionedBy === "jarvis") {
        return (workflowFile !== undefined && workflowFile !== station.workflowFile) || (workerId !== undefined && workerId !== station.workerId)
          ? "Workflow và WORKER_ID của kho do Jarvis tạo được giữ cố định. Tải lại trang để xem cấu hình hiện tại." : null;
      }
      if (workflowFile !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(workflowFile) || reviewStationIdentity(station.owner, station.repo, workflowFile))) {
        return "Tệp workflow phải là tên .yml hoặc .yaml hợp lệ, không chứa đường dẫn.";
      }
      if (workerId !== undefined && (workerId.length > 120 || !/^[A-Za-z0-9._-]*$/.test(workerId))) return "WORKER_ID chỉ nhận chữ, số, dấu chấm, gạch ngang hoặc gạch dưới; tối đa 120 ký tự.";
      return null;
    }
    const complaint = reviewEditable(existing);
    if (complaint) return { ok: false, slug, message: complaint };
    let encryptedPat: string | undefined;
    if (pat) {
      try {
        const identity = await deps.whoami(pat, { now: Date.now, deadlineAt: Date.now() + 15_000 });
        if (identity.login.toLowerCase() !== existing.owner.toLowerCase()) return { ok: false, slug, message: "PAT mới không thuộc tài khoản đang sở hữu kho này. Dán PAT của đúng tài khoản." };
        encryptedPat = deps.encrypt(pat);
      } catch { return { ok: false, slug, message: "Không xác minh được chủ sở hữu PAT mới với GitHub. Kiểm tra token rồi thử lại." }; }
    }
    const hasEnabled = form.has("enabledPresent") || form.has("enabled");
    const enabled = read(form, "enabled") === "on";
    try {
      await deps.mutate((currentSettings) => {
        const current = currentSettings.githubStations.find((station) => stationSlug(station) === slug);
        if (!current || reviewEditable(current)) throw Error("changed");
        if (!encryptedPat && !deps.isEncrypted(current.pat)) throw Error("invalid stored PAT");
        const nextWorkerId = current.provisionedBy === "jarvis" ? current.workerId : workerId ?? current.workerId;
        if (workerId !== undefined && nextWorkerId && nextWorkerId !== current.workerId && currentSettings.githubStations.some((station) => stationSlug(station) !== slug && station.workerId.toLowerCase() === nextWorkerId.toLowerCase())) throw Error("duplicate worker ID");
        // Merge only editable fields into the row locked NOW, preserving every runtime,
        // companion, provisioning, and concurrently refreshed field from that row.
        const updated = { ...current,
          workflowFile: current.provisionedBy === "jarvis" ? current.workflowFile : workflowFile ?? current.workflowFile,
          workerId: nextWorkerId,
          pat: encryptedPat ?? current.pat,
          enabled: hasEnabled ? enabled : current.enabled,
          dailyPushes: dailyPushes ?? current.dailyPushes,
        };
        currentSettings.githubStations = currentSettings.githubStations.map((station) => stationSlug(station) === slug ? updated : station);
      });
    } catch { return { ok: false, slug, message: "Không lưu được: sổ vừa thay đổi, WORKER_ID bị trùng, PAT đang lưu không hợp lệ, hoặc máy chủ chưa ghi được dữ liệu. Tải lại trang rồi thử lại." }; }
    const warnings: string[] = [];
    try { if (!(await deps.ping(slug)).ok) warnings.push("Đã lưu cấu hình nhưng chưa xác minh được trạng thái workflow. Kiểm tra trang chi tiết."); }
    catch { warnings.push("Đã lưu cấu hình nhưng lượt kiểm tra workflow bị gián đoạn. Kiểm tra trang chi tiết."); }
    invalidate(slug);
    return { ok: true, slug, message: "Đã cập nhật cấu hình kho GitHub.", warnings };
  }

  return { provision, update, saveLegacy: (form: FormData) => update(form, true) };
}
