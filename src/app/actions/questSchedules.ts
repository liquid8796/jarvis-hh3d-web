"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { saveQuestSchedules } from "@/lib/services/settings";
import { parseQuestSchedules, QuestScheduleLegacyJobsError } from "@/lib/validation/questSchedules";
import type { AdminResult } from "./admin";

export async function saveQuestSchedulesAction(
  _previous: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  await requireAdmin();

  const payload = formData.get("questSchedules");
  if (typeof payload !== "string") {
    return { ok: false, message: "Dữ liệu lịch nhiệm vụ không hợp lệ." };
  }
  let rules: unknown;
  try {
    rules = JSON.parse(payload);
  } catch {
    return { ok: false, message: "Dữ liệu lịch nhiệm vụ không hợp lệ." };
  }
  const parsed = parseQuestSchedules(rules);
  if (!parsed.ok) return parsed;

  try {
    await saveQuestSchedules(parsed.value);
  } catch (error) {
    if (error instanceof QuestScheduleLegacyJobsError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Chưa lưu được lịch nhiệm vụ. Hãy thử lại." };
  }
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, message: "Đã lưu lịch nhiệm vụ." };
}
