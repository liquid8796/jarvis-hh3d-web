import { and, eq, getTableColumns, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  ROLE_AWAITING,
  ROLE_DISCIPLE,
  ROLE_OWNER,
  normalizeRoles,
  type Role,
} from "@/lib/auth/permissions";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getAppSettings } from "@/lib/services/settings";
import type { UserRow } from "@/lib/db/schema";

/**
 * Every rule about WHO may exist and WHAT state they are in lives here, behind plain
 * functions — pages and server actions stay thin translators. This is the file to extend
 * when the tông môn grows new membership rules.
 */

/**
 * `roles` được CỘNG vào chứ không `Pick` ra từ `UserRow`, vì bảng users không còn cột vai nào
 * kể từ migration 0014 — vai là một quan hệ, và mọi phép đọc người ở đây ghép nó vào.
 *
 * Đây cũng chính là chỗ tsc canh giúp: ngày ai đó thêm một đường đọc người mà quên phép ghép,
 * kiểu trả về thiếu `roles` và không biên dịch được, thay vì lặng lẽ trả về một Gia chủ không
 * mang vai nào.
 */
type WithRoles = { roles: string[] };

export type PublicUser = Pick<
  UserRow,
  "id" | "username" | "displayName" | "email" | "tags" | "avatarUrl" | "status" | "createdAt" | "updatedAt"
> &
  WithRoles;

/** Trọn hàng users (kèm `passwordHash`) cộng vai — thứ mà đường đăng nhập cần. */
export type FullUser = UserRow & WithRoles;

/**
 * Vai của một đạo hữu, đọc từ bảng `user_roles` — nguồn DUY NHẤT kể từ 09/08/2026.
 *
 * Sắp theo `sort_order` chứ không theo lúc được ban: nhờ vậy mảng trả về luôn cùng thứ tự với
 * `normalizeRoles` — giao diện vẽ huy hiệu theo thứ tự thang vai, và phép so "vai có đổi
 * không" ở `updateUserAction` không bao giờ hiểu nhầm một mảng xáo thứ tự là một thay đổi.
 *
 * `coalesce` vì `array_agg` trả `null` khi không có dòng nào, mà môn đồ thường thì đúng là
 * không có dòng nào — thiếu nó là mọi phép `.roles.includes(...)` phía trên ngã vì null.
 */
const rolesOfUser = sql<string[]>`coalesce(
  (select array_agg(ur.role_code order by r.sort_order)
     from ${schema.userRoles} ur
     join ${schema.roles} r on r.code = ur.role_code
    where ur.user_id = ${schema.users.id}),
  '{}'::text[]
)`;

/**
 * `avatarUrl` có mặt vì nó là danh tính công khai y như danh xưng — thanh đầu trang và sảnh
 * đàm đạo đều vẽ nó. `avatarKey` thì KHÔNG: đó là tên object trong kho, một chi tiết lưu trữ
 * chỉ `setAvatar`/`clearAvatar` cần, và mọi cột lọt vào đây là một cột chảy ra tới client.
 */
const publicColumns = {
  id: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
  email: schema.users.email,
  roles: rolesOfUser,
  tags: schema.users.tags,
  avatarUrl: schema.users.avatarUrl,
  status: schema.users.status,
  createdAt: schema.users.createdAt,
  updatedAt: schema.users.updatedAt,
} as const;

/**
 * Trọn hàng users, CỘNG thêm `roles` đọc từ `user_roles`.
 *
 * `getTableColumns` chứ không phải `select()` trơn, vì bảng users KHÔNG còn cột `roles` nào để
 * `select()` mang về — nó phải được ghép vào đây. `verifyCredentials` trả về hàng này và
 * `loginAction` hỏi `isAdminUser(user)` trên đó, nên thiếu phép ghép là đường ĐĂNG NHẬP mất
 * vai.
 */
const allColumnsWithRoles = { ...getTableColumns(schema.users), roles: rolesOfUser } as const;

