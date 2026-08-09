#!/usr/bin/env node
/**
 * Kiểm chứng MA TRẬN QUYỀN (src/lib/auth/permissions.ts) — thuần, không database, không mạng.
 *
 * Vì sao đáng có: đây là những luật mà một dòng sai không văng lỗi nào cả — nó chỉ lặng lẽ
 * cho một vai trị sự trục xuất một người ngang vai, đúng cái lỗ hổng mà vai Gia chủ sinh ra
 * để bịt. Ma trận là hàm thuần nên đóng đinh từng ô một ở đây là rẻ và trọn.
 *
 * Từ 09/08/2026 có BỐN vai, tức 121 ô actor×target thay vì 9 — nhiều tới mức liệt kê tay thì
 * vừa sót vừa không ai đọc. Nên phần lớn ô được quét bằng vòng lặp so với một BẢNG HẠNG viết
 * tay ở dưới; những ô mang ý nghĩa lịch sử thì vẫn có dòng khẳng định riêng, vì một phép thử
 * còn để kể lại vì sao luật ấy tồn tại.
 */
import {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  canEditRoles,
  canManageUser,
  hasPermission,
  isAdminUser,
  isOwner,
  normalizeRoles,
  reviewRoleChange,
  type Permission,
  type Role,
} from "../src/lib/auth/permissions";
import { MAX_TAGS, MAX_TAG_LENGTH, TAG_PRESETS, parseTags, splitTags } from "../src/lib/validation/tags";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const owner = { id: "u-owner", roles: ["gia-chu"] };
const ownerMaster = { id: "u-owner-master", roles: ["gia-chu", "chuong-mon"] };
const elder = { id: "u-elder", roles: ["thai-thuong-truong-lao"] };
const elder2 = { id: "u-elder-2", roles: ["thai-thuong-truong-lao"] };
const master = { id: "u-master", roles: ["chuong-mon"] };
const master2 = { id: "u-master-2", roles: ["chuong-mon"] };
const member = { id: "u-member", roles: [] as string[] };
const member2 = { id: "u-member-2", roles: [] as string[] };
/** Đệ tử: MANG một vai, nhưng vẫn là môn đồ thường — cả điểm khó của vai này nằm ở đây. */
const disciple = { id: "u-disciple", roles: ["de-tu"] };
const disciple2 = { id: "u-disciple-2", roles: ["de-tu"] };
/** Phàm nhân: đang CHỜ DUYỆT. Bậc trị sự phải quản được họ — nếu không thì không ai duyệt nổi. */
const mortal = { id: "u-mortal", roles: ["pham-nhan"] };
const mortal2 = { id: "u-mortal-2", roles: ["pham-nhan"] };
/** Vừa trị sự vừa đeo danh xưng đệ tử: tấm khiên của vai trị sự KHÔNG được mất đi vì thế. */
const masterDisciple = { id: "u-master-disciple", roles: ["chuong-mon", "de-tu"] };

const EVERYONE = [
  owner, ownerMaster, elder, elder2, master, master2,
  masterDisciple, disciple, disciple2, mortal, mortal2, member, member2,
];

/**
 * BẢNG HẠNG viết tay — cố ý KHÔNG hỏi `isAdminUser`. Một oracle đi hỏi chính thứ đang bị
 * kiểm thì nó chỉ chứng minh code bằng chính code, và sẽ gật đầu với mọi lỗi mà code mắc.
 * Thêm một vai mới ở permissions.ts mà quên khai hạng ở đây là phép thử dừng ngay — đúng ý.
 */
