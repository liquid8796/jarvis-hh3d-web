#!/usr/bin/env node
/**
 * Đóng GÓI XEM QUẢNG CÁO — public/xem-qc/goi-xem-qc.tgz — cho GitHub Actions runner tải về.
 *
 * Gói gồm:
 *   - ad-viewer.mjs (xem và click quảng cáo Adsterra với CanvasBlocker)
 *   - canvas-blocker/ (tiện ích Chrome CanvasBlocker từ deploy/extensions hoặc D:\Backup\Chrome\CanvasBlocker)
 *   - node_modules/playwright-core (thư viện điều khiển Chromium)
 *   - package.json tối thiểu
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, "public", "xem-qc");
const outFile = path.join(outDir, "goi-xem-qc.tgz");

const staging = mkdtempSync(path.join(tmpdir(), "xem-qc-"));

try {
  // 1. ad-viewer.mjs
  cpSync(path.join(root, "scripts", "adViewer.mjs"), path.join(staging, "ad-viewer.mjs"));

  // 2. Tiện ích CanvasBlocker
  const extSources = [
    path.join(root, "deploy", "extensions", "canvas-blocker"),
    "D:\\Backup\\Chrome\\CanvasBlocker",
  ];
  let foundExt = false;
  for (const src of extSources) {
    if (existsSync(path.join(src, "manifest.json"))) {
      cpSync(src, path.join(staging, "canvas-blocker"), { recursive: true });
      foundExt = true;
      break;
    }
  }
  if (!foundExt) {
    throw new Error("buildAdViewerBundle: không tìm thấy thư mục tiện ích CanvasBlocker hợp lệ!");
  }

  // 3. playwright-core vào node_modules/
  const pwcSource = path.join(root, "node_modules", "playwright-core");
  cpSync(pwcSource, path.join(staging, "node_modules", "playwright-core"), { recursive: true });
  const playwrightVersion = JSON.parse(
    readFileSync(path.join(pwcSource, "package.json"), "utf8"),
  ).version;

  // 4. package.json tối thiểu
  const repoPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(
      {
        name: "auto-hh3d-ad-viewer",
        private: true,
        version: repoPkg.version,
        type: "module",
        playwrightVersion,
        scripts: { start: "node ad-viewer.mjs" },
      },
      null,
      2,
    ) + "\n",
  );

  // 5. Nén .tgz phẳng
  const tmpTgz = `${path.basename(staging)}.tgz`;
  execFileSync("tar", ["-czf", `../${tmpTgz}`, "."], { cwd: staging });
  mkdirSync(outDir, { recursive: true });
  cpSync(path.join(staging, "..", tmpTgz), outFile);
  rmSync(path.join(staging, "..", tmpTgz), { force: true });

  const mb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`✔ gói xem quảng cáo v${repoPkg.version} (playwright-core ${playwrightVersion}, ${mb}MB) → ${path.relative(root, outFile)}`);
} finally {
  const resolved = realpathSync(staging);
  if (path.dirname(resolved) !== realpathSync(tmpdir()) || !path.basename(resolved).startsWith("xem-qc-")) {
    throw new Error("Refusing to remove an unowned staging directory.");
  }
  rmSync(resolved, { recursive: true, force: true });
}
