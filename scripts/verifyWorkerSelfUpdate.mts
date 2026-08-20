/**
 * Phép tự thay gói của khôi lỗi máy nhà — luật thuần, và những mối nối phải còn nguyên.
 *
 * Tính năng này có hai nửa: một nửa là JavaScript (kiểm được ở đây), nửa kia là PowerShell/sh
 * trong vòng nuôi (chỉ chạy trên một cái máy thật mới biết). Lưới này giữ nửa kiểm được, và
 * ĐỌC MÃ NGUỒN của nửa kia để ít nhất bắt được cảnh ai đó gỡ mất một mối nối.
 *
 * Đọc mã nguồn KHÔNG phải là chạy nó — nói thẳng vậy. Một phép `includes` không chứng minh
 * vòng nuôi hoạt động; nó chỉ chứng minh vòng nuôi chưa bị tháo. Đó là thứ rẻ và có thật, còn
 * phần chạy thật thì phải đo trên máy Windows, và đã đo (xem CHANGELOG 1.3.29).
 */
import { readFileSync } from "node:fs";
import {
  UPDATE_EXIT_CODE,
  selfUpdateEnabled,
  shouldSelfUpdate,
} from "../src/lib/worker/selfUpdate.mjs";
import { anyMineStale, describeWorkerVersion, MINE_STALE_NOTICE } from "../src/lib/worker/version.ts";

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
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const on = { enabled: true };

console.log("Cờ là XIN VÀO — không bật cho những chỗ không dùng được");
check("không khai gì → TẮT", selfUpdateEnabled({}) === false);
check("khai \"1\" → bật", selfUpdateEnabled({ WORKER_SELF_UPDATE: "1" }) === true);
check("khai \"0\" → tắt", selfUpdateEnabled({ WORKER_SELF_UPDATE: "0" }) === false);
check("khai giá trị lạ → tắt (chỉ \"1\" mới là bật)", selfUpdateEnabled({ WORKER_SELF_UPDATE: "true" }) === false);
check("env là undefined → tắt, không nổ", selfUpdateEnabled(undefined) === false);

console.log("\nBa cửa từ chối, mỗi cửa chống một tai nạn cụ thể");
check(
  "cờ tắt → không thay, dù lệch bản",
  shouldSelfUpdate({ own: "1.2.0", web: "1.3.29", enabled: false }).update === false,
);
check(
  "gói không khai số bản → không thay (không tự kiểm chứng được ⇒ vòng lặp vô tận)",
  shouldSelfUpdate({ own: null, web: "1.3.29", ...on }).update === false,
);
check(
  "máy chủ chưa nói bản → không thay (KHÔNG đoán là cũ)",
  shouldSelfUpdate({ own: "1.2.0", web: null, ...on }).update === false,
);
check(
  "máy chủ trả chuỗi rỗng cũng vậy",
  shouldSelfUpdate({ own: "1.2.0", web: "   ", ...on }).update === false,
);

console.log("\nLệch là thay — kể cả khi gói ĐANG MỚI HƠN trạm");
check("đúng bản → không thay", shouldSelfUpdate({ own: "1.3.29", web: "1.3.29", ...on }).update === false);
check("khoảng trắng thừa không làm lệch giả", shouldSelfUpdate({ own: " 1.3.29 ", web: "1.3.29", ...on }).update === false);
check("cũ hơn trạm → thay", shouldSelfUpdate({ own: "1.2.0", web: "1.3.29", ...on }).update === true);
check(
  // Cùng lẽ đã chốt ở version.ts: trạm gương có thể mang bản CŨ hơn. So thứ tự thì khôi lỗi
  // đứng lệch với trạm nó đang nói chuyện; so bằng thì hai bên luôn hội tụ về một bản mã.
  "MỚI hơn trạm → vẫn thay, vì luật là so BẰNG chứ không so thứ tự",
  shouldSelfUpdate({ own: "1.4.0", web: "1.3.29", ...on }).update === true,
);

console.log("\nMọi phán quyết đều nói được lý do");
for (const ca of [
  { own: "1.2.0", web: "1.3.29", enabled: false },
  { own: null, web: "1.3.29", enabled: true },
  { own: "1.2.0", web: null, enabled: true },
  { own: "1.3.29", web: "1.3.29", enabled: true },
  { own: "1.2.0", web: "1.3.29", enabled: true },
]) {
  const r = shouldSelfUpdate(ca);
  check(`lý do có chữ: ${JSON.stringify(ca)}`, typeof r.reason === "string" && r.reason.trim().length > 0, r.reason);
}

console.log("\nMã thoát phải KHÁC hai mã đã có nghĩa");
check("khác 0 (xong việc) và khác 1 (thu đàn hụt hạn)", UPDATE_EXIT_CODE !== 0 && UPDATE_EXIT_CODE !== 1);
check("là số nguyên trong dải mã thoát hợp lệ", Number.isInteger(UPDATE_EXIT_CODE) && UPDATE_EXIT_CODE > 0 && UPDATE_EXIT_CODE < 256);

