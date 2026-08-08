import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import type { GameAccountRow } from "@/lib/db/schema";
import type { AccountTier } from "./configs";

/**
 * Tài khoản game — số nhiều, mỗi cái một cookie, một công tắc, một verdict hạng.
 *
 * Luật một chiều của cookie vẫn nguyên: hàm nào trả dữ liệu cho UI thì KHÔNG BAO GIỜ mang
 * cookie (kể cả phong bì); phong bì chỉ rời khỏi service này theo đường snapshot của job
 * (jobs.ts) để rồi được giải mã đúng một lần ở /api/worker. Việc phát tín hiệu realtime
 * không cần gọi tay: trigger `jarvis_dashboard_account_change` (migration 0009) phát topic
 * `config` trong chính transaction đã ghi.
 */

/** Hình tài khoản mà UI được phép nhìn: mọi thứ TRỪ cookie. */
export type GameAccountView = {
  id: string;
  label: string;
  accountTier: AccountTier | null;
  enabled: boolean;
};

/** Chặn phình vô hạn — 9 người đăng ký, không ai nuôi nổi hơn chừng này tài khoản thật. */
export const MAX_ACCOUNTS_PER_USER = 10;
const MAX_LABEL_LENGTH = 60;

function toView(row: GameAccountRow): GameAccountView {
  return {
    id: row.id,
    label: row.label,
    accountTier: row.accountTier ?? null,
    enabled: row.enabled,
  };
}

async function rowsOf(userId: string): Promise<GameAccountRow[]> {
  return db()
    .select()
    .from(schema.gameAccounts)
    .where(eq(schema.gameAccounts.userId, userId))
    .orderBy(asc(schema.gameAccounts.createdAt), asc(schema.gameAccounts.id));
}

export async function listAccounts(userId: string): Promise<GameAccountView[]> {
  return (await rowsOf(userId)).map(toView);
}

/**
 * Cho jobs.ts dựng snapshot: kèm PHONG BÌ cookie (vẫn mã hoá). Không dùng cho UI.
 */
export async function listAccountsWithEnvelope(userId: string): Promise<GameAccountRow[]> {
  return rowsOf(userId);
}

/** Đọc phong bì về plaintext; giá trị di sản chưa mã hoá đi qua nguyên vẹn. */
function openEnvelope(envelope: string): string | null {
  try {
    return isEncrypted(envelope) ? decryptSecret(envelope) : envelope;
  } catch {
    // Khoá mã hoá đổi giữa chừng thì phong bì cũ không mở được — với phép so trùng, một
    // phong bì không mở được đơn giản là "không so được", không phải lý do để sập.
    return null;
  }
}

/**
 * Hai tài khoản cùng chủ mang CÙNG một cookie là mầm hoạ kép: hai job chạy đồng thời sẽ
 * giành nhau đúng một hồ sơ Chromium (profileDirForJob băm theo cookie), và cùng một nhân
 * vật bị chạy nhiệm vụ hai lần. So bằng plaintext vì phong bì AES-GCM mỗi lần mã hoá một
 * khác — ciphertext không so được.
 */
async function labelOfDuplicate(
  userId: string,
  cookiePlain: string,
  excludeId?: string,
): Promise<string | null> {
  const needle = cookiePlain.trim();
  for (const row of await rowsOf(userId)) {
    if (row.id === excludeId) continue;
    if (openEnvelope(row.cookieEnvelope)?.trim() === needle) return row.label;
  }
  return null;
}

function normalizeLabel(label: string, fallback: string): string {
  const clean = label.trim().slice(0, MAX_LABEL_LENGTH).trim();
  return clean.length > 0 ? clean : fallback;
}

export type AccountMutation =
  | { ok: true; account: GameAccountView }
  | { ok: false; error: string };

