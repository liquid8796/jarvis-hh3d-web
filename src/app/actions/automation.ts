"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser } from "@/lib/auth/permissions";
import { requireActiveUser } from "@/lib/auth/guards";
import {
  addAccount,
  deleteAccount,
  renameAccount,
  setAccountEnabled,
  updateAccountCookie,
} from "@/lib/services/accounts";
import {
  configSchema,
  enforceMazeCapPolicy,
  enforceUnavailableQuestPolicy,
  saveConfig,
  setWorkerPref,
  workerPrefSchema,
} from "@/lib/services/configs";
import { getAppSettings } from "@/lib/services/settings";
import {
  clearVisibleJobEvents,
  getActiveJobs,
  requestStop,
  requestStopForAccount,
  startJob,
} from "@/lib/services/jobs";
// Import từ module LÁ, KHÔNG phải từ runCycle.mjs. runCycle kéo theo profile.mjs, mà module
// ấy đọc profile.json bằng `readFileSync(fileURLToPath(new URL(…)))` ngay ở thân module —
// dưới Turbopack, `URL` trong bundle không phải `URL` của Node, nên fileURLToPath ném lỗi
// lúc NẠP MODULE và kéo sập mọi server action của /dashboard. Xem đầu cookies.mjs.
//
// Chỗ này từng có `@ts-ignore` với lời ghi "module JS thuần, không có d.ts". Đã ĐO 09/08/2026:
// gỡ nó ra thì `tsc --noEmit` vẫn sạch — `allowJs` lo được, nên nó là dòng chết. Và import
// dưới đây trải nhiều dòng, tức lỗi module (nếu có) rơi ở dòng cuối, ngoài tầm che của một
// `@ts-ignore` đặt trên dòng đầu: nếu còn cần thật thì tsc đã đỏ ngay.
import {
  LOGIN_COOKIE_PREFIX,
  detectWordPressUser,
  parseCookieString,
} from "@/lib/quest-engine/cookies.mjs";

/**
 * Automation server actions — every one re-derives the caller from the session and
 * re-checks `active` status. The form can lie; the guard cannot be skipped.
 */

export type ActionResult = { ok: boolean; message: string };

type CookieInspection =
  | { ok: true; note: string; detectedUser: string | null }
  | { ok: false; message: string };

const COOKIE_MAX_LENGTH = 8000;

/**
 * Một nơi duy nhất soát chuỗi cookie cho cả nút thêm tài khoản lẫn nút thay cookie.
 *
 * `baseUrl` phải là tên miền ĐANG SỐNG do trưởng môn đặt, không phải hằng số trong mã nguồn:
 * bản xuất JSON của extension mang sẵn `domain`, và `parseCookieString` LOẠI mọi cookie
 * không thuộc tên miền đang nhắm tới. Đối chiếu với tên miền cũ sau một cú dời TLD nghĩa là
 * cookie mới dán đúng lại bị vứt sạch, rồi người dán nhận đúng câu「không đọc được」cho một
 * chuỗi hoàn toàn hợp lệ.
 */
function inspectCookie(pastedCookie: string, baseUrl: string): CookieInspection {
  const jar = parseCookieString(pastedCookie, baseUrl) as Array<{ name: string; value: string }>;

  if (jar.length === 0) {
    return {
      ok: false,
      // Chỉ đúng MỘT đường, và là đường mà ô nhập bên AccountManager cũng chỉ. Câu cũ mời
      // người ta đi DevTools hoặc Cookie-Editor — đọc xong vẫn không biết bấm vào đâu, và
      // giờ còn đá nhau với lời hướng dẫn ngay dưới ô dán.
      message:
        "Chuỗi cookie không đọc được — chưa lưu gì cả. Dùng tiện ích Chrome J2TEAM Cookies: " +
        "mở trang game đang đăng nhập, bấm vào tiện ích rồi chọn Export, dán nguyên chuỗi vừa " +
        "chép vào đây.",
    };
  }

  // Cùng MỘT phép nhận diện cho cả lời nhắn lẫn phép đoán tên, qua `LOGIN_COOKIE_PREFIX`.
  // Trước đây chỗ này so tiền tố lỏng hơn ("wordpress_logged_in", thiếu gạch dưới cuối);
  // để lệch nhau thì có ngày lời nhắn khoe「có phiên đăng nhập」trong khi phép đoán tên lại
  // bảo không thấy gì. WordPress luôn gắn COOKIEHASH sau dấu gạch dưới ấy nên siết lại
  // không mất trường hợp thật nào.
  const detectedUser = detectWordPressUser(jar);
  const hasLoginCookie = jar.some((cookie) =>
    cookie.name.toLowerCase().startsWith(LOGIN_COOKIE_PREFIX),
  );

  return {
    ok: true,
    detectedUser,
    note: hasLoginCookie
      ? ` Đã nhận ${jar.length} cookie, có phiên đăng nhập${detectedUser ? ` của「${detectedUser}」` : ""}.`
      : ` Đã nhận ${jar.length} cookie nhưng KHÔNG thấy cookie đăng nhập (wordpress_logged_in_…) — nếu lượt chạy báo hết phiên thì đây là lý do.`,
  };
}

