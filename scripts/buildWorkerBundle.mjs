#!/usr/bin/env node
/**
 * Đóng GÓI KHÔI LỖI — public/linh-su/goi-linh-su.tgz — thứ mà install.ps1 / install.sh tải về.
 *
 * Gói được SINH RA từ đúng những tệp repo đang chạy, không chép tay: worker.mjs + toàn bộ
 * quest-engine + playwright-core + một package.json tối thiểu. Nhờ vậy khôi lỗi máy nhà của
 * đạo hữu chạy đúng từng byte engine mà khôi lỗi tông môn chạy — không có "bản dành cho
 * người cài" nào để lệch.
 *
 * **playwright-core đi THEO GÓI, không cài qua npm.** Nó thuần JavaScript, không phụ thuộc
 * gói nào khác, và nén lại chỉ ~3MB — nên nhét thẳng vào đây rẻ hơn nhiều so với cái giá
 * phải trả cho npm: người cài phải có npm, phải ra được registry (proxy công ty, mạng chập
 * chờn, registry sập), và phải cài ĐÚNG phiên bản. Điều cuối mới là thứ đáng kể: khi
 * playwright-core nằm sẵn trong gói, `cli.js` tải browser CHÍNH LÀ cli.js của bản đang chạy,
 * nên lỗi kinh điển "Executable doesn't exist" (CLI lệch phiên bản đặt sẵn revision khác)
 * trở thành bất khả thi về mặt cấu trúc, thay vì chỉ được canh chừng bằng kỷ luật.
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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const importRewrites = [
    [
      'import { runCycle } from "../src/lib/quest-engine/runCycle.mjs";',
      'import { runCycle } from "./quest-engine/runCycle.mjs";',
    ],
    [
      'import { profileDirForJob, sweepStaleProfiles } from "../src/lib/quest-engine/browserProfile.mjs";',
      'import { profileDirForJob, sweepStaleProfiles } from "./quest-engine/browserProfile.mjs";',
    ],
    [
      'import { createWorkerCall } from "../src/lib/worker/controlFollow.mjs";',
      'import { createWorkerCall } from "./controlFollow.mjs";',
    ],
    [
      'import { UPDATE_EXIT_CODE, selfUpdateEnabled, shouldSelfUpdate } from "../src/lib/worker/selfUpdate.mjs";',
      'import { UPDATE_EXIT_CODE, selfUpdateEnabled, shouldSelfUpdate } from "./selfUpdate.mjs";',
    ],
  ];
  let bundledWorker = workerSource;
  for (const [needle, replacement] of importRewrites) {
    if (!bundledWorker.includes(needle)) {
      throw new Error(
        "buildWorkerBundle: không thấy một import quest-engine trong scripts/worker.mjs — " +
          "đường dẫn đã đổi? Sửa `importRewrites` cho khớp, đừng để gói phát ra bị hỏng im lặng.",
      );
    }
    bundledWorker = bundledWorker.replace(needle, replacement);
  }
  writeFileSync(
    path.join(staging, "worker.mjs"),
    bundledWorker,
  );

  // 2a. Lời gọi biết đi theo bảng điều phối. Đi cùng gói vì khôi lỗi máy nhà cũng phải theo
  //     được trạm mới — thiếu nó thì mỗi lượt chuyển trạm bỏ lại toàn bộ đàn ở trạm cũ. Đặt
  //     phẳng cạnh worker.mjs, đúng lời hứa "giải nén ra là thấy worker.mjs ngay".
  cpSync(
    path.join(root, "src", "lib", "worker", "controlFollow.mjs"),
    path.join(staging, "controlFollow.mjs"),
  );

  // 2b. Luật tự thay gói. Cùng lẽ với controlFollow.mjs, và cùng bài học: worker.mjs `import`
  //     nó, nên thiếu nó là gói giải nén ra chết ngay giây đầu bằng ERR_MODULE_NOT_FOUND —
  //     mà vòng nuôi thì cứ dựng lại mỗi 10 giây để chết tiếp. Xem chốt ở mục 4b.
  cpSync(
    path.join(root, "src", "lib", "worker", "selfUpdate.mjs"),
    path.join(staging, "selfUpdate.mjs"),
  );

  // 2. Toàn bộ quest-engine — engine + profile.json là MỘT khối, thiếu profile là engine
  //    lên đường mà không mang theo nhiệm vụ nào.
  cpSync(path.join(root, "src", "lib", "quest-engine"), path.join(staging, "quest-engine"), {
    recursive: true,
  });

  // 3. playwright-core, nguyên vẹn vào node_modules/ của gói. Node phân giải
  //    `import "playwright-core"` bằng cách đi ngược cây thư mục tìm node_modules, nên đặt
  //    ở đây là worker.mjs cạnh nó tìm thấy ngay — không cần npm, không cần cài đặt gì.
  const pwcSource = path.join(root, "node_modules", "playwright-core");
  cpSync(pwcSource, path.join(staging, "node_modules", "playwright-core"), { recursive: true });
  const playwrightVersion = JSON.parse(
    readFileSync(path.join(pwcSource, "package.json"), "utf8"),
  ).version;

  // 4. package.json tối thiểu. KHÔNG khai `dependencies`: mọi thứ đã nằm trong gói, và một
  //    dòng dependency ở đây chỉ mời gọi ai đó chạy `npm install` rồi ghi đè bản đã ghim.
  const repoPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(
      {
        name: "auto-hh3d-linh-su",
        private: true,
        version: repoPkg.version,
        type: "module",
        playwrightVersion,
        scripts: { start: "node worker.mjs" },
      },
      null,
      2,
    ) + "\n",
  );

  // 4b. CHỐT: mọi `import` tương đối trong gói phải trỏ tới một tệp CÓ THẬT trong gói.
  //
  //     Bài học này kho mã đã trả giá MỘT LẦN ở phía tông môn — xem khối bình chú của
  //     `COPIED_PATHS` trong khoiloiPayload.mjs: một commit thêm import thứ ba mà quên chép,
  //     kho sinh ra chết ngay giây đầu. Bên ấy dựng `assertImportsResolve` để chặn; gói máy
  //     nhà thì KHÔNG có gì cả, và 21/08/2026 dính đúng lỗi ấy — `selfUpdate.mjs` bị bỏ quên,
  //     gói 1.3.30 phát ra đã hỏng và chỉ lộ khi có người mở gói production ra soi.
  //
  //     Đặt ở đây chứ không ở một lưới `verify:*` riêng, vì đây là chỗ DUY NHẤT mọi lượt dựng
  //     gói đều đi qua: một lưới phải nhớ chạy là một lưới sẽ có ngày quên chạy.
  {
    const thieu = [];
    const coTrongGoi = (p) => existsSync(path.join(staging, p));
    const duyet = (thuMuc, tienTo) => {
      for (const muc of readdirSync(path.join(staging, thuMuc), { withFileTypes: true })) {
        const rel = tienTo ? `${tienTo}/${muc.name}` : muc.name;
        if (muc.isDirectory()) {
          if (rel === "node_modules") continue; // gói của người khác, không phải việc của ta
          duyet(path.join(thuMuc, muc.name), rel);
          continue;
        }
        if (!/\.(mjs|js)$/.test(muc.name)) continue;
        const src = readFileSync(path.join(staging, thuMuc, muc.name), "utf8");
        // Ba hình dạng import, y như assertImportsResolve bên tông môn. Thứ tự trong nhóm chọn
        // CÓ Ý NGHĨA: `import\s*\(` phải đứng trước `import\s*`, bằng không `import(` bị nuốt.
        for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']*)["']/g)) {
          const dich = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
          if (!coTrongGoi(dich)) thieu.push(`  ${rel} → ${m[1]}`);
        }
      }
    };
    duyet(".", "");
    if (thieu.length > 0) {
      throw new Error(
        "Gói linh sư THIẾU TỆP — máy nhà giải nén ra sẽ chết bằng ERR_MODULE_NOT_FOUND:\n" +
          `${thieu.join("\n")}\n` +
          "Thêm cú `cpSync` cho tệp còn thiếu ở trên, đừng phát ra một gói hỏng im lặng.",
      );
    }
  }

  // 5. Nén, gói phẳng — giải nén ra là thấy worker.mjs ngay, không có thư mục bọc ngoài.
  //    tar chạy với cwd = staging và ghi ra ĐƯỜNG DẪN TƯƠNG ĐỐI, rồi fs copy về đích: GNU
  //    tar (Git Bash trên Windows) đọc "D:\…" thành hostname remote, nên tuyệt đối không
  //    đưa đường dẫn có dấu hai chấm cho nó.
  const tmpTgz = `${path.basename(staging)}.tgz`;
  execFileSync("tar", ["-czf", `../${tmpTgz}`, "."], { cwd: staging });
  mkdirSync(outDir, { recursive: true });
  cpSync(path.join(staging, "..", tmpTgz), outFile);
  rmSync(path.join(staging, "..", tmpTgz), { force: true });
  const mb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(
    `✔ gói khôi lỗi v${repoPkg.version} (playwright-core ${playwrightVersion}, ${mb}MB) → ${path.relative(root, outFile)}`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
