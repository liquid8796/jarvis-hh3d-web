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
 *   gia-chu  — Gia chủ, vai lớn nhất. Một mình vai này sửa/xoá được người mang vai, và cũng
 *              là vai DUY NHẤT được đổi vai của bất kỳ ai. Sinh ra để bịt một lỗ hổng có
 *              thật: trước đây hai Trưởng môn ngang quyền hạ vai hay trục xuất được lẫn
 *              nhau — admin nào cũng chỉ an toàn cho tới khi một admin khác đổi ý.
 *
 *   Ba vai NGANG NHAU ở bậc trị sự — khác nhau ở danh xưng, không ở quyền:
 *     thai-thuong-truong-lao — Thái thượng trưởng lão
 *     chuong-mon             — Chưởng môn
 *     admin                  — Trưởng môn
 *   Cả ba: duyệt, sửa, trục xuất MÔN ĐỒ THƯỜNG; không đụng được người mang vai, kể cả người
 *   mang đúng vai của mình. Nghe thì lạ — một Chưởng môn không sửa nổi một Chưởng môn khác —
 *   nhưng đó CHÍNH LÀ lỗ hổng mà bậc Gia chủ sinh ra để bịt, và thêm vai mới không phải là
 *   lý do để mở lại nó.
 *
 *   (rỗng)   — môn đồ thường.
 *
 * Gia chủ nghiễm nhiên có mọi quyền trị sự — cấp trên mà thiếu quyền cấp dưới thì vừa vô lý
 * vừa bắt mọi chỗ kiểm tra phải nhớ hỏi đủ BỐN vai.
 *
 * Vì sao mã vai vẫn là tiếng Việt không dấu chứ không đổi sang tiếng Anh: mã đã nằm trong
 * `users.roles` của database thật. Đổi mã là một cuộc di dân dữ liệu, mà giữa lúc migrate và
 * deploy sẽ có một cửa sổ Gia chủ mang mã cũ trong khi code đã đọc mã mới — tức không còn ai
 * đổi được vai, và đó đúng là căn phòng khoá trái mà cả tệp này sinh ra để phòng. Cái giá
 * cho một bảng mã đẹp hơn không đáng.
 */

export const ASSIGNABLE_ROLES = ["gia-chu", "thai-thuong-truong-lao", "chuong-mon", "admin"] as const;
export type Role = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  "gia-chu": "Gia chủ",
  "thai-thuong-truong-lao": "Thái thượng trưởng lão",
  "chuong-mon": "Chưởng môn",
  admin: "Trưởng môn",
};

/**
 * Vai mang quyền trị sự, KHÔNG kể Gia chủ (vai ấy đi cửa riêng vì nó còn hơn thế).
 *
 * `satisfies` để một mã gõ sai bị bắt ngay tại dòng này thay vì im lặng thành "không ai có
 * vai ấy"; `Set` để `isAdminUser` — thứ chạy trên mọi request có phiên — không phải quét
 * mảng. Thêm một vai ngang admin về sau là thêm MỘT chuỗi vào đây, không đụng chỗ nào khác.
 */
const ADMIN_LEVEL_ROLES = ["thai-thuong-truong-lao", "chuong-mon", "admin"] as const satisfies readonly Role[];
const ADMIN_LEVEL = new Set<string>(ADMIN_LEVEL_ROLES);

/**
 * `readonly` chứ không `string[]`: những hàm này chỉ ĐỌC vai, và nhận cả mảng chỉ-đọc thì
 * nơi gọi khỏi phải sao chép mảng ra chỉ để chiều kiểu.
 */
type RoleBearer = { roles: readonly string[] };
type Identified = RoleBearer & { id: string };

export function isOwner(user: RoleBearer): boolean {
  return user.roles.includes("gia-chu");
}

/** "Có quyền trị sự" — Gia chủ và cả ba vai ngang admin đều qua cửa này. */
export function isAdminUser(user: RoleBearer): boolean {
  return isOwner(user) || user.roles.some((role) => ADMIN_LEVEL.has(role));
}

/**
 * A có được quản B không (sửa hồ sơ, đổi trạng thái, trục xuất)?
 *
 *   Gia chủ  → quản tất cả.
 *   Bậc trị  → chỉ quản người KHÔNG mang vai nào. "Không đụng được người mang vai" phải bao
 *   sự       trùm cả đổi trạng thái lẫn sửa hồ sơ, không riêng gì xoá: đình quyền một Trưởng
 *              môn hay đổi email của họ cũng chính là vô hiệu hoá họ, chỉ là bằng cửa khác.
 *              Và nó bao trùm cả người mang CÙNG vai với mình — ba vai ở bậc này ngang nhau,
 *              nên để họ hạ được nhau thì cả bậc chỉ an toàn tới khi có người đổi ý.
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
