"use server";

import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/auth/permissions";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth/session";
import { register, verifyCredentials } from "@/lib/services/users";
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
  usernameSchema,
} from "@/lib/validation/user";

/**
 * Auth server actions. Each returns `{ error }` for the form to show, or redirects on
 * success — the browser never sees a password beyond the POST that carries it.
 */

const registrationSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type FormState = { error: string } | null;

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registrationSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  }

  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== parsed.data.password) {
    return { error: "Mật khẩu nhập lại không khớp." };
  }

  const result = await register(parsed.data);
  if (!result.ok) {
    return { error: result.error };
  }

  // Claim `role` trong JWT là DI SẢN — không nơi nào đọc nó để phân quyền (guard nào cũng
  // đọc lại DB), giữ cho cookie cũ và mới cùng hình dạng. Ghi gương từ roles.
  await createSession({
    sub: result.user.id,
    username: result.user.username,
    role: isAdminUser(result.user) ? "admin" : "user",
  });

  // Đích đến do trạng thái THẬT vừa ghi xuống quyết định, không do đoán theo môn quy: giữa
  // lúc `register()` đọc công tắc và lúc này, trưởng môn có thể vừa gạt nó. Còn chờ duyệt
  // thì vào phòng chờ — nơi giải thích bước xét duyệt, thay vì một Auto toàn cửa khoá.
  redirect(result.user.status === "active" ? "/dashboard" : "/pending");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    return { error: "Điền đủ đạo hiệu và mật khẩu." };
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    return { error: "Đạo hiệu hoặc mật khẩu không đúng." };
  }

  await createSession({ sub: user.id, username: user.username, role: user.role });

  const next = String(formData.get("next") ?? "");
  if (next.startsWith("/") && !next.startsWith("//")) {
    redirect(next);
  }

  redirect(isAdminUser(user) ? "/admin" : user.status === "active" ? "/dashboard" : "/pending");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
