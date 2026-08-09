/**
 * Luật của TAG TRANG TRÍ — tách riêng khỏi `user.ts`, và lý do rất cụ thể chứ không phải
 * gu sắp xếp: hộp Sửa là component `"use client"`, nên mọi thứ nó import đều đi thẳng vào
 * bundle của trình duyệt. `user.ts` import `zod` và dựng schema ở cấp module, thứ bundler
 * không dám bỏ đi — nhập một hằng số từ đó là gánh cả zod sang phía client cho một trang
 * vốn chẳng cần. Tệp này KHÔNG import gì cả, và phải giữ nguyên như vậy.
 */

/**
 * Tag trang trí — luật ở đây chứ không nằm trong action, vì CẢ HAI phía cần nó: hộp Sửa phải
 * biết trần để làm mờ chip khi đã đủ tag, còn action phải soát lại vì form là thứ ngoài
 * Internet chạm tới được. Để hai bản thì một hôm nào đó chúng lệch nhau, và triệu chứng sẽ là
 * "bấm chip thêm được, bấm Lưu thì bị chửi".
 *
 * Tệp `"use server"` chỉ được xuất ra hàm async, nên một hàm thuần nằm trong đó cũng là một
 * hàm không phép thử nào với tới được — đây là lý do thứ hai, và nó đủ nặng để đứng một mình.
 */
export const MAX_TAGS = 3;

/**
 * 24 chứ không phải 20. Trần cũ là 20 và「thái thượng trưởng lão」dài 22 — tức cái tag mà
 * tông môn muốn dùng thì hệ thống từ chối thẳng, không ai đoán ra vì sao trước khi đếm tay.
 * 24 cho đúng cái tên dài nhất đang có thở được mà vẫn chặn người ta dán cả một câu.
 */
export const MAX_TAG_LENGTH = 24;

/**
 * Tag bày sẵn để bấm. KHÔNG phải danh sách đóng: Trưởng môn vẫn gõ tag tuỳ ý, đây chỉ là lối
 * tắt cho những cái hay dùng — và là cách để「thái thượng trưởng lão」vào đúng từng dấu thay
 * vì mỗi người gõ một kiểu rồi thành bốn tag khác nhau trông như một.
 */
export const TAG_PRESETS = ["Trưởng lão", "Thánh nữ", "Thái thượng trưởng lão", "Chưởng môn"] as const;

/**
 * Cắt MỘT ô chữ thành danh sách tag. Bỏ trùng, bỏ khoảng trắng thừa, bỏ phần rỗng — nên
 * "a, , a ,b" ra `["a","b"]` chứ không phải bốn tag.
 *
 * Tách rời khỏi `parseTags` vì hộp Sửa cần danh sách NGAY CẢ KHI nó chưa hợp lệ: đang có 4
 * tag thì `parseTags` trả lỗi, mà chip vẫn phải biết cái nào đang bật để người ta bấm bớt đi.
 */
export function splitTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0))];
}

/** Soát danh sách tag theo luật trần. Đây là thứ action gọi ở ranh giới tin cậy. */
export function parseTags(raw: string): { ok: true; tags: string[] } | { ok: false; error: string } {
  const tags = splitTags(raw);
  if (tags.length > MAX_TAGS) {
    return { ok: false, error: `Tối đa ${MAX_TAGS} tag cho một đạo hữu.` };
  }
  const tooLong = tags.find((t) => t.length > MAX_TAG_LENGTH);
  if (tooLong) {
    return { ok: false, error: `Tag「${tooLong.slice(0, 30)}…」dài quá ${MAX_TAG_LENGTH} ký tự.` };
  }
  return { ok: true, tags };
}

// ---------------------------------------------------------------------------------------
// KHUNG TAG — tấm bài vị có hoa văn (ảnh webp, chữ khắc sẵn trong ảnh) hiện cạnh tên trong
// Phòng Chat. Mỗi khung mang một NHÃN, và nhãn ấy chính là chuỗi tag: đạo hữu đeo tag nào
// thì sảnh vẽ khung có nhãn ấy. Sổ khung sống trong app_settings (services/settings.ts);
// bytes sống trong tàng khố media dưới tiền tố `tag-frames/`.
//
// Vẫn thuộc tệp không-import này vì đúng lý do cũ: ChatRoom và trang Tông Môn (đều
// `"use client"`) cần phép so khớp, còn API upload cần cùng phép ấy ở ranh giới tin cậy.
// ---------------------------------------------------------------------------------------

/** Một khung trong sổ. `key` là tên object trong tàng khố — cần cho lúc xoá. */
export type TagFrame = {
  id: string;
  /** Nhãn = chuỗi tag mà khung này đại diện. So khớp qua `normalizeTagLabel`. */
  label: string;
  url: string;
  key: string;
  /** Khung đeo cho người KHÔNG mang tag nào (bài vị「Đệ tử」). Tối đa một khung giữ cờ này. */
  isDefault: boolean;
};

/**
 * Chuẩn hoá nhãn để so khớp: bỏ khoảng trắng thừa, không phân biệt hoa thường.
 * 「chưởng  môn」và「Chưởng Môn」là một — tag do tay người gõ, khác nhau một con chữ hoa
 * mà mất khung thì không ai lần ra vì sao.
 */
export function normalizeTagLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * MỌI bài vị của một người, theo đúng thứ tự tag đã sắp.
 *
 * Bản trước tên `frameForTags` và trả về ĐÚNG MỘT khung — tag đầu tiên có khung thắng, phần
 * còn lại rớt xuống làm huy hiệu chữ. Nghe hợp lý cho tới khi gặp người mang hai danh xưng mà
 * CẢ HAI đều có bài vị riêng trong sổ: một cái hiện ra lộng lẫy, cái kia thành viên chữ trơn
 * cạnh nó. Ngày 09/08/2026 tông chủ thấy「Thánh Nữ」đeo bài vị còn「Thái thượng trưởng lão」
 * nằm bên như một mẩu chữ thừa, và chốt: có khung thì vẽ khung, đủ cả.
 *
 * DEDUP theo nhãn đã chuẩn hoá, không theo chuỗi thô: hai tag「Thánh nữ」và「Thánh Nữ」trỏ về
 * cùng một khung, và vẽ hai lần cùng một tấm ảnh thì trông như lỗi chứ không như vinh danh.
 *
 * Không tag nào có khung (kể cả danh sách rỗng) thì rơi về khung mặc định — họ vẫn là đệ tử
 * của tông môn. Sổ không có khung mặc định thì trả mảng RỖNG, và sảnh vẽ y như trước.
 */
export function framesForTags(tags: readonly string[], frames: readonly TagFrame[]): TagFrame[] {
  const picked: TagFrame[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const hit = frameByLabel(tag, frames);
    if (!hit) continue;
    const key = normalizeTagLabel(hit.label);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(hit);
  }
  if (picked.length > 0) return picked;

  const fallback = frames.find((frame) => frame.isDefault);
  return fallback ? [fallback] : [];
}

/** Khung mang nhãn này, hoặc `null`. */
export function frameByLabel(label: string, frames: readonly TagFrame[]): TagFrame | null {
  const wanted = normalizeTagLabel(label);
  if (!wanted) return null;
  return frames.find((frame) => normalizeTagLabel(frame.label) === wanted) ?? null;
}
