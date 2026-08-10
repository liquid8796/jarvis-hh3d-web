#!/usr/bin/env node
/**
 * Kiểm chứng chế độ BẾ QUAN TRÙNG TU, đầu này sang đầu kia ở tầng service:
 *
 *   1. Schema: document rỗng lẫn document cũ (chưa có nhánh maintenance) đều ra TẮT.
 *   1b. Cửa bế quan: ai gặp bảng chắn, ai chỉ thấy dải nhắc (phép quyết định thuần).
 *   2. Bật bảo trì → feed mang đúng trạng thái (đường đi của bảng chắn).
 *   3. Bật bảo trì → startJob từ chối với thông điệp bế quan (cửa Khai Đàn).
 *   4. Gia hạn giữ nguyên startedAt (thanh tiến độ không nhảy ngược).
 *   5. Tắt bảo trì → feed hạ cờ, startJob quay về lỗi thường ("chưa có tài khoản").
 *
 * Cửa claim của /api/worker không kiểm ở đây được (cần HTTP + token), nhưng nó đọc đúng
 * cùng một nhánh settings mà mục 2 đã chứng minh là đọc/ghi tròn trịa.
 *
 * Script động vào document cấu hình toàn hệ thống THẬT (không có cửa sau nào để tiêm giá
 * trị giả), nên nó in giá trị gốc trước khi chạm, khôi phục trong finally, rồi ĐỌC LẠI để
 * xác nhận — khôi phục hụt là loại thất bại phải hét lên: hậu quả của nó là cả tông môn
 * đứng im trong một phiên bảo trì không ai khai.
 */
import { neon } from "@neondatabase/serverless";
// @ts-expect-error — module JS thuần của quest-engine, không có d.ts.
import { normalizeGameBaseUrl } from "../src/lib/quest-engine/cookies.mjs";
import { maintenanceViewFor } from "../src/lib/auth/maintenance";
import { ASSIGNABLE_ROLES, type Role } from "../src/lib/auth/permissions";
import { appSettingsSchema, getAppSettings, saveAppSettings } from "../src/lib/services/settings";
import {
  JOB_EVENT_RETENTION_DEFAULT_DAYS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  parseRetentionDays,
} from "../src/lib/validation/retention";
import { getMaintenanceFeed } from "../src/lib/services/dashboard";
import { startJob } from "../src/lib/services/jobs";
import { register } from "../src/lib/services/users";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);
const stamp = Date.now();
const username = `__maint_${stamp}`;

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// ---- 0. Hạn lưu nhật ký đàn: biên tin cậy của núm trên tab Bảo Trì ------------------------
// Thuần, không chạm database. Đây là cửa DUY NHẤT giữa ô `<input>` và `saveAppSettings` — mà
// hàm ấy `parse()` chứ không `safeParse()`, nên một giá trị lọt lưới ở đây nổ thành lỗi server
// trần trụi thay vì một dòng nhắc tử tế.
{
  const okDays = (raw: unknown, expected: number) => {
    const r = parseRetentionDays(raw);
    assert(r.ok && r.days === expected, `parseRetentionDays(${JSON.stringify(raw)}) phải cho ${expected}`);
  };
  const bad = (raw: unknown, why: string) => {
    const r = parseRetentionDays(raw);
    assert(!r.ok, `parseRetentionDays(${JSON.stringify(raw)}) phải BỊ TỪ CHỐI — ${why}`);
  };

  okDays("7", 7);
  okDays("  14  ", 14); // ô number vẫn gửi lên chuỗi, và người ta vẫn dán kèm khoảng trắng
  okDays(String(RETENTION_MIN_DAYS), RETENTION_MIN_DAYS);
  okDays(String(RETENTION_MAX_DAYS), RETENTION_MAX_DAYS);

  bad("", "để trống");
  bad(null, "form không gửi trường nào");
  bad(undefined, "trường vắng mặt");
  bad(String(RETENTION_MIN_DAYS - 1), "dưới biên dưới");
  bad(String(RETENTION_MAX_DAYS + 1), "trên biên trên");
  bad("-7", "số âm");
  bad("7.5", "không nguyên");
  bad("abc", "không phải số");
  bad("Infinity", "vô hạn — Number() nuốt nhưng isInteger chặn");
  bad({}, "không phải chuỗi (FormData có thể trả về File)");

  // Biên của parser và biên của schema PHẢI là một. Lệch nhau nghĩa là có một giá trị qua được
  // action rồi chết ở `saveAppSettings` — đúng loại lỗi mà việc gom hằng số sinh ra để chặn.
  assert(
    appSettingsSchema.parse({ jobEvents: { retentionDays: RETENTION_MAX_DAYS } }).jobEvents.retentionDays ===
      RETENTION_MAX_DAYS,
    "schema phải nhận đúng biên trên mà parser nhận",
  );
  let threw = false;
  try {
    appSettingsSchema.parse({ jobEvents: { retentionDays: RETENTION_MAX_DAYS + 1 } });
  } catch {
    threw = true;
  }
  assert(threw, "schema phải TỪ CHỐI giá trị vượt biên — nếu không, parser là hàng rào duy nhất");
  assert(
    appSettingsSchema.parse({}).jobEvents.retentionDays === JOB_EVENT_RETENTION_DEFAULT_DAYS,
    "document rỗng (mọi deploy trước bản này) phải nhận hạn lưu mặc định",
  );
  console.log(`✔ hạn lưu nhật ký đàn: biên ${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS} khớp giữa parser và schema`);
}

