"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { pingStationBySlug, runCompanionNurture, runKeepalive } from "@/lib/services/githubStations";
import { getAppSettings, type AppSettings } from "@/lib/services/settings";
import { mutateGithubState } from "@/lib/services/companionState";
import { provisionGithubStation, productionGithubProvisionDependencies } from "@/lib/services/githubProvisioning";
import { createGithubStationFormHandlers, type GithubStationFormResult } from "@/lib/services/githubStationForms";
import { deletePrimaryGithubAccountGroup } from "@/lib/services/githubPrimaryDeletion";
import {
  MS_PER_DAY,
  SCHEDULE_DISABLE_DAYS,
  stationSlug,
} from "@/lib/validation/githubStations";

/**
 * Sổ kho GitHub — server action của tab Kho GitHub (deploy/github-actions.md §7).
 *
 * Mọi cửa gác bằng `github_station.manage`, KHÔNG phải `admin.panel`: sổ này cầm PAT, thứ push
 * được mã vào kho đang chạy khôi lỗi của bốn tài khoản. Bậc trị sự vào được trang Tông Môn
 * không có nghĩa là được cầm chìa ấy.
 *
 * PAT đi LÊN một chiều: nhận từ form → encryptSecret → document, không log. `viewOf` không chép
 * phong bì sang `StationView`, nên vẽ trang admin KHÔNG kéo theo PAT nào xuống trình duyệt — đó
 * mới là luật, chứ không phải「PAT không bao giờ đi xuống」. Chiều ngược lại có đúng một cửa,
 * `revealGithubStationPatAction`, và nó chỉ mở khi có người bấm: xem ghi chú tại chỗ.
 */

export type StationResult = GithubStationFormResult;

/** Hình chiếu an toàn cho client: KHÔNG mang phong bì PAT, chỉ mang dấu vết đủ để vận hành. */
export type StationView = {
  /** `owner/repo` — khoá tra của mọi action, và cũng là thứ hiện trên giao diện. */
  slug: string;
  owner: string;
  repo: string;
  githubId?: number;
  workflowFile: string;
  workerId: string;
  provisionedBy?: "jarvis";
  primaryDeferred: boolean;
  enabled: boolean;
  lastPingAt: string | null;
  lastCommitAt: string | null;
  lastPingOk: boolean | null;
  lastPingNote: string;
  workflowState: string;
  /** Kho phần mềm cùng owner/PAT; chỉ mang dấu vết vận hành, không mang thêm bí mật. */
  companionRepos: Array<{
    repo: string;
    lastNurtureDay: string | null;
    pushesToday: number;
    lastPushAt: string | null;
    lastPushOk: boolean | null;
    lastPushNote: string;
    managedBy?: "ollama";
    topic?: string;
    forkedFrom?: string;
    createdAt?: string;
    nextDecisionAt?: string | null;
    pendingDelete?: boolean;
  }>;
  companionCountOverride: number | null;
  allowCompanionFork: boolean;
  allowCompanionDelete: boolean;
  nurtureNextAt: string | null;
  nurtureLastNote: string;
  nurturePending: { repo: string; kind: "create" | "fork" } | null;
  /** Giới hạn commit lên MỖI kho phụ mỗi ngày; 0 là admin tạm dừng. */
  dailyPushes: number;
  /**
   * Còn bao nhiêu ngày trước mốc tắt lịch, tính từ lượt GHI cuối. `null` = chưa ghi lần nào nên
   * không biết — và「không biết」phải hiện ra đúng như thế, đừng vẽ một con số 60 an tâm giả.
   *
   * Tính ở server chứ không ở client: cùng một phép tính với `isCommitDue`, và hai bản thì hai
   * nơi sẽ trôi khỏi nhau đúng vào ngày ai đó đổi `KEEPALIVE_INTERVAL_DAYS`.
   */
  daysToDisable: number | null;
};

async function requireStationManage() {
  const user = await requireAdmin();
  if (!hasPermission(user, "github_station.manage")) {
    throw new Error("Chỉ Gia chủ mới chạm được vào sổ kho GitHub.");
  }
  return user;
}

