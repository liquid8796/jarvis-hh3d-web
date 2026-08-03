"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { updateProfile } from "@/lib/services/users";
import { displayNameSchema, emailSchema } from "@/lib/validation/user";

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