/** Cookie từ form: cắt khoảng trắng, chặn rỗng và chặn phình — trước khi đụng tới mã hoá. */
function readCookieField(formData: FormData): { ok: true; cookie: string } | { ok: false; message: string } {
  const cookie = String(formData.get("cookie") ?? "").trim();
  if (cookie.length === 0) {
    return { ok: false, message: "Hãy dán chuỗi cookie tài khoản trước khi bấm lưu." };
  }
  if (cookie.length > COOKIE_MAX_LENGTH) {
    return { ok: false, message: `Chuỗi cookie dài bất thường (quá ${COOKIE_MAX_LENGTH} ký tự) — kiểm tra lại bản dán.` };
  }
  return { ok: true, cookie };
}

function readAccountId(formData: FormData): string | null {
  const id = String(formData.get("accountId") ?? "").trim();
  return id.length > 0 ? id : null;
}

export async function saveConfigAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  // Mười một nhiệm vụ một-công-tắc dùng chung một khuôn tên field: q_<key>.
  const simple = (key: string) => ({ enabled: formData.get(`q_${key}`) === "on" });

  /**
   * Hạn mức giữ đan — KẸP tại biên thay vì để Zod ném.
   *
   * Form khai `noValidate` (hai tab dùng `hidden`, một ô số invalid nằm trong tab đang ẩn sẽ
   * chặn cả lượt lưu — xem ghi chú ở thẻ `<form>`), nên `max={20}` của ô nhập không gác được
   * gì: con số gõ tay đi thẳng tới đây. Mà `safeParse` hỏng thì CẢ bản cấu hình không lưu
   * được, chỉ vì một ô. Kẹp lại rồi hiện đúng con số đã lưu là thứ người gõ 25 thực sự muốn.
   */
  const keepCapOf = (name: string) => {
    const raw = Math.trunc(Number(formData.get(name)));
    return Number.isFinite(raw) && raw >= 1 ? Math.min(20, raw) : 10;
  };
  /** Cùng lẽ: một giá trị lạ (POST dựng tay) rơi về nết mặc định, không giết cả lượt lưu. */
  const keepCapModeOf = (name: string) => (formData.get(name) === "stop" ? "stop" : "decompose");

  const parsed = configSchema.safeParse({
    // Cookie không đi đường này nữa — tài khoản sống ở bảng riêng với bộ action riêng.
    gameCookie: "",
    // Nơi vận hành đang KHOÁ về khôi lỗi máy nhà — ép ở đây chứ không tin form, vì
    // `disabled` chỉ là một thuộc tính HTML và một POST dựng tay chẳng đi qua form lần nào.
    runner: "local",
    quests: {
      meCung: {
        enabled: formData.get("meCungEnabled") === "on",
        mode: String(formData.get("meCungMode") ?? "is-normal"),
        kickHp: Number(formData.get("meCungKickHp") ?? 0) || 0,
        kickIdleSec: Number(formData.get("meCungKickIdle") ?? 0) || 0,
        capCheck: formData.get("meCungCapCheck") === "on",
        // Hai lời nhắn đi qua sanitizeChatMessage của schema — form không phải tự làm sạch.
        chatLobby: String(formData.get("meCungChatLobby") ?? ""),
        chatFight: String(formData.get("meCungChatFight") ?? ""),
      },
      // Hai bản Luyện Đan Đường — tab VIP và tab Thường là hai bộ field RIÊNG trên form
      // (tiền tố luyenDan / luyenDanThuong). Trước đây chỉ có một bộ dùng chung, và khắc
      // từ tab này là đè lựa chọn của tab kia.
      luyenDan: {
        enabled: formData.get("luyenDanEnabled") === "on",
        tier: String(formData.get("luyenDanTier") ?? "Hạ Phẩm"),
        keepStarsFrom: Number(formData.get("luyenDanKeepStars") ?? 0) || 0,
        keepCapEnabled: formData.get("luyenDanKeepCapEnabled") === "on",
        keepCap: keepCapOf("luyenDanKeepCap"),
        keepCapMode: keepCapModeOf("luyenDanKeepCapMode"),
      },
      luyenDanThuong: {
        enabled: formData.get("luyenDanThuongEnabled") === "on",
        tier: String(formData.get("luyenDanThuongTier") ?? "Hạ Phẩm"),
        keepStarsFrom: Number(formData.get("luyenDanThuongKeepStars") ?? 0) || 0,
        keepCapEnabled: formData.get("luyenDanThuongKeepCapEnabled") === "on",
        keepCap: keepCapOf("luyenDanThuongKeepCap"),
        keepCapMode: keepCapModeOf("luyenDanThuongKeepCapMode"),
      },
      diemDanh: simple("diemDanh"),
      hoangVuc: simple("hoangVuc"),
      phucLoiDuong: simple("phucLoiDuong"),
      thiLuyen: simple("thiLuyen"),
      biCanh: simple("biCanh"),
      teLe: simple("teLe"),
      phucLoiVip: simple("phucLoiVip"),
      vongQuay: simple("vongQuay"),
      vanDap: simple("vanDap"),
      hySuDuong: simple("hySuDuong"),
      phanThuongHoatDong: simple("phanThuongHoatDong"),
      // Hai bản Khoáng Mạch — cùng phép tách tab VIP/Thường như Luyện Đan Đường ngay trên.
      khoangMach: {
        enabled: formData.get("khoangMachEnabled") === "on",
        mineType: String(formData.get("khoangMachMineType") ?? "2"),
        mineName: String(formData.get("khoangMachMineName") ?? ""),
        minBonus: Number(formData.get("khoangMachMinBonus") ?? 0) || 0,
        buyPhu: formData.get("khoangMachBuyPhu") === "on",
        hostMode: formData.get("khoangMachHostMode") === "on",
        hostMinBonus: Number(formData.get("khoangMachHostMinBonus") ?? 100) || 0,
      },
      khoangMachThuong: {
        enabled: formData.get("khoangMachThuongEnabled") === "on",
        mineType: String(formData.get("khoangMachThuongMineType") ?? "2"),
        mineName: String(formData.get("khoangMachThuongMineName") ?? ""),
        minBonus: Number(formData.get("khoangMachThuongMinBonus") ?? 0) || 0,
        buyPhu: formData.get("khoangMachThuongBuyPhu") === "on",
        hostMode: formData.get("khoangMachThuongHostMode") === "on",
        hostMinBonus: Number(formData.get("khoangMachThuongHostMinBonus") ?? 100) || 0,
      },
    },
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Cấu hình không hợp lệ." };
  }

  // Luật tài nguyên chung, áp ở SERVER chứ không tin ô tick: giao diện đã khoá tuỳ chọn
  // này lại cho đạo hữu thường, nhưng `disabled` chỉ là một thuộc tính HTML và một POST
  // dựng tay chẳng đi qua form lần nào (cùng lý do `runner` bị ép ở trên).
  const guarded = enforceUnavailableQuestPolicy(
    enforceMazeCapPolicy(parsed.data, { isAdmin: isAdminUser(user) }),
  );
  await saveConfig(user.id, guarded);
  revalidatePath("/dashboard");

  // So THAM CHIẾU: hàm luật trả về chính vật cũ khi không phải sửa gì. Nói ra khi nó đã ra
  // tay — im lặng ghi đè một lựa chọn người ta vừa bấm là cách nhanh nhất để họ tin rằng
  // ngọc giản này không nghe lời mình.
  const overridden = guarded !== parsed.data;
  return {
    ok: true,
    message: overridden
      ? "Đã khắc cấu hình vào ngọc giản. Riêng「Dừng khi đã đủ huyền tinh」của Mê Cung được " +
        "bật lại: khôi lỗi tông môn là tài nguyên chung, chỉ tông chủ mới gỡ khoá ấy được."
      : "Đã khắc cấu hình vào ngọc giản. Nếu đàn đang chạy, vòng kế tiếp sẽ dùng bản này.",
  };
}

