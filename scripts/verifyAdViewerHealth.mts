import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const runtime = read("scripts/adViewer.mjs");
const workflow = read("deploy/github/xem-quang-cao.yml");
const bundle = read("scripts/buildAdViewerBundle.mjs");

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

assert.doesNotMatch(runtime, /\.click\s*\(/, "health-check must not click production ad elements");
assert.doesNotMatch(runtime, /mouse\.click\s*\(/, "health-check must not synthesize page clicks");
assert.doesNotMatch(runtime, /MAX_RECURSIVE_CLICKS|handleRecursiveAdClicks/);
assert.doesNotMatch(runtime, /while \(Date\.now\(\) - startTime/);

assert.match(workflow, /name: Kiểm tra hiển thị quảng cáo/);
assert.match(workflow, /AD_VIEWER_AD_READY_TIMEOUT_MS: "15000"/);
assert.doesNotMatch(workflow, /AD_VIEWER_MAX_RECURSIVE_CLICKS/);
assert.doesNotMatch(workflow, /AD_VIEWER_MAX_LIFETIME_MS|TUOI_THO_MS|tuoi_tho_ms/);
assert.match(workflow, /XEM_QC_EXIT:-}" != "90"/);
assert.match(workflow, /name: Phát lượt thay runtime khi cần/);
assert.match(bundle, /health-check banner\/native Adsterra, không click quảng cáo production/);

console.log(
  "PASS: ad-viewer waits for exact ready selectors, verifies banner/native creatives, logs render evidence, and never clicks production ads.",
);
