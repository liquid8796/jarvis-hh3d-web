"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { changePassword, updateProfile } from "@/lib/services/users";
import { displayNameSchema, emailSchema, passwordSchema } from "@/lib/validation/user";

export type ProfileResult = { ok: boolean; message: string } | null;

/** A member may only edit their own public identity fields. */
export async function updateProfileAction(
  _prev: ProfileResult,
  formData: FormData,
): Promise<ProfileResult> {
  const user = await requireUser();
  const parsed = z
    .object({ displayName: displayNameSchema, email: emailSchema })
    .safeParse({
      displayName: formData.get("displayName"),
      email: formData.get("email"),
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  const result = await updateProfile(user.id, parsed.data);
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/pending");
  return { ok: true, message: "Đã lưu hồ sơ." };
}


export type PasswordResult = { ok: boolean; message: string } | null;

/** Đổi mật khẩu của chính phiên hiện tại; luôn xác minh mật khẩu cũ trước khi ghi. */
export async function updatePasswordAction(
  _prev: PasswordResult,
  formData: FormData,
): Promise<PasswordResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      currentPassword: z.string().min(1, "Nhập mật khẩu hiện tại."),
      newPassword: passwordSchema,
      confirmPassword: z.string(),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      path: ["confirmPassword"],
      message: "Hai lần nhập mật khẩu mới chưa khớp.",
    })
    .safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  const result = await changePassword(
    user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  return result.ok
    ? { ok: true, message: "Đã cập nhật mật khẩu." }
    : { ok: false, message: result.error };
}
