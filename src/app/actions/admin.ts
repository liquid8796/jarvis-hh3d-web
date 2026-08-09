"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — module JS thuần của quest-engine, không có d.ts và không cần. Import từ
// module LÁ `cookies.mjs` chứ không qua runCycle.mjs, cùng lý do với automation.ts.
import { normalizeGameBaseUrl } from "@/lib/quest-engine/cookies.mjs";
import {
  canEditRoles,
  canManageUser,
  hasPermission,
  normalizeRoles,
  reviewRoleChange,
} from "@/lib/auth/permissions";
import { STORE_CLOSED_MESSAGE, purgeAllChat } from "@/lib/services/chat";
import {
  describeSweep,
  purgeChatMedia,
  purgeUserAvatars,
  type MediaSweepResult,
} from "@/lib/services/media";
import { getAppSettings, saveAppSettings } from "@/lib/services/settings";
import { adminCreate, adminDelete, adminUpdate, findById, setStatus } from "@/lib/services/users";
import { CHAT_PURGE_PHRASE, matchesChatPurgePhrase } from "@/lib/validation/chat";
import { parseTags } from "@/lib/validation/tags";
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
  usernameSchema,
} from "@/lib/validation/user";

/**
 * Tông môn actions. Mỗi hàm mở đầu bằng `requireAdmin()` — không có ngoại lệ, kể cả những
 * hành động "nhỏ" như duyệt một người: form nào cũng có thể bị giả mạo, guard thì không thể
 * bị bỏ qua.
 *
 * Sau guard là MA TRẬN (permissions.ts): mọi action đụng vào một người khác phải đọc lại
 * người ấy từ database rồi hỏi `canManageUser` — hỏi trên bản ghi THẬT, không phải trên
 * role mà form gửi kèm, vì form là thứ ngoài Internet chạm tới được. Một admin tự hạ quyền
 * hay tự khoá mình cũng bị chặn, vì control plane không còn ai giữ chìa là phòng khoá trái.
 */

export type AdminResult = { ok: boolean; message: string };

const statusSchema = z.enum(["pending", "active", "disabled"]);

/** Duyệt / tạm khoá / trả về hàng chờ. */
export async function setStatusAction(userId: string, status: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) {
    return { ok: false, message: "Trạng thái không hợp lệ." };
  }

  if (userId === admin.id && parsed.data !== "active") {
    return { ok: false, message: "Không thể tự khoá chính mình." };
  }

  const target = await findById(userId);
  if (!target) {
    return { ok: false, message: "Không tìm thấy đạo hữu này." };
  }
  // Đình quyền một Trưởng môn cũng chính là vô hiệu hoá họ — nên nó đi qua đúng ma trận
  // như trục xuất, không có cửa riêng "chỉ đổi trạng thái thôi mà".
  if (userId !== admin.id && !canManageUser(admin, target)) {
    return { ok: false, message: "Trưởng môn không đụng được người mang vai — việc của Gia chủ." };
  }

  await setStatus(userId, parsed.data);
  revalidatePath("/admin");

  const verb =
    parsed.data === "active" ? "đã thu nhận" : parsed.data === "disabled" ? "đã bị đình quyền" : "trở lại hàng chờ";
  return { ok: true, message: `Đạo hữu ${verb}.` };
}

export async function createUserAction(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await requireAdmin();

  const parsed = z
    .object({
      username: usernameSchema,
      displayName: displayNameSchema,
      email: emailSchema,
      password: passwordSchema,
      status: statusSchema,
    })
    .safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password"),
      status: formData.get("status"),
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  // Vai của người mới cũng là ĐỔI VAI — checkbox nằm trong form của Gia chủ, nhưng luật thì
  // gác ở đây: admin thường gửi kèm field roles là bị từ chối, không phải bị lặng lẽ bỏ qua.
  const requestedRoles = normalizeRoles(formData.getAll("roles").map(String));
  if (requestedRoles.length > 0 && !canEditRoles(admin)) {
    return { ok: false, message: "Chỉ Gia chủ mới được ban vai." };
  }

  const result = await adminCreate({ ...parsed.data, roles: requestedRoles });
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  revalidatePath("/admin");
  return { ok: true, message: `Đã thu nhận「${parsed.data.displayName}」vào tông môn.` };
}

