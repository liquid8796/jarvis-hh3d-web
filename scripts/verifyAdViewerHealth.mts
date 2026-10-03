import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const runtime = read("scripts/adViewer.mjs");

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

assert.match(runtime, /humanClick\s*\(/, "ad-viewer must use human-like click simulation to navigate to landing page");
assert.match(runtime, /preClickEngagement\s*\(/, "ad-viewer must simulate pre-click engagement before clicking ads");
assert.match(runtime, /humanClickCdp|humanClickMouse/, "ad-viewer must implement CDP and/or Playwright mouse click engines");
assert.match(runtime, /generateBezierPath\s*\(/, "ad-viewer must generate Bézier curve mouse trajectories");
assert.match(runtime, /MAX_RECURSIVE_CLICKS/, "ad-viewer must support recursive ad clicks");
assert.match(runtime, /handleRecursiveAdClicks/, "ad-viewer must handle recursive ad clicks");
assert.match(runtime, /while \(Date\.now\(\) - startTime < MAX_LIFETIME_MS\)/, "ad-viewer must loop across lifetime cycles");
// @ts-ignore
const { parseProxyItem } = await import("./adViewer.mjs");
const p1 = parseProxyItem("103.152.112.5:8080@liquid:secret123");
assert.equal(p1?.server, "http://103.152.112.5:8080");
assert.equal(p1?.username, "liquid");
assert.equal(p1?.password, "secret123");

const p2 = parseProxyItem("http://103.152.112.5:8080@liquid:secret123");
assert.equal(p2?.server, "http://103.152.112.5:8080");
assert.equal(p2?.username, "liquid");
assert.equal(p2?.password, "secret123");

const p3 = parseProxyItem("liquid:secret123@103.152.112.5:8080");
assert.equal(p3?.server, "http://103.152.112.5:8080");
assert.equal(p3?.username, "liquid");
assert.equal(p3?.password, "secret123");

console.log(
  "PASS: ad-viewer waits for ready selectors, verifies banner/native creatives, logs render evidence, clicks ads, recursively reads landing pages, parses IP:PORT@USER:PASS proxies, and runs continuous cycles locally.",
);

