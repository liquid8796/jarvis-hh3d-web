"use server";

import { redirect } from "next/navigation";
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

  await createSession({
    sub: result.user.id,
    username: result.user.username,
    role: result.user.role,
  });

  // Fresh registrations are always pending — land them in the waiting room, which explains
  // the approval step instead of a dashboard full of locked doors.
  redirect("/pending");
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

  redirect(user.role === "admin" ? "/admin" : user.status === "active" ? "/dashboard" : "/pending");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