function viewOf(station: AppSettings["githubStations"][number], now: number): StationView {
  const lastCommit = station.lastCommitAt ? Date.parse(station.lastCommitAt) : Number.NaN;
  return {
    slug: stationSlug(station),
    owner: station.owner,
    repo: station.repo,
    githubId: station.githubId,
    workflowFile: station.workflowFile,
    workerId: station.workerId,
    provisionedBy: station.provisionedBy,
    primaryDeferred: station.primaryDeferred,
    enabled: station.enabled,
    lastPingAt: station.lastPingAt,
    lastCommitAt: station.lastCommitAt,
    lastPingOk: station.lastPingOk,
    lastPingNote: station.lastPingNote,
    workflowState: station.workflowState,
    companionRepos: station.companionRepos.map((companion) => ({
      repo: companion.repo,
      lastNurtureDay: companion.lastNurtureDay,
      pushesToday: companion.pushesToday,
      lastPushAt: companion.lastPushAt,
      lastPushOk: companion.lastPushOk,
      lastPushNote: companion.lastPushNote,
      managedBy: companion.managedBy,
      topic: companion.topic,
      forkedFrom: companion.forkedFrom,
      createdAt: companion.createdAt,
      nextDecisionAt: companion.nextDecisionAt,
      pendingDelete: companion.pendingDelete,
    })),
    companionCountOverride: station.companionCountOverride ?? null,
    allowCompanionFork: station.allowCompanionFork ?? false,
    allowCompanionDelete: station.allowCompanionDelete ?? false,
    nurtureNextAt: station.nurtureNextAt ?? null,
    nurtureLastNote: station.nurtureLastNote ?? "",
    nurturePending: station.nurturePending ? { repo: station.nurturePending.repo, kind: station.nurturePending.kind } : null,
    dailyPushes: station.dailyPushes,
    daysToDisable: Number.isNaN(lastCommit)
      ? null
      : Math.max(0, Math.floor(SCHEDULE_DISABLE_DAYS - (now - lastCommit) / MS_PER_DAY)),
  };
}

/** Sổ đã che cho trang admin vẽ. Gác quyền như mọi cửa khác — hình chiếu cũng là dữ liệu. */
export async function githubStationsForAdmin(): Promise<StationView[]> {
  await requireStationManage();
  const settings = await getAppSettings();
  const now = Date.now();
  return settings.githubStations.map((station) => viewOf(station, now));
}

export type StationPatResult = { ok: true; pat: string } | { ok: false; message: string };

/**
 * Mở phong bì PAT của MỘT kho — ngoại lệ duy nhất của luật ghi ở đầu tệp, nên nó cố ý hẹp.
 *
 * VÌ SAO CÓ: GitHub không cho xem lại một token đã phát. Khi cần dán lại PAT ấy — đặt tay Actions
 * secret cho kho, chạy `github:remove` cho một kho khác của cùng tài khoản, dựng thêm kho — thì sổ
 * này là bản duy nhất còn giữ nó. Không mở được nghĩa là mỗi lần cần đến, admin phải phát PAT mới
 * trên GitHub rồi đi cập nhật lại MỌI chỗ đang cầm cái cũ; cái giá ấy đắt hơn hẳn thứ đổi lại.
 *
 * VÌ SAO KHÔNG HẠ HÀNG RÀO: cùng cửa gác `github_station.manage` như mọi action khác, đúng MỘT
 * slug mỗi lượt, và chỉ chạy khi có người BẤM. Thứ quyết định「mở trang admin có kéo PAT xuống
 * không」là `viewOf`, và `viewOf` không đổi — nên một tab admin để mở vẫn không giữ PAT nào.
 *
 * Hai lời chẩn đoán ở đây trùng khít `pingStation`: phong bì hỏng và sai `ENCRYPTION_KEY` là hai
 * việc phải làm khác nhau, và cả hai đều kết thúc bằng「dán lại PAT」chứ không phải một câu về mã hoá.
 */
export async function revealGithubStationPatAction(slug: string): Promise<StationPatResult> {
  await requireStationManage();
  const settings = await getAppSettings();
  const station = settings.githubStations.find((s) => stationSlug(s) === slug);

  if (!station) {
    return { ok: false, message: `Không có kho「${slug}」trong sổ — có thể vừa bị xoá ở một tab khác.` };
  }
  if (!isEncrypted(station.pat)) {
    return { ok: false, message: "Phong bì PAT hỏng hoặc trống — dán lại PAT vào ô dưới." };
  }
  try {
    return { ok: true, pat: decryptSecret(station.pat) };
  } catch {
    return {
      ok: false,
      message: "Không giải mã được PAT — ENCRYPTION_KEY của trạm này khác lúc PAT được ghi. Dán lại PAT.",
    };
  }
}

