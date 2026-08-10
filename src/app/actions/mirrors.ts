"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { MongoClient } from "mongodb";
import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { resolveMongoDbName } from "@/lib/mongo/dbName";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";

/**
 * Sổ gương trạm — server action của tab Gương Trạm (deploy/mirror/README.md §4).
 *
 * Mọi cửa đều gác bằng `site.switch` chứ không chỉ `admin.panel`: sổ này cầm chuỗi kết nối
 * database của trạm KHÁC, và bậc trị sự thường vào được trang Tông Môn không có nghĩa là
 * được cầm chìa khoá của cả hệ trạm dự phòng. Chỉ Gia chủ (xem permissions.ts).
 *
 * Bản rõ của pg/mongo sống đúng MỘT khoảnh khắc trong bộ nhớ của action: nhận từ form →
 * probe (nếu là lượt lưu) → encryptSecret → document. Không log, không trả về client —
 * `mirrorsForAdmin()` chỉ phát bản đã che.
 */

export type MirrorResult = { ok: boolean; message: string };

/** Hình chiếu an toàn cho client: KHÔNG mang phong bì mã hoá, chỉ mang dấu vết đủ nhận diện. */
export type MirrorView = {
  id: string;
  name: string;
  url: string;
  /** host của DATABASE_URL/MONGODB_URI — đủ để admin nhận ra nhập nhầm, không đủ để kết nối. */
  pgHost: string;
  mongoHost: string;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeNote: string;
};

const MAX_MIRRORS = 8;

async function requireSiteSwitch() {
  const user = await requireAdmin();
  if (!hasPermission(user, "site.switch")) {
    throw new Error("Chỉ Gia chủ mới chạm được vào sổ gương trạm.");
  }
  return user;
}

function hostOf(connectionString: string): string {
  try {
    // mongodb+srv:// không phải scheme mà new URL nào cũng chịu — đổi vỏ http là đọc được host.
    return new URL(connectionString.replace(/^mongodb(\+srv)?:/, "http:")).hostname;
  } catch {
    return "(không đọc được host)";
  }
}

function viewOf(entry: AppSettings["mirrors"][number]): MirrorView {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    pgHost: isEncrypted(entry.pg) ? hostOf(decryptSecret(entry.pg)) : "(phong bì hỏng)",
    mongoHost: isEncrypted(entry.mongo) ? hostOf(decryptSecret(entry.mongo)) : "(phong bì hỏng)",
    lastProbeAt: entry.lastProbeAt,
    lastProbeOk: entry.lastProbeOk,
    lastProbeNote: entry.lastProbeNote,
  };
}

/** Sổ đã che cho trang admin vẽ. Gác quyền như mọi cửa khác — hình chiếu cũng là dữ liệu. */
export async function mirrorsForAdmin(): Promise<MirrorView[]> {
  await requireSiteSwitch();
  const settings = await getAppSettings();
  return settings.mirrors.map(viewOf);
}

/**
 * Probe CHỈ-ĐỌC một cặp kết nối: Postgres đếm sổ migration, Mongo ping. Trả lời chung một
 * câu chữ để ghi vào `lastProbeNote` — admin cần biết "hỏng ở đâu", không cần stack trace.
 */
async function probeConnections(pg: string, mongo: string): Promise<{ ok: boolean; note: string }> {
  const notes: string[] = [];
  let ok = true;

  try {
    const sql = neon(pg);
    const rows = await sql`
      select count(*)::int as n from information_schema.tables
       where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    `;
    if (rows[0].n === 0) {
      notes.push("PG nối được nhưng CHƯA có sổ migration — chạy scripts/migrate.mjs lên trạm ấy trước");
      ok = false;
    } else {
      const applied = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      notes.push(`PG ✔ (${applied[0].n} migration)`);
    }
  } catch (err) {
    notes.push(`PG ✗: ${err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ"}`);
    ok = false;
  }

  // serverSelectionTimeoutMS thấp có chủ ý: đây là một cú bấm trên trang admin, không phải
  // một phiên làm việc — 8 giây không trả lời thì câu trả lời chính là "không nối được".
  const client = new MongoClient(mongo, { serverSelectionTimeoutMS: 8_000 });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    // Nói luôn TÊN DATABASE đã giải, đừng chỉ ping cụm. Lượt chuyển trạm đầu tiên gãy đúng ở
    // khâu tên database trong khi kiểm mạch vẫn báo「Mongo ✔」— vì ping chưa hề chạm tới nó.
    // Vắng `chat_messages` KHÔNG phải lỗi (trạm gương mới thì chưa có gì), nhưng phải hiện ra.
    const dbName = resolveMongoDbName(mongo, process.env.MONGODB_DB);
    const seeded = await client.db(dbName).listCollections({ name: "chat_messages" }).hasNext();
    notes.push(`Mongo ✔ (db「${dbName}」, chat_messages ${seeded ? "có" : "chưa có"})`);
  } catch (err) {
    notes.push(`Mongo ✗: ${err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ"}`);
    ok = false;
  } finally {
    await client.close().catch(() => {});
  }

  return { ok, note: notes.join(" · ") };
}