export async function updateUserAction(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return { ok: false, message: "Thiếu định danh đạo hữu." };
  }

  // Mật khẩu để trống nghĩa là "giữ nguyên" — nên nó chỉ được kiểm khi có nhập.
  const password = String(formData.get("password") ?? "");
  const parsed = z
    .object({
      displayName: displayNameSchema,
      email: emailSchema,
      status: statusSchema,
      password: z.union([passwordSchema, z.literal("")]),
    })
    .safeParse({
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      status: formData.get("status"),
      password,
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  const target = await findById(userId);
  if (!target) {
    return { ok: false, message: "Không tìm thấy đạo hữu này." };
  }
  if (userId !== admin.id && !canManageUser(admin, target)) {
    return { ok: false, message: "Trưởng môn không đụng được người mang vai — việc của Gia chủ." };
  }
  if (userId === admin.id && parsed.data.status !== "active") {
    return { ok: false, message: "Không thể tự khoá chính mình." };
  }

  const tagsParsed = parseTags(String(formData.get("tags") ?? ""));
  if (!tagsParsed.ok) {
    return { ok: false, message: tagsParsed.error };
  }

  // Vai: form của Gia chủ gửi kèm cờ `rolesSubmitted` — "phần vai CÓ mặt trong form này".
  // Thiếu cờ = form không bày phần vai (admin thường) = giữ nguyên. Khác hẳn "bỏ hết tick"
  // của Gia chủ, thứ PHẢI hiểu là thu mọi vai — không có cờ thì hai ý ấy trùng hình dạng
  // (cùng là danh sách rỗng) và không phân xử nổi.
  let nextRoles: string[] | undefined;
  if (formData.get("rolesSubmitted") !== null) {
    nextRoles = normalizeRoles(formData.getAll("roles").map(String));
    const sameRoles =
      nextRoles.length === target.roles.length && nextRoles.every((r) => target.roles.includes(r));
    if (!sameRoles) {
      const refusal = reviewRoleChange(admin, target, nextRoles);
      if (refusal) {
        return { ok: false, message: refusal };
      }
    }
  }

  const result = await adminUpdate(userId, {
    displayName: parsed.data.displayName,
    email: parsed.data.email,
    roles: nextRoles,
    tags: tagsParsed.tags,
    status: parsed.data.status,
    password: parsed.data.password || undefined,
  });

  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  revalidatePath("/admin");
  return { ok: true, message: "Đã cập nhật đạo hữu." };
}

export async function deleteUserAction(userId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) {
    return { ok: false, message: "Không thể tự trục xuất chính mình." };
  }

  const target = await findById(userId);
  if (!target) {
    return { ok: false, message: "Không tìm thấy đạo hữu này." };
  }
  if (!canManageUser(admin, target)) {
    return { ok: false, message: "Trưởng môn không trục xuất được người mang vai — việc của Gia chủ." };
  }

  const result = await adminDelete(userId);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  /**
   * Ảnh đại diện là thứ DUY NHẤT của một đạo hữu không nằm trong Postgres, nên nó là thứ duy
   * nhất không tự chết theo dòng users: cấu hình, job, nhật ký đều đi theo `on delete cascade`
   * của schema, còn bytes trong OCI thì không có ràng buộc nào biết tới chúng.
   *
   * SAU khi xoá dòng, không phải trước: xoá bytes trước rồi lệnh xoá dòng ngã ngựa là để lại
   * một thành viên còn nguyên với ảnh vỡ. Và đi theo TIỀN TỐ nên nó dọn cả những ảnh cũ mà một
   * lần đổi ảnh trước đây có thể đã không xoá được.
   *
   * Trượt thì KHÔNG làm lượt trục xuất thất bại — người ấy đã rời tông môn thật rồi, báo
   * "không trục xuất được" là nói sai. Chỉ kể thêm một câu để trưởng môn biết còn bytes nằm lại.
   */
  let leftovers = "";
  try {
    const sweep = await purgeUserAvatars(userId);
    if (!sweep.storeClosed && (sweep.failed > 0 || sweep.firstError !== null)) {
      leftovers = ` Ảnh đại diện chưa dọn hết: ${describeSweep(sweep)}`;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    leftovers = ` Ảnh đại diện còn nằm trong tàng khố: ${reason}`;
  }

  revalidatePath("/admin");
  return { ok: !leftovers, message: `Đã trục xuất đạo hữu khỏi tông môn.${leftovers}` };
}

/**
 * Môn quy — công tắc xét duyệt, ở tab "Môn Đồ" ngay cạnh hàng chờ mà nó cai quản.
 *
 * `formData.get()` trả `null` khi checkbox KHÔNG được tick, vì trình duyệt đơn giản là không
 * gửi field ấy đi. Nên `null` ở đây phải đọc là "TẮT", không phải "giữ nguyên" — đọc nhầm
 * một lần là công tắc thành đường một chiều: bật được, không bao giờ tắt được.
 */
export async function saveMembershipSettingsAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  await requireAdmin();

  const requireApproval = formData.get("requireApproval") !== null;

  const settings = await getAppSettings();
  settings.membership.requireApproval = requireApproval;
  await saveAppSettings(settings);

  // Chỉ /admin cần gọi tên ở đây. Trang bái sư cũng đổi lời theo công tắc này, nhưng nó tự
  // khai `force-dynamic` nên vẽ lại từ database ở MỌI lượt ghé — nhắc tên nó ở đây chỉ khiến
  // người đọc sau tưởng trang ấy có cache để mà xoá.
  revalidatePath("/admin");

  return {
    ok: true,
    message: requireApproval
      ? "Cổng tông môn đã có người gác — người mới bái sư sẽ vào hàng chờ."
      : "Cổng tông môn đã mở — người mới bái sư được thu nhận ngay, không qua hàng chờ.",
  };
}

