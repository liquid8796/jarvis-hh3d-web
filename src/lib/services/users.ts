import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { UserRow } from "@/lib/db/schema";

/**
 * Every rule about WHO may exist and WHAT state they are in lives here, behind plain
 * functions — pages and server actions stay thin translators. This is the file to extend
 * when the tông môn grows new membership rules.
 */

export type PublicUser = Pick<
  UserRow,
  "id" | "username" | "displayName" | "role" | "status" | "createdAt" | "updatedAt"
>;

const publicColumns = {
  id: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
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

export async function findById(id: string): Promise<PublicUser | null> {
  const rows = await db().select(publicColumns).from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Registration: anyone may knock; everyone starts `pending` until an admin opens the gate. */
export async function register(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const username = input.username.toLowerCase();
  const existing = await findByUsername(username);
  if (existing) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }

  const rows = await db()
    .insert(schema.users)
    .values({
      username,
      displayName: input.displayName.trim(),
      passwordHash: hashPassword(input.password),
    })
    .returning(publicColumns);

  return { ok: true, user: rows[0] };
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
      or(ilike(schema.users.username, needle), ilike(schema.users.displayName, needle)),
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
  password: string;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await findByUsername(input.username);
  if (existing) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }

  await db().insert(schema.users).values({
    username: input.username.toLowerCase(),
    displayName: input.displayName.trim(),
    passwordHash: hashPassword(input.password),
    role: input.role,
    status: input.status,
  });

  return { ok: true };
}

export async function adminUpdate(
  id: string,
  input: {
    displayName?: string;
    password?: string;
    role?: "user" | "admin";
    status?: "pending" | "active" | "disabled";
  },
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
  if (input.password) patch.passwordHash = hashPassword(input.password);
  if (input.role) patch.role = input.role;
  if (input.status) patch.status = input.status;

  await db().update(schema.users).set(patch).where(eq(schema.users.id, id));
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
