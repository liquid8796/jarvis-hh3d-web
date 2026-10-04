import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADCASH_AUTOTAG_ZONE_ID,
  ADCASH_ZONE_ID,
  ADCASH_POPUNDER_ZONE_ID,
  ADCASH_BANNER_160X600_ZONE_ID,
  ADCASH_BANNER_160X600_WIDTH,
  ADCASH_BANNER_160X600_HEIGHT,
  ADCASH_LIB_SRC,
  adcashEnabled,
} from "../src/lib/adcash/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

// 1. Kiểm tra cấu hình và hằng số Adcash
assert.equal(ADCASH_LIB_SRC, "//acscdn.com/script/aclib.js", "Adcash library script source must match");
assert.equal(ADCASH_AUTOTAG_ZONE_ID, "s6snqbi4sg", "AutoTag zoneId must be s6snqbi4sg");
assert.equal(ADCASH_ZONE_ID, "s6snqbi4sg", "Default zoneId alias must match AutoTag");
assert.equal(ADCASH_POPUNDER_ZONE_ID, "12265546", "Pop-Under zoneId must match 12265546");
assert.equal(ADCASH_BANNER_160X600_ZONE_ID, "12265554", "Display 160x600 zoneId must match 12265554");
assert.equal(ADCASH_BANNER_160X600_WIDTH, 160, "Banner 160x600 width must be 160");
assert.equal(ADCASH_BANNER_160X600_HEIGHT, 600, "Banner 160x600 height must be 600");

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
assert.match(headGate, /aclib\.runPop/, "AdcashHead must call aclib.runPop for Pop-Under");
assert.match(headGate, /12265546|ADCASH_POPUNDER_ZONE_ID/, "AdcashHead must reference Pop-Under zoneId 12265546");

assert.match(headGate, /aclib\.runBanner/, "AdcashAds must call aclib.runBanner for Display 160x600");
assert.match(headGate, /12265554|ADCASH_BANNER_160X600_ZONE_ID/, "AdcashAds must reference Banner zoneId 12265554");
assert.match(headGate, /id="adcash-banner-160x600"/, "AdcashAds must contain #adcash-banner-160x600");

// 4. Kiểm tra CSS định vị banner 160x600 và loại trừ che khuất các tab hàng đợi, phòng chat
assert.match(adcashCss, /\.adcash-banner-160x600/, "adcash.css must define .adcash-banner-160x600");
assert.match(adcashCss, /160px/, "adcash.css must specify 160px width");
assert.match(adcashCss, /600px/, "adcash.css must specify 600px min-height");
assert.match(adcashCss, /body:has\(\[data-backdrop="hang-doi"\]\)\s*\.adcash-banner-160x600/, "Must hide banner on hang-doi tab");
assert.match(adcashCss, /body:has\(\[data-backdrop="chat"\]\)\s*\.adcash-banner-160x600/, "Must hide banner on chat tab");
assert.match(clientAds, /pathAllowsBanner/, "clientAds must define pathAllowsBanner to protect inner tabs");

// 5. Kiểm tra adViewer nhận diện cả AutoTag, Pop-Under và Banner 160x600
assert.match(adViewer, /#adcash-banner-160x600/, "adViewer must recognize #adcash-banner-160x600");
assert.match(adViewer, /ADCASH_CONTAINER_SELECTOR/, "adViewer must define ADCASH_CONTAINER_SELECTOR");

console.log("PASS: Toàn bộ cấu hình và mã nhúng Adcash (Pop-Under 12265546, Display 160x600 12265554, AutoTag) đã được kiểm chứng chuẩn xác.");