/**
 * Thêm/sửa một trạm. Lượt SỬA không bắt nhập lại chuỗi kết nối: ô để trống nghĩa là "giữ
 * phong bì cũ" — admin đổi mỗi cái tên không phải lục lại credential từ két.
 */
export async function saveMirrorAction(_prev: MirrorResult | null, formData: FormData): Promise<MirrorResult> {
  await requireSiteSwitch();

  const id = String(formData.get("id") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim().replace(/\/$/, "");
  const pgInput = String(formData.get("pg") ?? "").trim();
  const mongoInput = String(formData.get("mongo") ?? "").trim();

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
  if (!existing && (!pgInput || !mongoInput)) {
    return { ok: false, message: "Trạm mới cần đủ cả hai chuỗi kết nối Postgres và MongoDB." };
  }

  const pgPlain = pgInput || (existing ? decryptSecret(existing.pg) : "");
  const mongoPlain = mongoInput || (existing ? decryptSecret(existing.mongo) : "");
  if (!/^postgres(ql)?:\/\//.test(pgPlain)) return { ok: false, message: "Chuỗi Postgres phải bắt đầu bằng postgresql://." };
  if (!/^mongodb(\+srv)?:\/\//.test(mongoPlain)) return { ok: false, message: "Chuỗi Mongo phải bắt đầu bằng mongodb:// hoặc mongodb+srv://." };

  // Probe NGAY trong lượt lưu — một chuỗi gõ nhầm phải chết ở đây, không phải ở phút thứ ba
  // của một lượt chuyển trạm thật. Probe hỏng vẫn LƯU (có thể trạm kia chưa dựng xong DB),
  // nhưng kết quả ghi thẳng vào sổ cho ai nhìn cũng thấy.
  const probe = await probeConnections(pgPlain, mongoPlain);

  const entry: AppSettings["mirrors"][number] = {
    id,
    name,
    url,
    pg: encryptSecret(pgPlain),
    mongo: encryptSecret(mongoPlain),
    lastProbeAt: new Date().toISOString(),
    lastProbeOk: probe.ok,
    lastProbeNote: probe.note,
  };

  settings.mirrors = existing
    ? settings.mirrors.map((m) => (m.id === id ? entry : m))
    : [...settings.mirrors, entry];
  await saveAppSettings(settings);
  revalidatePath("/admin");

  return {
    ok: probe.ok,
    message: `${existing ? "Đã cập nhật" : "Đã ghi"} trạm「${name}」. Kiểm mạch: ${probe.note}`,
  };
}

export async function probeMirrorAction(_prev: MirrorResult | null, formData: FormData): Promise<MirrorResult> {
  await requireSiteSwitch();
  const id = String(formData.get("id") ?? "").trim();
  const settings = await getAppSettings();
  const entry = settings.mirrors.find((m) => m.id === id);
  if (!entry) return { ok: false, message: `Không có trạm「${id}」trong sổ.` };

  const probe = await probeConnections(decryptSecret(entry.pg), decryptSecret(entry.mongo));
  entry.lastProbeAt = new Date().toISOString();
  entry.lastProbeOk = probe.ok;
  entry.lastProbeNote = probe.note;
  await saveAppSettings(settings);
  revalidatePath("/admin");
  return { ok: probe.ok, message: `Kiểm mạch「${entry.name}」: ${probe.note}` };
}

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
 * Chuỗi kết nối lấy từ env của chính trạm này, URL lấy từ header `host` của chính request —
 * cả hai đều là sự thật tại chỗ, không phải thứ admin phải chép tay từ dashboard sang.
 */
export async function registerSelfAction(): Promise<MirrorResult> {
  await requireSiteSwitch();

  const siteId = (process.env.SITE_ID ?? "").trim();
  if (!siteId) {
    return { ok: false, message: "Trạm này chưa khai SITE_ID — đặt biến ấy trên Vercel rồi deploy lại đã." };
  }
  const pg = (process.env.DATABASE_URL ?? "").trim();
  const mongo = (process.env.MONGODB_URI ?? "").trim();
  if (!pg || !mongo) {
    return { ok: false, message: "Trạm này thiếu DATABASE_URL hoặc MONGODB_URI — không tự khai được." };
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
    pg: encryptSecret(pg),
    mongo: encryptSecret(mongo),
    lastProbeAt: new Date().toISOString(),
    lastProbeOk: true,
    lastProbeNote: "Tự khai từ env của chính trạm — không cần kiểm mạch, nó đang chạy bằng chính hai chuỗi này.",
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
