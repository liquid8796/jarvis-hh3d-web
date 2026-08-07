#!/usr/bin/env node
/**
 * Kiểm chứng chế độ BẾ QUAN TRÙNG TU, đầu này sang đầu kia ở tầng service:
 *
 *   1. Schema: document rỗng lẫn document cũ (chưa có nhánh maintenance) đều ra TẮT.
 *   2. Bật bảo trì → feed của Linh Đài mang đúng trạng thái (đường đi của popup).
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
import { appSettingsSchema, getAppSettings, saveAppSettings } from "../src/lib/services/settings";
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

// ---- 1. Schema thuần — không chạm database -----------------------------------------------

const empty = appSettingsSchema.parse({});
assert(empty.maintenance.active === false, "document RỖNG phải mặc định TẮT bảo trì");
assert(empty.maintenance.startedAt === null && empty.maintenance.expectedEndAt === null,
  "document rỗng không được bịa ra mốc thời gian");

const legacy = appSettingsSchema.parse({ chat: { retentionDays: 14 }, membership: { requireApproval: false } });
assert(legacy.maintenance.active === false, "document cũ (chưa có nhánh maintenance) phải TẮT");
assert(legacy.membership.requireApproval === false, "thêm nhánh mới không được nuốt cấu hình đã có");

console.log("✔ Schema: cổng bảo trì mặc định TẮT trên mọi document cũ — deploy không tự đóng cửa tông môn.");

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
  assert(feedOn.active === true, "feed Linh Đài phải mang cờ bảo trì khi đã bật");
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