const RANK: Record<string, "gia-chu" | "tri-su" | "mon-do"> = {
  "u-owner": "gia-chu",
  "u-owner-master": "gia-chu",
  "u-elder": "tri-su",
  "u-elder-2": "tri-su",
  "u-master": "tri-su",
  "u-master-2": "tri-su",
  // Đeo thêm danh xưng đệ tử KHÔNG hạ một vai trị sự xuống hạng quản được.
  "u-master-disciple": "tri-su",
  // Đệ tử xếp hạng MÔN ĐỒ, dù có tên trong danh mục vai. Nếu bảng này ghi "tri-su" thì phép
  // quét ma trận bên dưới sẽ đỏ ở mọi ô「trị sự × đệ tử」— đúng cái lỗ hổng phải chặn.
  // Phàm nhân xếp hạng MÔN ĐỒ — đây là ô quan trọng nhất của bảng này: ghi "tri-su" là
  // hàng chờ tự khoá lại, không bậc trị sự nào duyệt được ai.
  "u-mortal": "mon-do",
  "u-mortal-2": "mon-do",
  "u-disciple": "mon-do",
  "u-disciple-2": "mon-do",
  "u-member": "mon-do",
  "u-member-2": "mon-do",
};

for (const person of EVERYONE) {
  assert(RANK[person.id] !== undefined, `thiếu khai hạng cho ${person.id} trong bảng oracle`);
}

// ---- Vai nào cũng phải có nhãn và không trùng ----------------------------------------
assert(new Set(ASSIGNABLE_ROLES).size === ASSIGNABLE_ROLES.length, "mã vai không được trùng nhau");
for (const role of ASSIGNABLE_ROLES) {
  assert(typeof ROLE_LABEL[role] === "string" && ROLE_LABEL[role].length > 0, `vai ${role} chưa có nhãn hiển thị`);
}
assert(ASSIGNABLE_ROLES[0] === "gia-chu", "gia-chu phải đứng ĐẦU — thứ tự này là thứ tự huy hiệu và thứ tự chuẩn hoá");
assert(
  ASSIGNABLE_ROLES.at(-1) === "pham-nhan",
  "pham-nhan phải đứng CUỐI — nó là bậc thấp nhất (chưa nhập môn), và vị trí ấy chính là sort_order dưới database",
);
assert(ASSIGNABLE_ROLES.length === 5, `đang có ${ASSIGNABLE_ROLES.length} vai — cập nhật bảng oracle rồi sửa con số này`);
console.log(`✔ Bảng vai: ${ASSIGNABLE_ROLES.length} mã, không trùng, vai nào cũng có nhãn, gia-chu đầu — pham-nhan cuối.`);

// ---- Nhận vai -----------------------------------------------------------------------
assert(isOwner(owner) && isOwner(ownerMaster), "gia-chu phải được nhận là Gia chủ");
assert(!isOwner(master) && !isOwner(elder) && !isOwner(member), "không mang gia-chu thì không phải Gia chủ");
assert(isAdminUser(owner), "Gia chủ nghiễm nhiên có quyền trị sự — dù không đeo thêm vai trị sự nào");
assert(isAdminUser(master) && isAdminUser(ownerMaster), "Chưởng môn phải có quyền trị sự");
assert(isAdminUser(elder), "Thái thượng trưởng lão phải có quyền trị sự — ngang Chưởng môn là ngang ở đây");
assert(isAdminUser(master), "Chưởng môn phải có quyền trị sự");
assert(!isAdminUser(member), "môn đồ thường không có quyền trị sự");

assert(!isAdminUser(disciple), "ĐỆ TỬ KHÔNG có quyền trị sự — nó là danh xưng, không phải một bậc");
assert(!isAdminUser(mortal), "PHÀM NHÂN KHÔNG có quyền trị sự — người còn đang chờ duyệt");
assert(
  canManageUser(master, mortal) && canManageUser(elder, mortal),
  "bậc trị sự PHẢI quản được phàm nhân — không thì chính hàng chờ tự khoá lại, không ai duyệt được ai",
);