// ---- 1. Schema thuần — không chạm database -----------------------------------------------

const empty = appSettingsSchema.parse({});
assert(empty.maintenance.active === false, "document RỖNG phải mặc định TẮT bảo trì");
assert(empty.maintenance.startedAt === null && empty.maintenance.expectedEndAt === null,
  "document rỗng không được bịa ra mốc thời gian");

const legacy = appSettingsSchema.parse({ chat: { retentionDays: 14 }, membership: { requireApproval: false } });
assert(legacy.maintenance.active === false, "document cũ (chưa có nhánh maintenance) phải TẮT");
assert(legacy.membership.requireApproval === false, "thêm nhánh mới không được nuốt cấu hình đã có");

console.log("✔ Schema: cổng bảo trì mặc định TẮT trên mọi document cũ — deploy không tự đóng cửa tông môn.");

// ---- 1b. Ai đi qua được cửa nào trong lúc bế quan ----------------------------------------
// Phép quyết định của MaintenanceGate là một hàm THUẦN, nên nó kiểm được ở đây mà không cần
// dựng React: chính vì thế nó nằm trong lib/auth/maintenance.ts chứ không nằm trong component.

const OFF = { active: false } as const;
const ON = { active: true } as const;
const MEMBER = { roles: [] as string[] };

for (const viewer of [null, MEMBER, { roles: ["chuong-mon"] }, { roles: ["gia-chu"] }]) {
  assert(maintenanceViewFor(OFF, viewer) === "open", "cửa mở thì KHÔNG ai bị chắn, cũng không ai thấy dải nhắc");
}

assert(maintenanceViewFor(ON, MEMBER) === "wall", "môn đồ thường phải gặp bảng chắn ở mọi trang");
assert(maintenanceViewFor(ON, { roles: ["choi-choi"] }) === "wall", "một vai lạ KHÔNG được coi là bậc trị sự");

/**
 * Vai TRỊ SỰ giữ được cửa vào trang Tông Môn — nơi có đúng cái công tắc tắt bảo trì. Chắn họ là
 * khoá trái căn phòng chứa chìa khoá của chính nó.
 *
 * `de-tu` KHÔNG nằm trong nhóm ấy, và đó là chủ ý: đệ tử là danh xưng của môn đồ thường nên
 * trong lúc bế quan họ gặp bảng chắn như mọi môn đồ khác. Vòng lặp này trước đây quét TRỌN
 * `ASSIGNABLE_ROLES` và đòi vai nào cũng qua cửa — một giả định đúng của thời mọi vai đều là vai
 * trị sự, và nó đã ĐỎ ngay khi vai `de-tu` ra đời (bản 0.57.0). Bảng viết tay dưới đây là chỗ
 * mỗi vai thêm về sau phải khai mình thuộc phía nào; `Record<Role, …>` nên bỏ trống là không
 * biên dịch được.
 */