/**
 * Đổi tên miền hoathinh3d đang sống.
 *
 * Site đổi TLD định kỳ (mx → am → one → …), và trước bản này mỗi cú dời bắt cả tông môn
 * đứng im chờ một lần deploy chỉ để sửa ba ký tự — đêm 07/08/2026 mất nhiều giờ đúng vì
 * chuyện đó. Giờ trưởng môn gõ tên miền mới, và vòng chạy KẾ TIẾP của mọi khôi lỗi (VM tông
 * môn lẫn máy nhà từng đạo hữu) đã dùng nó, vì tên miền đi kèm mỗi lần phát việc.
 *
 * KHÔNG đụng tới cookie đã lưu, và đó là chủ ý: cookie gắn chặt vào tên miền nên sau một cú
 * dời chúng đã chết sẵn — nhưng xoá hộ là tự tay vứt thứ duy nhất còn dùng được nếu trưởng
 * môn gõ nhầm rồi sửa lại. Việc của action này là nói thẳng ra điều đó.
 */
export async function saveGameDomainAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  await requireAdmin();

  const parsed = normalizeGameBaseUrl(String(formData.get("baseUrl") ?? ""));
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }

  const settings = await getAppSettings();
  const previous = settings.game.baseUrl;
  if (previous === parsed.baseUrl) {
    return { ok: true, message: `Tên miền vẫn là ${parsed.baseUrl} — không có gì để đổi.` };
  }

  settings.game.baseUrl = parsed.baseUrl;
  await saveAppSettings(settings);
  await notifyDashboard({ userId: "*", topic: "config" });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      `Đã đổi tên miền: ${previous} → ${parsed.baseUrl}. Khôi lỗi dùng ngay từ vòng kế. ` +
      "LƯU Ý: cookie gắn theo tên miền, nên mọi tài khoản phải dán lại chuỗi cookie lấy từ " +
      "tên miền mới, nếu không lượt chạy sẽ báo hết phiên đăng nhập.",
  };
}

