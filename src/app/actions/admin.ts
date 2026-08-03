"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
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