const ROLE_PASSES_MAINTENANCE: Record<Role, boolean> = {
  "gia-chu": true,
  "thai-thuong-truong-lao": true,
  "chuong-mon": true,
  admin: true,
  "de-tu": false,
};

for (const role of ASSIGNABLE_ROLES) {
  const want = ROLE_PASSES_MAINTENANCE[role] ? "banner" : "wall";
  assert(
    maintenanceViewFor(ON, { roles: [role] }) === want,
    `vai ${role} trong lúc bế quan phải thấy「${want}」— vai trị sự phải đi qua được, không thì không ai tắt được bảo trì; còn danh xưng của môn đồ thì phải bị chắn như môn đồ`,
  );
}
assert(
  maintenanceViewFor(ON, { roles: ["de-tu", "chuong-mon"] }) === "banner",
  "đeo thêm danh xưng đệ tử KHÔNG được lấy mất quyền đi qua của một Trưởng môn",
);
assert(
  maintenanceViewFor(ON, { roles: ["chuong-mon", "choi-choi"] }) === "banner",
  "mang thêm một vai lạ không được làm mất quyền trị sự",
);

// Khách chưa đăng nhập PHẢI qua được: cửa đăng nhập là đường duy nhất để một trưởng môn vừa
// hết phiên quay lại với công tắc ấy.
assert(maintenanceViewFor(ON, null) === "banner", "khách chưa đăng nhập phải vào được cửa đăng nhập");

console.log("✔ Cửa bế quan: môn đồ VÀ đệ tử gặp bảng chắn; bốn vai trị sự và khách chưa đăng nhập đi qua được.");

// ---- Tên miền game: chuẩn hoá và phòng thân ----------------------------------------------

for (const [input, want] of [
  ["hoathinh3d.one", "https://hoathinh3d.one"],
  ["https://hoathinh3d.one", "https://hoathinh3d.one"],
  ["https://hoathinh3d.one/", "https://hoathinh3d.one"],
  ["  https://hoathinh3d.one/nhiem-vu-hang-ngay?x=1  ", "https://hoathinh3d.one"],
  ["HTTPS://HoaThinh3D.ONE", "https://hoathinh3d.one"],
  ["http://hoathinh3d.one", "http://hoathinh3d.one"],
] as const) {
  const parsed = normalizeGameBaseUrl(input);
  assert(parsed.ok && parsed.baseUrl === want, `「${input}」phải chuẩn hoá thành ${want}, nhận ${JSON.stringify(parsed)}`);
}

for (const bad of ["", "   ", "hoathinh3d", "localhost", "ftp://hoathinh3d.one", "a b.com", "x".repeat(250)]) {
  const parsed = normalizeGameBaseUrl(bad);
  assert(!parsed.ok && parsed.error.length > 0, `「${bad}」phải bị từ chối kèm lý do, nhận ${JSON.stringify(parsed)}`);
}

// Document rác không được để cả tông môn trỏ vào chuỗi rỗng — thà giữ hằng số trong mã nguồn.
const garbageDomain = appSettingsSchema.parse({ game: { baseUrl: "không-phải-tên-miền" } });
assert(
  garbageDomain.game.baseUrl.startsWith("https://"),
  `giá trị rác phải rơi về hằng số mặc định, nhận ${garbageDomain.game.baseUrl}`,
);
assert(
  appSettingsSchema.parse({}).game.baseUrl.startsWith("https://hoathinh3d."),
  "document rỗng phải có sẵn tên miền mặc định",
);

console.log("✔ Tên miền: chuẩn hoá mọi cách gõ, từ chối mọi giá trị hỏng, rác thì rơi về mặc định.");

// ---- 2..5. Trên database thật -------------------------------------------------------------

