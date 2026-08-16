#!/usr/bin/env node
/**
 * Kiểm chứng công tắc XÉT DUYỆT THÀNH VIÊN, đầu này sang đầu kia.
 *
 * Script này ĐỘNG VÀO document cấu hình toàn hệ thống thật, vì đó là thứ `register()` đọc và
 * không có cửa sau nào để tiêm giá trị giả vào. Nên nó in giá trị gốc ra màn hình TRƯỚC khi
 * chạm vào, khôi phục trong `finally`, rồi ĐỌC LẠI để chắc chắn khôi phục đã ăn — thất bại ở
 * bước đó là loại thất bại phải hét lên, không phải ghi một dòng log rồi thôi: hậu quả của nó
 * là cổng tông môn nằm sai chiều mà không ai biết.
 */
import { sqlTag } from "./pgTag.mjs";
import { appSettingsSchema, getAppSettings, saveAppSettings } from "../src/lib/services/settings";
import { findById, register } from "../src/lib/services/users";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = sqlTag(process.env.DATABASE_URL);
const stamp = Date.now();
const gatedUsername = `__gate_on_${stamp}`;
const openUsername = `__gate_off_${stamp}`;

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// ---------------------------------------------------------------------------
// Phần thuần: default và tính tương thích ngược. Không chạm database.
// ---------------------------------------------------------------------------

const empty = appSettingsSchema.parse({});
assert(
  empty.membership.requireApproval === true,
  "document RỖNG phải mặc định BẬT xét duyệt — nếu không, deploy xong là cổng tự mở",
);

// Đúng hình thù mà mọi bản deploy trước bản này đã ghi xuống: có `chat`, không có `membership`.
const legacy = appSettingsSchema.parse({ chat: { retentionDays: 14 } });
assert(
  legacy.membership.requireApproval === true,
  "document cũ (chưa có nhánh membership) phải mặc định BẬT xét duyệt",
);
assert(legacy.chat.retentionDays === 14, "thêm nhánh mới không được nuốt cấu hình đã có");

// Rác trong document không được kéo cả cấu hình về default một cách im lặng ở chiều đọc —
// getAppSettings() có nhánh safeParse dự phòng, còn ở đây ta chốt luật của chính schema.
assert(
  appSettingsSchema.safeParse({ membership: { requireApproval: "có" } }).success === false,
  "requireApproval không phải boolean thì schema phải từ chối",
);

console.log("✔ Default và tương thích ngược: cổng luôn nghiêng về phía ĐÓNG khi chưa ai nói gì.");

// ---------------------------------------------------------------------------
// Phần thật: hai chiều công tắc, đo bằng trạng thái người vừa đăng ký.
// ---------------------------------------------------------------------------

const originalRows = await sql`select value from app_settings where id = 'global' limit 1`;
const hadRow = originalRows.length > 0;
const originalValue = hadRow ? originalRows[0].value : null;
console.log(`• Cấu hình gốc (giữ để trả lại): ${hadRow ? JSON.stringify(originalValue) : "CHƯA CÓ DÒNG NÀO"}`);

