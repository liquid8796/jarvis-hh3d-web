import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADSTERRA_LEADERBOARD_KEY,
  ADSTERRA_LEADERBOARD_SCRIPT_SRC,
  ADSTERRA_NATIVE_CONTAINER_ID,
  ADSTERRA_NATIVE_SCRIPT_SRC,
  ADSTERRA_POPUNDER_SCRIPT_SRC,
  ADSTERRA_SITE_ID,
  ADSTERRA_SMARTLINK_URL,
  ADSTERRA_SOCIAL_BAR_SCRIPT_SRC,
  adsterraEnabled,
} from "../src/lib/adsterra/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

assert.equal(ADSTERRA_SITE_ID, 6090351);
assert.equal(ADSTERRA_LEADERBOARD_KEY, "5f0b1341593afd724f2bd2cd211c6b73");
assert.equal(ADSTERRA_LEADERBOARD_SCRIPT_SRC, "https://deliberatewatchful.com/5f0b1341593afd724f2bd2cd211c6b73/invoke.js");
assert.equal(ADSTERRA_NATIVE_CONTAINER_ID, "container-5e6634da84f8f263d7ab34ae152f1c8d");
assert.equal(ADSTERRA_NATIVE_SCRIPT_SRC, "https://deliberatewatchful.com/5e6634da84f8f263d7ab34ae152f1c8d/invoke.js");
assert.equal(ADSTERRA_POPUNDER_SCRIPT_SRC, "https://deliberatewatchful.com/43/0d/4f/430d4fbd8d66c3bb0f47cab838ef8a06.js");
assert.equal(ADSTERRA_SOCIAL_BAR_SCRIPT_SRC, "https://deliberatewatchful.com/97/7a/66/977a66f06e979e2830ee60ed1fa88533.js");
assert.equal(ADSTERRA_SMARTLINK_URL, "https://deliberatewatchful.com/ndimkb9kxi?key=f06720140b3b11ad092d96fa65ca5110");

assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(adsterraEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(adsterraEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(adsterraEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "production", ADSTERRA_DISABLED: "1" }), false);

const [layout, gate, client, privacy, css, envExample, packageJson] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/AdsterraAds.tsx"),
  read("src/components/adsterra/AdsterraClientAds.tsx"),
  read("src/app/quyen-rieng-tu/page.tsx"),
  read("src/app/adsterra.css"),
  read(".env.example"),
  read("package.json"),
]);

assert.match(layout, /<AdsterraAds \/>/);
assert.match(layout, /\.\/adsterra\.css/);
assert.match(gate, /adsterraEnabled\(host\)/);
assert.match(gate, /session\?\.role === "admin"/);
assert.match(client, /ADSTERRA_LEADERBOARD_SCRIPT_SRC/);
assert.match(client, /ADSTERRA_NATIVE_SCRIPT_SRC/);
assert.match(client, /ADSTERRA_POPUNDER_SCRIPT_SRC/);
assert.match(client, /ADSTERRA_SOCIAL_BAR_SCRIPT_SRC/);
assert.match(client, /ADSTERRA_SMARTLINK_URL/);
assert.match(client, /data-adsterra-global/);
assert.match(client, /dataset\.cfasync = "false"/);
assert.match(client, /rel="sponsored noopener noreferrer"/);
for (const excludedPath of ["/admin", "/chat-frame", "/login", "/pending", "/quyen-rieng-tu", "/register"]) {
  assert.match(client, new RegExp(JSON.stringify(excludedPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(client, /matchMedia\("\(min-width: 760px\)"\)/);
assert.match(client, /ADSTERRA_LEADERBOARD_WIDTH/);
assert.match(client, /ADSTERRA_LEADERBOARD_HEIGHT/);
assert.match(client, /fitBannerToSlot/);
assert.match(client, /ResizeObserver/);
assert.match(client, /adsterra-leaderboard-canvas/);
assert.match(client, /MutationObserver/);
assert.match(client, /setTimeout\(\(\) => settle\("blocked"\), 8_000\)/);
assert.match(client, /data-status=\{status\}/);
assert.match(client, /data-status=\{nativeStatus\}/);
assert.match(client, /adsterra-native/);
assert.doesNotMatch(client, /adsterra-label/);
assert.match(privacy, /Adsterra và định dạng quảng cáo/);
assert.match(privacy, /Popunder và liên kết tài trợ dùng miền tuỳ chỉnh\/chống chặn/);
assert.match(privacy, /Social Bar là tag tiêu chuẩn/);
assert.doesNotMatch(privacy, /Social Bar và Popunder dùng phiên bản chống chặn/);
assert.match(css, /\.adsterra-stack/);
assert.match(css, /\.adsterra-native/);
assert.match(css, /\.adsterra-unit\[data-status="blocked"\]/);
assert.doesNotMatch(css, /\.adsterra-label/);
assert.match(css, /\.adsterra-leaderboard-canvas/);
assert.match(css, /transform: scale\(var\(--adsterra-leaderboard-scale/);
assert.doesNotMatch(css, /@media \(max-width: 759px\)[\s\S]*\.adsterra-leaderboard\s*\{\s*display:\s*none;/);
assert.match(css, /@media \(max-width: 759px\)/);
assert.match(envExample, /ADSTERRA_DISABLED="0"/);
assert.equal(JSON.parse(packageJson).scripts["verify:adsterra"], "tsx scripts/verifyAdsterra.mts");

console.log("PASS: Adsterra desktop/mobile placements, responsive banner scaling, blocked-slot collapse, vendor tags, gates and privacy disclosure are consistent.");
