"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { backendIsStation } from "@/lib/mirror/switchGuard";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";
import { fetchVercelUsage, type VercelUsage } from "@/lib/services/vercelUsage";

/**
 * Sổ gương trạm — server action của tab Gương Trạm (deploy/mirror/README.md §4).
 *
 * Mọi cửa đều gác bằng `site.switch` chứ không chỉ `admin.panel`: sổ này cầm token Vercel của
 * những TÀI KHOẢN KHÁC, và bậc trị sự thường vào được trang Tông Môn không có nghĩa là được
 * cầm chìa khoá của cả năm tài khoản giữ trạm. Chỉ Gia chủ (xem permissions.ts).
 *
 * Bản rõ của token sống đúng MỘT khoảnh khắc trong bộ nhớ của action: nhận từ form →
 * encryptSecret → document. Không log, không trả về client — `mirrorsForAdmin()` chỉ phát cờ
 * có/không.
 *
 * Hai chuỗi kết nối database rụng khỏi sổ ngày 16/08/2026; phong bì cũ còn nằm trong
 * `app_settings` nhưng không cửa nào ở đây đọc hay ghi chúng nữa.
 */

export type MirrorResult = { ok: boolean; message: string };

/**
 * Hình chiếu an toàn cho client: KHÔNG mang phong bì mã hoá, chỉ mang dấu vết đủ nhận diện.
 *
 * ĐÃ RỤNG 16/08/2026: `pgHost`/`mongoHost` và ba trường kiểm mạch. Chúng kể về kho riêng của
 * từng trạm — thứ mà cuộc dời backend về VM đã cho nghỉ. Giữ lại là bày ra một trạng thái đúng
 * (PG ✔, 27 migration) về một database KHÔNG AI ĐỌC, tức mời người vận hành tin vào một sức
 * khoẻ không liên quan gì tới sức khoẻ của hệ.
 */
export type MirrorView = {
  id: string;
  name: string;
  url: string;
  /**
   * Sổ đã có token Vercel của trạm này chưa — CHỈ có/không, không bao giờ là chính token.
   * Giao diện cần nó để biết nên hiện bảng usage hay hiện lời mời dán token.
   */
  hasVercelToken: boolean;
  /**
   * Bảng usage ĐẦY ĐỦ do GitHub Actions cào rồi đẩy lên (`/api/usage-report`). `null` = chưa
   * lượt nào tới. Ở đây KHÔNG có credential nào — chỉ tên meter và hai con số đã format.
   */
  usageReport: { readAt: string; meters: { title: string; used: string; limit: string | null }[] } | null;
};

const MAX_MIRRORS = 8;

async function requireSiteSwitch() {
  const user = await requireAdmin();
  if (!hasPermission(user, "site.switch")) {
    throw new Error("Chỉ Gia chủ mới chạm được vào sổ gương trạm.");
  }
  return user;
}

function viewOf(entry: AppSettings["mirrors"][number]): MirrorView {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    hasVercelToken: isEncrypted(entry.vercelToken ?? ""),
    usageReport: entry.usageReport ?? null,
  };
}

/** Sổ đã che cho trang admin vẽ. Gác quyền như mọi cửa khác — hình chiếu cũng là dữ liệu. */
export async function mirrorsForAdmin(): Promise<MirrorView[]> {
  await requireSiteSwitch();
  const settings = await getAppSettings();
  return settings.mirrors.map(viewOf);
}

/**
 * Thêm/sửa một trạm trong sổ: mã, tên, URL, và token Vercel của tài khoản giữ nó.
 *
 * ── KHÔNG CÒN HỎI CHUỖI KẾT NỐI (16/08/2026) ──────────────────────────────────────────────
 *
 * Sổ này từng là danh mục các BẢN SAO ĐẦY ĐỦ — mỗi trạm một Neon, một Atlas, và lượt lưu nào
 * cũng kiểm mạch cả hai trước khi ghi. Từ ngày backend về VM, một trạm chỉ còn là vỏ chuyển
 * tiếp; kho riêng của nó không ai đọc. Hỏi tiếp hai chuỗi ấy là bắt người vận hành đi lục
 * credential của một database không dùng, rồi cất nó vào sổ để không ai đọc lần nữa.
 *
 * PHONG BÌ CŨ ĐƯỢC GIỮ NGUYÊN qua mọi lượt sửa: gỡ khỏi form không phải là xoá dữ liệu. Ngày
 * nào muốn dọn hẳn thì đó là một lượt chạy riêng, cố ý — không phải tác dụng phụ của một cú
 * bấm「Lưu」khi ai đó chỉ định đổi cái tên.
 */
