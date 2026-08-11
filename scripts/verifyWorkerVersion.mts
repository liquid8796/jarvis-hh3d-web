/**
 * Kiểm chứng luật đối chiếu bản khôi lỗi (src/lib/worker/version.ts) và lối worker tự đọc bản
 * của chính nó.
 *
 * Thuần, không mạng, không database. Chỗ đáng kiểm nhất là ca「trạm đang phục vụ mang bản CŨ HƠN
 * gói người dùng đã cài」— cảnh có thật sau một lượt chuyển trạm sang gương trạm chưa kịp phát
 * hành. Một phép so「cũ hơn / mới hơn」kiểu semver sẽ nói ngược trong đúng ca ấy.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeWorkerVersion } from "../src/lib/worker/version";

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✔ ${label}`);
}

// ---- Khôi lỗi đời cũ: KHÔNG khai gì ------------------------------------------------------------
// Đây là ca quan trọng nhất, vì đúng những bản ấy là những bản chưa biết đi theo bảng điều phối.
for (const missing of [null, undefined, "", "   "]) {
  const v = describeWorkerVersion(missing, "0.71.0");
  ok(v.state === "unknown" && v.stale, `bản vắng (${JSON.stringify(missing)}) → "không rõ" VÀ phải giục cài lại`);
}
ok(describeWorkerVersion(null, "0.71.0").label.includes("cài lại"), "…và câu chữ nói thẳng phải làm gì");

// ---- Trùng bản --------------------------------------------------------------------------------
{
  const v = describeWorkerVersion("0.71.0", "0.71.0");
  ok(v.state === "current" && !v.stale, "trùng bản → không giục gì");
  ok(v.label === "bản 0.71.0", "…và chỉ hiện con số, không thêm lời thừa");
  ok(describeWorkerVersion(" 0.71.0 ", "0.71.0").state === "current", "khoảng trắng thừa hai bên không làm lệch phép so");
}

// ---- Lệch bản ---------------------------------------------------------------------------------
{
  const cu = describeWorkerVersion("0.64.0", "0.71.0");
  ok(cu.state === "mismatch" && cu.stale, "khôi lỗi CŨ hơn web → giục cài lại");
  ok(cu.label.includes("0.64.0") && cu.label.includes("0.71.0"), "…và hiện CẢ HAI con số để người đọc tự đối chiếu");

  // Trạm gương lên ngôi mà chưa kịp phát hành: web CŨ hơn gói người dùng đang chạy. Phép so thứ
  // tự sẽ nói「khôi lỗi mới hơn, không sao」— sai, vì hai bên vẫn lệch mã và vẫn cần cài lại.
  const nguoc = describeWorkerVersion("0.71.0", "0.64.0");
  ok(nguoc.state === "mismatch" && nguoc.stale, "web CŨ hơn khôi lỗi (sau lượt chuyển trạm) → VẪN báo lệch");
  ok(nguoc.label.includes("web đang ở 0.64.0"), "…và nói rõ web đang ở đâu, không đổ lỗi cho khôi lỗi");
}

// ---- Không biết web ở bản nào -----------------------------------------------------------------
for (const unknownWeb of [null, undefined, ""]) {
  const v = describeWorkerVersion("0.71.0", unknownWeb);
  ok(v.state === "unknown" && !v.stale, `web không khai bản (${JSON.stringify(unknownWeb)}) → KHÔNG được đoán là cũ`);
  ok(v.label === "bản 0.71.0", "…chỉ nói con số đang có");
}

// ---- Worker đọc đúng bản của chính nó ----------------------------------------------------------
// Gói phát hành đặt `package.json` NGANG HÀNG với worker.mjs; cây mã nguồn thì worker.mjs nằm
// trong scripts/ nên package.json ở thư mục cha. Nhầm chỗ là mọi khôi lỗi khai `null` và tính
// năng này chết lặng — nên kiểm cả hai đường dẫn mà worker.mjs thật sự thử.
{
  const repoRoot = path.join(import.meta.dirname, "..");
  const source = readFileSync(path.join(repoRoot, "scripts", "worker.mjs"), "utf8");
  ok(source.includes('"./package.json"'), "worker thử ./package.json (hình hài GÓI PHÁT HÀNH) trước");
  ok(source.includes('"../package.json"'), "…rồi mới tới ../package.json (hình hài CÂY MÃ NGUỒN)");
  ok(
    source.indexOf('"./package.json"') < source.indexOf('"../package.json"'),
    "…đúng thứ tự ấy: gói phát hành là ca thường gặp",
  );

  const repoVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
  ok(typeof repoVersion === "string" && repoVersion.length > 0, `package.json của repo có version (${repoVersion})`);
  // Biên của server: version phải lọt qua regex ở /api/worker, nếu không mọi lượt claim trả 400.
  ok(/^[A-Za-z0-9.+-]+$/.test(repoVersion) && repoVersion.length <= 32, "…và lọt qua đúng bộ lọc mà /api/worker áp");
}

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
