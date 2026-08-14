#!/usr/bin/env node
/**
 * ĐỒNG BỘ THÔNG TIN DATABASE CỦA TRẠM ĐANG PHỤC VỤ vào `.env.local` dưới máy.
 *
 *   npm run env:sync                (hoặc bấm đúp sync-db-env.bat)
 *   npm run env:sync -- --dry-run   soi xem sẽ đổi khoá nào, KHÔNG ghi gì
 *
 * ── VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────────
 *
 * `.env.local` trỏ CỨNG vào một trạm, còn trạm đang phục vụ thì đổi theo mỗi lượt chuyển trạm.
 * Hai thứ ấy lệch nhau là hỏng theo kiểu tệ nhất: công cụ vẫn nối được, vẫn đọc ra dữ liệu thật,
 * chỉ là dữ liệu của một trạm KHÔNG AI DÙNG NỮA. Không có lỗi nào để đọc.
 *
 * Đo 14/08/2026: `.env.local` trỏ vào một trạm đã nghỉ mà database của nó đã bị dọn sạch —
 * `app_settings` còn 0 dòng — nên `npm run deploy:all` báo「Sổ gương chưa có trạm nào」và dừng.
 * Chữa bằng tay là mở dashboard Vercel của đúng tài khoản giữ trạm ấy rồi chép từng biến; lượt
 * này viết thành mã.
 *
 * ── VÒNG LUẨN QUẨN, VÀ CHỖ CẮT NÓ ─────────────────────────────────────────────────────────────
 *
 * Sổ gương (nơi biết chuỗi kết nối của mọi trạm) nằm TRONG database. Chuỗi kết nối dưới máy hỏng
 * thì không đọc được sổ, mà không đọc được sổ thì không biết chuỗi kết nối đúng — con rắn cắn
 * đuôi. Cắt bằng hai thứ KHÔNG nằm trong database nào:
 *
 *   1. Bảng điều phối trên OCI (`readControlDoc`) — nói trạm nào đang phục vụ.
 *   2. `VERCEL_TOKEN_<TÊN TRẠM>` trong `.env.local` — mở được project Vercel của trạm ấy.
 *      Chìa Vercel KHÔNG xoay theo lượt chuyển trạm, nên nó còn đứng khi mọi nấc khác đã đổ.
 *
 * Đây đúng là nấc thang thứ hai mà `activeStationPg.mts` đã dựng cho `DATABASE_URL`; ở đây dùng
 * lại nguyên nó (`pullStationEnv`) chứ không chép bản thứ hai.
 *
 * ── CHỈ LẤY PHẦN DATABASE ─────────────────────────────────────────────────────────────────────
 *
 * KHÔNG chép cả môi trường production về. `.env.local` dưới máy còn giữ những thứ CỐ Ý khác
 * production — chìa Vercel của mọi tài khoản, biến để chạy dev, khoá thử nghiệm — và đè trọn lên
 * chúng là phá cấu hình của cả máy để chữa đúng một chuyện. Lấy đúng họ khoá database, và in ra
 * những khoá trông giống database mà KHÔNG lấy, để không có gì lặng lẽ nằm ngoài.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readControlDoc } from "../src/lib/control/read";
import { pullStationEnv } from "./activeStationPg.mts";
import { mergeEnvFile, parseEnvFile } from "./envFile.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const dryRun = process.argv.includes("--dry-run");
const repoRoot = path.join(import.meta.dirname, "..");
const ENV_FILE = path.join(repoRoot, ".env.local");
const BACKUP_FILE = `${ENV_FILE}.bak`;

/** Chú kiểu trên BIẾN để TypeScript thu hẹp kiểu ở mọi chỗ gọi — xem bình chú cùng tên ở `usage:cookie`. */
const die: (message: string) => never = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/**
 * Khoá được coi là「thông tin database」.
 *
 * Tên ĐÍCH DANH là những khoá chính mã trong `src/` đọc thật. Họ TIỀN TỐ là những khoá do tích
 * hợp Neon/Vercel rót vào — chúng không phải thứ app này đọc, nhưng công cụ khác thì có (drizzle,
 * `psql`, thư viện Neon), và để một `POSTGRES_URL` cũ nằm lại cạnh một `DATABASE_URL` mới là
 * dựng đúng cái bẫy「hai công cụ, hai database」mà cả tệp này sinh ra để dẹp.
 */