export async function saveMirrorAction(_prev: MirrorResult | null, formData: FormData): Promise<MirrorResult> {
  await requireSiteSwitch();

  const id = String(formData.get("id") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim().replace(/\/$/, "");
  const vercelInput = String(formData.get("vercelToken") ?? "").trim();

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    return { ok: false, message: "Mã trạm: chữ thường/số/gạch nối, 2–64 ký tự — nó sẽ là SITE_ID của deploy bên kia." };
  }
  if (name.length === 0 || name.length > 120) return { ok: false, message: "Tên trạm 1–120 ký tự." };
  if (!url.startsWith("https://")) return { ok: false, message: "URL trạm phải là https tuyệt đối." };

  const settings = await getAppSettings();
  const existing = settings.mirrors.find((m) => m.id === id);

  if (!existing && settings.mirrors.length >= MAX_MIRRORS) {
    return { ok: false, message: `Sổ đầy (${MAX_MIRRORS} trạm) — dọn trạm chết trước khi thêm.` };
  }
  /**
   * Token Vercel là TUỲ CHỌN: thiếu nó thì trạm vẫn là một vỏ chạy tốt, chỉ là bảng hạn mức
   * im lặng. Ô để trống nghĩa là「giữ phong bì cũ」, để admin sửa mỗi cái tên mà không phải
   * lục lại két — nay nó là chuỗi bí mật DUY NHẤT còn lại trong sổ.
   */
  // `isEncrypted` gác trước `decryptSecret`: trạm ghi trước bản này mang chuỗi RỖNG ở trường
  // ấy, và giải mã một chuỗi rỗng là ném — tức lượt sửa tên một trạm cũ sẽ văng lỗi.
  const vercelPlain =
    vercelInput ||
    (existing && isEncrypted(existing.vercelToken ?? "") ? decryptSecret(existing.vercelToken) : "");

  const entry: AppSettings["mirrors"][number] = {
    id,
    name,
    url,
    // Phong bì kho cũ đi qua nguyên vẹn, trạm mới thì rỗng — xem khối bình chú đầu hàm.
    pg: existing?.pg ?? "",
    mongo: existing?.mongo ?? "",
    vercelToken: vercelPlain ? encryptSecret(vercelPlain) : "",
    // GIỮ bảng usage đã cào: sửa cái tên trạm mà mất luôn số liệu thì lượt cào kế tiếp còn
    // sáu tiếng nữa mới tới, và suốt quãng ấy popup trống trơn không ai hiểu vì sao.
    usageReport: existing?.usageReport ?? null,
    // Ba trường kiểm mạch đi theo phép kiểm mạch: giữ giá trị cũ để không viết đè một sự thật
    // lịch sử bằng một giá trị bịa, nhưng không còn ai đọc chúng.
    lastProbeAt: existing?.lastProbeAt ?? null,
    lastProbeOk: existing?.lastProbeOk ?? null,
    lastProbeNote: existing?.lastProbeNote ?? "",
  };

  settings.mirrors = existing
    ? settings.mirrors.map((m) => (m.id === id ? entry : m))
    : [...settings.mirrors, entry];
  await saveAppSettings(settings);
  revalidatePath("/admin");

  return { ok: true, message: `${existing ? "Đã cập nhật" : "Đã ghi"} trạm「${name}」.` };
}

/**
 * Mức dùng Vercel 30 ngày của MỘT trạm, cho tab Gương Trạm.
 *
 * Đọc theo yêu cầu (một cú bấm) chứ không nhét vào lượt render trang: `/v2/usage` là một lượt
 * đi ra Internet, và trang Tông Môn không được phép chậm đi vì một API của bên thứ ba — nhất
 * là khi tab này còn giữ nút chuyển trạm, thứ người ta mở ra trong lúc có sự cố.
 *
 * Trả về `VercelUsage`, tức mọi ngả hỏng đã thành `{ ok: false, error }` có chữ đọc được.
 * Không ném lên client trừ khi người gọi không có quyền — cửa quyền thì phải đóng sập.
 */
export async function mirrorUsageAction(id: string): Promise<VercelUsage> {
  await requireSiteSwitch();

  const settings = await getAppSettings();
  const entry = settings.mirrors.find((m) => m.id === id);
  if (!entry) return { ok: false, error: `Không có trạm「${id}」trong sổ.` };
  if (!isEncrypted(entry.vercelToken ?? "")) {
    return { ok: false, error: "Trạm này chưa có token Vercel — dán vào ô ở form Sửa trạm." };
  }

  return fetchVercelUsage(decryptSecret(entry.vercelToken));
}

