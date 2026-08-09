#!/usr/bin/env node
/**
 * Kiểm chứng SỔ KHUNG TAG — phép so khớp thuần (validation/tags.ts) và cách đặt tên object
 * (services/media.ts). Không database, không mạng: phần chạm kho thật đã có verify:media lo
 * đường ống chung, còn seed script tự nói kết quả của nó.
 *
 * Vì sao đáng có: phép so khớp là thứ quyết định AI đeo bài vị NÀO trước mắt cả sảnh. Nó sai
 * thì không văng lỗi — chỉ có một Thánh nữ mang nhầm bài vị Chưởng môn, và người ta sẽ đi tìm
 * lỗi ở chỗ upload thay vì ở một dòng so chuỗi.
 */
import {
  frameByLabel,
  frameForTags,
  normalizeTagLabel,
  type TagFrame,
} from "../src/lib/validation/tags";
import { sniffImageKind, tagFrameObjectKey } from "../src/lib/services/media";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const frame = (label: string, isDefault = false): TagFrame => ({
  id: `id-${label}`,
  label,
  url: `https://kho.example/o/${encodeURIComponent(label)}.webp`,
  key: `tag-frames/${label}.webp`,
  isDefault,
});

const SO_KHUNG = [
  frame("Chưởng môn"),
  frame("Trưởng lão"),
  frame("Thái thượng trưởng lão"),
  frame("Thánh nữ"),
  frame("Đệ tử", true),
];

// ---- Chuẩn hoá nhãn -----------------------------------------------------------------
assert(normalizeTagLabel("  Chưởng   Môn ") === "chưởng môn", "khoảng trắng thừa và chữ hoa phải được san phẳng");
assert(normalizeTagLabel("") === "" && normalizeTagLabel("   ") === "", "chuỗi trắng chuẩn hoá về rỗng");
console.log("✔ Chuẩn hoá nhãn: hoa/thường và khoảng trắng không còn là lý do mất khung.");

// ---- Tra khung theo nhãn ------------------------------------------------------------
assert(frameByLabel("chưởng môn", SO_KHUNG)?.label === "Chưởng môn", "nhãn thường phải khớp khung hoa");
assert(frameByLabel("Chưởng  Môn", SO_KHUNG)?.label === "Chưởng môn", "hai dấu cách giữa chữ vẫn phải khớp");
assert(frameByLabel("chuong mon", SO_KHUNG) === null, "THIẾU DẤU là một tag KHÁC — không được đoán ý");
assert(frameByLabel("", SO_KHUNG) === null, "nhãn rỗng không khớp gì cả — kể cả khung mặc định");
console.log("✔ Tra nhãn: khớp không phân biệt hoa thường, nhưng dấu tiếng Việt là luật cứng.");

// ---- Chọn bài vị cho một người -------------------------------------------------------
assert(
  frameForTags(["Thánh nữ"], SO_KHUNG)?.label === "Thánh nữ",
  "một tag một khung: đeo đúng bài vị của mình",
);
assert(
  frameForTags(["Luyện đan", "Thánh nữ"], SO_KHUNG)?.label === "Thánh nữ",
  "tag không có khung phải bị lướt qua để tới tag có khung",
);
assert(
  frameForTags(["Trưởng lão", "Thánh nữ"], SO_KHUNG)?.label === "Trưởng lão",
  "hai tag đều có khung: tag ĐỨNG TRƯỚC thắng — thứ tự tag là thứ admin sắp, không phải chỗ ta chọn hộ",
);
assert(
  frameForTags([], SO_KHUNG)?.label === "Đệ tử",
  "không tag nào: đeo bài vị mặc định (Đệ tử)",
);
assert(
  frameForTags(["Luyện đan"], SO_KHUNG)?.label === "Đệ tử",
  "toàn tag không khung cũng rơi về mặc định — họ vẫn là đệ tử của tông môn",
);
assert(frameForTags([], []) === null, "sổ trống: không bài vị nào, sảnh vẽ như xưa");
assert(
  frameForTags(["Luyện đan"], [frame("Chưởng môn")]) === null,
  "sổ không có mặc định và tag không khớp: null, KHÔNG được vơ bừa khung đầu sổ",
);
console.log("✔ Chọn bài vị: tag trước thắng, không khung thì về mặc định, sổ trống thì thôi.");

// ---- Tên object trong kho ------------------------------------------------------------
const kind = sniffImageKind(
  new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
);
assert(kind?.contentType === "image/webp", "bytes RIFF….WEBP phải được soi ra webp");

const key = tagFrameObjectKey("Chưởng môn", kind!);
assert(key.startsWith("tag-frames/"), `khung phải nằm dưới tag-frames/, đang là ${key}`);
assert(key.endsWith(".webp"), `đuôi phải suy từ bytes đã soi, đang là ${key}`);
assert(key.split("/").length === 2, `key phải đúng 2 tầng — một dấu / lọt từ nhãn là thêm thư mục lạ: ${key}`);
assert(
  tagFrameObjectKey("Chưởng môn", kind!) !== tagFrameObjectKey("Chưởng môn", kind!),
  "hai lần cùng nhãn KHÔNG được ra cùng key — immutable trong cache chỉ đúng khi key không tái sinh",
);
assert(tagFrameObjectKey("///", kind!).includes("/khung-"), "nhãn toàn ký tự lạ phải rơi về 'khung'");
console.log("✔ Tên object: dưới tag-frames/, đuôi theo bytes, không đụng nhau, nhãn lạ có đường lui.");

// QUAN TRỌNG NHẤT của khối này: tiền tố khung KHÔNG được là con của tiền tố chat — nút thanh
// tẩy sảnh quét `chat/` theo tiền tố, và một bộ khung nằm lọt trong đó sẽ chết theo lần bấm.
const { CHAT_PREFIX, TAG_FRAME_PREFIX } = await import("../src/lib/services/media.ts");
assert(
  !`${TAG_FRAME_PREFIX}/`.startsWith(`${CHAT_PREFIX}/`),
  "tag-frames/ phải đứng NGOÀI chat/ — nếu không, thanh tẩy sảnh sẽ xoá sạch bộ khung",
);
console.log("✔ Tiền tố: khung đứng ngoài vùng quét của nút thanh tẩy sảnh.");

console.log("");
console.log("TẤT CẢ XANH — sổ khung: so khớp, bài vị mặc định và tên object đều đóng đinh.");