/** Trần ước lượng: một ngày. Trùng tu lâu hơn thế thì con số không còn là ước lượng nữa. */
const MAINTENANCE_MAX_MINUTES = 24 * 60;
const MAINTENANCE_MAX_NOTE = 500;

/**
 * Khai bảo trì HOẶC dời hạn chót khi đang bảo trì — cùng một form, cùng một action.
 *
 * `startedAt` chỉ được đặt ở lần BẬT đầu tiên và giữ nguyên khi gia hạn: nó là chân trái
 * của thanh tiến độ, đổi nó giữa chừng là thanh tiến độ nhảy ngược trước mắt người xem.
 * `expectedEndAt` thì luôn tính lại từ BÂY GIỜ + số phút — trưởng môn đang trả lời câu
 * "còn bao lâu nữa", không phải "tổng cộng bao lâu".
 *
 * NOTIFY với userId "*" — mọi Auto đang mở đều nhận frame trong giây kế tiếp; ai vào
 * sau nhận qua SSR. Không có đường nào phải đợi nhịp poll 30 giây.
 */
export async function startMaintenanceAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  await requireAdmin();

  const minutes = Number(formData.get("minutes"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAINTENANCE_MAX_MINUTES) {
    return { ok: false, message: `Ước lượng phải là số phút nguyên trong khoảng 1–${MAINTENANCE_MAX_MINUTES}.` };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > MAINTENANCE_MAX_NOTE) {
    return { ok: false, message: `Lời nhắn tối đa ${MAINTENANCE_MAX_NOTE} ký tự.` };
  }

  const settings = await getAppSettings();
  const now = new Date();
  const extending = settings.maintenance.active && settings.maintenance.startedAt !== null;
  settings.maintenance = {
    active: true,
    startedAt: extending ? settings.maintenance.startedAt : now.toISOString(),
    expectedEndAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
    note,
  };
  await saveAppSettings(settings);
  await notifyDashboard({ userId: "*", topic: "config" });

  revalidatePath("/admin");
  return {
    ok: true,
    message: extending
      ? `Đã dời hạn chót: còn khoảng ${minutes} phút nữa.`
      : `Tông môn bắt đầu bế quan trùng tu — dự kiến ${minutes} phút. Cửa phát việc đã đóng; đàn đang chạy sẽ hoàn thành nốt vòng.`,
  };
}

export async function endMaintenanceAction(): Promise<AdminResult> {
  await requireAdmin();

  const settings = await getAppSettings();
  if (!settings.maintenance.active) {
    return { ok: false, message: "Tông môn có đang bế quan đâu mà mở cửa." };
  }

  settings.maintenance = { active: false, startedAt: null, expectedEndAt: null, note: "" };
  await saveAppSettings(settings);
  await notifyDashboard({ userId: "*", topic: "config" });

  revalidatePath("/admin");
  return {
    ok: true,
    message: "Đã mở cửa trở lại — cửa phát việc mở, các đàn nằm chờ sẽ tự chạy tiếp từ vòng kế.",
  };
}

/**
 * Cấu hình đàm đạo — tab "Đàm Đạo" của trang Tông Môn. Đọc-sửa-ghi trọn document qua Zod,
 * nên một field mới thêm vào schema sau này không bị form cũ ghi đè mất.
 */
