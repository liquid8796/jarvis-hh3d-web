/**
 * Ma trận ai-được-làm-gì của tông môn — MỘT chỗ duy nhất, thuần, không đụng database.
 *
 * Vì sao tách khỏi guards.ts: guard trả lời "người này là ai" (đọc DB, redirect); còn đây
 * trả lời "A có được đụng vào B không" — thuần dữ liệu vào ra, nên kiểm chứng được bằng
 * script không cần dựng gì cả. Mọi server action về người PHẢI hỏi qua đây; action tự bịa
 * luật riêng là cách các luật lệch nhau giữa các form.
 *
 * Thang vai (từ 08/08/2026, một người có thể giữ NHIỀU vai cùng lúc):
 *
 *   gia-chu  — Gia chủ, vai lớn nhất. Một mình vai này sửa/xoá được các Trưởng môn, và cũng
 *              là vai DUY NHẤT được đổi vai của bất kỳ ai. Sinh ra để bịt một lỗ hổng có
 *              thật: trước đây hai Trưởng môn ngang quyền hạ vai hay trục xuất được lẫn
 *              nhau — admin nào cũng chỉ an toàn cho tới khi một admin khác đổi ý.
 *   admin    — Trưởng môn. Duyệt, sửa, trục xuất MÔN ĐỒ THƯỜNG; không đụng được người mang
 *              vai (admin hay gia-chu), kể cả chính vai của mình.
 *   (rỗng)   — môn đồ thường.
 *
 * Gia chủ nghiễm nhiên có mọi quyền Trưởng môn — cấp trên mà thiếu quyền cấp dưới thì vừa
 * vô lý vừa bắt mọi chỗ kiểm tra phải nhớ hỏi HAI vai.
 */

export const ASSIGNABLE_ROLES = ["gia-chu", "admin"] as const;
export type Role = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  "gia-chu": "Gia chủ",
  admin: "Trưởng môn",
};

type RoleBearer = { roles: string[] };
type Identified = RoleBearer & { id: string };

export function isOwner(user: RoleBearer): boolean {
  return user.roles.includes("gia-chu");
}

/** "Có quyền trị sự" — Gia chủ hay Trưởng môn đều qua cửa này. */
export function isAdminUser(user: RoleBearer): boolean {
  return isOwner(user) || user.roles.includes("admin");
}

/**
 * A có được quản B không (sửa hồ sơ, đổi trạng thái, trục xuất)?
 *
 *   Gia chủ  → quản tất cả.
 *   Admin    → chỉ quản người KHÔNG mang vai. "Không đụng được admin khác" phải bao trùm cả
 *              đổi trạng thái lẫn sửa hồ sơ, không riêng gì xoá: đình quyền một admin hay
 *              đổi email của họ cũng chính là vô hiệu hoá họ, chỉ là bằng cửa khác.
 *   Môn đồ   → không quản ai.
 *
 * Tự quản mình KHÔNG đi qua hàm này — các giới hạn tự thân (không tự khoá, không tự trục
 * xuất, không tự rời ngôi Gia chủ) là luật riêng, gác ở action.
 */
export function canManageUser(actor: RoleBearer, target: RoleBearer): boolean {
  if (isOwner(actor)) return true;
  if (isAdminUser(actor)) return !isAdminUser(target) && !isOwner(target);
  return false;
}

/** Đổi VAI là đặc quyền của riêng Gia chủ — admin thăng một môn đồ lên admin cũng là đổi vai. */
export function canEditRoles(actor: RoleBearer): boolean {
  return isOwner(actor);
}

/**
 * Soát một lần đổi vai cụ thể. Trả về lời từ chối, hoặc `null` nếu hợp lệ.
 *
 * Luật chống tự khoá cửa: Gia chủ không được tự rời ngôi. Không phải vì ngôi ấy quý, mà vì
 * đường ngược lại KHÔNG TỒN TẠI — chỉ Gia chủ đổi được vai, nên khoảnh khắc người cuối cùng
 * rời ngôi là cả hệ thống vĩnh viễn không còn ai đổi vai được nữa.
 */
export function reviewRoleChange(
  actor: Identified,
  target: Identified,
  nextRoles: readonly string[],
): string | null {
  if (!canEditRoles(actor)) {
    return "Chỉ Gia chủ mới được đổi vai.";
  }
  if (actor.id === target.id && !nextRoles.includes("gia-chu")) {
    return "Gia chủ không thể tự rời ngôi — truyền ngôi cho người khác trước đã.";
  }
  return null;
}

/** Làm sạch một mảng vai thô từ form: chỉ giữ vai hợp lệ, bỏ trùng, thứ tự ổn định. */
export function normalizeRoles(raw: readonly string[]): Role[] {
  return ASSIGNABLE_ROLES.filter((role) => raw.includes(role));
}
