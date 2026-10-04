import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADCASH_AUTOTAG_ZONE_ID,
  ADCASH_ZONE_ID,
  ADCASH_POPUNDER_ZONE_ID,
  ADCASH_BANNER_160X600_LEFT_ZONE_ID,
  ADCASH_BANNER_160X600_RIGHT_ZONE_ID,
  ADCASH_BANNER_160X600_ZONE_ID,
  ADCASH_BANNER_728X90_ZONE_ID,
  ADCASH_BANNER_160X600_WIDTH,
  ADCASH_BANNER_160X600_HEIGHT,
  ADCASH_BANNER_728X90_WIDTH,
  ADCASH_BANNER_728X90_HEIGHT,
  ADCASH_LIB_SRC,
  adcashEnabled,
} from "../src/lib/adcash/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

// 1. Kiểm tra cấu hình và hằng số Adcash (5 zone ID mới)
assert.equal(ADCASH_LIB_SRC, "//acscdn.com/script/aclib.js", "Adcash library script source must match");
assert.equal(ADCASH_AUTOTAG_ZONE_ID, "vaup0kxkvs", "AutoTag zoneId must be vaup0kxkvs");
assert.equal(ADCASH_ZONE_ID, "vaup0kxkvs", "Default zoneId alias must match AutoTag");
assert.equal(ADCASH_POPUNDER_ZONE_ID, "12265806", "Pop-Under zoneId must match 12265806");
assert.equal(ADCASH_BANNER_160X600_LEFT_ZONE_ID, "12265814", "Display 160x600 Left zoneId must match 12265814");
assert.equal(ADCASH_BANNER_160X600_RIGHT_ZONE_ID, "12265822", "Display 160x600 Right zoneId must match 12265822");
assert.equal(ADCASH_BANNER_160X600_ZONE_ID, "12265814", "Display 160x600 alias must match Left zoneId");
assert.equal(ADCASH_BANNER_728X90_ZONE_ID, "12265830", "Display 728x90 Leaderboard zoneId must match 12265830");
assert.equal(ADCASH_BANNER_160X600_WIDTH, 160, "Banner 160x600 width must be 160");
assert.equal(ADCASH_BANNER_160X600_HEIGHT, 600, "Banner 160x600 height must be 600");
assert.equal(ADCASH_BANNER_728X90_WIDTH, 728, "Banner 728x90 width must be 728");
assert.equal(ADCASH_BANNER_728X90_HEIGHT, 90, "Banner 728x90 height must be 90");

// 2. Kiểm tra điều kiện kích hoạt an toàn của Adcash
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(adcashEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(adcashEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(adcashEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "production", ADCASH_DISABLED: "1" }), false);

// 3. Kiểm tra mã nguồn gắn thẻ trên giao diện web
const [layout, headGate, adViewer, adcashCss, clientAds] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/AdcashAds.tsx"),
  read("scripts/adViewer.mjs"),
  read("src/app/adcash.css"),
  read("src/components/adcash/AdcashClientAds.tsx"),
]);

assert.match(layout, /<AdcashHead \/>/, "layout must include AdcashHead in <head>");
assert.match(layout, /<AdcashAds \/>/, "layout must include AdcashAds in <body>");
assert.match(layout, /import "\.\/adcash\.css"/, "layout must import adcash.css");

assert.match(headGate, /aclib\.runAutoTag/, "AdcashHead must call aclib.runAutoTag");
assert.match(headGate, /vaup0kxkvs|ADCASH_AUTOTAG_ZONE_ID/, "AdcashHead must reference AutoTag zoneId");
assert.match(headGate, /aclib\.runPop/, "AdcashHead must call aclib.runPop for Pop-Under");
assert.match(headGate, /12265806|ADCASH_POPUNDER_ZONE_ID/, "AdcashHead must reference Pop-Under zoneId 12265806");

assert.match(headGate, /aclib\.runBanner/, "AdcashAds must call aclib.runBanner for Display banners");
assert.match(headGate, /12265814|ADCASH_BANNER_160X600_LEFT_ZONE_ID/, "AdcashAds must reference Left Flank zoneId 12265814");
assert.match(headGate, /12265822|ADCASH_BANNER_160X600_RIGHT_ZONE_ID/, "AdcashAds must reference Right Flank zoneId 12265822");
assert.match(headGate, /12265830|ADCASH_BANNER_728X90_ZONE_ID/, "AdcashAds must reference Leaderboard zoneId 12265830");
assert.match(headGate, /id="adcash-banner-160x600-left"/, "AdcashAds must contain #adcash-banner-160x600-left");
assert.match(headGate, /id="adcash-banner-160x600-right"/, "AdcashAds must contain #adcash-banner-160x600-right");
assert.match(headGate, /id="adcash-banner-728x90"/, "AdcashAds must contain #adcash-banner-728x90");

// 4. Kiểm tra CSS định vị banner flank và leaderboard, loại trừ che khuất các tab hàng đợi, phòng chat
assert.match(adcashCss, /\.adcash-flank-left/, "adcash.css must define .adcash-flank-left");
assert.match(adcashCss, /\.adcash-flank-right/, "adcash.css must define .adcash-flank-right");
assert.match(adcashCss, /\.adcash-leaderboard/, "adcash.css must define .adcash-leaderboard");
assert.match(adcashCss, /body:has\(\[data-backdrop="hang-doi"\]\)\s*\.adcash-flank/, "Must hide flank on hang-doi tab");
assert.match(adcashCss, /body:has\(\[data-backdrop="chat"\]\)\s*\.adcash-flank/, "Must hide flank on chat tab");
assert.match(adcashCss, /body:has\(\[data-backdrop="hang-doi"\]\)\s*\.adcash-leaderboard/, "Must hide leaderboard on hang-doi tab");
assert.match(adcashCss, /body:has\(\[data-backdrop="chat"\]\)\s*\.adcash-leaderboard/, "Must hide leaderboard on chat tab");
assert.match(clientAds, /pathAllowsBanner/, "clientAds must define pathAllowsBanner to protect inner tabs");

// 5. Kiểm tra adViewer nhận diện cả 5 zone của Adcash
assert.match(adViewer, /#adcash-banner-160x600-left/, "adViewer must recognize #adcash-banner-160x600-left");
assert.match(adViewer, /#adcash-banner-160x600-right/, "adViewer must recognize #adcash-banner-160x600-right");
assert.match(adViewer, /#adcash-banner-728x90/, "adViewer must recognize #adcash-banner-728x90");
assert.match(adViewer, /ADCASH_CONTAINER_SELECTOR/, "adViewer must define ADCASH_CONTAINER_SELECTOR");

console.log("PASS: Toàn bộ 5 zone Adcash mới (AutoTag vaup0kxkvs, Pop-Under 12265806, Flank Left 12265814, Flank Right 12265822, Leaderboard 12265830) đã được kiểm chứng chuẩn xác.");
