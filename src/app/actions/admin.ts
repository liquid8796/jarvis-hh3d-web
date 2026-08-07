"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — module JS thuần của quest-engine, không có d.ts và không cần. Import từ
// module LÁ `cookies.mjs` chứ không qua runCycle.mjs, cùng lý do với automation.ts.
import { normalizeGameBaseUrl } from "@/lib/quest-engine/cookies.mjs";
import { getAppSettings, saveAppSettings } from "@/lib/services/settings";
import { adminCreate, adminDelete, adminUpdate, setStatus } from "@/lib/services/users";
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
  usernameSchema,
} from "@/lib/validation/user";

/**
 * Tông môn actions. Mỗi hàm mở đầu bằng `requireAdmin()` — không có ngoại lệ, kể cả những
 * hành động "nhỏ" như duyệt một người: form nào cũng có thể bị giả mạo, guard thì không thể
 * bị bỏ qua. Một admin tự hạ quyền hay tự khoá mình cũng bị chặn ở đây, vì một control
 * plane không còn ai giữ chìa là một căn phòng khoá trái.
 */

export type AdminResult = { ok: boolean; message: string };

const statusSchema = z.enum(["pending", "active", "disabled"]);
const roleSchema = z.enum(["user", "admin"]);

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

  await setStatus(userId, parsed.data);
  revalidatePath("/admin");

  const verb =
    parsed.data === "active" ? "đã thu nhận" : parsed.data === "disabled" ? "đã bị đình quyền" : "trở lại hàng chờ";
  return { ok: true, message: `Đạo hữu ${verb}.` };
}

export async function createUserAction(_prev: AdminResult | null, formData: FormData): Promise<AdminResult> {
  await requireAdmin();

  const parsed = z
    .object({
      username: usernameSchema,
      displayName: displayNameSchema,
      email: emailSchema,
      password: passwordSchema,
      role: roleSchema,
      status: statusSchema,
    })
    .safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role"),
      status: formData.get("status"),
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  const result = await adminCreate(parsed.data);
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
      role: roleSchema,
      status: statusSchema,
      password: z.union([passwordSchema, z.literal("")]),
    })
    .safeParse({
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      role: formData.get("role"),
      status: formData.get("status"),
      password,
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  if (userId === admin.id && (parsed.data.role !== "admin" || parsed.data.status !== "active")) {
    return { ok: false, message: "Không thể tự hạ quyền hoặc tự khoá chính mình." };
  }

  const result = await adminUpdate(userId, {
    displayName: parsed.data.displayName,
    email: parsed.data.email,
    role: parsed.data.role,
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

  const result = await adminDelete(userId);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  revalidatePath("/admin");
  return { ok: true, message: "Đã trục xuất đạo hữu khỏi tông môn." };
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
 * chuyện đó. Giờ trưởng môn gõ tên miền mới, và vòng chạy KẾ TIẾP của mọi linh sứ (VM tông
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
      `Đã đổi tên miền: ${previous} → ${parsed.baseUrl}. Linh sứ dùng ngay từ vòng kế. ` +
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
 * NOTIFY với userId "*" — mọi Linh Đài đang mở đều nhận frame trong giây kế tiếp; ai vào
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