const DB_KEYS_EXACT = new Set([
  "DATABASE_URL",
  "REALTIME_DATABASE_URL",
  "MONGODB_URI",
  "MONGODB_URL",
  "MONGODB_DB",
]);
const DB_KEY_PREFIXES = ["POSTGRES_", "PG", "NEON_", "DATABASE_URL_", "MONGODB_"];

/**
 * Khoá TRÔNG giống database nhưng KHÔNG được đồng bộ.
 *
 * `CHAT_TEST_MONGODB_URI` là nút vặn của phép kiểm dưới máy, không phải cấu hình của trạm — kéo
 * giá trị production về đây là trỏ phép kiểm vào database thật, và phép kiểm thì có quyền ghi.
 */
const NEVER_SYNC = new Set(["CHAT_TEST_MONGODB_URI"]);

/** Dùng cho phần「trông giống database mà không lấy」— chỉ để BÁO, không để lọc. */
const LOOKS_LIKE_DB = /(DATABASE|POSTGRES|MONGO|NEON|REDIS|^PG)/;

function isDbKey(key: string): boolean {
  if (NEVER_SYNC.has(key)) return false;
  return DB_KEYS_EXACT.has(key) || DB_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// ---- 1. Trạm nào đang phục vụ ------------------------------------------------------------------

const doc = await readControlDoc();
const activeSiteId = doc?.activeSiteId ?? "";
if (activeSiteId.length === 0) {
  /**
   * KHÔNG fail-open về `DATABASE_URL` dưới máy, khác `purgeRosterCli`. Ở đó fail-open còn có
   * nghĩa (dọn nhầm một dòng ma ở trạm đã nghỉ thì chẳng ai mất gì); còn ở đây thì việc cần làm
   * CHÍNH LÀ「biết trạm nào đang phục vụ」— không biết mà vẫn ghi là ghi bừa vào tệp chìa khoá.
   */
  die(
    "Không đọc được bảng điều phối nên không biết trạm nào đang phục vụ.\n" +
      "  Thiếu OCI_REGION / OCI_NAMESPACE / OCI_BUCKET trong .env.local? Đặt đủ ba biến ấy rồi chạy lại.",
  );
}

console.log(`\n── Đồng bộ thông tin database ────────────────────────`);
console.log(`  trạm đang phục vụ : ${activeSiteId}`);
console.log(`  bảng điều phối    : revision ${doc?.revision ?? "?"}, lật lúc ${doc?.switchedAt ?? "?"}`);
console.log(`  tệp sẽ vá         : ${path.relative(repoRoot, ENV_FILE)}`);

// ---- 2. Kéo môi trường production của trạm ấy --------------------------------------------------

console.log(`\n  (hỏi Vercel môi trường production của「${activeSiteId}」…)`);
let stationEnv: Map<string, string>;
try {
  stationEnv = pullStationEnv(activeSiteId);
} catch (err) {
  die(err instanceof Error ? err.message : "Không kéo được môi trường của trạm đang phục vụ.");
}

const updates = new Map([...stationEnv].filter(([key]) => isDbKey(key)));
if (updates.size === 0) {
  die(
    `Trạm「${activeSiteId}」không có khoá database nào trong môi trường production —\n` +
      "  gần như chắc chắn là kéo nhầm project. Soi lại trên dashboard Vercel trước khi ghi gì.",
  );
}

// Một trạm KHÔNG có DATABASE_URL thì mọi thứ dưới máy sẽ hỏng ngay sau lượt ghi này. Chặn ở đây,
// đừng để người ta phát hiện lúc `next dev` không dựng nổi trang.
if (!updates.has("DATABASE_URL")) {
  die(`Trạm「${activeSiteId}」thiếu DATABASE_URL trong môi trường production — không ghi gì cả.`);
}

// ---- 3. Trộn vào .env.local --------------------------------------------------------------------

const original = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (original.length === 0) {
  console.log("\n  ⚠ Chưa có .env.local (hoặc tệp rỗng) — sẽ tạo mới, chỉ gồm phần database.");
}

let merged;
try {
  merged = mergeEnvFile(original, updates);
} catch (err) {
  // `formatEnvValue` ném khi một giá trị không biểu diễn nổi trong định dạng .env của kho này.
  die(`Không viết ra được: ${err instanceof Error ? err.message : "lỗi lạ"}`);
}

/** GIÁ TRỊ KHÔNG BAO GIỜ ĐƯỢC IN — đây là chuỗi kết nối. Chỉ in TÊN khoá và trạng thái. */
console.log("\n── Khoá database của trạm ────────────────────────────");
for (const key of [...updates.keys()].sort()) {
  const state = merged.added.includes(key)
    ? "THÊM MỚI"
    : merged.replaced.includes(key)
      ? "đổi"
      : "vốn đã đúng";
  console.log(`  ${key.padEnd(28)} ${state}`);
}

const skipped = [...stationEnv.keys()].filter((key) => !isDbKey(key) && LOOKS_LIKE_DB.test(key));
if (skipped.length > 0) {
  console.log("\n  Trông giống database mà KHÔNG đồng bộ (cố ý — xem NEVER_SYNC/luật chọn khoá):");
  for (const key of skipped.sort()) console.log(`    ${key}`);
}

/**
 * Khoá database CÓ dưới máy mà trạm đang phục vụ KHÔNG khai.
 *
 * Đây là dạng cũ nguy hiểm nhất còn sót lại sau lượt vá: không có gì để đè lên nó, nên nó nằm
 * nguyên — và giá trị nằm nguyên ấy là chuỗi kết nối của TRẠM ĐÃ NGHỈ. Công cụ nào đọc đúng khoá
 * đó sẽ nối vào trạm cũ trong khi mọi khoá bên cạnh đã trỏ trạm mới. Không tự xoá (xoá một dòng
 * trong tệp chìa khoá phải là quyết định của người), nhưng phải KÊU LÊN.
 */
const stale = [...parseEnvFile(original).keys()].filter((key) => isDbKey(key) && !updates.has(key));
if (stale.length > 0) {
  console.log(
    `\n  ⚠ Có dưới máy mà trạm「${activeSiteId}」KHÔNG khai: ${stale.sort().join(", ")}\n` +
      "    Nhiều khả năng là giá trị cũ của một trạm đã nghỉ — không tự xoá, đạo hữu soi rồi gỡ tay.",
  );
}

if (merged.duplicated.length > 0) {
  console.log(
    `\n  ⚠ Khoá xuất hiện NHIỀU LẦN trong .env.local: ${merged.duplicated.join(", ")}\n` +
      "    Mọi bản đều đã được vá nên không lệch, nhưng nên dọn tay — `loadEnv` lấy dòng ĐẦU\n" +
      "    còn Next lấy dòng CUỐI, và ngày hai dòng ấy khác nhau thì rất khó nhìn ra.",
  );
}

if (merged.text === original) {
  console.log("\n✔ Không có gì phải đổi — .env.local đã trỏ đúng trạm đang phục vụ.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, KHÔNG ghi gì.");
  process.exit(0);
}

// ---- 4. Ghi: sao lưu trước, rồi thay bằng một cú đổi tên ---------------------------------------
//
// Đổi tên chứ không ghi đè tại chỗ: cây làm việc này thường có vài phiên cùng chạy, và một tiến
// trình khác đang đọc `.env.local` giữa lúc ta ghi dở sẽ đọc được một tệp CỤT — mất đúng những
// dòng chưa kịp ghi. `rename` trên cùng ổ đĩa là một thao tác nguyên tử: tệp cũ hoặc tệp mới,
// không có ở giữa. (`.env*` đã nằm trong .gitignore nên cả .bak lẫn .tmp đều không lọt vào git.)
if (original.length > 0) {
  copyFileSync(ENV_FILE, BACKUP_FILE);
  console.log(`\n  đã sao lưu bản cũ → ${path.relative(repoRoot, BACKUP_FILE)}`);
}

const temporary = `${ENV_FILE}.tmp-${process.pid}`;
writeFileSync(temporary, merged.text, "utf8");
renameSync(temporary, ENV_FILE);

// Đọc lại rồi mới tin: ghi xong mà không soi lại thì không có gì chứng minh giá trị đã tới nơi —
// cùng lối với bước「đọc lại secret」của `updateUsageCookie.mts`.
const readBack = parseEnvFile(readFileSync(ENV_FILE, "utf8"));
const wrong = [...updates.entries()].filter(([key, value]) => readBack.get(key) !== value).map(([key]) => key);
if (wrong.length > 0) {
  die(
    `Ghi xong nhưng đọc lại thấy sai ở: ${wrong.join(", ")}.\n` +
      `  Bản cũ còn nguyên ở ${path.relative(repoRoot, BACKUP_FILE)} — chép lại đè lên .env.local.`,
  );
}

console.log(`\n✔ Đã vá ${merged.replaced.length + merged.added.length} khoá; đọc lại khớp cả ${updates.size} khoá.`);
console.log(`  .env.local nay trỏ vào trạm「${activeSiteId}」.`);
console.log("  Phiên/tiến trình nào đang chạy (next dev, script dài) phải khởi động lại mới thấy giá trị mới.");