/**
 * HÌNH DẠNG từng vai — bảng VIẾT TAY, không suy từ `ROLE_PERMISSIONS`. Suy ra từ chính hằng số
 * đang bị kiểm thì phép thử chỉ chứng minh code bằng code, và sẽ gật đầu với mọi lỗi code mắc.
 *
 * Hai câu hỏi để RỜI nhau dù hôm nay chúng chia bảng vai y hệt nhau, vì đó đúng là loại nhầm
 * lẫn mà `de-tu` vừa vạch ra: hợp nhất hai câu khác nhau chỉ vì tình cờ trùng kết quả là cách
 * một trong hai lặng lẽ sai vào ngày có vai thứ sáu. Ngày có một vai nắm `chat.purge` mà không
 * vào được trang Tông Môn, `opensAdminDoor: false` + `labelOnly: false` nói đúng ngay.
 *
 * `Record<Role, …>` nên thêm vai ở permissions.ts mà quên khai ở đây là KHÔNG biên dịch được —
 * cùng một mẹo, cùng một lý do với `ROLE_SHIELDS_BEARER`.
 */
const ROLE_SHAPE: Record<Role, { opensAdminDoor: boolean; labelOnly: boolean }> = {
  "gia-chu": { opensAdminDoor: true, labelOnly: false },
  "thai-thuong-truong-lao": { opensAdminDoor: true, labelOnly: false },
  "chuong-mon": { opensAdminDoor: true, labelOnly: false },
  "de-tu": { opensAdminDoor: false, labelOnly: true },
  "pham-nhan": { opensAdminDoor: false, labelOnly: true },
};

for (const role of ASSIGNABLE_ROLES) {
  assert(
    isAdminUser({ roles: [role] }) === ROLE_SHAPE[role].opensAdminDoor,
    `vai ${role}: cửa trị sự mở ${isAdminUser({ roles: [role] })}, bảng oracle nói ${ROLE_SHAPE[role].opensAdminDoor}`,
  );
}
console.log("✔ Nhận vai: ba vai trị sự qua cửa, đệ tử/phàm nhân và mảng rỗng thì không.");

// ---- Bảng quyền ----------------------------------------------------------------------
assert(new Set(PERMISSIONS).size === PERMISSIONS.length, "mã quyền không được trùng nhau");
for (const permission of PERMISSIONS) {
  assert(
    typeof PERMISSION_LABEL[permission] === "string" && PERMISSION_LABEL[permission].length > 0,
    `quyền ${permission} chưa có nhãn hiển thị`,
  );
  assert(
    ASSIGNABLE_ROLES.some((role) => ROLE_PERMISSIONS[role].includes(permission)),
    `quyền ${permission} không vai nào nắm — một hàng rào không ai mở được là hàng rào chết`,
  );
}
for (const role of ASSIGNABLE_ROLES) {
  // Hai chiều, theo đúng bảng hình dạng viết tay: vai trị sự mà rỗng quyền là quên đấu dây;
  // vai danh xưng mà CÓ quyền là trao nhầm. Trước khi có `de-tu`, dòng này chỉ đòi "phải khác
  // rỗng" — một luật đúng khi mọi vai đều là bậc trị sự, và sai ngay khi có vai đầu tiên
  // sinh ra chỉ để làm cái nhãn.
  assert(
    (ROLE_PERMISSIONS[role].length === 0) === ROLE_SHAPE[role].labelOnly,
    ROLE_SHAPE[role].labelOnly
      ? `vai ${role} là danh xưng thuần, KHÔNG được mang quyền nào`
      : `vai ${role} không mở được việc gì thì nó là một cái nhãn — khai vào ROLE_SHAPE nếu đó là ý`,
  );
  assert(
    new Set(ROLE_PERMISSIONS[role]).size === ROLE_PERMISSIONS[role].length,
    `vai ${role} khai trùng một quyền`,
  );
  for (const permission of ROLE_PERMISSIONS[role]) {
    assert(PERMISSIONS.includes(permission), `vai ${role} khai một mã quyền không có trong danh mục: ${permission}`);
  }
}