console.log("\nLời nhắc: nguyên văn tông chủ đặt, và chỉ nhắc về máy ĐANG TRỰC");
check(
  "câu chữ đúng nguyên văn",
  MINE_STALE_NOTICE === "Khôi lỗi máy nhà đã cũ, cần được update để theo kịp tông môn.",
  MINE_STALE_NOTICE,
);
check(
  "máy đang trực mà lệch bản → nhắc",
  anyMineStale([{ online: true, version: "1.2.0" }], "1.3.29") === true,
);
check(
  // Máy đã tắt mang số bản của LẦN CHẠY CUỐI. Giục nó là dựng một việc phải làm mà người dùng
  // không có cách nào làm — cùng luật đã áp cho từng dòng trong danh sách.
  "máy đã TẮT mà lệch bản → KHÔNG nhắc",
  anyMineStale([{ online: false, version: "1.2.0" }], "1.3.29") === false,
);
check("mọi máy đúng bản → không nhắc", anyMineStale([{ online: true, version: "1.3.29" }], "1.3.29") === false);
check("chưa có máy nào → không nhắc", anyMineStale([], "1.3.29") === false);
check(
  "không biết bản của trạm → KHÔNG nhắc (không đoán là cũ)",
  anyMineStale([{ online: true, version: "1.2.0" }], null) === false,
);
check(
  "một máy đúng bản, một máy lệch → vẫn nhắc",
  anyMineStale([{ online: true, version: "1.3.29" }, { online: true, version: "1.2.0" }], "1.3.29") === true,
);
check(
  "khôi lỗi đời cũ không khai số bản, đang trực → có nhắc",
  describeWorkerVersion(null, "1.3.29").stale === true && anyMineStale([{ online: true, version: null }], "1.3.29") === true,
);

console.log("\nMối nối phía máy chủ: bản của trạm phải đi kèm CẢ HAI lối trả của claim");
const route = read("src/app/api/worker/route.ts");
check("lối KHÔNG có job mang webVersion", /job: null, webVersion: WEB_VERSION/.test(route));
check("lối CÓ job mang webVersion", /webVersion: WEB_VERSION,\r?\n\s+job: \{/.test(route));
check("WEB_VERSION lấy từ package.json, không phải hằng gõ tay", /const WEB_VERSION = pkg\.version/.test(route));

console.log("\nMối nối phía khôi lỗi");
const worker = read("scripts/worker.mjs");
check("đọc webVersion từ hồi đáp claim", /const \{ job, webVersion \} = await call\("claim"/.test(worker));
check("hỏi luật rồi mới thu đàn", /shouldSelfUpdate\(\{/.test(worker) && /beginDrain\(xet\.reason\)/.test(worker));
check("thoát bằng đúng mã ấy khi thu xong", /process\.exitCode = UPDATE_EXIT_CODE/.test(worker));
check(
  // Hai đường vào thu đàn khác (hạn tuổi thọ, SIGTERM) KHÔNG được kích thay gói: một lượt bấm
  // huỷ trên Actions mà lại đi thay gói là hành vi không ai ngờ tới.
  "cờ riêng cho lượt thu đàn-để-thay-gói, không suy từ `draining`",
  /let drainingForUpdate = false;/.test(worker) && /if \(drainingForUpdate\) \{/.test(worker),
);

console.log("\nMối nối phía vòng nuôi (đọc mã — KHÔNG phải chạy)");
const ps1 = read("public/linh-su/install.ps1");
const sh = read("public/linh-su/install.sh");
for (const [ten, src, batMa, hamThay] of [
  ["install.ps1", ps1, /\$LASTEXITCODE -eq 90/, /function Thay-Goi/],
  ["install.sh", sh, /"\$ma" -eq 90/, /thay_goi\(\) \{/],
] as const) {
  check(`${ten}: vòng nuôi bắt đúng mã ${UPDATE_EXIT_CODE}`, batMa.test(src));
  check(`${ten}: có hàm thay gói`, hamThay.test(src));
  check(`${ten}: bật cờ trong .env`, /WORKER_SELF_UPDATE=1/.test(src));
  check(
    // Không có cửa này thì trạm hứa một đằng gói phát một nẻo là khôi lỗi thoát-thay-thoát mãi mãi.
    `${ten}: có cửa THÔI HỎI khi thay gói mà bản không đổi`,
    /WORKER_SELF_UPDATE/.test(src) && (ten === "install.ps1" ? /\$xinThayGoi = "0"/ : /xin_thay_goi=0/).test(src),
  );
  check(
    // Bộ cài giết tiến trình TRƯỚC rồi mới tải; vòng nuôi phải làm ngược lại, bằng không một cú
    // mất mạng biến máy đang chạy được thành máy chết.
    `${ten}: soi gói đủ mặt TRƯỚC khi chép đè`,
    /worker\.mjs/.test(src) && /quest-engine/.test(src),
  );
}
check(
  "vòng nuôi KHÔNG gọi lại bộ cài (bộ cài giết trước tải sau — mất mạng là máy chết)",
  !/install\.ps1[^\n]*\| iex/.test(ps1.slice(ps1.indexOf("function Thay-Goi"))),
);

console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