// ---------------------------------------------------------------------------
// Tài khoản game — thêm / thay cookie / đổi tên / bật-tắt / xoá
// ---------------------------------------------------------------------------

/** Thêm một tài khoản mới. Soát cookie NGAY LÚC DÁN — thời điểm trung thực nhất (bài học 02/08). */
export async function addAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const field = readCookieField(formData);
  if (!field.ok) return { ok: false, message: field.message };

  const inspection = inspectCookie(field.cookie, (await getAppSettings()).game.baseUrl);
  if (!inspection.ok) return inspection;

  // Ba nấc đặt tên, đúng thứ tự của bản PC (`GameAccount.ResolveLabel`): tên tự đặt → tên đọc
  // được từ cookie → tên đánh số. Nấc cuối do `addAccount` tự cấp, nên ở đây chỉ cần đưa
  // xuống chuỗi RỖNG khi hai nấc trên đều trống — `normalizeLabel` bên accounts.ts hiểu nhãn
  // rỗng là "dùng fallback", và đó vẫn là nơi duy nhất biết số thứ tự tài khoản.
  const typedLabel = String(formData.get("label") ?? "").trim();
  const result = await addAccount(
    user.id,
    typedLabel || inspection.detectedUser || "",
    field.cookie,
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Đã lưu「${result.account.label}」và mã hoá cookie.${inspection.note}`,
  };
}

/** Thay cookie của một tài khoản sẵn có — verdict hạng cũ bị xoá để khôi lỗi dò lại. */
export async function updateAccountCookieAction(formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const accountId = readAccountId(formData);
  if (!accountId) return { ok: false, message: "Thiếu tài khoản cần thay cookie." };

  const field = readCookieField(formData);
  if (!field.ok) return { ok: false, message: field.message };

  const inspection = inspectCookie(field.cookie, (await getAppSettings()).game.baseUrl);
  if (!inspection.ok) return inspection;

  const result = await updateAccountCookie(user.id, accountId, field.cookie);
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Đã thay cookie của「${result.account.label}」— hạng tài khoản sẽ được dò lại ở vòng chạy kế.${inspection.note}`,
  };
}