// "Gia chủ nghiễm nhiên có mọi quyền" — khẳng định trên TỪNG mã, không tin vào cách viết
// `ROLE_PERMISSIONS['gia-chu'] = PERMISSIONS`. Ngày ai đó chép tay danh sách ấy ra là ngày
// dòng này bắt được.
for (const permission of PERMISSIONS) {
  assert(hasPermission(owner, permission), `Gia chủ phải có quyền ${permission}`);
}
for (const role of ASSIGNABLE_ROLES) {
  for (const permission of ROLE_PERMISSIONS[role]) {
    assert(
      ROLE_PERMISSIONS["gia-chu"].includes(permission),
      `vai ${role} có quyền ${permission} mà Gia chủ thì không — cấp trên thiếu quyền cấp dưới là vô lý`,
    );
  }
}

/**
 * AI GIỮ QUYỀN GÌ — bảng viết tay, và là oracle mạnh nhất của tệp này.
 *
 * Trước 09/08/2026 chỗ này chỉ là một danh sách「ba quyền riêng của Gia chủ」, đủ dùng khi ba
 * vai bậc trị sự còn ngang nhau y hệt. Ngày Thái thượng trưởng lão nhận riêng `job.force_stop`
 * thì một danh sách như thế không nói được gì về sự khác biệt ấy — nó vẫn xanh dù ai đó lỡ
 * tay ban quyền dừng đàn cho cả Trưởng môn.
 *
 * `Record<Permission, …>` nên thêm một mã quyền ở permissions.ts mà quên khai ở đây là KHÔNG
 * biên dịch được. Và bảng này cố ý KHÔNG suy từ `ROLE_PERMISSIONS` — suy ra từ chính hằng số
 * đang bị kiểm thì phép thử chỉ chứng minh code bằng code.
 */
const PERMISSION_HOLDERS: Record<Permission, readonly Role[]> = {
  "admin.panel": ["gia-chu", "thai-thuong-truong-lao", "chuong-mon"],
  "member.manage": ["gia-chu", "thai-thuong-truong-lao", "chuong-mon"],
  "role_bearer.manage": ["gia-chu"],
  "role.assign": ["gia-chu"],
  "chat.purge": ["gia-chu"],
  // Chỉ Gia chủ và Thái thượng trưởng lão. Chưởng môn và Trưởng môn KHÔNG — đây chính là
  // chỗ ba vai bậc trị sự thôi ngang nhau, nên nó phải có một dòng đứng canh.
  "job.force_stop": ["gia-chu", "thai-thuong-truong-lao"],
};

for (const permission of PERMISSIONS) {
  for (const role of ASSIGNABLE_ROLES) {
    const want = PERMISSION_HOLDERS[permission].includes(role);
    const got = hasPermission({ roles: [role] }, permission);
    assert(got === want, `vai ${role} × quyền ${permission}: code nói ${got}, bảng oracle nói ${want}`);
  }
  assert(!hasPermission(member, permission), `môn đồ thường không được có quyền nào, kể cả ${permission}`);
  assert(!hasPermission({ roles: ["choi-choi"] }, permission), `một mã vai bịa không được mở ra quyền ${permission}`);
}

// Đeo thêm một danh xưng KHÔNG được lấy mất quyền đang có — `de-tu` là vai rỗng quyền, và
// phép hỏi quét mọi vai người ta mang, nên nó không thể trừ đi của ai cái gì.
assert(
  hasPermission({ roles: ["thai-thuong-truong-lao", "de-tu"] }, "job.force_stop"),
  "Thái thượng trưởng lão đeo thêm danh xưng đệ tử vẫn phải dừng được đàn",
);
assert(
  !hasPermission({ roles: ["chuong-mon", "de-tu"] }, "job.force_stop"),
  "Chưởng môn gom thêm danh xưng nào cũng KHÔNG ra được quyền dừng đàn",
);

console.log(
  `✔ Bảng quyền: ${PERMISSIONS.length} mã × ${ASSIGNABLE_ROLES.length} vai quét trọn theo bảng oracle, ` +
    `Gia chủ trùm hết, dừng đàn chỉ Gia chủ + Thái thượng trưởng lão.`,
);