export async function findByUsername(username: string): Promise<FullUser | null> {
  const rows = await db()
    .select(allColumnsWithRoles)
    .from(schema.users)
    .where(eq(schema.users.username, username.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByEmail(email: string): Promise<FullUser | null> {
  const rows = await db()
    .select(allColumnsWithRoles)
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
  const status = membership.requireApproval ? "pending" : "active";
  // Danh xưng đi theo TRẠNG THÁI, không do ai ban: còn chờ duyệt thì là Phàm nhân, vào thẳng
  // được thì đã là Đệ tử. `setStatus` lo nốt cú thăng vai lúc duyệt.
  const role = status === "pending" ? ROLE_AWAITING : ROLE_DISCIPLE;

  /**
   * MỘT câu lệnh cho cả hàng `users` lẫn dòng vai — cùng lý lẽ với `adminCreate`: hai câu
   * riêng thì có một khe mà ở đó người mới đã tồn tại nhưng chưa mang danh xưng nào, và
   * người gọi thì vừa nhận một thông báo lỗi nên tưởng chưa có gì được tạo.
   *
   * Không `returning` trọn `publicColumns` ở đây rồi trả thẳng: cột `roles` là một truy vấn
   * con, mà CTE `granted` ghi trong CÙNG ảnh chụp nên câu `returning` KHÔNG nhìn thấy dòng
   * vai vừa chèn — nó sẽ trả về một mảng vai rỗng, sai lặng lẽ. Nên: ghi nguyên tử trước,
   * rồi đọc lại một lượt để có sự thật.
   */
  const created = await db().execute(sql`
    with new_user as (
      insert into users (username, display_name, email, password_hash, status)
      values (
        ${username},
        ${input.displayName.trim()},
        ${email},
        ${hashPassword(input.password)},
        ${status}
      )
      -- Hai người có thể submit cùng lúc sau bước kiểm tra trên. Database phân xử, rồi ta
      -- đọc lại để trả thông báo thân thiện thay vì làm văng lỗi 500 vì unique constraint.
      on conflict do nothing
      returning id
    ),
    granted as (
      insert into user_roles (user_id, role_code)
      select nu.id, ${role} from new_user nu
    )
    select id from new_user
  `);

  const id = (created.rows[0] as { id?: string } | undefined)?.id;
  if (id) {
    const user = await findById(id);
    // Vừa chèn xong mà đọc lại không thấy là chuyện KHÔNG được nuốt: nó nghĩa là hàng đã bị
    // xoá ngay sau đó, hoặc ta đang đọc nhầm database.
    if (!user) {
      return { ok: false, error: "Đã lập được đạo hiệu nhưng không đọc lại được — thử đăng nhập xem sao." };
    }
    return { ok: true, user };
  }
  if (await findByUsername(username)) {
    return { ok: false, error: "Đạo hiệu này đã có người dùng." };
  }
  return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<FullUser | null> {
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

/**
 * Đổi trạng thái, và — CHỈ khi trạng thái mới là `active` — thăng danh xưng cho người vừa
 * được duyệt: bỏ「Phàm nhân」, ban「Đệ tử」.
 *
 * Luật sống ở TẦNG NÀY chứ không trong nút bấm bên `admin.ts`, vì nó là một tính chất của cú
 * chuyển trạng thái chứ không của một cái nút: ngày có thêm đường duyệt thứ hai (duyệt hàng
 * loạt, tự duyệt theo môn quy) thì nó đã đúng sẵn, không cần ai nhớ chép lại.
 *
 * Ba điều CỐ Ý:
 *
 *  1. Chỉ chiều ĐI LÊN. Đẩy ngược một người về `pending` hay `disabled` KHÔNG thu lại danh
 *     xưng — thu vai là việc của Gia chủ qua bảng môn đồ, và tự động hạ vai người ta khi
 *     đình quyền tạm thời là một hành vi bất ngờ không ai yêu cầu.
 *  2. Ban `de-tu` VÔ ĐIỀU KIỆN (trừ Gia chủ), không phải chỉ khi đang mang `pham-nhan`. Nhờ
 *     vậy nó vừa là phép thăng vai, vừa là phép TỰ CHỮA cho những hàng cũ chưa có danh xưng
 *     nào — chạy lại bao nhiêu lần cũng ra một kết quả.
 *  3. Trừ Gia chủ, đúng như lệ「toàn bộ user trừ gia-chu là đệ tử」: một Gia chủ đeo thêm
 *     nhãn Đệ tử thì vô nghĩa, dù chẳng mất quyền gì.
 *
 * MỘT câu lệnh, cùng lý lẽ với `writeRoles`: neon-http không có transaction tương tác, nên
 * "trạng thái và danh xưng cùng sống hoặc cùng chết" chỉ có một hình dạng.
 */
export async function setStatus(
  id: string,
  status: "pending" | "active" | "disabled",
): Promise<void> {
  if (status !== "active") {
    await db()
      .update(schema.users)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
    return;
  }

  await db().execute(sql`
    with promoted as (
      delete from user_roles
       where user_id = ${id} and role_code = ${ROLE_AWAITING}
    ),
    granted as (
      insert into user_roles (user_id, role_code)
      select ${id}, ${ROLE_DISCIPLE}
       where not exists (
         select 1 from user_roles
          where user_id = ${id} and role_code = ${ROLE_OWNER}
       )
      on conflict do nothing
    )
    update users set status = ${status}, updated_at = now() where id = ${id}
  `);
}

/**
 * Ghi TRỌN tập vai của một người — thêm cái thiếu, bỏ cái thừa — trong ĐÚNG MỘT câu lệnh.
 *
 * Vì sao một câu: ba phép ghi ở đây (xoá vai cũ, thêm vai mới, đóng dấu `updated_at`) phải
 * cùng sống hoặc cùng chết. Driver `neon-http` KHÔNG có transaction tương tác, nên "cùng sống
 * hoặc cùng chết" chỉ có một hình dạng: một câu lệnh. CTE ghi dữ liệu được Postgres bảo đảm
 * chạy đúng một lần dù câu chính không đọc tới, nên `removed` và `added` không cần ai tham
 * chiếu — và chính vì thế câu `update users` cuối cùng vẫn cần thiết dù nó chỉ đóng dấu giờ:
 * nó là câu CHÍNH giữ ba CTE lại với nhau.
 *
 * `wanted` lọc qua bảng `roles` chứ không tin thẳng mảng gửi vào, nên mã lạ bị BỎ chứ không
 * làm ngã khoá ngoại.
 *
 * Không có khe giữa xoá và thêm: cả hai đọc cùng một ảnh chụp, và vai vừa được giữ lại thì
 * nằm trong `wanted` nên không rơi vào tầm của `removed` — người ta không mất quyền một
 * micro-giây nào giữa chừng.
 */
async function writeRoles(id: string, codes: readonly Role[]): Promise<void> {
  await db().execute(sql`
    with wanted as (
      select code from roles where code = any(${sql.param(codes)}::text[])
    ),
    removed as (
      delete from user_roles
       where user_id = ${id} and role_code not in (select code from wanted)
    ),
    added as (
      insert into user_roles (user_id, role_code)
      select ${id}, code from wanted
      on conflict do nothing
    )
    update users set updated_at = now() where id = ${id}
  `);
}

/**
 * Tạo người kèm vai — cũng MỘT câu lệnh, cùng lý lẽ với `writeRoles`.
 *
 * Ca hỏng mà nó bịt rất cụ thể: hàng users vào được, phép cấp vai ngã ⇒ một Chưởng môn vừa
 * được lập ra nhưng không mang vai nào, còn trưởng môn thì nhìn thấy một thông báo lỗi và
 * không có cách nào biết người ấy đã tồn tại hay chưa. Trả giá bằng việc mất kiểm kiểu của
 * drizzle cho bảy tên cột — nên `npm run verify:roles` chạy đúng đường này với vai kèm theo.
 */
export async function adminCreate(input: {
  username: string;
  displayName: string;
  email: string;
  password: string;
  roles: string[];
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

  // Không chọn danh xưng nào thì để TRẠNG THÁI quyết định, đúng như đường đăng ký tự nhiên.
  // Thiếu nhánh này thì hàng chờ có hai loại người: kẻ tự gõ cửa (Phàm nhân) và kẻ được lập
  // tay (không danh xưng nào) — mà chúng phải là một.
  const chosen = normalizeRoles(input.roles);
  const codes: readonly Role[] =
    chosen.length > 0 ? chosen : [input.status === "pending" ? ROLE_AWAITING : ROLE_DISCIPLE];
  const result = await db().execute(sql`
    with new_user as (
      insert into users (username, display_name, email, password_hash, status)
      values (
        ${input.username.toLowerCase()},
        ${input.displayName.trim()},
        ${email},
        ${hashPassword(input.password)},
        ${input.status}
      )
      on conflict do nothing
      returning id
    ),
    granted as (
      insert into user_roles (user_id, role_code)
      select nu.id, r.code from new_user nu join roles r on r.code = any(${sql.param(codes)}::text[])
    )
    select id from new_user
  `);

  if (result.rows.length === 0) {
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
    roles?: string[];
    tags?: string[];
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
  if (input.tags) patch.tags = input.tags;
  if (input.status) patch.status = input.status;

  try {
    await db().update(schema.users).set(patch).where(eq(schema.users.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Email này đã được dùng cho một đạo hiệu khác." };
    }
    throw error;
  }

  /**
   * Vai đi SAU cùng, và là câu lệnh riêng — `user_roles` là bảng khác nên không nhét chung
   * vào phép cập nhật hàng users được.
   *
   * Sau cùng thì hỏng ở đâu cũng đỡ đau: hồ sơ đã ghi, quyền giữ NGUYÊN như trước lượt sửa —
   * tức đúng trạng thái mà trưởng môn đang nhìn thấy lúc bấm. Thứ tự ngược lại là cấp hay
   * thu quyền xong rồi báo lỗi, để lại một người vừa đổi quyền mà không ai chủ ý.
   *
   * Và cả hai câu đều ghi TRỌN trạng thái mong muốn (không phải delta), còn form thì gửi trọn
   * trạng thái ấy, nên bấm Lưu lại lần nữa là hội tụ — chính là điều thông báo lỗi đang bảo
   * người ta làm.
   */
  if (input.roles) {
    await writeRoles(id, normalizeRoles(input.roles));
  }

  return { ok: true };
}

/** Self-service profile update; role, status, username and password remain out of reach. */
export async function updateProfile(
  id: string,
  input: { displayName: string; email: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return adminUpdate(id, input);
}

// ---------------------------------------------------------------------------
// Ảnh đại diện
// ---------------------------------------------------------------------------

/**
 * Ghi ảnh mới và trả về tên object của ảnh CŨ, trong ĐÚNG MỘT câu lệnh.
 *
 * Phép tự-join `from users prev` đọc bảng ở ảnh chụp trước khi câu update ghi, nên
 * `prev.avatar_key` là giá trị cũ — tức người gọi biết phải xoá object nào mà không cần một
 * lượt SELECT riêng trước đó. Đọc-rồi-ghi để lại một khe giữa hai lượt đi: hai tab cùng đổi
 * ảnh sẽ cùng đọc ra một key cũ, rồi một trong hai ảnh mới thành object không ai trỏ tới và
 * không ai biết để dọn. Một câu lệnh thì không có khe ấy — cùng lối nghĩ với `editMessage`
 * bên chat.ts, nơi quyền sở hữu nằm TRONG bộ lọc chứ không phải ở một phép kiểm trước đó.
 *
 * `null` trong `previousKey` nghĩa là người này chưa từng có ảnh, hoặc không có dòng nào khớp
 * `id` — người gọi phân biệt hai ca ấy bằng `matched`.
 */
export async function setAvatar(
  id: string,
  avatar: { url: string; key: string },
): Promise<{ matched: boolean; previousKey: string | null }> {
  const result = await db().execute(sql`
    update users u
    set avatar_url = ${avatar.url}, avatar_key = ${avatar.key}, updated_at = now()
    from users prev
    where u.id = ${id} and prev.id = u.id
    returning prev.avatar_key as previous_key
  `);

  const row = result.rows[0] as { previous_key: string | null } | undefined;
  return { matched: row !== undefined, previousKey: row?.previous_key ?? null };
}

/** Bỏ ảnh, trả về tên object vừa thôi được dùng — cùng phép tự-join và cùng lý do như trên. */
export async function clearAvatar(
  id: string,
): Promise<{ matched: boolean; previousKey: string | null }> {
  const result = await db().execute(sql`
    update users u
    set avatar_url = null, avatar_key = null, updated_at = now()
    from users prev
    where u.id = ${id} and prev.id = u.id
    returning prev.avatar_key as previous_key
  `);

  const row = result.rows[0] as { previous_key: string | null } | undefined;
  return { matched: row !== undefined, previousKey: row?.previous_key ?? null };
}

/**
 * Ảnh của một nhúm người, tra theo id — dành cho sảnh đàm đạo, nơi tin nhắn sống ở MongoDB
 * và chỉ mang theo `userId`.
 *
 * Ảnh cố tình KHÔNG bị đóng băng vào tin nhắn như tên và tag, dù cả ba đều là "danh tính lúc
 * nói". Lý do rất cụ thể: đổi ảnh là XOÁ object cũ, nên một URL đóng băng trong tin cũ sẽ
 * thành ảnh vỡ ngay lần đổi đầu tiên. Tên đóng băng thì chỉ là một chuỗi, không hỏng đi được.
 *
 * Trả về map chỉ gồm người CÓ ảnh: người chưa đặt thì vắng mặt, và giao diện vẽ vòng tròn
 * chữ đầu — nhỏ hơn cho đường truyền, và không có `null` nào để phía client phải phân biệt.
 */
export async function avatarsByUserId(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  // `inArray` với mảng rỗng sinh ra SQL `in ()` — cú pháp lỗi ở Postgres. Và một lượt đi mạng
  // để hỏi về không ai thì dù có chạy được cũng là một lượt thừa.
  if (unique.length === 0) return {};

  const rows = await db()
    .select({ id: schema.users.id, avatarUrl: schema.users.avatarUrl })
    .from(schema.users)
    .where(and(inArray(schema.users.id, unique), isNotNull(schema.users.avatarUrl)));

  return Object.fromEntries(rows.map((row) => [row.id, row.avatarUrl!]));
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

/**
 * Deletion cascades through configs, jobs and events by schema design — an expelled member
 * leaves nothing dangling. The LAST Gia chủ cannot be deleted: only gia-chu may change
 * roles, so the moment the last one is gone, no one can ever manage roles again — a control
 * plane with no one holding the keys is a locked room.
 */
export async function adminDelete(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await findById(id);
  if (!target) {
    return { ok: false, error: "Không tìm thấy đạo hữu này." };
  }

  if (target.roles.includes("gia-chu")) {
    // Đếm thẳng trên `user_roles` — đây là phép hỏi mà `user_roles_role_code_idx` sinh ra để
    // phục vụ, và nó không phải quét bảng users nữa.
    const owners = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleCode, "gia-chu"));
    if ((owners[0]?.n ?? 0) <= 1) {
      return { ok: false, error: "Không thể xoá Gia chủ cuối cùng — truyền ngôi trước đã." };
    }
  }

  await db().delete(schema.users).where(eq(schema.users.id, id));
  return { ok: true };
}
