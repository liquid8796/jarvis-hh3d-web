/**
 * Ma trận ai-được-làm-gì của tông môn — MỘT chỗ duy nhất, thuần, không đụng database.
 *
 * Vì sao tách khỏi guards.ts: guard trả lời "người này là ai" (đọc DB, redirect); còn đây
 * trả lời "A có được đụng vào B không" — thuần dữ liệu vào ra, nên kiểm chứng được bằng
 * script không cần dựng gì cả. Mọi server action về người PHẢI hỏi qua đây; action tự bịa
 * luật riêng là cách các luật lệch nhau giữa các form.
 *
 * Database giữ bản SAO của bảng vai và bảng quyền dưới đây (`roles`, `permissions`,
 * `role_permissions`) để một câu SQL trả lời được "ai xoá sạch được sảnh đàm đạo"; còn ai
 * MANG vai nào thì database mới là gốc (`user_roles`). Chiều gốc của ma trận là code →
 * database — lý do đầy đủ nằm ở `rolePermissions` trong `src/lib/db/schema.ts`, và
 * `npm run verify:roles` đỏ khi hai bên lệch nhau.
 *
 * Thang vai (từ 08/08/2026, một người có thể giữ NHIỀU vai cùng lúc):
 *
 *   gia-chu  — Gia chủ, vai lớn nhất. Một mình vai này sửa/xoá được người mang vai, và cũng
 *              là vai DUY NHẤT được đổi vai của bất kỳ ai. Sinh ra để bịt một lỗ hổng có
 *              thật: trước đây hai vai trị sự ngang quyền hạ vai hay trục xuất được lẫn
 *              nhau — ai cũng chỉ an toàn cho tới khi một người ngang vai đổi ý.
 *
 *   Hai vai ở bậc trị sự:
 *     thai-thuong-truong-lao — Thái thượng trưởng lão
 *     chuong-mon             — Chưởng môn
 *   Cả hai: duyệt, sửa, trục xuất MÔN ĐỒ THƯỜNG; không đụng được người mang vai, kể cả người
 *   mang đúng vai của mình. Nghe thì lạ — một Chưởng môn không sửa nổi một Chưởng môn khác —
 *   nhưng đó CHÍNH LÀ lỗ hổng mà bậc Gia chủ sinh ra để bịt, và thêm vai mới không phải là
 *   lý do để mở lại nó.
 *
 *   de-tu    — Đệ tử. Vai ĐẦU TIÊN không mang quyền nào: nó là một danh xưng cho môn đồ
 *              thường, không phải một bậc trị sự. Xem `ROLE_SHIELDS_BEARER` — thêm nó vào
 *              danh mục suýt nữa đã khiến chính Trưởng môn không quản nổi đệ tử.
 *
 *   (rỗng)   — môn đồ thường chưa được ban danh xưng nào.
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

/**
 * Thứ tự ở đây LÀ thang vai: nó quyết định `sort_order` dưới database (kiểm bởi
 * `verify:roles`), thứ tự huy hiệu trên bảng môn đồ, và thứ tự `normalizeRoles` trả về. Nên
 * `de-tu` đứng CUỐI — nó là bậc thấp nhất, không phải một vai trị sự xếp nhầm chỗ.
 */
export const ASSIGNABLE_ROLES = [
  "gia-chu",
  "thai-thuong-truong-lao",
  "chuong-mon",
  "de-tu",
] as const;
export type Role = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  "gia-chu": "Gia chủ",
  "thai-thuong-truong-lao": "Thái thượng trưởng lão",
  "chuong-mon": "Chưởng môn",
  "de-tu": "Đệ tử",
};

/**
 * BẢNG QUYỀN — từng việc cụ thể một vai mở ra được.
 *
 * Trước bản này, "ai được làm gì" nằm rải trong thân các hàm dưới đây: một danh sách vai bậc
 * trị sự ở `isAdminUser`, một phép `isOwner` ở `canEditRoles`, một phép `isOwner` nữa ở tận
 * `purgeChatAction` bên actions. Ba chỗ, ba cách viết, và không chỗ nào đọc được bằng SQL.
 * Giờ chúng là dữ liệu: một bảng mã quyền, một bảng vai→quyền, và mọi câu hỏi đi qua
 * `hasPermission`.
 *
 * Danh sách này CỐ Ý ngắn: mỗi mã ở đây phải được code thật ĐỌC tại một chỗ ra quyết định cụ
 * thể. Không thêm quyền cho những việc mà hôm nay chỉ cần `requireAdmin()` là xong (đổi tên
 * miền, đặt hạn lưu, bật/tắt bế quan) — một mã không ai hỏi tới thì không phải hàng rào, chỉ
 * là một dòng trong bảng chờ mục rữa.
 *
 * `admin.panel` và `member.manage` hiện do CÙNG ba vai nắm giữ, và đó không phải trùng lặp:
 * chúng trả lời hai câu khác nhau — "mở được trang Tông Môn" và "ra tay được với môn đồ".
 * Ngày có một vai chỉ để NGỒI XEM, hai câu ấy tách đôi ngay, và chỗ tách đã có sẵn tên.
 */
