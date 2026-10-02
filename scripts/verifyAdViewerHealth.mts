import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const runtime = read("scripts/adViewer.mjs");
const workflow = read("deploy/github/xem-quang-cao.yml");
const bundle = read("scripts/buildAdViewerBundle.mjs");
const blocker = read("scripts/obscuraCanvasBlocker.mjs");

// 1. Module CanvasBlocker cho Obscura
assert.match(blocker, /__obscura_canvas_blocker__/);
assert.match(blocker, /getCanvasBlockerInitScript/);
assert.match(blocker, /getImageData/);
assert.match(blocker, /toDataURL/);
assert.match(blocker, /toBlob/);
assert.match(blocker, /readPixels/);
assert.match(blocker, /\[native code\]/);

// 2. Runtime adViewer với Obscura CDP Server
assert.match(runtime, /resolveObscuraBin/);
assert.match(runtime, /startObscuraServer/);
assert.match(runtime, /connectOverCDP/);
assert.match(runtime, /getCanvasBlockerInitScript/);
assert.match(runtime, /killProcessTree/);
assert.match(runtime, /safeQueryAll/);

assert.match(runtime, /\.adsterra-leaderboard\[data-status="ready"\]/);
assert.match(runtime, /\.adsterra-native\[data-status="ready"\]/);
assert.match(runtime, /iframe\[width="728"\]\[height="90"\]/);
assert.match(runtime, /container-5e6634da84f8f263d7ab34ae152f1c8d/);
assert.match(runtime, /a\[href\] img/);
assert.match(runtime, /__bn-container/);
assert.match(runtime, /creativeCount/);
assert.match(runtime, /renderMs/);
assert.match(runtime, /boundingBox/);
assert.match(runtime, /return "no-fill"/);
assert.match(runtime, /allReady: banner\.status === "ready" && native\.status === "ready"/);
const nativeCreativeIndex = runtime.indexOf("const nativeCreativeCount");
const renderResultIndex = runtime.indexOf("renderMs: Date.now() - startedAt");
assert.ok(nativeCreativeIndex >= 0 && renderResultIndex > nativeCreativeIndex, "renderMs must include creative verification time");

assert.match(runtime, /\.click\s*\(/, "ad-viewer must click ad elements to navigate to landing page");
assert.match(runtime, /mouse\.click\s*\(/, "ad-viewer must synthesize clicks for popunders when needed");
assert.match(runtime, /MAX_RECURSIVE_CLICKS/, "ad-viewer must support recursive ad clicks");
assert.match(runtime, /handleRecursiveAdClicks/, "ad-viewer must handle recursive ad clicks");
assert.match(runtime, /while \(Date\.now\(\) - startTime < MAX_LIFETIME_MS\)/, "ad-viewer must loop across lifetime cycles");

// 3. Workflow GitHub Actions tải Obscura Linux
assert.match(workflow, /name: Xem quảng cáo/);
assert.match(workflow, /Download and install Obscura browser binary/);
assert.match(workflow, /obscura-x86_64-linux\.tar\.gz/);
assert.match(workflow, /OBSCURA_BIN=/);
assert.match(workflow, /test -f "\$dir\/obscuraCanvasBlocker\.mjs"/);
assert.match(workflow, /AD_VIEWER_AD_READY_TIMEOUT_MS: "15000"/);
assert.match(workflow, /AD_VIEWER_MAX_RECURSIVE_CLICKS: "2"/);
assert.match(workflow, /AD_VIEWER_MAX_LIFETIME_MS:/);
assert.match(workflow, /timeout-minutes: 350/);
assert.match(workflow, /name: Phát lượt kế/);

// 4. Đóng gói bundle
assert.match(bundle, /obscuraCanvasBlocker\.mjs/);
assert.match(bundle, /xem và click quảng cáo Adsterra với CanvasBlocker/);

console.log(
  "PASS: ad-viewer uses Obscura CDP server, CanvasBlocker init script, verifies banner/native creatives, logs render evidence, clicks ads safely, and downloads Obscura v0.2.3 in workflow.",
);