const originalRows = await sql`select value from app_settings where id = 'global' limit 1`;
const hadRow = originalRows.length > 0;
const originalValue = hadRow ? originalRows[0].value : null;
console.log(`• Cấu hình gốc (giữ để trả lại): ${hadRow ? JSON.stringify(originalValue) : "CHƯA CÓ DÒNG NÀO"}`);

try {
  const created = await register({
    username,
    displayName: "Maintenance verifier",
    email: `maint+${stamp}@example.com`,
    password: "verification-password",
  });
  if (!created.ok) throw new Error(created.error);
  const userId = created.user.id;

  // --- Bật ---
  const on = await getAppSettings();
  const startIso = new Date().toISOString();
  on.maintenance = {
    active: true,
    startedAt: startIso,
    expectedEndAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    note: "kiểm chứng tự động",
  };
  await saveAppSettings(on);

  const feedOn = await getMaintenanceFeed();
  assert(feedOn.active === true, "feed Auto phải mang cờ bảo trì khi đã bật");
  assert(feedOn.expectedEndAt === on.maintenance.expectedEndAt, "feed phải mang đúng hạn chót cho đồng hồ đếm ngược");
  assert(feedOn.note === "kiểm chứng tự động", "feed phải mang lời nhắn cho popup");

  const blocked = await startJob(userId);
  assert(!blocked.ok, "Khai Đàn phải bị từ chối trong lúc bảo trì");
  assert(!blocked.ok && blocked.error.includes("bế quan"), `lỗi phải nói rõ lý do bế quan, nhận: "${!blocked.ok ? blocked.error : ""}"`);

  // --- Gia hạn: startedAt đứng yên, expectedEndAt dời ---
  const extend = await getAppSettings();
  extend.maintenance = {
    ...extend.maintenance,
    expectedEndAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  await saveAppSettings(extend);
  const feedExtended = await getMaintenanceFeed();
  assert(feedExtended.startedAt === startIso, "gia hạn không được đổi startedAt — thanh tiến độ sẽ nhảy ngược");

  // --- Tắt ---
  const off = await getAppSettings();
  off.maintenance = { active: false, startedAt: null, expectedEndAt: null, note: "" };
  await saveAppSettings(off);

  const feedOff = await getMaintenanceFeed();
  assert(feedOff.active === false, "feed phải hạ cờ khi bảo trì kết thúc");

  const normal = await startJob(userId);
  assert(!normal.ok && normal.error.includes("tài khoản"), "hết bảo trì thì startJob phải quay về lỗi thường (user thử không có tài khoản game)");

  console.log("✔ Bật: feed mang cờ + hạn chót, Khai Đàn khoá đúng lý do. Gia hạn: startedAt đứng yên. Tắt: mọi cửa mở lại.");

  // --- Đổi tên miền: ghi rồi đọc lại, và KHÔNG chạm hàng xóm -----------------
  const beforeDomain = await getAppSettings();
  const keptChat = beforeDomain.chat.retentionDays;
  const keptApproval = beforeDomain.membership.requireApproval;

  const withDomain = await getAppSettings();
  withDomain.game.baseUrl = "https://hoathinh3d.example";
  await saveAppSettings(withDomain);

  const afterDomain = await getAppSettings();
  assert(afterDomain.game.baseUrl === "https://hoathinh3d.example", "tên miền mới phải đọc lại được nguyên vẹn");
  assert(afterDomain.chat.retentionDays === keptChat, "đổi tên miền không được đụng hạn lưu đàm đạo");
  assert(afterDomain.membership.requireApproval === keptApproval, "đổi tên miền không được đụng công tắc xét duyệt");
  assert(afterDomain.maintenance.active === false, "đổi tên miền không được tự bật bảo trì");

  console.log("✔ Tên miền lưu được, đọc lại đúng, và không làm suy suyển cấu hình hàng xóm.");
} finally {
  await sql`delete from users where username = ${username}`.catch(
    (error) => console.error("! Không dọn được tài khoản thử:", error),
  );

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
    console.error("Vào tab Bảo Trì của trang Tông Môn kiểm tra và tắt bảo trì bằng tay.");
    console.error(error);
    process.exitCode = 1;
  }
}