export async function renameAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const accountId = readAccountId(formData);
  if (!accountId) return { ok: false, message: "Thiếu tài khoản cần đổi tên." };

  const result = await renameAccount(user.id, accountId, String(formData.get("label") ?? ""));
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/dashboard");
  return { ok: true, message: `Đã đổi tên thành「${result.account.label}」.` };
}

/**
 * Bật/tắt một tài khoản. Tắt là rút khỏi vòng chạy NGAY: đàn của tài khoản đó (nếu có) được
 * thu trước rồi mới hạ cờ, để không còn khe nào cho một vòng mới len vào giữa hai bước.
 */
export async function toggleAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const accountId = readAccountId(formData);
  if (!accountId) return { ok: false, message: "Thiếu tài khoản cần bật/tắt." };
  const enabled = formData.get("enabled") === "on";

  let stoppedJob = false;
  if (!enabled) {
    stoppedJob = await requestStopForAccount(user.id, accountId);
  }

  const result = await setAccountEnabled(user.id, accountId, enabled);
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/dashboard");
  if (enabled) {
    return {
      ok: true,
      message: `Đã bật「${result.account.label}」— bấm Khai Đàn để tài khoản này bắt đầu chạy.`,
    };
  }
  return {
    ok: true,
    message: stoppedJob
      ? `Đã tắt「${result.account.label}」và gửi lệnh thu đàn cho tài khoản này.`
      : `Đã tắt「${result.account.label}」.`,
  };
}

