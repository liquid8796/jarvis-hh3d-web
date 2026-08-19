"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { pingStationBySlug, runCompanionNurture, runKeepalive } from "@/lib/services/githubStations";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";
import {
  DEFAULT_DAILY_PUSHES,
  DEFAULT_WORKFLOW_FILE,
  MAX_DAILY_PUSHES,
  MIN_DAILY_PUSHES,
  MS_PER_DAY,
  SCHEDULE_DISABLE_DAYS,
  reviewStationIdentity,
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

export type StationResult = { ok: boolean; message: string };

/** Hình chiếu an toàn cho client: KHÔNG mang phong bì PAT, chỉ mang dấu vết đủ để vận hành. */
export type StationView = {
  /** `owner/repo` — khoá tra của mọi action, và cũng là thứ hiện trên giao diện. */
  slug: string;
  owner: string;
  repo: string;
  workflowFile: string;
  workerId: string;
  enabled: boolean;
  lastPingAt: string | null;
  lastCommitAt: string | null;
  lastPingOk: boolean | null;
  lastPingNote: string;
  workflowState: string;
  /** Hai kho phần mềm cùng owner/PAT; chỉ mang dấu vết vận hành, không mang thêm bí mật. */
  companionRepos: Array<{
    repo: string;
    lastNurtureDay: string | null;
    pushesToday: number;
    lastPushAt: string | null;
    lastPushOk: boolean | null;
    lastPushNote: string;
  }>;
  /** Số commit nuôi cần đẩy lên MỖI kho phụ mỗi ngày; 0 là admin tạm dừng. */
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
    workflowFile: station.workflowFile,
    workerId: station.workerId,
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
    })),
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

/**
 * Thêm/sửa một kho, rồi NGÓ NGAY — cùng lối với `saveMirrorAction`: một PAT dán nhầm phải chết
 * ở đây, trước mặt người vừa dán, chứ không phải trong một lượt cron lúc ba giờ sáng.
 *
 * Lượt ngó ấy đi qua `force: false`, và chỗ ấy quan trọng hơn vẻ ngoài của nó:
 *   • Kho MỚI chưa có `lastCommitAt` nên đằng nào cũng tới hạn → nó ghi một commit thật, tức
 *     chứng minh trọn đường「PAT push được mã vào kho này」ngay lúc lưu.
 *   • Kho CŨ sửa mỗi cái `workerId` thì không tới hạn → chỉ một lượt GET, không rác một commit
 *     nào vào kho người ta chỉ vì admin gõ lại một cái nhãn.
 */