/** Guarded form adapters: create provisions a real repository; update only edits an existing row. */
const stationForms = createGithubStationFormHandlers({
  requireManage: requireStationManage,
  provision: provisionGithubStation,
  activateDeferred: async (station, options) => {
    let pat = options.pat?.trim() ?? "";
    if (!pat) {
      if (!isEncrypted(station.pat)) throw new Error("stored PAT is not encrypted");
      pat = decryptSecret(station.pat);
    }
    return provisionGithubStation({
      pat,
      repo: station.repo,
      workflowFile: station.workflowFile,
      dailyPushes: options.dailyPushes ?? station.dailyPushes,
      workerId: station.workerId,
      activateDeferredSlug: stationSlug(station),
    });
  },
  getSettings: getAppSettings,
  mutate: mutateGithubState,
  whoami: productionGithubProvisionDependencies.whoami,
  encrypt: encryptSecret,
  isEncrypted,
  ping: (slug) => pingStationBySlug(slug, false),
  invalidate: (slug) => {
    revalidatePath("/admin");
    if (slug) revalidatePath(`/admin/github/${slug}`);
  },
});

export async function provisionGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  return stationForms.provision(formData);
}

export async function updateGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  return stationForms.update(formData);
}

/** Compatibility with already loaded admin clients; this path can never append a registration. */
export async function saveGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  return stationForms.saveLegacy(formData);
}
export async function deleteGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  await requireStationManage();
  const slug = String(formData.get("slug") ?? "").trim();
  const expectedGroup = String(formData.get("expectedGroup") ?? "");
  const result = await deletePrimaryGithubAccountGroup(slug, expectedGroup);
  // Cache refresh cannot turn a completed remote + database deletion into a retry prompt.
  try { revalidatePath("/admin"); } catch { /* The next request reads the committed registry. */ }
  try { revalidatePath("/admin/github/[owner]/[repo]", "page"); } catch { /* Same committed registry. */ }
  return result;
}

/**
 * Nút「Nuôi ngay」. `force: true` — người bấm muốn thấy một commit thật, không muốn nghe「còn hạn」.
 * Luật `disabled_manually` vẫn đứng: xem `pingStation`.
 */
export async function pingGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  await requireStationManage();
  const slug = String(formData.get("slug") ?? "").trim();
  const result = await pingStationBySlug(slug, true);
  revalidatePath("/admin");
  return { ok: result.ok, message: `${result.slug}: ${result.note}` };
}

/**
 * Nút「Chạy vòng nuôi」— cùng HAI vòng kho chính + repo phụ mà /api/cron chạy mỗi ngày, chỉ
 * khác là do người bấm nên không qua cửa gác trạm đang hoạt động.
 *
 * `force: false` có chủ ý: đây là nút để DIỄN TẬP lượt cron và xem nó nói gì, không phải để ép
 * bốn kho cùng nhận một commit. Muốn ép một kho thì đã có nút「Nuôi ngay」của riêng dòng ấy.
 * Vòng Ollama có ngân sách riêng để chờ model quyết định và tạo source. dailyPushes là giới
 * hạn trên, không phải số commit bắt buộc phải đạt trong ngày.
 */
export async function runKeepaliveAction(
  _prev: StationResult | null,
  _formData: FormData,
): Promise<StationResult> {
  await requireStationManage();
  const startedAt = Date.now();
  const summary = await runKeepalive({ deadlineAt: startedAt + 10_000 });
  const companionSummary = await runCompanionNurture({ deadlineAt: startedAt + 240_000 });
  revalidatePath("/admin");
  revalidatePath("/admin/github/[owner]/[repo]", "page");

  const primaryParts = [
    summary.checked === 0 ? "Kho chính: không có kho đang bật để ngó" : `Kho chính: đã ngó ${summary.checked} kho`,
    summary.checked > 0 ? `ghi mốc ${summary.committed}` : null,
    summary.failed > 0 ? `HỎNG ${summary.failed}` : null,
    summary.skipped > 0 ? `bỏ lại ${summary.skipped} vì hết ngân sách thời gian` : null,
  ].filter((part) => part !== null);

  const companionParts = [
    companionSummary.checked === 0
      ? "Repo phụ: chưa có repo đang bật để nuôi"
      : `Repo phụ: đã xét ${companionSummary.checked} repo`,
    companionSummary.checked > 0 ? `đẩy ${companionSummary.pushed} commit` : null,
    companionSummary.checked > 0 ? `đã xử lý ${companionSummary.completed}` : null,
    companionSummary.failed > 0 ? `HỎNG ${companionSummary.failed}` : null,
    companionSummary.skipped > 0
      ? `chưa xử lý ${companionSummary.skipped} mục trong lượt này`
      : null,
  ].filter((part) => part !== null);

  return {
    ok: summary.failed === 0 && companionSummary.failed === 0,
    message: `${primaryParts.join(", ")}. ${companionParts.join(", ")}. Chi tiết từng kho ở danh sách trên.`,
  };
}