export const PERMISSIONS = [
  "admin.panel",
  "member.manage",
  "role_bearer.manage",
  "role.assign",
  "chat.purge",
  "job.force_stop",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  "admin.panel": "Vào trang Tông Môn",
  "member.manage": "Quản môn đồ thường",
  "role_bearer.manage": "Quản cả người mang vai",
  "role.assign": "Ban và thu vai",
  "chat.purge": "Thanh tẩy sảnh đàm đạo",
  "job.force_stop": "Dừng đàn của người khác",
};

/**
 * Ba vai bậc trị sự dùng CHUNG một danh sách, không phải ba bản chép giống nhau — "ngang nhau"
 * là một sự thật của hệ thống, nên nó phải là một dòng khai báo, không phải một sự trùng hợp
 * mà ai đó phải nhớ giữ.
 */
const TRI_SU_PERMISSIONS = ["admin.panel", "member.manage"] as const satisfies readonly Permission[];

/**
 * Thái thượng trưởng lão = bậc trị sự CỘNG quyền dừng đàn của người khác.
 *
 * Đây là lần ĐẦU TIÊN ba vai bậc trị sự thôi ngang nhau, nên nó đáng một dòng giải thích chứ
 * không được lẳng lặng trôi qua: từ 09/08/2026 tông chủ giao cho vai này việc gỡ những đàn
 * kẹt mãi không thông trên trang Hàng Đợi. Chưởng môn và Trưởng môn KHÔNG có — cố ý, vì
 * dừng đàn là đụng vào việc đang chạy của người khác, và tông môn muốn ít tay chạm vào đó.
 *
 * Câu「ba vai ngang nhau」ở đầu tệp vẫn đúng ở CHỖ NÓ NÓI: quản người. Chỗ chúng khác nhau
 * giờ là đây, và chỉ đây.
 */
const THAI_THUONG_PERMISSIONS = [
  ...TRI_SU_PERMISSIONS,
  "job.force_stop",
] as const satisfies readonly Permission[];

/**
 * Gia chủ nhận NGUYÊN `PERMISSIONS`, không phải một danh sách chép tay. Nhờ vậy "Gia chủ
 * nghiễm nhiên có mọi quyền" thành đúng theo cấu tạo: thêm một quyền mới là Gia chủ có ngay,
 * không cần ai nhớ thêm tên nó vào một chỗ thứ hai.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  "gia-chu": PERMISSIONS,
  "thai-thuong-truong-lao": THAI_THUONG_PERMISSIONS,
  "chuong-mon": TRI_SU_PERMISSIONS,
  /**
   * Đệ tử KHÔNG mở được việc gì cả, và mảng rỗng này là một lời khai chứ không phải một chỗ
   * chưa điền: vai này là DANH XƯNG cho môn đồ thường, để bảng môn đồ và sảnh đàm đạo gọi họ
   * bằng một cái tên, chứ không phải để trao thêm quyền.
   */
  "de-tu": [],
};

/**
 * Vai nào CHE CHẮN người mang nó khỏi bậc trị sự — tức chỉ Gia chủ mới đụng tới được.
 *
 * Tách khỏi "có mang vai nào không", và sự tách này là phần khó nhất của việc thêm `de-tu`.
 * Trước bản này, `canManageUser` che chắn BẤT KỲ ai mang một vai có trong danh mục, vì hồi ấy
 * mọi vai đều là vai trị sự nên hai câu ấy trùng kết quả. Thả `de-tu` vào danh mục theo cách
 * cũ là biến mỗi đệ tử thành người mà Trưởng môn, Chưởng môn và Thái thượng trưởng lão đều
 * KHÔNG duyệt, không sửa, không trục xuất được — chỉ Gia chủ làm nổi. Đúng ngược với ý nghĩa
 * của vai: đệ tử chính là người mà bậc trị sự sinh ra để quản.
 *
 * Là `Record<Role, boolean>` chứ không phải một mảng các vai được che: kiểu này bắt MỌI vai
 * thêm về sau phải trả lời câu hỏi ấy ngay tại đây, không biên dịch được nếu bỏ trống. Một
 * danh sách thì im lặng bỏ sót, và bỏ sót ở đây nghĩa là một vai trị sự mới lặng lẽ trở thành
 * người ai cũng trục xuất được.
 */
const ROLE_SHIELDS_BEARER: Record<Role, boolean> = {
  "gia-chu": true,
  "thai-thuong-truong-lao": true,
  "chuong-mon": true,
  "de-tu": false,
};

/**
 * Dựng MỘT LẦN lúc nạp module. `isAdminUser` chạy trên mọi request có phiên — ở guard, ở thanh
 * đầu trang, ở mỗi action — nên phép hỏi phải là tra `Set`, không phải quét mảng.
 */
const GRANTS: ReadonlyMap<string, ReadonlySet<Permission>> = new Map(
  ASSIGNABLE_ROLES.map((role) => [role, new Set(ROLE_PERMISSIONS[role])] as const),
);