export async function saveGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  await requireStationManage();

  const owner = String(formData.get("owner") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();
  const workflowFile = String(formData.get("workflowFile") ?? "").trim() || DEFAULT_WORKFLOW_FILE;
  const workerId = String(formData.get("workerId") ?? "").trim();
  const patInput = String(formData.get("pat") ?? "").trim();
  const enabled = formData.get("enabled") === "on";

  const complaint = reviewStationIdentity(owner, repo, workflowFile);
  if (complaint) {
    return { ok: false, message: complaint };
  }
  if (workerId.length > 120) {
    return { ok: false, message: "WORKER_ID dài quá 120 ký tự — chép nhầm gì rồi." };
  }
  // Khoảng trắng trong PAT gần như luôn là lỗi chép-dán (nuốt cả dấu xuống dòng của terminal),
  // và nó sẽ đi thẳng vào một header HTTP. Chặn ở đây thay vì để GitHub trả 401 khó hiểu.
  if (patInput.length > 0 && /\s/.test(patInput)) {
    return { ok: false, message: "PAT có khoảng trắng — chép lại, đừng kèm dấu xuống dòng." };
  }

  const settings = await getAppSettings();
  const slug = `${owner}/${repo}`;
  const existing = settings.githubStations.find((s) => stationSlug(s) === slug);

  // Client cũ không gửi trường này: giữ giá trị đang lưu (hoặc mặc định cho kho mới) thay vì
  // vô tình tạm dừng cả hai kho phụ trong một lượt sửa PAT/WORKER_ID không liên quan.
  const dailyPushesInput = formData.get("dailyPushes");
  let dailyPushes = existing?.dailyPushes ?? DEFAULT_DAILY_PUSHES;
  if (dailyPushesInput !== null) {
    const raw = String(dailyPushesInput).trim();
    if (!/^\d+$/.test(raw)) {
      return {
        ok: false,
        message: `Số lượt đẩy mỗi ngày phải là số nguyên từ ${MIN_DAILY_PUSHES} đến ${MAX_DAILY_PUSHES}.`,
      };
    }
    dailyPushes = Number(raw);
    if (!Number.isSafeInteger(dailyPushes) || dailyPushes < MIN_DAILY_PUSHES || dailyPushes > MAX_DAILY_PUSHES) {
      return {
        ok: false,
        message: `Số lượt đẩy mỗi ngày phải nằm trong khoảng ${MIN_DAILY_PUSHES}–${MAX_DAILY_PUSHES}; chọn 0 để tạm dừng.`,
      };
    }
  }

  const hasCompanionFields = formData.has("companionRepo1") || formData.has("companionRepo2");
  const submittedCompanionNames = hasCompanionFields
    ? ["companionRepo1", "companionRepo2"].map((field) => String(formData.get(field) ?? "").trim())
    : (existing?.companionRepos.map((companion) => companion.repo) ?? []);
  const submittedFilledCompanionNames = submittedCompanionNames.filter((name) => name.length > 0);

  // Hai kho đi thành một cặp: nhận một tên rồi âm thầm bỏ kho còn lại sẽ làm scheduler chạy
  // một nửa công việc mà giao diện vẫn trông như đã cấu hình xong.
  if (submittedFilledCompanionNames.length === 1) {
    return { ok: false, message: "Cần đủ tên của cả hai kho phần mềm phụ, hoặc để trống cả hai cho kho khôi lỗi cũ." };
  }
  if (!existing && submittedFilledCompanionNames.length !== 2) {
    return { ok: false, message: "Kho khôi lỗi mới cần đúng hai kho phần mềm phụ để nuôi hằng ngày." };
  }

  const storedCompanions = existing?.companionRepos ?? [];
  if (storedCompanions.length > 0 && hasCompanionFields) {
    const storedNames = new Set(storedCompanions.map((companion) => companion.repo.toLowerCase()));
    const submittedNames = new Set(submittedFilledCompanionNames.map((name) => name.toLowerCase()));
    const isSamePair =
      submittedFilledCompanionNames.length === storedCompanions.length &&
      submittedNames.size === storedNames.size &&
      [...storedNames].every((name) => submittedNames.has(name));
    if (!isSamePair) {
      return {
        ok: false,
        message: "Cặp kho phụ là danh tính đã khoá; không thể đổi tên hoặc xoá qua form sửa kho.",
      };
    }
  }

  // Tên gửi lên chỉ là bằng chứng request vẫn trỏ đúng cặp cũ. Luôn dùng bản canonical đang lưu
  // để một request đổi hoa/thường (hoặc đảo hai ô) không đổi danh tính repo hay tách trace khỏi repo.
  // Station đời cũ có mảng rỗng là ngoại lệ duy nhất: nó được bổ sung đúng hai repo trong một lượt.
  const filledCompanionNames =
    storedCompanions.length > 0
      ? storedCompanions.map((companion) => companion.repo)
      : submittedFilledCompanionNames;
  for (const [index, companionRepo] of filledCompanionNames.entries()) {
    const companionComplaint = reviewStationIdentity(owner, companionRepo, DEFAULT_WORKFLOW_FILE);
    if (companionComplaint) {
      return { ok: false, message: `Kho phần mềm phụ ${index + 1}: ${companionComplaint}` };
    }
  }
  const distinctRepos = new Set([repo, ...filledCompanionNames].map((name) => name.toLowerCase()));
  if (distinctRepos.size !== 1 + filledCompanionNames.length) {
    return { ok: false, message: "Kho khôi lỗi và hai kho phần mềm phụ phải có ba tên khác nhau." };
  }

  if (!existing && patInput.length === 0) {
    return { ok: false, message: "Kho mới cần một PAT — không có chìa thì không nuôi được." };
  }

  // Ô để trống nghĩa là「giữ phong bì cũ」, cùng luật với sổ gương trạm: admin sửa mỗi cái
  // WORKER_ID không phải lục lại token từ két.
  const patEnvelope = patInput
    ? encryptSecret(patInput)
    : existing && isEncrypted(existing.pat)
      ? existing.pat
      : "";
  if (patEnvelope.length === 0) {
    return { ok: false, message: "Kho này chưa có PAT hợp lệ trong sổ — dán một cái mới vào ô PAT." };
  }

  const entry: AppSettings["githubStations"][number] = {
    owner,
    repo,
    workflowFile,
    workerId,
    pat: patEnvelope,
    enabled,
    // Dấu vết GIỮ NGUYÊN qua lượt sửa: `lastCommitAt` là mốc đếm ngược tới ngày GitHub tắt lịch,
    // và xoá nó vì admin đổi một cái nhãn là vứt đúng con số duy nhất nói được kho còn bao lâu.
    lastPingAt: existing?.lastPingAt ?? null,
    lastCommitAt: existing?.lastCommitAt ?? null,
    lastPingOk: existing?.lastPingOk ?? null,
    lastPingNote: existing?.lastPingNote ?? "",
    workflowState: existing?.workflowState ?? "",
    dailyPushes,
    companionRepos:
      storedCompanions.length > 0
        ? storedCompanions.map((companion) => ({ ...companion }))
        : filledCompanionNames.map((companionRepo) => ({
            repo: companionRepo,
            lastNurtureDay: null,
            pushesToday: 0,
            lastPushAt: null,
            lastPushOk: null,
            lastPushNote: "",
          })),
  };

  settings.githubStations = existing
    ? settings.githubStations.map((s) => (stationSlug(s) === slug ? entry : s))
    : [...settings.githubStations, entry];
  await saveAppSettings(settings);

  // Ngó SAU khi lưu, không phải trước: `pingStationBySlug` đọc sổ, nên dòng phải nằm sẵn ở đó —
  // và nhờ thứ tự ấy, kết quả lượt ngó cũng được ghi thẳng vào dòng vừa lưu.
  const ping = await pingStationBySlug(slug, false);
  revalidatePath("/admin");

  return {
    ok: ping.ok,
    message: `${existing ? "Đã cập nhật" : "Đã ghi"} kho「${slug}」. ${ping.note}`,
  };
}

