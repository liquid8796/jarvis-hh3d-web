"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/guards";
import { clearCookie, configSchema, saveConfig } from "@/lib/services/configs";
import { clearLatestJobEvents, requestStop, startJob } from "@/lib/services/jobs";
// Import từ module LÁ, KHÔNG phải từ runCycle.mjs. runCycle kéo theo profile.mjs, mà module
// ấy đọc profile.json bằng `readFileSync(fileURLToPath(new URL(…)))` ngay ở thân module —
// dưới Turbopack, `URL` trong bundle không phải `URL` của Node, nên fileURLToPath ném lỗi
// lúc NẠP MODULE và kéo sập mọi server action của /dashboard. Xem đầu cookies.mjs.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — module JS thuần của quest-engine, không có d.ts và không cần.
import { DEFAULT_GAME_BASE_URL, parseCookieString } from "@/lib/quest-engine/cookies.mjs";

/**
 * Automation server actions — every one re-derives the caller from the session and
 * re-checks `active` status. The form can lie; the guard cannot be skipped.
 */

export type ActionResult = { ok: boolean; message: string };

export async function saveConfigAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireActiveUser();

  // Mười nhiệm vụ một-công-tắc dùng chung một khuôn tên field: q_<key>.
  const simple = (key: string) => ({ enabled: formData.get(`q_${key}`) === "on" });

  const parsed = configSchema.safeParse({
    gameCookie: String(formData.get("gameCookie") ?? ""),
    // Nơi vận hành đang KHOÁ về linh sứ máy nhà — ép ở đây chứ không tin form, vì
    // `disabled` chỉ là một thuộc tính HTML và một POST dựng tay chẳng đi qua form lần nào.
    runner: "local",
    quests: {
      meCung: {
        enabled: formData.get("meCungEnabled") === "on",
        mode: String(formData.get("meCungMode") ?? "is-normal"),
        kickHp: Number(formData.get("meCungKickHp") ?? 0) || 0,
        kickIdleSec: Number(formData.get("meCungKickIdle") ?? 0) || 0,
        capCheck: formData.get("meCungCapCheck") === "on",
      },
      luyenDan: {
        enabled: formData.get("luyenDanEnabled") === "on",
        tier: String(formData.get("luyenDanTier") ?? "Hạ Phẩm"),
        keepStarsFrom: Number(formData.get("luyenDanKeepStars") ?? 0) || 0,
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
      khoangMach: simple("khoangMach"),
    },
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Cấu hình không hợp lệ." };
  }

  // Soát cookie NGAY LÚC DÁN — thời điểm trung thực nhất, khi người dùng còn đứng đó và còn
  // sửa được. Bài học 02/08: một bản xuất JSON được lưu êm ả, parse ra số không, và sự thật
  // chỉ nổi lên ở một selector Mê Cung mười phút sau, dưới một cái tên chẳng liên quan.
  const pastedCookie = parsed.data.gameCookie.trim();
  let cookieNote = "";
  if (pastedCookie.length > 0) {
    const jar = parseCookieString(pastedCookie, process.env.GAME_BASE_URL || DEFAULT_GAME_BASE_URL) as {
      name: string;
    }[];
    if (jar.length === 0) {
      return {
        ok: false,
        message:
          "Chuỗi cookie không đọc được — chưa lưu gì cả. Hãy dán dạng 'a=1; b=2' copy từ DevTools, " +
          "hoặc nguyên bản xuất JSON của ứng dụng desktop.",
      };
    }

    cookieNote = jar.some((c) => c.name.startsWith("wordpress_logged_in"))
      ? ` Đã nhận ${jar.length} cookie, có phiên đăng nhập.`
      : ` Đã nhận ${jar.length} cookie nhưng KHÔNG thấy cookie đăng nhập (wordpress_logged_in_…) — nếu lượt chạy báo hết phiên thì đây là lý do.`;
  }

  await saveConfig(user.id, parsed.data);
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Đã khắc cấu hình vào ngọc giản. Lượt khai đàn kế tiếp sẽ dùng bản này.${cookieNote}`,
  };
}

/** Rút cookie khỏi hệ thống — thứ duy nhất xoá được bí mật đã lưu. */
export async function clearCookieAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  await clearCookie(user.id);
  revalidatePath("/dashboard");
  return { ok: true, message: "Đã xoá tài khoản hoathinh3d khỏi ngọc giản." };
}

export async function startAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const result = await startJob(user.id);
  revalidatePath("/dashboard");

  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  return { ok: true, message: "Đàn pháp đã lập — linh sứ sẽ tiếp nhận trong giây lát." };
}

/**
 * Dọn nhật ký của lượt đang hiển thị. Không đụng tới lượt chạy: linh sứ vẫn làm việc, và
 * những dòng nó kể từ giây này trở đi vẫn hiện ra như thường.
 */
export async function clearLogAction(): Promise<ActionResult> {
  const user = await requireActiveUser();
  const gone = await clearLatestJobEvents(user.id);
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
  return { ok: true, message: "Đã gửi lệnh thu đàn." };
}