// ---- Ai quản được ai: quét TRỌN ma trận ----------------------------------------------
const expectManage = (actorId: string, targetId: string): boolean => {
  if (RANK[actorId] === "gia-chu") return true;
  if (RANK[actorId] === "tri-su") return RANK[targetId] === "mon-do";
  return false;
};

let checked = 0;
for (const actor of EVERYONE) {
  for (const target of EVERYONE) {
    const got = canManageUser(actor, target);
    const want = expectManage(actor.id, target.id);
    assert(
      got === want,
      `canManageUser(${actor.id} [${actor.roles.join("+") || "không vai"}], ` +
        `${target.id} [${target.roles.join("+") || "không vai"}]) = ${got}, đáng lẽ ${want}`,
    );
    checked++;
  }
}
console.log(`✔ Quản người: quét trọn ${checked} ô actor×target, không ô nào lệch bảng hạng.`);

// Những ô mang ý nghĩa lịch sử — giữ dòng riêng để phép thử còn KỂ được vì sao luật tồn tại.
assert(!canManageUser(elder, elder2), "LỖ HỔNG CŨ: một vai trị sự KHÔNG được quản người ngang vai mình");
assert(!canManageUser(master, master2), "Chưởng môn cũng KHÔNG quản được Chưởng môn khác — cùng một lẽ ấy");
assert(!canManageUser(elder, elder2), "Thái thượng trưởng lão cũng vậy");
assert(
  !canManageUser(master, elder) && !canManageUser(elder, master),
  "hai vai bậc trị sự ngang nhau nên không ai đụng được ai — KHÁC vai cũng không",
);
assert(!canManageUser(elder, owner) && !canManageUser(master, ownerMaster), "không vai trị sự nào với tới Gia chủ");
assert(canManageUser(owner, elder) && canManageUser(owner, master), "Gia chủ quản được cả hai vai mới");
console.log("✔ Bậc trị sự: hai vai ngang nhau, không ai hạ được ai — chỉ Gia chủ vượt vạch.");

// ---- Đệ tử: MANG vai nhưng KHÔNG được che chắn ---------------------------------------
// Đây là cái bẫy của cả tính năng. Trước khi có `de-tu`, phép che chắn hỏi "có mang vai nào
// trong danh mục không" — hồi ấy vô hại vì mọi vai đều là vai trị sự. Giữ nguyên phép ấy khi
// thêm `de-tu` là trao cho mỗi đệ tử một tấm khiên chắn cả ba bậc trị sự: không ai duyệt, sửa
// hay trục xuất họ được nữa ngoài Gia chủ. Sáu dòng dưới đây là chỗ lỗi ấy sẽ kêu.
assert(canManageUser(master, disciple), "Trưởng môn PHẢI quản được đệ tử — đệ tử chính là người họ sinh ra để quản");
assert(canManageUser(master, disciple), "Chưởng môn cũng phải quản được đệ tử");
assert(canManageUser(elder, disciple), "Thái thượng trưởng lão cũng phải quản được đệ tử");
assert(canManageUser(owner, disciple), "Gia chủ thì hiển nhiên");
assert(!canManageUser(disciple, member), "đệ tử KHÔNG quản được ai — vai này không mở quyền nào");
assert(!canManageUser(disciple, disciple2), "kể cả một đệ tử khác");

// Trộn vai: tấm khiên đến TỪ vai trị sự, nên đeo thêm danh xưng đệ tử không gỡ nó ra.
assert(
  !canManageUser(master2, masterDisciple),
  "Trưởng môn đeo thêm danh xưng đệ tử vẫn là Trưởng môn — không được rơi xuống hạng quản được",
);
assert(isAdminUser(masterDisciple), "vai trị sự + danh xưng đệ tử thì vẫn qua được cửa trị sự");