try {
  // --- Công tắc BẬT: người mới phải dừng ở hàng chờ -------------------------
  const gated = await getAppSettings();
  gated.membership.requireApproval = true;
  await saveAppSettings(gated);

  const gatedResult = await register({
    username: gatedUsername,
    displayName: "Gate on",
    email: `gate-on+${stamp}@example.com`,
    password: "verification-password",
  });
  assert(gatedResult.ok, "đăng ký khi đang xét duyệt phải thành công");
  if (!gatedResult.ok) throw new Error(gatedResult.error);
  assert(
    gatedResult.user.status === "pending",
    `bật xét duyệt thì người mới phải là 'pending', nhận được '${gatedResult.user.status}'`,
  );

  // Đọc lại từ database chứ không tin giá trị returning: đích đến của người dùng được quyết
  // bởi cột đã ghi xuống, nên đó mới là thứ đáng kiểm.
  const gatedStored = await findById(gatedResult.user.id);
  assert(gatedStored?.status === "pending", "cột status trong database phải là 'pending'");

  // --- Công tắc TẮT: người mới được thu nhận ngay ---------------------------
  const open = await getAppSettings();
  open.membership.requireApproval = false;
  await saveAppSettings(open);

  const openResult = await register({
    username: openUsername,
    displayName: "Gate off",
    email: `gate-off+${stamp}@example.com`,
    password: "verification-password",
  });
  assert(openResult.ok, "đăng ký khi cổng mở phải thành công");
  if (!openResult.ok) throw new Error(openResult.error);
  assert(
    openResult.user.status === "active",
    `tắt xét duyệt thì người mới phải là 'active', nhận được '${openResult.user.status}'`,
  );

  const openStored = await findById(openResult.user.id);
  assert(openStored?.status === "active", "cột status trong database phải là 'active'");
  // `roles` chứ không phải `role`: `PublicUser` bỏ cột di sản ấy từ lúc vai thành một TẬP HỢP,
  // nên phép so cũ luôn là `undefined === "user"` — một phép thử đỏ quanh năm, tức không gác gì.
  assert(openStored?.roles.length === 0, "mở cổng KHÔNG được phát quyền trưởng môn cho ai");

  // --- Tắt cổng không với tay ngược về quá khứ ------------------------------
  // Người đăng ký lúc cổng còn gác vẫn phải nằm nguyên trong hàng chờ; đây chính là cảnh báo
  // mà form môn quy hiện ra, và nó chỉ đúng nếu hành vi thật đúng như vậy.
  const gatedAfterOpening = await findById(gatedResult.user.id);
  assert(
    gatedAfterOpening?.status === "pending",
    "mở cổng không được tự duyệt những người đã đứng sẵn trong hàng chờ",
  );

  // --- Đổi công tắc không được làm hỏng cấu hình hàng xóm -------------------
  const after = await getAppSettings();
  const before = appSettingsSchema.parse(hadRow ? originalValue : {});
  assert(
    after.chat.retentionDays === before.chat.retentionDays,
    "ghi môn quy không được đụng tới hạn lưu đàm đạo",
  );

  console.log("✔ Bật: 'pending'. Tắt: 'active'. Hàng chờ cũ giữ nguyên. Cấu hình đàm đạo không suy suyển.");
} finally {
  await sql`delete from users where username = ${gatedUsername} or username = ${openUsername}`.catch(
    (error) => console.error("! Không dọn được tài khoản thử:", error),
  );

  // Khôi phục, rồi ĐỌC LẠI để xác nhận. Không có bước đọc lại thì "đã khôi phục" chỉ là một
  // câu nói, mà câu nói ấy sai thì cổng tông môn nằm sai chiều trong im lặng.
  try {
    if (hadRow) {
      await sql`update app_settings set value = ${originalValue}, updated_at = now() where id = 'global'`;
    } else {
      await sql`delete from app_settings where id = 'global'`;
    }

    const check = await sql`select value from app_settings where id = 'global' limit 1`;
    const restoredOk = hadRow
      ? JSON.stringify(check[0]?.value) === JSON.stringify(originalValue)
      : check.length === 0;
    if (!restoredOk) throw new Error("đọc lại sau khôi phục không khớp giá trị gốc");

    console.log("✔ Đã trả cấu hình toàn hệ thống về đúng giá trị gốc.");
  } catch (error) {
    console.error("\n!!! KHÔNG KHÔI PHỤC ĐƯỢC CẤU HÌNH TOÀN HỆ THỐNG !!!");
    console.error("Giá trị gốc:", hadRow ? JSON.stringify(originalValue) : "(không có dòng nào)");
    console.error("Hãy vào trang Tông Môn đặt lại công tắc xét duyệt bằng tay.");
    console.error(error);
    process.exitCode = 1;
  }
}