export async function saveChatSettingsAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  await requireAdmin();

  const days = Number(formData.get("retentionDays"));
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { ok: false, message: "Hạn lưu phải là số ngày nguyên trong khoảng 1–365." };
  }

  const settings = await getAppSettings();
  settings.chat.retentionDays = days;
  await saveAppSettings(settings);

  revalidatePath("/admin");
  return { ok: true, message: `Đã đặt hạn lưu đàm đạo: tin sống ${days} ngày rồi tự tan.` };
}

/**
 * Thanh tẩy sảnh đàm đạo — xoá SẠCH tin trong tàng thư (Mongo) và bytes đính kèm trong tàng
 * khố media (OCI). Không có đường lui.
 *
 * BA hàng rào, và không cái nào thừa:
 *   1. `requireAdmin()` như mọi action ở đây.
 *   2. Quyền `chat.purge` — bảng quyền chỉ ban nó cho Gia chủ. Cùng một mạch lý lẽ với
 *      `deleteMessage`: thu hồi lời nói là việc của người đã nói, nên để một Trưởng môn xoá
 *      trắng lịch sử đàm đạo của cả tông môn thì sảnh chung thành thứ ai cầm quyền nấy viết
 *      lại. Và permissions.ts đã nói rõ vì sao admin không được là quyền lớn nhất — "admin
 *      nào cũng chỉ an toàn cho tới khi một admin khác đổi ý". Hỏi QUYỀN chứ không hỏi
 *      `isOwner` để nút bấm ở trang Tông Môn và hàng rào ở đây hỏi đúng một câu.
 *   3. Gõ tay câu xác nhận. Hàng rào này KHÔNG phải để chống kẻ gian (kẻ gian đã qua được
 *      hàng rào 2 thì gửi thẳng chuỗi ấy) mà để chống chính mình lúc bấm nhầm — nhưng nó
 *      vẫn được soát ở server, vì form là thứ ngoài Internet chạm tới được và một action
 *      xoá sạch không nên gọi được bằng một cú POST trống.
 *
 * THỨ TỰ tin trước, bytes sau — cố ý:
 *   • Quét bytes trước rồi tin ngã ngựa ⇒ cả sảnh treo đầy ảnh vỡ, ai cũng thấy.
 *   • Xoá tin trước rồi bytes ngã ngựa ⇒ vài tệp mồ côi nằm im, không ai thấy, và lần bấm
 *     sau dọn nốt vì phép quét đi theo TIỀN TỐ chứ không theo URL trong tin.
 * Hỏng nửa chừng là chuyện phải tính tới, nên chọn nửa nào hỏng thì đỡ đau hơn.
 */
export async function purgeChatAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!hasPermission(admin, "chat.purge")) {
    return { ok: false, message: "Thanh tẩy cả sảnh là việc của Gia chủ — Trưởng môn không mở được cửa này." };
  }
  if (!matchesChatPurgePhrase(String(formData.get("confirm") ?? ""))) {
    return { ok: false, message: `Gõ đúng「${CHAT_PURGE_PHRASE}」vào ô xác nhận rồi hãy bấm.` };
  }

  const wiped = await purgeAllChat();
  if (wiped.storeClosed) {
    return { ok: false, message: STORE_CLOSED_MESSAGE };
  }

  // Cấu hình media đặt nửa vời thì `purgeChatMedia` NÉM (xem services/media.ts) — bắt lại ở
  // đây để lời báo nói được cả hai chuyện: tin đã xoá xong, còn bytes thì chưa và vì sao.
  let sweep: MediaSweepResult;
  try {
    sweep = await purgeChatMedia();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Đã xoá ${wiped.messages} tin khỏi tàng thư, nhưng không quét được tàng khố media: ${reason}`,
    };
  }

  const partial = !sweep.storeClosed && (sweep.failed > 0 || sweep.firstError !== null);
  return {
    ok: !partial,
    message: `Đã thanh tẩy sảnh đàm đạo: xoá ${wiped.messages} tin. ${describeSweep(sweep)}`,
  };
}