/** Xoá tài khoản — kéo theo toàn bộ lịch sử chạy của nó. Từ chối khi đàn còn sống. */
export async function deleteAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const accountId = readAccountId(formData);
  if (!accountId) return { ok: false, message: "Thiếu tài khoản cần xoá." };

  // Xoá dưới chân một khôi lỗi đang chạy là bỏ nó bơ vơ với một job không còn tồn tại —
  // bắt dừng trước, xoá sau, và nói rõ vì sao.
  const active = await getActiveJobs(user.id);
  if (active.some((job) => job.accountId === accountId)) {
    return {
      ok: false,
      message: "Tài khoản này đang có đàn pháp chạy — tắt tài khoản (đàn sẽ được thu) rồi mới xoá được.",
    };
  }

  const result = await deleteAccount(user.id, accountId);
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/dashboard");
  return { ok: true, message: `Đã xoá「${result.label}」cùng lịch sử chạy của nó.` };
}

// ---------------------------------------------------------------------------
// Khai Đàn / Thu Đàn / dọn nhật ký
// ---------------------------------------------------------------------------

/**
 * Chọn LOẠI khôi lỗi sẽ cầm đàn: tông môn, máy nhà, hay ai rảnh trước cũng được.
 *
 * Lựa chọn được cất trong ngọc giản của đạo hữu (một khoá riêng, không đụng phần nhiệm vụ) và
 * có hiệu lực NGAY cả với những đàn đang nằm chờ — cửa phát việc đọc thẳng bảng cấu hình chứ
 * không đọc bản đông lạnh trong dòng job. Đàn đang chạy dở thì đi hết vòng này đã.
 */
export async function setWorkerPrefAction(pref: string): Promise<ActionResult> {
  const user = await requireActiveUser();

  // Giá trị tới từ trình duyệt — soát ở biên, không tin cái nút bấm. Một POST dựng tay không
  // đi qua radio nào cả, và giá trị lạ nằm trong JSONB sẽ làm mệnh đề lọc bên claim hiểu khác đi.
  const parsed = workerPrefSchema.safeParse(pref);
  if (!parsed.success) {
    return { ok: false, message: "Lựa chọn nơi chạy không hợp lệ — chưa đổi gì cả." };
  }

  await setWorkerPref(user.id, parsed.data);
  revalidatePath("/dashboard");

  // Đổi xong thì KHÔNG có gì để nói: cái nút vừa sáng lên đã trả lời rồi, và dòng ghi chú ngay
  // dưới nhóm nút vẫn luôn tả đúng lựa chọn đang chọn. Một câu xác nhận nhắc lại điều mắt vừa
  // thấy chỉ là tiếng ồn — nên chỉ nhánh HỎNG ở trên mới mang lời nhắn.
  return { ok: true, message: "" };
}

export async function startAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const result = await startJob(user.id);
  revalidatePath("/dashboard");

  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  const names = result.startedLabels.map((label) => `「${label}」`).join(" ");
  return {
    ok: true,
    message:
      result.alreadyRunning > 0
        ? `Đàn pháp đã lập thêm cho ${names} — ${result.alreadyRunning} tài khoản khác vẫn đang chạy.`
        : `Đàn pháp đã lập cho ${names} — khôi lỗi sẽ tự chạy các vòng cho tới khi bạn bấm Thu Đàn.`,
  };
}

/**
 * Dọn nhật ký của các lượt đang hiển thị. Không đụng tới lượt chạy: khôi lỗi vẫn làm việc, và
 * những dòng nó kể từ giây này trở đi vẫn hiện ra như thường.
 */
export async function clearLogAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const gone = await clearVisibleJobEvents(user.id);
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: gone > 0 ? `Đã dọn ${gone} dòng nhật ký.` : "Nhật ký vốn đã trống.",
  };
}

export async function stopAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  await requestStop(user.id);
  revalidatePath("/dashboard");
  return { ok: true, message: "Đã gửi lệnh thu đàn cho mọi tài khoản đang chạy." };
}