// Quyền: đệ tử không mở được MỘT việc nào trong danh mục.
for (const permission of PERMISSIONS) {
  assert(!hasPermission(disciple, permission), `đệ tử không được có quyền ${permission}`);
}
assert(ROLE_PERMISSIONS["de-tu"].length === 0, "ROLE_PERMISSIONS['de-tu'] phải RỖNG — nó là danh xưng, không phải bậc");
assert(!canEditRoles(disciple), "đệ tử không đổi được vai của ai");
console.log("✔ Đệ tử: mang vai mà vẫn là môn đồ — bậc trị sự quản được, và nó không mở quyền nào.");

// ---- Đổi vai ------------------------------------------------------------------------
assert(canEditRoles(owner) && canEditRoles(ownerMaster), "chỉ Gia chủ đổi vai — và phải được");
assert(!canEditRoles(master), "Chưởng môn không được đổi vai — kể cả thăng môn đồ lên ngang mình");
assert(!canEditRoles(elder) && !canEditRoles(master), "vai trị sự nào cũng KHÔNG được đổi vai — ngang nhau thì ngang cả chỗ bị chặn");
assert(!canEditRoles(member), "môn đồ không đổi vai");

assert(reviewRoleChange(owner, master, []) === null, "Gia chủ thu mọi vai của một Chưởng môn: hợp lệ");
assert(reviewRoleChange(owner, member, ["chuong-mon"]) === null, "Gia chủ thăng môn đồ lên Chưởng môn: hợp lệ");
assert(reviewRoleChange(owner, member, ["chuong-mon"]) === null, "Gia chủ phong Chưởng môn: hợp lệ");
assert(
  reviewRoleChange(owner, member, ["thai-thuong-truong-lao", "chuong-mon"]) === null,
  "một người giữ CẢ HAI vai mới cùng lúc: hợp lệ — vai vốn là một tập hợp",
);
assert(reviewRoleChange(owner, master, ["gia-chu", "chuong-mon"]) === null, "Gia chủ truyền ngôi (thêm gia-chu): hợp lệ");
assert(reviewRoleChange(master, member, ["chuong-mon"]) !== null, "Chưởng môn thăng người khác phải bị từ chối");
assert(reviewRoleChange(master, member, ["chuong-mon"]) !== null, "Chưởng môn phong Chưởng môn phải bị từ chối");
assert(reviewRoleChange(master, master2, []) !== null, "Chưởng môn hạ vai Chưởng môn khác phải bị từ chối");
console.log("✔ Đổi vai: đặc quyền của riêng Gia chủ, hai vai mới không được thừa hưởng.");

// ---- Chống tự khoá cửa --------------------------------------------------------------
assert(
  reviewRoleChange(owner, owner, []) !== null,
  "Gia chủ tự rời ngôi phải bị chặn — không còn ai đổi vai được nữa là hệ thống khoá trái",
);
assert(
  reviewRoleChange(owner, owner, ["chuong-mon"]) !== null,
  "tự hạ xuống Chưởng môn cũng là rời ngôi — phải bị chặn nốt",
);
assert(
  reviewRoleChange(owner, owner, ["chuong-mon"]) !== null,
  "tự hạ xuống Chưởng môn cũng là rời ngôi — vai mới KHÔNG được là cửa sau để buông ngôi",
);
assert(
  reviewRoleChange(owner, owner, ["gia-chu"]) === null,
  "tự bỏ vai Chưởng môn mà GIỮ ngôi gia-chu thì được — ngôi mới là thứ không được buông",
);
console.log("✔ Chống khoá cửa: không có đường nào Gia chủ tự rời ngôi, kể cả qua vai mới.");

