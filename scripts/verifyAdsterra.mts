import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADSTERRA_POPUNDER_SCRIPT_SRC,
  ADSTERRA_SITE_ID,
  ADSTERRA_SOCIAL_BAR_SCRIPT_SRC,
  adsterraEnabled,
} from "../src/lib/adsterra/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

assert.equal(ADSTERRA_SITE_ID, 6090351);
assert.equal(
  ADSTERRA_POPUNDER_SCRIPT_SRC,
  "https://deliberatewatchful.com/43/0d/4f/430d4fbd8d66c3bb0f47cab838ef8a06.js",
);
assert.equal(
  ADSTERRA_SOCIAL_BAR_SCRIPT_SRC,
  "https://deliberatewatchful.com/97/7a/66/977a66f06e979e2830ee60ed1fa88533.js",
);

assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(adsterraEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(adsterraEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(adsterraEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(adsterraEnabled("auto-hh3d.online", { NODE_ENV: "production", ADSTERRA_DISABLED: "1" }), false);

const [layout, gate, privacy, configSource, envExample, packageJson] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/AdsterraAds.tsx"),
  read("src/app/quyen-rieng-tu/page.tsx"),
  read("src/lib/adsterra/config.ts"),
  read(".env.example"),
  read("package.json"),
]);

// Popunder đặt trước </head>, Social Bar đặt trước </body>
assert.match(layout, /<head>[\s\S]*<AdsterraPopunder \/>[\s\S]*<\/head>/);
assert.match(layout, /<AdsterraSocialBar \/>[\s\S]*<\/body>/);

// Không còn các loại quảng cáo khác (banners, native, smartlink)
assert.doesNotMatch(configSource, /ADSTERRA_LEADERBOARD/);
assert.doesNotMatch(configSource, /ADSTERRA_BANNER_/);
assert.doesNotMatch(configSource, /ADSTERRA_NATIVE_/);
assert.doesNotMatch(configSource, /ADSTERRA_SMARTLINK/);
assert.doesNotMatch(layout, /adsterra\.css/);

// Kiểm tra quyền hạn và cổng chặn quản trị viên
assert.match(gate, /adsterraEnabled\(host\)/);
assert.match(gate, /session\?\.role === "admin"/);
assert.match(gate, /ADSTERRA_POPUNDER_SCRIPT_SRC/);
assert.match(gate, /ADSTERRA_SOCIAL_BAR_SCRIPT_SRC/);

// Kiểm tra chính sách quyền riêng tư
assert.match(privacy, /Adsterra và định dạng quảng cáo/);
assert.match(privacy, /Social Bar và Popunder/);

assert.match(envExample, /ADSTERRA_DISABLED="0"/);
assert.equal(JSON.parse(packageJson).scripts["verify:adsterra"], "tsx scripts/verifyAdsterra.mts");

console.log("PASS: Adsterra Popunder in <head>, Social Bar in <body>, gates and privacy disclosure verified.");
