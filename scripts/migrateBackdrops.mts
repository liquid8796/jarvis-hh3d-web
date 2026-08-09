#!/usr/bin/env node
/**
 * Đưa những tấm nền đang nằm trong `public/` lên tàng khố OCI, rồi gán chúng đúng chỗ cũ.
 *
 *   npm run media:backdrops
 *
 * VÌ SAO CẦN: từ bản này, nền của từng trang tới từ app_settings chứ không còn gõ cứng trong
 * globals.css. Không chạy script thì trang Hàng Đợi rơi xuống nền mặc định ngay sau khi deploy
 * — không hỏng gì, nhưng là một thay đổi giao diện mà không ai bấm.
 *
 * IDEMPOTENT theo đúng nghĩa: tấm đã có trong kho (tra bằng `statObject` trên key đã lưu trong
 * app_settings) thì KHÔNG tải lên lần nữa, và phép gán chỉ ghi khi ô ấy đang trống. Chạy lại
 * mấy lần cũng chỉ tốn vài lượt đi mạng.
 *
 * Thứ tự bắt buộc: chạy SAU khi bản code mới đã lên. Nhánh `appearance` là thứ bản deploy cũ
 * không biết, mà `saveAppSettings` thì parse qua Zod — nên một lượt lưu cấu hình của bản cũ sẽ
 * NUỐT MẤT nhánh này. Ghi trước khi deploy là ghi vào một cái xô thủng.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { BACKDROP_PREFIX, mediaStoreReady, publicUrlOf, putBackdropFile, sniffImageKind, statObject } from "../src/lib/services/media";
import { getAppSettings, saveAppSettings } from "../src/lib/services/settings";
import { DEFAULT_SLOT, isBackdropPageKey } from "../src/lib/validation/backdrops";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

/**
 * Tấm nào lên kho, và gán vào ô nào.
 *
 * `backdrop.png` KHÔNG có mặt: nó là tấm CỨU HỘ, cố ý ở lại trong repo và cố ý không gán vào
 * ô mặc định — ô mặc định để trống nghĩa là "dùng tấm gốc", và như vậy tông môn có một tấm
 * nền ngay cả khi tàng khố tắt. Đưa nó lên kho rồi gán vào chính ô ấy chỉ tạo ra một bản sao
 * thứ hai của cùng một bức tranh, mà không mua thêm được gì.
 */
const MIGRATIONS = [
  { file: "public/backdrop-hang-doi.png", name: "Tu Linh Tien Tu", slot: "hang-doi" },
] as const;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt — chạy `npm run env:pull` trước.");
if (!mediaStoreReady()) {
  throw new Error(
    "Tàng khố media chưa mở: thiếu biến môi trường của OCI Object Storage. Xem deploy/oracle/README.md.",
  );
}

const settings = await getAppSettings();
let changed = false;

for (const entry of MIGRATIONS) {
  if (entry.slot !== DEFAULT_SLOT && !isBackdropPageKey(entry.slot)) {
    throw new Error(`Ô「${entry.slot}」không có trong sổ trang — sửa MIGRATIONS hoặc sổ.`);
  }

  const current =
    entry.slot === DEFAULT_SLOT ? settings.appearance.defaultBackdrop : settings.appearance.pageBackdrops[entry.slot];

  // Đã gán rồi VÀ bytes còn nằm trong kho: không đụng gì. Đây là nhánh của mọi lần chạy lại.
  if (current) {
    const found = current.key.startsWith(`${BACKDROP_PREFIX}/`) ? await statObject(current.key) : null;
    if (found) {
      console.log(`• ${entry.slot}: đã có「${current.key}」(${found.size} B) — bỏ qua.`);
      continue;
    }
    console.log(`• ${entry.slot}: phép gán trỏ vào「${current.key}」mà kho không có — tải lại tấm gốc.`);
  }

  const body = new Uint8Array(readFileSync(entry.file));
  const kind = sniffImageKind(body);
  if (!kind) {
    throw new Error(`${entry.file} không phải PNG/JPEG/WebP/GIF — không đưa lên kho được.`);
  }

  const stored = await putBackdropFile({ name: entry.name, kind, body });
  console.log(`  ↑ ${basename(entry.file)} → ${stored.key} (${body.byteLength} B)`);

  const image = { key: stored.key, url: publicUrlOf(stored.key) };
  if (entry.slot === DEFAULT_SLOT) {
    settings.appearance.defaultBackdrop = image;
  } else {
    settings.appearance.pageBackdrops[entry.slot] = image;
  }
  changed = true;
}

if (changed) {
  await saveAppSettings(settings);
  console.log("✔ Đã lưu phép gán vào app_settings.");
} else {
  console.log("✔ Không có gì để đổi — mọi tấm đã ở đúng chỗ.");
}