// ---- Làm sạch mảng vai từ form ------------------------------------------------------
assert(
  JSON.stringify(normalizeRoles(["chuong-mon", "gia-chu"])) === JSON.stringify(["gia-chu", "chuong-mon"]),
  "thứ tự chuẩn hoá phải ổn định (gia-chu trước) bất kể form gửi kiểu gì",
);
assert(
  JSON.stringify(normalizeRoles(["de-tu", "pham-nhan", "chuong-mon", "thai-thuong-truong-lao", "gia-chu"])) ===
    JSON.stringify([...ASSIGNABLE_ROLES]),
  "gửi đủ CẢ NĂM vai theo thứ tự lộn xộn vẫn phải ra đúng thứ tự thang vai",
);
assert(
  JSON.stringify(normalizeRoles(["de-tu", "gia-chu"])) === JSON.stringify(["gia-chu", "de-tu"]),
  "đệ tử phải xếp SAU Gia chủ — nó là bậc thấp nhất, và thứ tự này là thứ tự huy hiệu",
);
assert(normalizeRoles(["chuong-mon", "chuong-mon", "chuong-mon"]).length === 1, "vai lặp phải được gộp");
assert(normalizeRoles(["hacker", "root", "superadmin"]).length === 0, "vai bịa phải bị vứt");
assert(
  normalizeRoles(["chuong_mon", "chuongmon", "Chưởng môn"]).length === 0,
  "gõ gần đúng vẫn là vai bịa — mã vai so KHỚP TỪNG KÝ TỰ, không đoán ý",
);
assert(normalizeRoles([]).length === 0, "mảng rỗng ra mảng rỗng");
console.log("✔ Làm sạch: vai bịa bị vứt, vai lặp được gộp, thứ tự ổn định.");

// ---- Tag: trần và tag bày sẵn --------------------------------------------------------
// Phép thử ĐÁNG GIÁ NHẤT ở khối này: mọi tag bày sẵn phải lọt trần. Trước bản này trần là 20
// mà「Thái thượng trưởng lão」dài 22 — chip bấm vào được, Lưu thì bị từ chối, và không có gì
// trên màn hình nói ra con số nào đã vượt.
for (const preset of TAG_PRESETS) {
  assert(
    preset.length <= MAX_TAG_LENGTH,
    `tag bày sẵn「${preset}」dài ${preset.length} ký tự, vượt trần ${MAX_TAG_LENGTH} — bấm được mà lưu không được`,
  );
}
assert(TAG_PRESETS.length <= MAX_TAGS * 4, "danh sách bày sẵn dài quá thì nó là một cái menu, không phải lối tắt");
assert(new Set(TAG_PRESETS.map((t) => t.toLowerCase())).size === TAG_PRESETS.length, "tag bày sẵn không được trùng nhau");

assert(JSON.stringify(splitTags("a, , a ,b")) === JSON.stringify(["a", "b"]), "cắt tag: bỏ trùng, bỏ rỗng, bỏ khoảng trắng");
assert(splitTags("").length === 0 && splitTags("   ,  ").length === 0, "ô trống ra không tag nào, không phải một tag rỗng");

const full = parseTags(TAG_PRESETS.slice(0, MAX_TAGS).join(", "));
assert(full.ok && full.tags.length === MAX_TAGS, `đúng ${MAX_TAGS} tag bày sẵn phải lọt`);
assert(!parseTags(TAG_PRESETS.join(", ")).ok, `quá ${MAX_TAGS} tag phải bị từ chối`);
assert(!parseTags("x".repeat(MAX_TAG_LENGTH + 1)).ok, "tag dài quá trần phải bị từ chối");
assert(parseTags("x".repeat(MAX_TAG_LENGTH)).ok, "tag dài ĐÚNG bằng trần phải lọt — biên là biên, không phải vạch cấm");
console.log(`✔ Tag: ${TAG_PRESETS.length} tag bày sẵn đều lọt trần ${MAX_TAG_LENGTH}, biên trần chuẩn xác.`);

console.log("");
console.log("TẤT CẢ XANH — ma trận quyền đóng đinh đủ các ô.");

// Giữ `Role` được dùng tới để tsc không kêu import thừa, và cũng là một phép thử kiểu: mã lạ
// gán vào `Role` phải không biên dịch được.
const sampleRole: Role = "chuong-mon";
assert(ASSIGNABLE_ROLES.includes(sampleRole), "mã mẫu phải nằm trong bảng vai");
