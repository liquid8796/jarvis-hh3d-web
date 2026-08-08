#!/usr/bin/env node
/**
 * Kiểm chứng MA TRẬN QUYỀN (src/lib/auth/permissions.ts) — thuần, không database, không mạng.
 *
 * Vì sao đáng có: đây là những luật mà một dòng sai không văng lỗi nào cả — nó chỉ lặng lẽ
 * cho một Trưởng môn trục xuất một Trưởng môn khác, đúng cái lỗ hổng mà vai Gia chủ sinh ra
 * để bịt. Ma trận là hàm thuần nên đóng đinh từng ô một ở đây là rẻ và trọn.
 */
import {
  canEditRoles,
  canManageUser,
  isAdminUser,
  isOwner,
  normalizeRoles,
  reviewRoleChange,
} from "../src/lib/auth/permissions";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const owner = { id: "u-owner", roles: ["gia-chu"] };
const ownerAdmin = { id: "u-owner-admin", roles: ["gia-chu", "admin"] };
const admin = { id: "u-admin", roles: ["admin"] };
const admin2 = { id: "u-admin-2", roles: ["admin"] };
const member = { id: "u-member", roles: [] as string[] };

// ---- Nhận vai -----------------------------------------------------------------------
assert(isOwner(owner) && isOwner(ownerAdmin), "gia-chu phải được nhận là Gia chủ");
assert(!isOwner(admin) && !isOwner(member), "không mang gia-chu thì không phải Gia chủ");
assert(isAdminUser(owner), "Gia chủ nghiễm nhiên có quyền trị sự — dù không đeo thêm vai admin");
assert(isAdminUser(admin) && isAdminUser(ownerAdmin), "admin phải có quyền trị sự");
assert(!isAdminUser(member), "môn đồ thường không có quyền trị sự");
console.log("✔ Nhận vai: gia-chu ⊃ quyền admin, mảng rỗng là môn đồ thường.");

// ---- Ai quản được ai ----------------------------------------------------------------
assert(canManageUser(owner, admin), "Gia chủ phải quản được Trưởng môn");
assert(canManageUser(owner, ownerAdmin), "Gia chủ quản được cả một Gia chủ khác");
assert(canManageUser(owner, member), "Gia chủ quản được môn đồ");
assert(canManageUser(admin, member), "Trưởng môn phải quản được môn đồ thường");
assert(!canManageUser(admin, admin2), "LỖ HỔNG CŨ: Trưởng môn KHÔNG được quản Trưởng môn khác");
assert(!canManageUser(admin, owner), "Trưởng môn không được quản Gia chủ");
assert(!canManageUser(admin, ownerAdmin), "vai kép gia-chu+admin vẫn phải ngoài tầm Trưởng môn");
assert(!canManageUser(member, member), "môn đồ không quản ai — kể cả môn đồ khác");
assert(!canManageUser(member, admin), "môn đồ càng không quản được Trưởng môn");
console.log("✔ Quản người: admin bị chặn trước admin, chỉ Gia chủ vượt được vạch ấy.");

// ---- Đổi vai ------------------------------------------------------------------------
assert(canEditRoles(owner) && canEditRoles(ownerAdmin), "chỉ Gia chủ đổi vai — và phải được");
assert(!canEditRoles(admin), "Trưởng môn không được đổi vai — kể cả thăng môn đồ lên admin");
assert(!canEditRoles(member), "môn đồ không đổi vai");

assert(reviewRoleChange(owner, admin, []) === null, "Gia chủ thu mọi vai của một admin: hợp lệ");
assert(reviewRoleChange(owner, member, ["admin"]) === null, "Gia chủ thăng môn đồ lên admin: hợp lệ");
assert(reviewRoleChange(owner, admin, ["gia-chu", "admin"]) === null, "Gia chủ truyền ngôi (thêm gia-chu): hợp lệ");
assert(reviewRoleChange(admin, member, ["admin"]) !== null, "admin thăng người khác phải bị từ chối");
assert(reviewRoleChange(admin, admin2, []) !== null, "admin hạ vai admin khác phải bị từ chối");
console.log("✔ Đổi vai: đặc quyền của riêng Gia chủ.");

// ---- Chống tự khoá cửa --------------------------------------------------------------
assert(
  reviewRoleChange(owner, owner, []) !== null,
  "Gia chủ tự rời ngôi phải bị chặn — không còn ai đổi vai được nữa là hệ thống khoá trái",
);
assert(
  reviewRoleChange(owner, owner, ["admin"]) !== null,
  "tự hạ xuống admin cũng là rời ngôi — phải bị chặn nốt",
);
assert(
  reviewRoleChange(owner, owner, ["gia-chu"]) === null,
  "tự bỏ vai admin mà GIỮ ngôi gia-chu thì được — ngôi mới là thứ không được buông",
);
console.log("✔ Chống khoá cửa: Gia chủ không tự rời ngôi được, phải truyền ngôi trước.");

// ---- Làm sạch mảng vai từ form ------------------------------------------------------
assert(JSON.stringify(normalizeRoles(["admin", "gia-chu"])) === JSON.stringify(["gia-chu", "admin"]),
  "thứ tự chuẩn hoá phải ổn định (gia-chu trước) bất kể form gửi kiểu gì");
assert(normalizeRoles(["admin", "admin", "admin"]).length === 1, "vai lặp phải được gộp");
assert(normalizeRoles(["hacker", "root", "superadmin"]).length === 0, "vai bịa phải bị vứt");
assert(normalizeRoles([]).length === 0, "mảng rỗng ra mảng rỗng");
console.log("✔ Làm sạch: vai bịa bị vứt, vai lặp được gộp, thứ tự ổn định.");

console.log("");
console.log("TẤT CẢ XANH — ma trận quyền đóng đinh đủ các ô.");
