import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getAppSettings } from "@/lib/services/settings";
import type { UserRow } from "@/lib/db/schema";

/**
 * Every rule about WHO may exist and WHAT state they are in lives here, behind plain
 * functions — pages and server actions stay thin translators. This is the file to extend
 * when the tông môn grows new membership rules.
 */

export type PublicUser = Pick<
  UserRow,
  "id" | "username" | "displayName" | "email" | "role" | "status" | "createdAt" | "updatedAt"
>;

const publicColumns = {
  id: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
  email: schema.users.email,
  role: schema.users.role,
  status: schema.users.status,
  createdAt: schema.users.createdAt,
  updatedAt: schema.users.updatedAt,
} as const;

export async function findByUsername(username: string): Promise<UserRow | null> {
  const rows = await db()
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = await db()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<PublicUser | null> {
  const rows = await db().select(publicColumns).from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Bái sư: ai cũng được gõ cửa. Người mới dừng lại ở `pending` hay vào thẳng `active` là do
 * MÔN QUY quyết định (công tắc xét duyệt, tab Môn Đồ của trang Tông Môn).
 *
 * Luật ấy được đọc NGAY TẠI ĐÂY chứ không nhận từ tham số của người gọi. Form bái sư là thứ
 * ngoài Internet chạm tới được: hễ trạng thái khởi sinh đi vào bằng đối số thì sớm muộn cũng
 * có một đường gọi nào đó chuyền thẳng dữ liệu từ form xuống, và lúc ấy kẻ gõ cửa tự phong
 * cho mình `active` chỉ bằng một field thừa. Trạng thái người mới sinh ra thuộc về tầng này,
 * không thuộc về ai gọi nó.
 */
export async function register(input: {
  username: string;
  displayName: string;
  email: string;
  password: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const username = input.username.toLowerCase();
  const email = input.email.trim().toLowerCase();
  const existing = await findByUsername(username);
  if (existing) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }
  if (await findByEmail(email)) {
    return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
  }

  const { membership } = await getAppSettings();

  const rows = await db()
    .insert(schema.users)
    .values({
      username,
      displayName: input.displayName.trim(),
      email,
      passwordHash: hashPassword(input.password),
      status: membership.requireApproval ? "pending" : "active",
    })
    // Hai người có thể submit cùng lúc sau bước kiểm tra trên. Database phân xử, rồi ta
    // đọc lại để trả thông báo thân thiện thay vì làm văng lỗi 500 vì unique constraint.
    .onConflictDoNothing()
    .returning(publicColumns);

  if (rows[0]) return { ok: true, user: rows[0] };
  if (await findByUsername(username)) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }
  return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<UserRow | null> {
  const user = await findByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return user;
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

export async function listUsers(options: {
  search?: string;
  status?: "pending" | "active" | "disabled";
}): Promise<PublicUser[]> {
  const conditions = [];
  if (options.search) {
    const needle = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(schema.users.username, needle),
        ilike(schema.users.displayName, needle),
        ilike(schema.users.email, needle),
      ),
    );
  }

  if (options.status) {
    conditions.push(eq(schema.users.status, options.status));
  }

  return db()
    .select(publicColumns)
    .from(schema.users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      // Pending first — they are the queue the admin came here to clear.
      sql`case ${schema.users.status} when 'pending' then 0 when 'active' then 1 else 2 end`,
      schema.users.createdAt,
    );
}

export async function countPending(): Promise<number> {
  const rows = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(eq(schema.users.status, "pending"));
  return rows[0]?.n ?? 0;
}

export async function setStatus(
  id: string,
  status: "pending" | "active" | "disabled",
): Promise<void> {
  await db()
    .update(schema.users)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.users.id, id));
}

export async function adminCreate(input: {
  username: string;
  displayName: string;
  email: string;
  password: string;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  const existing = await findByUsername(input.username);
  if (existing) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }
  if (await findByEmail(email)) {
    return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
  }

  const rows = await db()
    .insert(schema.users)
    .values({
      username: input.username.toLowerCase(),
      displayName: input.displayName.trim(),
      email,
      passwordHash: hashPassword(input.password),
      role: input.role,
      status: input.status,
    })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (rows.length === 0) {
    if (await findByUsername(input.username)) {
      return { ok: false, error: "Đạo hiệu này đã có người dùng." };
    }
    return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
  }

  return { ok: true };
}

export async function adminUpdate(
  id: string,
  input: {
    displayName?: string;
    email?: string;
    password?: string;
    role?: "user" | "admin";
    status?: "pending" | "active" | "disabled";
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.email !== undefined) {
    const owner = await findByEmail(input.email);
    if (owner && owner.id !== id) {
      return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
  if (input.email !== undefined) patch.email = input.email.trim().toLowerCase();
  if (input.password) patch.passwordHash = hashPassword(input.password);
  if (input.role) patch.role = input.role;
  if (input.status) patch.status = input.status;

  try {
    await db().update(schema.users).set(patch).where(eq(schema.users.id, id));
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
    }
    throw error;
  }
}

/** Self-service profile update; role, status, username and password remain out of reach. */
export async function updateProfile(
  id: string,
  input: { displayName: string; email: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return adminUpdate(id, input);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

/**
 * Deletion cascades through configs, jobs and events by schema design — an expelled member
 * leaves nothing dangling. The LAST admin cannot be deleted; a control plane with no one
 * holding the keys is a locked room.
 */
export async function adminDelete(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await findById(id);
  if (!target) {
    return { ok: false, error: "Không tìm thấy đạo hữu này." };
  }

  if (target.role === "admin") {
    const admins = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(eq(schema.users.role, "admin"));
    if ((admins[0]?.n ?? 0) <= 1) {
      return { ok: false, error: "Không thể xoá trưởng môn cuối cùng." };
    }
  }

  await db().delete(schema.users).where(eq(schema.users.id, id));
  return { ok: true };
}
