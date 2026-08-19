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
import { sqlTag } from "./pgTag.mjs";
import { normalizeGameBaseUrl } from "../src/lib/quest-engine/cookies.mjs";
import { maintenanceAllowsAutomation, maintenanceViewFor } from "../src/lib/auth/maintenance";
import { ADMIN_ROLE_CODES, ASSIGNABLE_ROLES, type Role } from "../src/lib/auth/permissions";
import { appSettingsSchema, getAppSettings, saveAppSettings } from "../src/lib/services/settings";
import {
  HOURS_PER_DAY,
  JOB_EVENT_RETENTION_DEFAULT_DAYS,
  JOB_EVENT_RETENTION_DEFAULT_HOURS,
  RETENTION_MAX_DAYS,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_DAYS,
  RETENTION_MIN_HOURS,
  formatRetention,
  parseRetentionHours,
  splitRetention,
} from "../src/lib/validation/retention";
import { getMaintenanceFeed } from "../src/lib/services/dashboard";
import { startJob } from "../src/lib/services/jobs";
import { register } from "../src/lib/services/users";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = sqlTag(process.env.DATABASE_URL);
const stamp = Date.now();
const username = `__maint_${stamp}`;
/** Người thứ hai, mang vai trị sự — để đo cửa auto mở cho ĐÚNG một phía. */
const adminUsername = `__maint_admin_${stamp}`;
/** Vai dùng để phong: lấy từ chính bộ mã mà SQL phát việc lọc, không gõ tay một mã thứ hai. */
const ADMIN_ROLE_FOR_TEST = ADMIN_ROLE_CODES[0];

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// ---- 0. Hạn lưu nhật ký đàn: biên tin cậy của núm trên tab Bảo Trì ------------------------
// Thuần, không chạm database. Đây là cửa DUY NHẤT giữa ô `<input>` và `saveAppSettings` — mà
// hàm ấy `parse()` chứ không `safeParse()`, nên một giá trị lọt lưới ở đây nổ thành lỗi server
// trần trụi thay vì một dòng nhắc tử tế.
{
  const ok = (amount: unknown, unit: unknown, expected: number) => {
    const r = parseRetentionHours(amount, unit);
    assert(
      r.ok && r.hours === expected,
      `parseRetentionHours(${JSON.stringify(amount)}, ${JSON.stringify(unit)}) phải cho ${expected} giờ`,
    );
  };
  const bad = (amount: unknown, unit: unknown, why: string) => {
    const r = parseRetentionHours(amount, unit);
    assert(
      !r.ok,
      `parseRetentionHours(${JSON.stringify(amount)}, ${JSON.stringify(unit)}) phải BỊ TỪ CHỐI — ${why}`,
    );
  };

  ok("7", "day", 7 * HOURS_PER_DAY);
  ok("7", "hour", 7);
  ok("  14  ", "day", 14 * HOURS_PER_DAY); // ô number vẫn gửi lên chuỗi, và người ta vẫn dán kèm khoảng trắng
  ok("  36  ", "hour", 36);
  ok(String(RETENTION_MIN_DAYS), "day", RETENTION_MIN_DAYS * HOURS_PER_DAY);
  ok(String(RETENTION_MAX_DAYS), "day", RETENTION_MAX_HOURS);
  ok(String(RETENTION_MIN_HOURS), "hour", RETENTION_MIN_HOURS);
  ok(String(RETENTION_MAX_HOURS), "hour", RETENTION_MAX_HOURS);

  bad("", "day", "để trống");
  bad(null, "day", "form không gửi trường nào");
  bad(undefined, "day", "trường vắng mặt");
  bad("0", "hour", "không có hạn lưu nào bằng 0 — đó là xoá sạch");
  bad(String(RETENTION_MIN_DAYS - 1), "day", "dưới biên dưới");
  bad(String(RETENTION_MAX_DAYS + 1), "day", "trên biên trên của ngày");
  bad(String(RETENTION_MAX_HOURS + 1), "hour", "trên biên trên của giờ");
  bad("-7", "day", "số âm");
  bad("7.5", "hour", "không nguyên");
  bad("abc", "day", "không phải số");
  bad("Infinity", "hour", "vô hạn — Number() nuốt nhưng isInteger chặn");
  bad({}, "day", "không phải chuỗi (FormData có thể trả về File)");

  // Đơn vị: TỪ CHỐI chứ không đoán. Đoán「giờ」cho một con số người ta định là「ngày」là cắt hạn
  // lưu xuống 1/24, và lượt quét kế tiếp xoá thật.
  bad("7", null, "form cũ không có ô đơn vị");
  bad("7", "", "đơn vị rỗng");
  bad("7", "week", "đơn vị lạ");
  bad("7", "DAY", "sai chữ hoa — không nhận bừa");
  ok("1", "  day  ", HOURS_PER_DAY); // đơn vị dính khoảng trắng thì vẫn hiểu

  // Biên của parser và biên của schema PHẢI là một. Lệch nhau nghĩa là có một giá trị qua được
  // action rồi chết ở `saveAppSettings` — đúng loại lỗi mà việc gom hằng số sinh ra để chặn.
  assert(
    appSettingsSchema.parse({ jobEvents: { retentionHours: RETENTION_MAX_HOURS } }).jobEvents
      .retentionHours === RETENTION_MAX_HOURS,
    "schema phải nhận đúng biên trên mà parser nhận",
  );
  let threw = false;
  try {
    appSettingsSchema.parse({ jobEvents: { retentionHours: RETENTION_MAX_HOURS + 1 } });
  } catch {
    threw = true;
  }
  assert(threw, "schema phải TỪ CHỐI giá trị vượt biên — nếu không, parser là hàng rào duy nhất");
  assert(
    appSettingsSchema.parse({}).jobEvents.retentionHours === JOB_EVENT_RETENTION_DEFAULT_HOURS,
    "document rỗng (mọi deploy trước bản này) phải nhận hạn lưu mặc định",
  );

  // Document CŨ mang `retentionDays` — mọi document đã ghi trước bản 0.72.0. Rơi về mặc định ở
  // đây nghĩa là hạn lưu trưởng môn đã đặt biến mất lặng lẽ ngay nhịp deploy.
  assert(
    appSettingsSchema.parse({ jobEvents: { retentionDays: 30 } }).jobEvents.retentionHours ===
      30 * HOURS_PER_DAY,
    "document cũ phải được đọc thành GIỜ, không được rơi về mặc định",
  );
  assert(
    appSettingsSchema.parse({ jobEvents: { retentionDays: JOB_EVENT_RETENTION_DEFAULT_DAYS } }).jobEvents
      .retentionHours === JOB_EVENT_RETENTION_DEFAULT_HOURS,
    "mặc định cũ (7 ngày) và mặc định mới phải là CÙNG một khoảng thời gian",
  );
  assert(
    appSettingsSchema.parse({ jobEvents: { retentionHours: 6, retentionDays: 30 } }).jobEvents
      .retentionHours === 6,
    "có cả hai khoá thì khoá GIỜ thắng — đó là thứ lần Lưu gần nhất ghi ra",
  );
  let threwLegacy = false;
  try {
    appSettingsSchema.parse({ jobEvents: { retentionDays: RETENTION_MAX_DAYS + 1 } });
  } catch {
    threwLegacy = true;
  }
  assert(threwLegacy, "khoá cũ vượt biên vẫn phải bị từ chối như trước, không được lọt qua nhánh đọc cũ");

  // Vòng đời của một con số trên form: lưu ra giờ → chẻ lại thành (số, đơn vị) để rót vào ô →
  // người ta bấm Lưu mà không sửa gì → phải ra ĐÚNG con số cũ. Lệch ở đây nghĩa là mở trang
  // admin rồi bấm Lưu là tự đổi hạn lưu của chính mình.
  for (const hours of [1, 6, 23, 24, 25, 36, 168, 720, RETENTION_MAX_HOURS]) {
    const shown = splitRetention(hours);
    const back = parseRetentionHours(String(shown.amount), shown.unit);
    assert(
      back.ok && back.hours === hours,
      `${hours} giờ chẻ ra「${shown.amount} ${shown.unit}」rồi đọc lại phải về đúng ${hours}`,
    );
    assert(shown.amount >= 1 && Number.isInteger(shown.amount), `${hours} giờ phải chẻ ra số nguyên ≥ 1`);
  }

  assert(formatRetention(168) === "7 ngày", "168 giờ phải kể là「7 ngày」");
  assert(formatRetention(24) === "1 ngày", "24 giờ phải kể là「1 ngày」");
  assert(formatRetention(6) === "6 giờ", "6 giờ phải kể là「6 giờ」");
  assert(formatRetention(36) === "1 ngày 12 giờ", "36 giờ phải kể đủ cả phần lẻ");

  console.log(
    `✔ hạn lưu nhật ký đàn: biên ${RETENTION_MIN_HOURS}–${RETENTION_MAX_HOURS} giờ khớp giữa parser và schema, document cũ (ngày) đọc được, form đi vòng không trôi số`,
  );
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
  "de-tu": false,
  /** Phàm nhân đang chờ duyệt — chưa nhập môn thì chưa mở được cửa nào, kể cả cửa bế quan. */
  "pham-nhan": false,
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

console.log("✔ Cửa bế quan: môn đồ VÀ đệ tử gặp bảng chắn; ba vai trị sự và khách chưa đăng nhập đi qua được.");

// ---- Ai còn CHẠY AUTO được trong lúc bế quan (18/08/2026) ---------------------------------
//
// Luật đi kèm cửa trên, và đi kèm vì cùng một lẽ: bế quan là để SỬA, mà nghiệm một bản vá thì
// phải chạy một đàn THẬT. Ba cửa trong mã hỏi cùng hàm này — Khai Đàn, khai đàn hộ, và phép
// phát việc cho khôi lỗi — nên một phép kiểm ở đây bao được cả ba.

for (const owner of [null, MEMBER, { roles: ["chuong-mon"] }, { roles: ["gia-chu"] }]) {
  assert(maintenanceAllowsAutomation(OFF, owner) === true, "cửa mở thì đàn của ai cũng chạy được");
}

assert(maintenanceAllowsAutomation(ON, MEMBER) === false, "môn đồ thường KHÔNG chạy auto trong lúc bế quan");
assert(maintenanceAllowsAutomation(ON, { roles: ["de-tu"] }) === false, "đệ tử là danh xưng môn đồ — cũng không chạy");
assert(maintenanceAllowsAutomation(ON, { roles: ["choi-choi"] }) === false, "một vai lạ KHÔNG mở được cửa auto");

/**
 * `null` = không tra ra chủ đàn (phiên trỏ vào một dòng users đã xoá, hoặc đàn mồ côi). Phải ngả
 * về phía ĐÓNG: mở cho một danh tính không đọc được là mở cho tất cả, vì "không đọc được" là thứ
 * dễ dựng nhất trong mọi cảnh hỏng.
 */
assert(maintenanceAllowsAutomation(ON, null) === false, "không tra ra chủ đàn thì KHÔNG chạy — ngả về phía đóng");

for (const role of ASSIGNABLE_ROLES) {
  assert(
    maintenanceAllowsAutomation(ON, { roles: [role] }) === ROLE_PASSES_MAINTENANCE[role],
    `vai ${role}: quyền chạy auto lúc bế quan phải TRÙNG với quyền đi qua bảng chắn`,
  );
}
assert(
  maintenanceAllowsAutomation(ON, { roles: ["de-tu", "chuong-mon"] }) === true,
  "đeo thêm danh xưng đệ tử KHÔNG lấy mất quyền chạy auto của một Trưởng môn",
);

/**
 * Danh sách mã vai mà câu SQL phát việc dùng để lọc phải TRÙNG KHÍT với phép hỏi trên mảng vai.
 * Đây là chỗ duy nhất hai bên gặp nhau: lệch một mã thì trang cho vào mà database không phát
 * việc — một cái hỏng không có lỗi nào để đọc, chỉ có một đàn nằm im.
 */
const expectedAdminCodes = ASSIGNABLE_ROLES.filter((role) => ROLE_PASSES_MAINTENANCE[role]);
assert(
  [...ADMIN_ROLE_CODES].sort().join(",") === [...expectedAdminCodes].sort().join(","),
  `ADMIN_ROLE_CODES phải đúng bộ vai trị sự — nhận: [${ADMIN_ROLE_CODES.join(", ")}], mong: [${expectedAdminCodes.join(", ")}]`,
);
assert(ADMIN_ROLE_CODES.length > 0, "bộ mã vai trị sự RỖNG sẽ khoá auto của cả tông môn trong lúc bế quan");

console.log(`✔ Chạy auto lúc bế quan: chỉ ${ADMIN_ROLE_CODES.length} vai trị sự, và SQL lọc đúng bộ mã ấy.`);

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

  /**
   * ── BẬC TRỊ SỰ VẪN KHAI ĐÀN ĐƯỢC (18/08/2026) ───────────────────────────────────────────
   *
   * Đo bằng NGƯỜI THẬT mang vai thật, không bằng một đối tượng bịa: `startJob` tra vai qua
   * `findById`, nên một phép kiểm không đi qua database sẽ không chứng minh được gì về đúng
   * đoạn dây ấy — mà đoạn dây mới là chỗ hỏng được.
   *
   * Nhân chứng là LỜI TỪ CHỐI, không phải một lượt khai đàn thành công: người thử này không có
   * tài khoản game nào, nên cửa sau nó chặn lại với câu「chưa có tài khoản」. Đúng cái ta cần —
   * nó chứng minh cửa BẢO TRÌ đã mở, mà không phải dựng cả một tài khoản game giả cùng cookie.
   */
  const createdAdmin = await register({
    username: adminUsername,
    displayName: "Maintenance verifier (trị sự)",
    email: `maint-admin+${stamp}@example.com`,
    password: "verification-password",
  });
  if (!createdAdmin.ok) throw new Error(createdAdmin.error);
  const adminId = createdAdmin.user.id;
  await sql`insert into user_roles (user_id, role_code) values (${adminId}, ${ADMIN_ROLE_FOR_TEST})
            on conflict (user_id, role_code) do nothing`;

  const adminTry = await startJob(adminId);
  assert(
    !(!adminTry.ok && adminTry.error.includes("bế quan")),
    `bậc trị sự (${ADMIN_ROLE_FOR_TEST}) PHẢI qua được cửa bế quan, nhận: "${!adminTry.ok ? adminTry.error : "ok"}"`,
  );
  assert(
    !adminTry.ok && adminTry.error.includes("tài khoản"),
    `…và dừng ở cửa KẾ TIẾP (chưa có tài khoản game), nhận: "${!adminTry.ok ? adminTry.error : "ok"}"`,
  );

  // Gỡ vai rồi thử lại: cùng một con người, chỉ khác vai — nên nếu lượt này vẫn lọt thì cửa
  // không đọc vai chút nào, nó chỉ đang mở cho bất kỳ ai.
  await sql`delete from user_roles where user_id = ${adminId}`;
  const demoted = await startJob(adminId);
  assert(
    !demoted.ok && demoted.error.includes("bế quan"),
    `gỡ vai xong thì chính người ấy phải bị chặn lại, nhận: "${!demoted.ok ? demoted.error : "ok"}"`,
  );

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
  // Cả HAI người thử. `user_roles.user_id` mang `on delete cascade`, nên xoá người là vai đi
  // theo — không còn dòng vai mồ côi nào trỏ vào một user đã biến mất.
  await sql`delete from users where username in (${username}, ${adminUsername})`.catch(
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