export async function addAccount(
  userId: string,
  label: string,
  cookiePlain: string,
): Promise<AccountMutation> {
  const existing = await rowsOf(userId);
  if (existing.length >= MAX_ACCOUNTS_PER_USER) {
    return { ok: false, error: `Tối đa ${MAX_ACCOUNTS_PER_USER} tài khoản — xoá bớt trước khi thêm.` };
  }

  const duplicate = await labelOfDuplicate(userId, cookiePlain);
  if (duplicate) {
    return { ok: false, error: `Cookie này đã được lưu ở tài khoản「${duplicate}」.` };
  }

  const rows = await db()
    .insert(schema.gameAccounts)
    .values({
      userId,
      label: normalizeLabel(label, `Tài khoản ${existing.length + 1}`),
      cookieEnvelope: encryptSecret(cookiePlain.trim()),
    })
    .returning();
  return { ok: true, account: toView(rows[0]) };
}

/**
 * Thay cookie của một tài khoản. Cookie mới có thể thuộc hạng đối nghịch nên verdict cũ bị
 * xoá — chỉ khôi lỗi nhìn hub mới được quyền phán lại (đúng luật đã đặt ở saveCookie cũ).
 */
export async function updateAccountCookie(
  userId: string,
  accountId: string,
  cookiePlain: string,
): Promise<AccountMutation> {
  const duplicate = await labelOfDuplicate(userId, cookiePlain, accountId);
  if (duplicate) {
    return { ok: false, error: `Cookie này đã được lưu ở tài khoản「${duplicate}」.` };
  }

  const rows = await db()
    .update(schema.gameAccounts)
    .set({
      cookieEnvelope: encryptSecret(cookiePlain.trim()),
      accountTier: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.gameAccounts.id, accountId), eq(schema.gameAccounts.userId, userId)))
    .returning();
  if (rows.length === 0) {
    return { ok: false, error: "Không tìm thấy tài khoản này — có thể nó vừa bị xoá." };
  }
  return { ok: true, account: toView(rows[0]) };
}

export async function renameAccount(
  userId: string,
  accountId: string,
  label: string,
): Promise<AccountMutation> {
  const clean = normalizeLabel(label, "");
  if (clean.length === 0) {
    return { ok: false, error: "Tên tài khoản không được để trống." };
  }

  const rows = await db()
    .update(schema.gameAccounts)
    .set({ label: clean, updatedAt: new Date() })
    .where(and(eq(schema.gameAccounts.id, accountId), eq(schema.gameAccounts.userId, userId)))
    .returning();
  if (rows.length === 0) {
    return { ok: false, error: "Không tìm thấy tài khoản này — có thể nó vừa bị xoá." };
  }
  return { ok: true, account: toView(rows[0]) };
}

export async function setAccountEnabled(
  userId: string,
  accountId: string,
  enabled: boolean,
): Promise<AccountMutation> {
  const rows = await db()
    .update(schema.gameAccounts)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(schema.gameAccounts.id, accountId), eq(schema.gameAccounts.userId, userId)))
    .returning();
  if (rows.length === 0) {
    return { ok: false, error: "Không tìm thấy tài khoản này — có thể nó vừa bị xoá." };
  }
  return { ok: true, account: toView(rows[0]) };
}

/**
 * Xoá tài khoản. FK cascade kéo theo job và nhật ký của nó — nơi gọi phải chắc rằng không
 * còn job đang sống (actions kiểm và từ chối), vì một khôi lỗi đang cầm job bị xoá dưới chân
 * sẽ chỉ còn biết kể lỗi vào console của chính nó.
 */
export async function deleteAccount(
  userId: string,
  accountId: string,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const rows = await db()
    .delete(schema.gameAccounts)
    .where(and(eq(schema.gameAccounts.id, accountId), eq(schema.gameAccounts.userId, userId)))
    .returning({ label: schema.gameAccounts.label });
  if (rows.length === 0) {
    return { ok: false, error: "Không tìm thấy tài khoản này — có thể nó đã bị xoá rồi." };
  }
  return { ok: true, label: rows[0].label };
}
