#!/usr/bin/env node
/**
 * Kiểm chứng LUẬT ĐẶT TÊN kho khôi lỗi (`scripts/khoiloiNaming.mjs`) — thuần, không mạng, không
 * database, chạy trong vài mili giây.
 *
 * VÌ SAO ĐÁNG CÓ, và vì sao đúng chỗ này: cái giá của một lỗi ở đây KHÔNG hiện ra dưới máy. Một
 * cái tên hớ chỉ biểu hiện khi kho đã nằm công khai trên tài khoản người ta, và lối chữa duy nhất
 * là xoá kho rồi dựng lại — tức mất luôn cả lịch sử `workers` của khôi lỗi ấy. Không phép thử nào
 * chờ tới lúc đó được, nên luật phải bị đóng đinh ở đây, lúc nó còn là hàm.
 *
 * Ca NẶNG NHẤT không phải「từ cấm bị bắt」mà là「chính hằng số của ta có tuân luật của ta không」.
 * Bộ ca ấy nằm ở nhóm 3, và nó là thứ duy nhất bắt được kiểu hỏng thật sự dễ xảy ra: ai đó sửa
 * `REPO_NAME_PREFIX` thành một cái tên nghe hay mà quên mất danh sách cấm.
 */
import { randomBytes } from "node:crypto";
import {
  ALL_REPO_NAME_PREFIXES,
  FORBIDDEN_NAME_WORDS,
  KHOILOI_ID_PREFIX,
  LEGACY_REPO_NAME_PREFIXES,
  REPO_NAME_PREFIX,
  forbiddenWordsIn,
  reviewGeneratedName,
} from "./khoiloiNaming.mjs";

let count = 0;
const assert = (condition, message) => {
  count += 1;
  if (!condition) throw new Error(message);
  console.log(`✔ ${message}`);
};

// ---- 1. Mỗi từ cấm đều bị bắt, và bắt theo CHUỖI CON --------------------------------------------

for (const word of FORBIDDEN_NAME_WORDS) {
  assert(
    reviewGeneratedName("Tên kho", `linh-su-${word}-01`) !== null,
    `từ cấm「${word}」bị bắt kể cả khi nằm giữa một cái tên trông vô hại`,
  );
}

assert(
  forbiddenWordsIn("actions/checkout").includes("action"),
  "`actions` bị bắt vì chứa `action` — so khớp theo chuỗi con, không theo ranh giới từ",
);
assert(forbiddenWordsIn("AUTO-HH3D").length === 2, "hoa thường không cứu được: `AUTO-HH3D` dính cả hai từ");
assert(
  forbiddenWordsIn("my-github-bot").includes("github"),
  "`github` nằm giữa tên vẫn bị bắt",
);

/**
 * Cái bẫy đã ghi ở đầu `khoiloiNaming.mjs`: `hoathinh3d` KHÔNG chứa `hh3d` (hoat-hin-h3d), nên rút
 * gọn danh sách còn một trong hai là mở đúng một lối lọt. Ca này giữ cho ai đó về sau không "dọn"
 * danh sách cho gọn.
 */
assert(
  !"hoathinh3d".includes("hh3d") && forbiddenWordsIn("hoathinh3d").includes("hoathinh3d"),
  "`hoathinh3d` không chứa `hh3d` nên phải có mặt riêng trong danh sách",
);

// ---- 2. Tên sạch thì đi qua ---------------------------------------------------------------------

assert(reviewGeneratedName("Tên kho", "linh-su-20260813-124522-1354") === null, "tên kho thật đi qua được");
assert(reviewGeneratedName("WORKER_ID", "khoiloi-tro-20260813-124522") === null, "WORKER_ID thật đi qua được");
assert(reviewGeneratedName("WORKER_ID", "tong-mon-khoiloi") === null, "id của khôi lỗi trên VM vẫn hợp luật");

// ---- 3. HẰNG SỐ CỦA TA CÓ TUÂN LUẬT CỦA TA KHÔNG ------------------------------------------------

assert(
  reviewGeneratedName("REPO_NAME_PREFIX", REPO_NAME_PREFIX) === null,
  `tiền tố tên kho hiện hành「${REPO_NAME_PREFIX}」tự nó hợp luật`,
);
assert(
  reviewGeneratedName("KHOILOI_ID_PREFIX", KHOILOI_ID_PREFIX) === null,
  `tiền tố WORKER_ID hiện hành「${KHOILOI_ID_PREFIX}」tự nó hợp luật`,
);

/**
 * Dựng ĐÚNG hai cái tên mà hai script sinh ra, bằng đúng công thức của chúng — chứ không kiểm mỗi
 * tiền tố. Hậu tố mới là chỗ có thể lén mang từ cấm vào: 4 ký tự hex thì không, nhưng công thức
 * có thể bị đổi, và ca này sẽ đỏ ngay lúc ấy.
 */
const stamp = "20260813-124522";
assert(
  reviewGeneratedName("Tên kho", `${REPO_NAME_PREFIX}-${stamp}-${randomBytes(2).toString("hex")}`) === null,
  "tên kho dựng theo đúng công thức của newGithubStation.mts hợp luật",
);
assert(
  reviewGeneratedName("WORKER_ID", `${KHOILOI_ID_PREFIX}-${stamp}`) === null,
  "WORKER_ID dựng theo đúng công thức của newGithubStation.mts hợp luật",
);

// ---- 4. Tiền tố CŨ phải còn trong danh sách của lượt xoá ----------------------------------------

/**
 * Ca này gác một thứ đi NGƯỢC ba nhóm trên: những kho dựng trước 13/08/2026 mang tên VI PHẠM luật
 * mới, và chúng vẫn phải bị lượt xoá nhìn thấy. Xoá tiền tố cũ khỏi `LEGACY_REPO_NAME_PREFIXES`
 * cho "sạch" là làm chúng tàng hình trước chính công cụ dọn của mình — mà kho rỗng dựng dở thì
 * không có dòng sổ nào để bắt bằng đường khác.
 */
assert(
  LEGACY_REPO_NAME_PREFIXES.includes("auto-hh3d-linh-su"),
  "tiền tố cũ `auto-hh3d-linh-su` còn nguyên trong danh sách, để lượt xoá còn thấy kho dựng trước 13/08/2026",
);
assert(
  ALL_REPO_NAME_PREFIXES[0] === REPO_NAME_PREFIX &&
    ALL_REPO_NAME_PREFIXES.length === LEGACY_REPO_NAME_PREFIXES.length + 1,
  "danh sách tiền tố của lượt xoá = tiền tố hiện hành + mọi tiền tố cũ",
);
assert(
  forbiddenWordsIn(LEGACY_REPO_NAME_PREFIXES[0]).length > 0,
  "tiền tố cũ ĐÚNG LÀ thứ luật mới cấm — đó là lý do luật chỉ áp cho tên SINH RA, không áp cho tên KHAI BÁO",
);

console.log(`\n✔ ${count} phép kiểm — luật đặt tên kho khôi lỗi còn nguyên.`);
