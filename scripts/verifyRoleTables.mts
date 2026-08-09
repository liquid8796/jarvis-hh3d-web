#!/usr/bin/env node
/**
 * Kiểm chứng BỐN BẢNG VAI–QUYỀN trên database THẬT: roles, permissions, role_permissions,
 * user_roles.
 *
 * Vì sao phải chạm database thay vì kiểm thuần như verifyPermissions.mts: đường ghi vai được
 * viết bằng SQL thô (một câu lệnh, CTE ghi dữ liệu — xem `writeRoles` và `adminCreate` trong
 * services/users.ts), tức tsc không soát hộ được tên cột nào cả. Một chữ gõ nhầm ở đó chỉ
 * hiện ra khi câu lệnh chạy.
 *
 * Hai việc, và việc đầu mới là việc đáng tiền:
 *
 *   1. DANH MỤC trong database phải khớp từng dòng với hằng số trong permissions.ts. Chiều gốc
 *      là code → database (lý do ở `rolePermissions` trong schema.ts), nên bản sao dưới
 *      database chỉ đúng chừng nào có ai đó nhớ viết migration. Đây là chỗ "quên viết" biến
 *      thành một phép thử đỏ thay vì một bí ẩn sáu tháng sau.
 *
 *   2. Cấp/thu vai đi trọn đường thật: adminCreate → findById → adminUpdate → adminDelete,
 *      cộng các hàng rào của chính database (khoá ngoại, cascade, restrict).
 *
 * Tài khoản tạm mang mật khẩu NGẪU NHIÊN, không phải một chuỗi cố định: script này có lúc cấp
 * vai gia-chu cho tài khoản tạm, và nếu nó chết giữa chừng trước khi dọn thì thứ còn nằm lại
 * phải là một tài khoản không ai đăng nhập được. Dọn dẹp đi theo TIỀN TỐ tên nên một lần chạy
 * hỏng trước đây cũng được quét nốt.
 */
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import {
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
} from "../src/lib/auth/permissions";
import {
  adminCreate,
  adminDelete,
  adminUpdate,
  findById,
  findByUsername,
  listUsers,
  register,
} from "../src/lib/services/users";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const PREFIX = "__roles_";
const stamp = Date.now();
const username = `${PREFIX}${stamp}`;
const plainUsername = `${PREFIX}plain_${stamp}`;
const password = `${randomUUID()}${randomUUID()}`;
/** Vai dựng ra chỉ để thử `on delete restrict` — xem lý do tại chỗ dùng. */
const TEMP_ROLE = `${PREFIX}vai`;

