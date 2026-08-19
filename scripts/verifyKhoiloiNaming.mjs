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
  GENERATED_NAME_SHAPE,
  LEGACY_REPO_NAME_PREFIXES,
  NAME_HEADS,
  NAME_TAILS,
  PACKAGE_NAME,
  forbiddenWordsIn,
  randomSoftwareName,
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

assert(reviewGeneratedName("Tên kho", "cobalt-relay-4f2a") === null, "tên kho thật đi qua được");
assert(
  reviewGeneratedName("Tên kho", "linh-su-20260813-124522-1354") !== null,
  "tên kho ĐỜI CŨ nay bị luật mới từ chối — đúng ý lượt 17/08/2026",
);
/**
 * Từ 17/08/2026 luật CŨNG từ chối `tong-mon-khoiloi` — id của khôi lỗi trên VM. Ghi ra đây chứ
 * không nới luật, vì nó vô hại theo đúng nghĩa hẹp: id ấy được đặt trong `/opt/jarvis/shared/.env`
 * của VM, không đi qua `newGithubStation.mts` hay `newGithubKhoiloi.mjs` — hai chỗ DUY NHẤT gọi
 * `reviewGeneratedName`. Và lý do của lệnh cấm cũng không áp cho nó: nó không nằm trong một kho
 * công khai nào, nên chẳng có ô tìm kiếm nào đọc được.
 *
 * Ca này giữ cho ai đó về sau đừng "sửa cho xanh" bằng cách gọi luật ở một chỗ thứ ba.
 */
assert(
  reviewGeneratedName("WORKER_ID", "tong-mon-khoiloi") !== null,
  "luật mới từ chối cả `tong-mon-khoiloi` — id ấy đặt ở .env của VM, không đi qua đường sinh tên này",
);

// ---- 3. HẰNG SỐ CỦA TA CÓ TUÂN LUẬT CỦA TA KHÔNG ------------------------------------------------

/**
 * Ca nặng nhất của cả tệp, và nay nặng hơn trước: tên không còn dựng từ MỘT tiền tố mà rút từ HAI
 * RỔ TỪ. Một từ hớ lọt vào rổ thì chỉ hiện ra ở đúng lượt dựng nào rút trúng nó — tức có thể im
 * hàng tháng. Nên soi TỪNG TỪ, cả hai rổ.
 */
for (const word of [...NAME_HEADS, ...NAME_TAILS]) {
  assert(
    reviewGeneratedName("Từ trong rổ", word) === null,
    `từ「${word}」trong rổ tên tự nó hợp luật`,
  );
}
/**
 * SÀN của hai rổ, và vì sao nó là 150 chứ không phải 10.
 *
 * Bản đầu (20 × 18) đặt sàn ở 10 — một con số chỉ chống được cảnh「ai đó xoá gần hết rổ」. Nó
 * KHÔNG chống được cái hỏng thật, thứ đo được trên sổ ngày 19/08/2026: chín kho mà ba cặp tên
 * giống mặt nhau (`vellum-loom` hai lần, `amber-*` hai lần, `*-pier` hai lần). Tên ngẫu nhiên
 * sinh ra để mỗi kho đứng một mình; giống mặt nhau là hỏng đúng mục đích ấy, dù không một cái
 * tên nào trùng khít.
 *
 * 150 mỗi rổ giữ số cặp trên hai vạn — đủ để chín kho gần như chắc chắn không đụng nhau. Sàn đứng
 * đây thay vì trong lời dặn để lượt sau ai đó rút bớt từ thì lưới đỏ ngay dưới máy.
 */
const PAIR_FLOOR = 20_000;
assert(
  NAME_HEADS.length >= 150 && NAME_TAILS.length >= 150,
  `hai rổ đủ rộng (${NAME_HEADS.length} đầu × ${NAME_TAILS.length} đuôi)`,
);
assert(
  NAME_HEADS.length * NAME_TAILS.length >= PAIR_FLOOR,
  `số cặp từ ${(NAME_HEADS.length * NAME_TAILS.length).toLocaleString("vi-VN")} vượt sàn ${PAIR_FLOOR.toLocaleString("vi-VN")}`,
);