/*
 * `probeMirrorAction` đã gỡ 16/08/2026 cùng nút「Kiểm mạch」.
 *
 * Nó nối tới Postgres và Mongo của một trạm rồi báo「PG ✔ (27 migration) · Mongo ✔」. Câu ấy
 * vẫn ĐÚNG sau cuộc dời backend — và đó chính là lý do phải gỡ chứ không phải lý do để giữ:
 * một dấu tích xanh về sức khoẻ của một database không ai đọc là thứ nguy hiểm hơn hẳn một ô
 * trống, vì nó trả lời câu hỏi「hệ có ổn không」bằng dữ liệu của một hệ khác.
 */

export async function deleteMirrorAction(_prev: MirrorResult | null, formData: FormData): Promise<MirrorResult> {
  await requireSiteSwitch();
  const id = String(formData.get("id") ?? "").trim();
  const settings = await getAppSettings();
  if (!settings.mirrors.some((m) => m.id === id)) {
    return { ok: false, message: `Không có trạm「${id}」trong sổ.` };
  }
  settings.mirrors = settings.mirrors.filter((m) => m.id !== id);
  await saveAppSettings(settings);
  revalidatePath("/admin");
  return { ok: true, message: `Đã xoá trạm「${id}」khỏi sổ.` };
}

/**
 * Ghi CHÍNH TRẠM NÀY vào sổ — nút cứu khỏi cảnh cụt đường về.
 *
 * Sổ nằm trong `app_settings` nên nó ĐI THEO dữ liệu sang trạm mới mỗi lượt chuyển. Nếu sổ
 * chỉ liệt kê những trạm KHÁC, thì sau khi chuyển sang B, trạm B nhận một cuốn sổ không có
 * tên A — và không còn ai để pick mà quay về. Hệ phải đối xứng: sổ là danh mục MỌI trạm, kể
 * cả trạm đang cầm bút.
 *
 * URL lấy từ header `host` của chính request — sự thật tại chỗ, không phải thứ admin phải chép
 * tay từ dashboard sang. (Bản trước còn lấy cả DATABASE_URL/MONGODB_URI từ env; từ 16/08/2026
 * sổ không giữ chuỗi kết nối nữa — xem khối bình chú ở `saveMirrorAction`.)
 */
export async function registerSelfAction(): Promise<MirrorResult> {
  await requireSiteSwitch();

  const siteId = (process.env.SITE_ID ?? "").trim();
  if (!backendIsStation(siteId)) {
    // Lời khuyên cũ ở đây là「đặt SITE_ID trên Vercel rồi deploy lại」— đúng khi mỗi trạm là một
    // bản đầy đủ, NGUY HIỂM từ 16/08/2026: xem khối bình chú của `backendIsStation`. Nơi này tự
    // khai vào sổ cũng không có nghĩa gì, vì sổ là danh mục các TRẠM, còn nó là backend.
    return {
      ok: false,
      message:
        "Nơi này là backend trên VM, không phải một trạm — không có gì để tự khai vào sổ. " +
        "ĐỪNG đặt SITE_ID cho nó: việc ấy lên đạn lại lượt chuyển trạm và tầng chuyển hướng, cả hai " +
        "đều đã hết đích.",
    };
  }
  const host = (await headers()).get("host");
  if (!host) return { ok: false, message: "Không đọc được host của chính trang này." };
  const url = `https://${host}`;

  const settings = await getAppSettings();
  const existing = settings.mirrors.find((m) => m.id === siteId);
  const entry: AppSettings["mirrors"][number] = {
    id: siteId,
    name: existing?.name ?? `Trạm ${siteId}`,
    url,
    pg: existing?.pg ?? "",
    mongo: existing?.mongo ?? "",
    // Giữ token đã có, đừng xoá: lượt tự khai này chạy lại được nhiều lần (mỗi lần trạm đổi
    // URL), và env của một trạm KHÔNG mang token Vercel của chính nó — chỉ có người dán tay.
    vercelToken: existing?.vercelToken ?? "",
    usageReport: existing?.usageReport ?? null,
    lastProbeAt: existing?.lastProbeAt ?? null,
    lastProbeOk: existing?.lastProbeOk ?? null,
    lastProbeNote: existing?.lastProbeNote ?? "",
  };
  settings.mirrors = existing
    ? settings.mirrors.map((m) => (m.id === siteId ? entry : m))
    : [...settings.mirrors, entry];
  await saveAppSettings(settings);
  revalidatePath("/admin");
  return {
    ok: true,
    message: `${existing ? "Đã cập nhật" : "Đã ghi"} trạm hiện tại「${siteId}」(${url}) vào sổ — giờ trạm khác có đường quay về đây.`,
  };
}
