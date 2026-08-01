"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/guards";
import { configSchema } from "@/lib/services/configs";
import { saveConfig } from "@/lib/services/configs";
import { requestStop, startJob } from "@/lib/services/jobs";

/**
 * Automation server actions — every one re-derives the caller from the session and
 * re-checks `active` status. The form can lie; the guard cannot be skipped.
 */

export type ActionResult = { ok: boolean; message: string };

export async function saveConfigAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  const parsed = configSchema.safeParse({
    gameCookie: String(formData.get("gameCookie") ?? ""),
    quests: {
      meCung: {
        enabled: formData.get("meCungEnabled") === "on",
        mode: String(formData.get("meCungMode") ?? "is-normal"),
        kickHp: Number(formData.get("meCungKickHp") ?? 0) || 0,
        capCheck: formData.get("meCungCapCheck") === "on",
      },
      luyenDan: {
        enabled: formData.get("luyenDanEnabled") === "on",
        tier: String(formData.get("luyenDanTier") ?? "Hạ Phẩm"),
        keepStarsFrom: Number(formData.get("luyenDanKeepStars") ?? 0) || 0,
      },
    },
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Cấu hình không hợp lệ." };
  }

  await saveConfig(user.id, parsed.data);
  revalidatePath("/dashboard");
  return { ok: true, message: "Đã khắc cấu hình vào ngọc giản. Lượt khai đàn kế tiếp sẽ dùng bản này." };
}

export async function startAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const result = await startJob(user.id);
  revalidatePath("/dashboard");
  return result.ok
    ? { ok: true, message: "Đàn pháp đã lập — linh sứ sẽ tiếp nhận trong giây lát." }
    : { ok: false, message: result.error };
}

export async function stopAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  await requestStop(user.id);
  revalidatePath("/dashboard");
  return { ok: true, message: "Đã gửi lệnh thu đàn." };
}