try {
  // ---- 1. Danh mục dưới database phải khớp code ---------------------------------------
  const roleRows = (await sql`select code, label, sort_order from roles order by sort_order`) as {
    code: string;
    label: string;
    sort_order: number;
  }[];
  assert(
    roleRows.length === ASSIGNABLE_ROLES.length,
    `bảng roles có ${roleRows.length} dòng, code khai ${ASSIGNABLE_ROLES.length} vai — thiếu một migration?`,
  );
  ASSIGNABLE_ROLES.forEach((role, index) => {
    const row = roleRows[index];
    assert(row.code === role, `vai thứ ${index} dưới database là「${row.code}」, code nói「${role}」`);
    assert(row.label === ROLE_LABEL[role], `nhãn vai ${role}: database「${row.label}」≠ code「${ROLE_LABEL[role]}」`);
    assert(
      Number(row.sort_order) === index,
      `thứ tự vai ${role}: database ${row.sort_order} ≠ vị trí ${index} trong ASSIGNABLE_ROLES`,
    );
  });

  const permissionRows = (await sql`select code, label from permissions order by code`) as {
    code: string;
    label: string;
  }[];
  assert(
    permissionRows.length === PERMISSIONS.length,
    `bảng permissions có ${permissionRows.length} dòng, code khai ${PERMISSIONS.length} quyền`,
  );
  for (const row of permissionRows) {
    const known = PERMISSIONS.find((p) => p === row.code);
    assert(known !== undefined, `database có quyền「${row.code}」mà code không biết`);
    assert(
      row.label === PERMISSION_LABEL[known!],
      `nhãn quyền ${row.code}: database「${row.label}」≠ code「${PERMISSION_LABEL[known!]}」`,
    );
  }

  const grantRows = (await sql`select role_code, permission_code from role_permissions`) as {
    role_code: string;
    permission_code: string;
  }[];
  const inDb = new Set(grantRows.map((r) => `${r.role_code}|${r.permission_code}`));
  const inCode = new Set(
    ASSIGNABLE_ROLES.flatMap((role) => ROLE_PERMISSIONS[role].map((p) => `${role}|${p}`)),
  );
  for (const pair of inCode) {
    assert(inDb.has(pair), `code ban ${pair.replace("|", " → ")} mà database thì không — thiếu migration`);
  }
  for (const pair of inDb) {
    assert(inCode.has(pair), `database ban ${pair.replace("|", " → ")} mà code thì không — migration thừa`);
  }
  console.log(
    `✔ Danh mục khớp: ${roleRows.length} vai, ${permissionRows.length} quyền, ${grantRows.length} ô vai→quyền.`,
  );

  // ---- 2. Tạo người kèm vai, một câu lệnh ---------------------------------------------
  // Gửi vai theo thứ tự LỘN XỘN có chủ ý: cái đọc ra phải là thứ tự thang vai, không phải
  // thứ tự gửi vào — thứ tự ấy là thứ tự huy hiệu, và là thứ `updateUserAction` so để biết
  // "vai có đổi không".
  const created = await adminCreate({
    username,
    displayName: "Kiểm vai",
    email: `${username}@example.com`,
    password,
    roles: ["chuong-mon", "gia-chu"],
    status: "disabled",
  });
  assert(created.ok, `adminCreate kèm vai phải thành công: ${created.ok ? "" : created.error}`);

  const found = await findByUsername(username);
  assert(found !== null, "tạo xong phải tìm lại được");
  const userId = found!.id;

  const afterCreate = await findById(userId);
  assert(
    JSON.stringify(afterCreate?.roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    `vai đọc ra phải theo thang vai, nhận được ${JSON.stringify(afterCreate?.roles)}`,
  );

  const rowsAfterCreate = (await sql`
    select role_code from user_roles where user_id = ${userId} order by role_code
  `) as { role_code: string }[];
  assert(
    JSON.stringify(rowsAfterCreate.map((r) => r.role_code)) === JSON.stringify(["chuong-mon", "gia-chu"]),
    "user_roles phải có đúng hai dòng — vai là quan hệ, không phải thuộc tính của hàng users",
  );
  console.log("✔ Tạo người kèm vai: user_roles có đủ dòng, đọc ra đúng thứ tự thang vai.");

  // ---- 3. Đường ĐĂNG NHẬP cũng phải thấy vai -------------------------------------------
  // `findByUsername` trả về trọn hàng users, mà bảng users KHÔNG còn cột vai nào — vai phải
  // được GHÉP vào từ `user_roles` (xem `allColumnsWithRoles`). Thiếu phép ghép ấy thì
  // `loginAction` đặt claim "user" cho một Gia chủ, và không có gì kêu lên.
  const asLogin = await findByUsername(username);
  assert(
    JSON.stringify(asLogin?.roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    `đường đăng nhập phải thấy đủ vai — nhận được ${JSON.stringify(asLogin?.roles)}`,
  );
  console.log("✔ Đường đăng nhập: hàng users trơn không có vai, phép ghép từ user_roles bù đủ.");

  // ---- 4. Sửa vai: thu bớt, thêm mới, và mã bịa bị vứt ---------------------------------
  const demoted = await adminUpdate(userId, { roles: ["chuong-mon", "khong-co-that"] });
  assert(demoted.ok, "thu vai phải thành công");
  const afterDemote = await findById(userId);
  assert(
    JSON.stringify(afterDemote?.roles) === JSON.stringify(["chuong-mon"]),
    `mã bịa phải bị vứt, chỉ còn chuong-mon — nhận được ${JSON.stringify(afterDemote?.roles)}`,
  );

  const stripped = await adminUpdate(userId, { roles: [] });
  assert(stripped.ok, "thu sạch vai phải thành công");
  const afterStrip = await findById(userId);
  assert(
    JSON.stringify(afterStrip?.roles) === JSON.stringify([]),
    `thu sạch vai phải ra mảng rỗng — nhận được ${JSON.stringify(afterStrip?.roles)}`,
  );
  const noRows = (await sql`select count(*)::int as n from user_roles where user_id = ${userId}`) as { n: number }[];
  assert(noRows[0].n === 0, "thu sạch vai phải xoá hết dòng trong user_roles");

  const regranted = await adminUpdate(userId, { roles: ["gia-chu", "chuong-mon"] });
  assert(regranted.ok, "ban lại vai phải thành công");
  const afterRegrant = await findById(userId);
  assert(
    JSON.stringify(afterRegrant?.roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    "ban lại vai phải khôi phục đủ",
  );
  console.log("✔ Sửa vai: thu bớt, thu sạch, ban lại — mỗi lượt ghi đặt lại TRỌN tập vai.");

  // ---- 5. Sửa hồ sơ KHÔNG được chạm vai -----------------------------------------------
  const renamed = await adminUpdate(userId, { displayName: "Kiểm vai (đã đổi tên)" });
  assert(renamed.ok, "đổi tên hiển thị phải thành công");
  const afterRename = await findById(userId);
  assert(afterRename?.displayName === "Kiểm vai (đã đổi tên)", "tên hiển thị phải đổi thật");
  assert(
    JSON.stringify(afterRename?.roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    "sửa hồ sơ mà không gửi vai thì vai phải giữ NGUYÊN, không bị thu mất",
  );
  console.log("✔ Sửa hồ sơ không kèm vai: vai giữ nguyên (đường `updateProfile` của mọi đạo hữu đi lối này).");

  // ---- 5b. Danh sách người của trang Tông Môn -----------------------------------------
  // `listUsers` là đường đọc ĐÔNG NGƯỜI duy nhất — phép đọc vai ở đây là một subquery tương
  // quan chạy cho từng hàng, kèm `order by` riêng của nó. Một hàm chạy đúng cho một người
  // chưa chứng minh được nó chạy đúng khi Postgres phải dựng kế hoạch cho cả bảng.
  const listed = await listUsers({ search: username });
  assert(listed.length === 1, `tìm theo đạo hiệu phải ra đúng một người, nhận được ${listed.length}`);
  assert(
    JSON.stringify(listed[0].roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    `danh sách phải mang đủ vai theo thang vai — nhận được ${JSON.stringify(listed[0].roles)}`,
  );
  const listedPlainly = await listUsers({});
  const everyone = listedPlainly.find((u) => u.username === username);
  assert(everyone !== undefined, "quét toàn bảng phải thấy tài khoản tạm");
  assert(
    listedPlainly.every((u) => Array.isArray(u.roles)),
    "mọi hàng trong danh sách phải có mảng vai, kể cả môn đồ thường (coalesce, không phải null)",
  );
  console.log(`✔ Danh sách Tông Môn: ${listedPlainly.length} hàng, hàng nào cũng mang mảng vai đọc từ bảng thật.`);

  // ---- 6. Người mới bái sư: không vai, và phép đọc trong RETURNING phải chạy được ------
  const joined = await register({
    username: plainUsername,
    displayName: "Môn đồ kiểm vai",
    email: `${plainUsername}@example.com`,
    password,
  });
  assert(joined.ok, `bái sư phải thành công: ${joined.ok ? "" : joined.error}`);
  if (joined.ok) {
    assert(
      Array.isArray(joined.user.roles) && joined.user.roles.length === 0,
      `người mới phải ra mảng vai RỖNG ngay trong RETURNING — nhận được ${JSON.stringify(joined.user.roles)}`,
    );
  }
  console.log("✔ Bái sư: người mới không mang vai nào, và phép đọc vai chạy được ngay trong RETURNING.");

  // ---- 7. Hàng rào của chính database --------------------------------------------------
  let bogusRejected = false;
  try {
    await sql`insert into user_roles (user_id, role_code) values (${userId}, 'khong-co-that')`;
  } catch {
    bogusRejected = true;
  }
  assert(bogusRejected, "khoá ngoại phải chặn một mã vai không có trong danh mục");

  /**
   * `on delete restrict` phải được thử trên một vai DỰNG RA ĐỂ THỬ, tuyệt đối không phải trên
   * `gia-chu`. Đây là database thật: nếu ràng buộc ấy hỏng theo chiều ngược với dự đoán thì
   * phép thử "xoá gia-chu xem có bị chặn không" sẽ XOÁ THẬT vai lớn nhất của tông môn, và
   * cascade sẽ mang theo cả role_permissions. Một phép thử không được phép có kết cục ấy.
   */
  await sql`insert into roles (code, label, sort_order) values (${TEMP_ROLE}, 'Vai kiểm thử', 99)`;
  await sql`insert into user_roles (user_id, role_code) values (${userId}, ${TEMP_ROLE})`;
  let roleDeleteRejected = false;
  try {
    await sql`delete from roles where code = ${TEMP_ROLE}`;
  } catch {
    roleDeleteRejected = true;
  }
  assert(roleDeleteRejected, "on delete restrict phải chặn việc xoá một vai còn có người mang");
  const stillThere = (await sql`select count(*)::int as n from roles where code = ${TEMP_ROLE}`) as { n: number }[];
  assert(stillThere[0].n === 1, "vai đang có người mang phải còn nguyên sau lần xoá bị chặn");

  // Vai kiểm thử không nằm trong danh mục của code, nên `writeRoles` phải THU nó như mọi mã
  // lạ khác — tiện thể gỡ luôn ràng buộc để `finally` dọn được vai ấy.
  const cleaned = await adminUpdate(userId, { roles: ["gia-chu", "chuong-mon"] });
  assert(cleaned.ok, "ghi lại vai phải thành công");
  const afterClean = await findById(userId);
  assert(
    JSON.stringify(afterClean?.roles) === JSON.stringify(["gia-chu", "chuong-mon"]),
    `một lượt ghi vai phải thu cả vai ngoài danh mục — nhận được ${JSON.stringify(afterClean?.roles)}`,
  );
  console.log("✔ Hàng rào database: mã vai lạ bị khoá ngoại chặn, vai đang có người mang thì không xoá được.");

  // ---- 8. Trục xuất: đếm Gia chủ trên user_roles, và cascade dọn sạch ------------------
  // Tài khoản tạm đang mang gia-chu. Xoá được nghĩa là phép đếm đã thấy CẢ Gia chủ thật —
  // nếu câu đếm hỏng và trả 0 thì hàng rào "không xoá Gia chủ cuối cùng" sẽ chặn ngay đây.
  const removed = await adminDelete(userId);
  assert(removed.ok, `trục xuất phải thành công: ${removed.ok ? "" : removed.error}`);
  const orphans = (await sql`select count(*)::int as n from user_roles where user_id = ${userId}`) as { n: number }[];
  assert(orphans[0].n === 0, "on delete cascade phải dọn sạch vai của người đã bị trục xuất");
  console.log("✔ Trục xuất: phép đếm Gia chủ đọc user_roles, và vai đi theo người bằng cascade.");

  console.log("");
  console.log("TẤT CẢ XANH — bốn bảng vai–quyền khớp code và chịu được đường ghi thật.");
} finally {
  // Người TRƯỚC, vai SAU: cascade gỡ `user_roles` theo người, và chừng nào còn một dòng trỏ
  // vào vai kiểm thử thì chính `on delete restrict` vừa được chứng minh ở trên sẽ giữ nó lại.
  await sql`delete from users where username like ${`${PREFIX}%`}`.catch(() => {});
  await sql`delete from roles where code like ${`${PREFIX}%`}`.catch(() => {});
}
