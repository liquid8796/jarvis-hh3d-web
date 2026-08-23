/**
 * Khôi lỗi tông môn TỰ PHÁT LƯỢT KẾ — và cái phanh giữ nó khỏi thành vòng lặp đốt tiền.
 *
 * ── VÌ SAO CÓ CHUỖI ─────────────────────────────────────────────────────────────────────────
 *
 * Cron của GitHub KHÔNG mất nhịp (đo 22/08/2026: đủ 6 lượt/ngày như khai) nhưng trễ 52–211 phút,
 * tức dao động 159 phút. Ngân sách gối đầu chỉ là `tuổi thọ − chu kỳ cron` = 290 − 240 = 50 phút.
 * Dao động 159 phút không lọt nổi khe 50 phút, nên đội hở lỗ đều đặn — đo được một lỗ 84 phút.
 *
 * ── VÌ SAO PHANH QUAN TRỌNG HƠN CHUỖI ───────────────────────────────────────────────────────
 *
 * GitHub cấm `GITHUB_TOKEN` kích hoạt workflow CHÍNH VÌ sợ đệ quy, và chừa đúng hai cửa
 * (`workflow_dispatch`, `repository_dispatch`) cho người biết mình đang làm gì. Ta đi qua cửa ấy
 * thì phải tự gánh phần GitHub vừa buông: một lượt chết yểu mà vẫn phát lượt kế sẽ chết yểu
 * tiếp, mãi mãi, và đốt sạch phút Actions của tài khoản.
 *
 * Phanh: CHỈ nối chuỗi khi lượt đã sống quá NỬA tuổi thọ, và ngưỡng ấy SUY TỪ `TUOI_THO_MS` chứ
 * không phải hằng số gõ tay. Đó là điều lưới này canh gắt nhất — một hằng số gõ tay sẽ trôi khỏi
 * cấu hình lúc ai đó chỉnh tuổi thọ, và trôi lặng lẽ.
 *
 * ── LƯỚI NÀY CANH GÌ, VÀ KHÔNG CANH GÌ ──────────────────────────────────────────────────────
 *
 * Canh: những bất biến ĐỌC ĐƯỢC trong `linh-su.yml`. Thuần — không mạng, không database, không
 * cần parser YAML (kho không có, và thêm một phụ thuộc chỉ để chạy một lưới là cái giá sai).
 *
 * KHÔNG canh: hành vi thật của đoạn bash. Bảng chín ca (chết yểu / ngay dưới nửa đời / đúng nửa
 * đời / rút lui thường / ca thử đời ngắn / tuổi thọ 0 / tuổi thọ rỗng / HTTP 403) đã được chạy
 * TAY trên chính đoạn script rút ra từ tệp này, 21/08/2026 — xem CHANGELOG 1.3.41. Muốn chạy
 * lại: rút khối `run:` của bước「Phát lượt kế」, chèn một hàm `curl()` giả, rồi cho `BAT_DAU_LUC`
 * và `TUOI_THO_MS` các giá trị trong bảng. Nói thẳng ra ở đây vì một lưới im lặng về giới hạn
 * của mình là một lưới dễ bị tưởng là đã phủ hết.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(what: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${what}`);
  } else {
    failures.push(`${what}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const YML = "deploy/github/linh-su.yml";
const src = readFileSync(new URL(`../${YML}`, import.meta.url), "utf8");

console.log("Quyền: đủ để phát, không hơn");
check("có `actions: write`", /^\s+actions:\s*write\s*$/m.test(src));
check(
  // `contents: read` phải CÒN. Khai `permissions` là ghi đè trọn bộ mặc định, nên xoá dòng này
  // là `actions/checkout` mất quyền đọc kho và cả lượt chạy chết ngay bước đầu.
  "vẫn giữ `contents: read` — khai permissions là ghi đè TRỌN bộ mặc định",
  /^\s+contents:\s*read\s*$/m.test(src),
);
check(
  "KHÔNG xin quyền ghi nội dung kho — chuỗi chỉ cần phát lượt",
  !/^\s+contents:\s*write\s*$/m.test(src),
);

console.log("\nMốc giờ phải được ghi TRƯỚC mọi thứ, kể cả bước cài đặt");
const iMoc = src.indexOf("BAT_DAU_LUC=$(date +%s)");
const iCheckout = src.indexOf("actions/checkout@v4");
check("có ghi mốc giờ vào $GITHUB_ENV", iMoc > 0 && /BAT_DAU_LUC=\$\(date \+%s\)" >> "\$GITHUB_ENV"/.test(src));
check(
  // Một lượt chết lúc `npm ci` cũng phải bị phanh giữ. Ghi mốc SAU bước cài là phanh đo hụt mất
  // vài phút đắt nhất của lượt chạy.
  "mốc giờ đứng TRƯỚC checkout",
  iMoc > 0 && iCheckout > 0 && iMoc < iCheckout,
  `mốc ở ${iMoc}, checkout ở ${iCheckout}`,
);

console.log("\nBước nối chuỗi");
check("có bước「Phát lượt kế」", /- name: Phát lượt kế/.test(src));
check(
  // `success()` là không đủ: lượt thoát 1 vì hụt hạn thu đàn VẪN là một lượt đã sống trọn đời,
  // và bỏ nối ở đó là tự tay mở lại đúng cái lỗ vừa vá.
  "chạy với `if: always()`, không phải success()",
  /- name: Phát lượt kế\r?\n\s+if: always\(\)/.test(src),
);
check("dùng GITHUB_TOKEN, KHÔNG nhét PAT vào kho", /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/.test(src));
check(
  "không có PAT nào lọt vào workflow",
  !/secrets\.(GITHUB_PAT|PAT|CHAIN_PAT|GH_PAT)/.test(src),
);
check("gọi đúng cửa dispatches", /actions\/workflows\/linh-su\.yml\/dispatches/.test(src));
check(
  // Chèn `${{ }}` thẳng vào bash là cửa tiêm mã. Mọi giá trị phải đi qua `env:` rồi đọc bằng $VAR.
  "giá trị đi qua env, không nội suy `${{ }}` vào thân bash",
  !/run: \|[\s\S]{0,2000}?\$\{\{/.test(src.slice(src.indexOf("- name: Phát lượt kế"))),
);

console.log("\nPHANH — phần đáng canh nhất");
check(
  "ngưỡng SUY TỪ tuổi thọ (`TUOI_THO_MS / 2000`), không phải hằng số gõ tay",
  /nguong=\$\(\( TUOI_THO_MS \/ 2000 \)\)/.test(src),
);
check("có so sánh chặn khi chưa đủ nửa đời", /if \[ "\$troi" -lt "\$nguong" \]/.test(src));
check("tuổi thọ không đọc được thì TỪ CHỐI nối, không đoán bừa", /TUOI_THO_MS:-0.*-le 0/.test(src));
check(
  // Hai chỗ phải cùng đọc một con số: phanh canh theo tuổi thọ này mà worker sống theo tuổi thọ
  // khác thì phanh vô nghĩa.
  "phanh và worker cùng đọc MỘT biểu thức tuổi thọ",
  (src.match(/inputs\.tuoi_tho_ms \|\| '17400000'/g) ?? []).length === 2,
  `thấy ${(src.match(/inputs\.tuoi_tho_ms \|\| '17400000'/g) ?? []).length} lần, phải đúng 2`,
);

console.log("\nHỏng thì phải KÊU, không nuốt");
check("phát hỏng thì ::error::", /::error::Phát lượt kế HỎNG/.test(src));
check("và thoát khác 0", /::error::Chuỗi đứt[\s\S]{0,200}exit 1/.test(src));

console.log("\nLưới đỡ phải còn");
check(
  // Chuỗi đứt (phát hỏng, lượt bị huỷ, lượt chết yểu) thì cron dựng lại đội trong tối đa 4 giờ.
  // Bỏ cron là đổi một lỗ 84 phút lấy một lỗ vĩnh viễn.
  "cron vẫn còn làm lưới đỡ",
  /- cron: "0 \*\/4 \* \* \*"/.test(src),
);
check(
  // Không có nó thì lượt kế phát ra sẽ CHẠY SONG SONG với lượt cũ: hai tiến trình cùng WORKER_ID,
  // giành nhau đàn, ghi đè sổ điểm danh của nhau.
  "concurrency giữ đúng MỘT lượt chạy, và không huỷ lượt đang cày",
  /group: linh-su-github/.test(src) && /cancel-in-progress: false/.test(src),
);

console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