export async function deleteGithubStationAction(
  _prev: StationResult | null,
  formData: FormData,
): Promise<StationResult> {
  await requireStationManage();
  const slug = String(formData.get("slug") ?? "").trim();
  const settings = await getAppSettings();
  if (!settings.githubStations.some((s) => stationSlug(s) === slug)) {
    return { ok: false, message: `Không có kho「${slug}」trong sổ.` };
  }
  settings.githubStations = settings.githubStations.filter((s) => stationSlug(s) !== slug);
  await saveAppSettings(settings);
  revalidatePath("/admin");
  return {
    ok: true,
    message:
      `Đã xoá station「${slug}」khỏi sổ. Repo khôi lỗi và cặp repo software trên GitHub đều ` +
      "được giữ nguyên; từ nay vòng tự động không nuôi repo nào trong bundle ấy nữa.",
  };
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
 * Hai deadline chép đúng phần ngân sách GitHub của cron: tránh ghép hai vòng 40 giây thành một
 * server action 80 giây. Repo bị partial/skipped phải chạy lại trong CÙNG ngày nếu muốn đủ quota;
 * ngày mai mở quota mới chứ không bù số commit còn thiếu của hôm nay.
 */
export async function runKeepaliveAction(
  _prev: StationResult | null,
  _formData: FormData,
): Promise<StationResult> {
  await requireStationManage();
  const startedAt = Date.now();
  const summary = await runKeepalive({ deadlineAt: startedAt + 10_000 });
  const companionSummary = await runCompanionNurture({ deadlineAt: startedAt + 45_000 });
  revalidatePath("/admin");

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
    companionSummary.checked > 0 ? `đạt quota ${companionSummary.completed}` : null,
    companionSummary.failed > 0 ? `HỎNG ${companionSummary.failed}` : null,
    companionSummary.skipped > 0
      ? `bỏ lại ${companionSummary.skipped} vì hết ngân sách thời gian`
      : null,
  ].filter((part) => part !== null);

  return {
    ok: summary.failed === 0 && companionSummary.failed === 0,
    message: `${primaryParts.join(", ")}. ${companionParts.join(", ")}. Chi tiết từng kho ở danh sách trên.`,
  };
}
