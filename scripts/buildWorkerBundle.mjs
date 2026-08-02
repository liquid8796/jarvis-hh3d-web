#!/usr/bin/env node
/**
 * Đóng GÓI LINH SỨ — public/linh-su/goi-linh-su.tgz — thứ mà install.ps1 / install.sh tải về.
 *
 * Gói được SINH RA từ đúng những tệp repo đang chạy, không chép tay: worker.mjs + toàn bộ
 * quest-engine + một package.json tối thiểu. Nhờ vậy linh sứ máy nhà của đạo hữu chạy đúng
 * từng byte engine mà linh sứ tông môn chạy — không có "bản dành cho người cài" nào để lệch.
 *
 * Chạy tự động ở `prebuild`/`predev` (npm lifecycle), nên mỗi deploy Vercel đóng gói lại từ
 * nguồn mới nhất. Định dạng .tgz thay vì .zip có lý do rất trần tục: Windows 10+ có sẵn
 * tar.exe (bsdtar), Linux/macOS thì khỏi nói — người cài không phải có thêm bất cứ gì.
 *
 * worker.mjs trong repo import `../src/lib/quest-engine/…` (vì nó sống ở scripts/); trong
 * gói, engine nằm NGAY CẠNH nó nên import phải là `./quest-engine/…`. Phép rewrite dưới đây
 * cố ý FAIL BUILD khi không tìm thấy dòng import — nếu ai đó đổi đường dẫn mà quên nơi này,
 * thà vỡ lúc build còn hơn phát ra một gói cài xong không chạy.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, "public", "linh-su");
const outFile = path.join(outDir, "goi-linh-su.tgz");

const staging = mkdtempSync(path.join(tmpdir(), "linh-su-"));

try {
  // 1. worker.mjs — rewrite đường import engine cho đúng hình dạng của gói.
  const workerSource = readFileSync(path.join(root, "scripts", "worker.mjs"), "utf8");
  const needle = 'import { runCycle } from "../src/lib/quest-engine/runCycle.mjs";';
  if (!workerSource.includes(needle)) {
    throw new Error(
      "buildWorkerBundle: không thấy dòng import quest-engine trong scripts/worker.mjs — " +
        "đường dẫn đã đổi? Sửa `needle` cho khớp, đừng để gói phát ra bị hỏng im lặng.",
    );
  }
  writeFileSync(
    path.join(staging, "worker.mjs"),
    workerSource.replace(needle, 'import { runCycle } from "./quest-engine/runCycle.mjs";'),
  );

  // 2. Toàn bộ quest-engine — engine + profile.json là MỘT khối, thiếu profile là engine
  //    lên đường mà không mang theo nhiệm vụ nào.
  cpSync(path.join(root, "src", "lib", "quest-engine"), path.join(staging, "quest-engine"), {
    recursive: true,
  });

  // 3. package.json tối thiểu. playwright-core ghim CHÍNH XÁC bản đang nằm trong
  //    node_modules của repo (không phải range "^" trong package.json): revision Chromium
  //    gắn chặt với phiên bản, và installer sẽ chạy `npx playwright@<đúng bản này> install
  //    chromium` — lệch một nấc là "Executable doesn't exist" lúc worker mở browser.
  const repoPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const playwrightVersion = JSON.parse(
    readFileSync(path.join(root, "node_modules", "playwright-core", "package.json"), "utf8"),
  ).version;
  writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(
      {
        name: "auto-hh3d-linh-su",
        private: true,
        version: repoPkg.version,
        type: "module",
        dependencies: { "playwright-core": playwrightVersion },
        scripts: { start: "node worker.mjs" },
      },
      null,
      2,
    ) + "\n",
  );

  // 4. Nén, gói phẳng — giải nén ra là thấy worker.mjs ngay, không có thư mục bọc ngoài.
  //    tar chạy với cwd = staging và ghi ra ĐƯỜNG DẪN TƯƠNG ĐỐI, rồi fs copy về đích: GNU
  //    tar (Git Bash trên Windows) đọc "D:\…" thành hostname remote, nên tuyệt đối không
  //    đưa đường dẫn có dấu hai chấm cho nó.
  const tmpTgz = `${path.basename(staging)}.tgz`;
  execFileSync("tar", ["-czf", `../${tmpTgz}`, "."], { cwd: staging });
  mkdirSync(outDir, { recursive: true });
  cpSync(path.join(staging, "..", tmpTgz), outFile);
  rmSync(path.join(staging, "..", tmpTgz), { force: true });
  console.log(`✔ gói linh sứ v${repoPkg.version} → ${path.relative(root, outFile)}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