/**
 * Ba luật hình dạng của một TỪ trong rổ, mỗi luật chống một kiểu hỏng riêng:
 *
 *   • chỉ `a-z` — một dấu gạch hay chữ hoa lọt vào là `GENERATED_NAME_SHAPE` thôi khớp chính cái
 *     tên ta vừa sinh ra, tức lượt XOÁ mất bộ lọc khoanh vùng;
 *   • dài 3–10 — tên kho là thứ người ta đọc bằng mắt, và `alabaster-lighthouse-4f2a` đã là dài;
 *   • KHÔNG TRÙNG trong một rổ — một từ chép hai lần là một từ được rút với xác suất gấp đôi, thứ
 *     không ai thấy khi đọc mảng.
 */
for (const [name, list] of [["đầu", NAME_HEADS], ["đuôi", NAME_TAILS]]) {
  const bad = list.filter((word) => !/^[a-z]{3,10}$/.test(word));
  assert(bad.length === 0, `mọi từ rổ ${name} chỉ gồm a-z và dài 3–10 (lệch: ${bad.join(", ") || "không"})`);
  assert(new Set(list).size === list.length, `rổ ${name} không có từ nào chép hai lần`);
}

/**
 * HAI RỔ KHÔNG ĐƯỢC GIAO NHAU: một từ nằm ở cả hai chỗ đẻ ra được `prism-prism-4f2a`, và một cái
 * tên như thế đọc lên là biết ngay có máy sinh ra nó — đúng thứ tên ngẫu nhiên phải giấu.
 */
const overlap = NAME_HEADS.filter((word) => NAME_TAILS.includes(word));
assert(overlap.length === 0, `hai rổ rời nhau, không từ nào đứng cả hai chỗ (chung: ${overlap.join(", ") || "không"})`);
assert(
  reviewGeneratedName("PACKAGE_NAME", PACKAGE_NAME) === null,
  `tên gói trong package.json「${PACKAGE_NAME}」tự nó hợp luật`,
);

/**
 * Dựng tên bằng ĐÚNG hàm mà hai script gọi, nhiều lượt, chứ không kiểm mỗi hằng số. Bốn trăm lượt
 * là đủ để mọi cặp từ đều có cơ hội xuất hiện vài lần.
 */
for (let i = 0; i < 400; i++) {
  const name = randomSoftwareName();
  if (reviewGeneratedName("Tên tự sinh", name) !== null) {
    throw new Error(`tên tự sinh「${name}」mang từ cấm`);
  }
  if (!GENERATED_NAME_SHAPE.test(name)) {
    throw new Error(`tên tự sinh「${name}」không khớp hình dạng mà lượt xoá đi tìm`);
  }
}
count += 1;
console.log("✔ 400 tên tự sinh đều hợp luật VÀ khớp hình dạng bộ lọc của lượt xoá");

/** `pick` tiêm vào được, nên lưới chạy tất định — và ca này chứng minh điều đó. */
assert(
  randomSoftwareName(() => 0) === `${NAME_HEADS[0]}-${NAME_TAILS[0]}-0000`,
  "bộ sinh nhận phép rút tiêm vào, nên lưới kiểm chạy được tất định",
);

/** Hình dạng phải TỪ CHỐI những cái tên không phải của ta, bằng không bộ lọc xoá là một cái lưới thủng. */
for (const stranger of ["my-cool-project", "cobalt-relay", "cobalt-relay-4f2ag", "cobaltrelay4f2a", "Cobalt-Relay-4F2A"]) {
  assert(!GENERATED_NAME_SHAPE.test(stranger), `hình dạng từ chối「${stranger}」`);
}

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
  LEGACY_REPO_NAME_PREFIXES.includes("linh-su"),
  "tiền tố `linh-su` (đời 13/08–17/08) còn trong danh sách, để lượt xoá còn thấy kho dựng thời ấy",
);
assert(
  ALL_REPO_NAME_PREFIXES === LEGACY_REPO_NAME_PREFIXES,
  "không còn tiền tố nào ĐANG hành nghề — danh sách của lượt xoá thuần tuý là sử liệu",
);
assert(
  LEGACY_REPO_NAME_PREFIXES.every((prefix) => forbiddenWordsIn(prefix).length > 0),
  "MỌI tiền tố đời cũ đều là thứ luật mới cấm — đó là lý do luật chỉ áp cho tên SINH RA",
);


console.log(`\n✔ ${count} phép kiểm — luật đặt tên kho khôi lỗi còn nguyên.`);