/**
 * Cùng lẽ với `GRANTS`: dựng một lần lúc nạp module, rồi tra bằng `Set`.
 *
 * Là `Set<string>` chứ không tra thẳng `ROLE_SHIELDS_BEARER` bằng một phép ép kiểu: mảng vai
 * đọc từ database là `string[]`, nên tra thẳng vào một `Record<Role, …>` sẽ phải nói dối trình
 * biên dịch rằng mọi chuỗi đều là `Role`. `Set.has` nhận chuỗi bất kỳ mà không phải nói dối, và
 * một mã lạ đơn giản là không có trong tập — tức quản được như môn đồ thường.
 */
const SHIELDED_ROLES: ReadonlySet<string> = new Set(
  ASSIGNABLE_ROLES.filter((role) => ROLE_SHIELDS_BEARER[role]),
);

/**
 * `readonly` chứ không `string[]`: những hàm này chỉ ĐỌC vai, và nhận cả mảng chỉ-đọc thì
 * nơi gọi khỏi phải sao chép mảng ra chỉ để chiều kiểu.
 */
type RoleBearer = { roles: readonly string[] };
type Identified = RoleBearer & { id: string };

/** Người này có mở được việc ấy không — cửa vào DUY NHẤT của bảng quyền. */
export function hasPermission(user: RoleBearer, permission: Permission): boolean {
  return user.roles.some((role) => GRANTS.get(role)?.has(permission) === true);
}

/**
 * "Có mang vai nào ĐƯỢC CHE CHẮN không" — hỏi theo DANH MỤC chứ không phải `roles.length > 0`.
 * Một mã lạ lọt vào (không thể, vì `user_roles.role_code` có khoá ngoại — nhưng luật này không
 * nên phụ thuộc vào điều đó) sẽ không biến người ta thành kẻ bất khả xâm phạm mà không ai gỡ
 * được: mã không có trong bảng thì `?? false`, tức quản được như môn đồ thường.
 */
function bearsShieldedRole(user: RoleBearer): boolean {
  return user.roles.some((role) => SHIELDED_ROLES.has(role));
}

export function isOwner(user: RoleBearer): boolean {
  return user.roles.includes("gia-chu");
}

/** "Có quyền trị sự" — cửa `requireAdmin`. Cả ba vai đều mở được. */
export function isAdminUser(user: RoleBearer): boolean {
  return hasPermission(user, "admin.panel");
}

/**
 * A có được quản B không (sửa hồ sơ, đổi trạng thái, trục xuất)?
 *
 *   Gia chủ  → quản tất cả (`role_bearer.manage`).
 *   Bậc trị  → chỉ quản người KHÔNG mang vai nào. "Không đụng được người mang vai" phải bao
 *   sự       trùm cả đổi trạng thái lẫn sửa hồ sơ, không riêng gì xoá: đình quyền một Trưởng
 *              môn hay đổi email của họ cũng chính là vô hiệu hoá họ, chỉ là bằng cửa khác.
 *              Và nó bao trùm cả người mang CÙNG vai với mình — ba vai ở bậc này ngang nhau,
 *              nên để họ hạ được nhau thì cả bậc chỉ an toàn tới khi có người đổi ý.
 *   Môn đồ   → không quản ai.
 *
 * Phía BỊ QUẢN hỏi `bearsShieldedRole`, KHÔNG hỏi `isAdminUser` và cũng KHÔNG hỏi "có mang vai
 * nào không". Ba câu ấy khác nhau, và ngày `de-tu` ra đời là ngày chúng tách hẳn:
 *   • "mở được trang Tông Môn"      → `isAdminUser`
 *   • "có tên trong danh mục vai"   → đúng cả với đệ tử
 *   • "được che chắn khỏi bậc trị sự" → `ROLE_SHIELDS_BEARER`, và CHỈ câu này được dùng ở đây
 * Bản trước hỏi câu thứ hai, hồi ấy vô hại vì mọi vai đều là vai trị sự. Giữ nguyên nó khi
 * thêm `de-tu` là trao cho mỗi đệ tử một tấm khiên chắn cả ba bậc trị sự — không ai duyệt,
 * sửa hay trục xuất họ được nữa ngoài Gia chủ.
 *
 * Tự quản mình KHÔNG đi qua hàm này — các giới hạn tự thân (không tự khoá, không tự trục
 * xuất, không tự rời ngôi Gia chủ) là luật riêng, gác ở action.
 */
export function canManageUser(actor: RoleBearer, target: RoleBearer): boolean {
  if (hasPermission(actor, "role_bearer.manage")) return true;
  if (hasPermission(actor, "member.manage")) return !bearsShieldedRole(target);
  return false;
}

/** Đổi VAI là đặc quyền của riêng Gia chủ — một Chưởng môn thăng ai đó lên ngang mình cũng là đổi vai. */
export function canEditRoles(actor: RoleBearer): boolean {
  return hasPermission(actor, "role.assign");
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
