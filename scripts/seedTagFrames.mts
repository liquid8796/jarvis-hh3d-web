#!/usr/bin/env node
/**
 * Gieo bộ KHUNG TAG gốc: đọc các tệp webp trong một thư mục, đẩy lên tàng khố media
 * (`tag-frames/`) rồi đăng ký vào sổ khung trong app_settings.
 *
 *   npm run seed:tag-frames -- "C:/duong/dan/toi/folder-khung"
 *
 * Vì sao là script chứ không phải tệp trong `public/`: mỗi bài vị nặng ~2.8MB, năm tấm là
 * ~13MB — nhét vào repo là mọi lần deploy tải thêm ngần ấy cho những bytes không bao giờ
 * đổi. Kho media đã có sẵn, URL công khai sống mãi, và khung upload sau này cũng đi đường
 * ấy — một đường ống cho tất cả.
 *
 * CHẠY LẠI VÔ HẠI: nhãn đã có trong sổ thì bỏ qua (không đẩy lại bytes, không ghi đè sổ).
 * Muốn thay một khung gốc thì gỡ nó trong trang Tông Môn rồi chạy lại script.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

/**
 * Nhãn cho từng tệp gốc — bảng tra Ở ĐÂY vì tên tệp là ASCII không dấu, không suy ngược ra
 * nhãn tiếng Việt được (thieu dấu là thành tag khác, mất khớp với chip trong trang Tông Môn).
 * Tệp lạ trong thư mục thì script NÓI RÕ và bỏ qua — upload nó qua trang Tông Môn, nơi có ô
 * nhãn để gõ cho đúng.
 */
const KNOWN_FRAMES: Record<string, { label: string; isDefault: boolean }> = {
  "chuong_mon_mystic_smooth.webp": { label: "Chưởng môn", isDefault: false },
  "truong_lao_mystic_smooth.webp": { label: "Trưởng lão", isDefault: false },
  "thai_thuong_truong_lao_mystic_smooth.webp": { label: "Thái thượng trưởng lão", isDefault: false },
  "thanh_nu_mystic_smooth.webp": { label: "Thánh nữ", isDefault: false },
  // Bài vị của người KHÔNG mang tag nào — mọi môn đồ thường trong sảnh đeo khung này.
  "de_tu_mystic_smooth.webp": { label: "Đệ tử", isDefault: true },
};

const folder = process.argv[2];
if (!folder) {
  console.error('Cách dùng: npm run seed:tag-frames -- "<thư mục chứa các tệp khung>"');
  process.exit(1);
}

const media = await import("../src/lib/services/media.ts");
const { getAppSettings, saveAppSettings } = await import("../src/lib/services/settings.ts");
const { frameByLabel } = await import("../src/lib/validation/tags.ts");

if (!media.mediaStoreReady()) {
  console.error("Tàng khố media chưa khai mở — cần đủ bộ biến OCI_* (npm run env:pull).");
  process.exit(1);
}

try {
  const settings = await getAppSettings();
  const files = readdirSync(folder).filter((name) => /\.(webp|png|gif|jpe?g)$/i.test(name));
  if (files.length === 0) {
    console.error(`Không thấy tệp ảnh nào trong ${folder}.`);
    process.exit(1);
  }

  let added = 0;
  for (const name of files) {
    const known = KNOWN_FRAMES[name];
    if (!known) {
      console.log(`• BỎ QUA ${name} — không có trong bảng nhãn. Upload nó qua trang Tông Môn để đặt nhãn cho đúng.`);
      continue;
    }
    if (frameByLabel(known.label, settings.chat.tagFrames)) {
      console.log(`• Đã có「${known.label}」trong sổ — bỏ qua (chạy lại vô hại là vậy).`);
      continue;
    }

    const body = new Uint8Array(readFileSync(join(folder, name)));
    const kind = media.sniffImageKind(body);
    if (!kind) {
      console.log(`• BỎ QUA ${name} — bytes không phải PNG/JPEG/WebP/GIF.`);
      continue;
    }

    const stored = await media.putTagFrameFile({ label: known.label, kind, body });

    // Cờ mặc định là đơn nhất — tệp gốc chỉ có một, nhưng sổ có thể đã mang một mặc định
    // do admin đặt tay, và script gieo không có quyền giật cờ của họ.
    const isDefault = known.isDefault && !settings.chat.tagFrames.some((frame) => frame.isDefault);
    settings.chat.tagFrames = [
      ...settings.chat.tagFrames,
      { id: crypto.randomUUID(), label: known.label, url: stored.url, key: stored.key, isDefault },
    ];
    added++;
    console.log(`✔「${known.label}」→ ${stored.key} (${(body.byteLength / 1024 / 1024).toFixed(1)}MB${isDefault ? ", mặc định" : ""})`);
  }

  if (added > 0) {
    await saveAppSettings(settings);
  }
  console.log("");
  console.log(`Xong: thêm ${added} khung, sổ hiện có ${settings.chat.tagFrames.length}.`);
} finally {
  media.closeMediaStore();
}
