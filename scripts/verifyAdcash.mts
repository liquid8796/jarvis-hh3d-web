import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADCASH_AUTOTAG_ZONE_ID,
  ADCASH_ZONE_ID,
  ADCASH_LIB_SRC,
  adcashEnabled,
} from "../src/lib/adcash/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

// 1. Kiểm tra cấu hình và hằng số Adcash AutoTag duy nhất
assert.equal(ADCASH_LIB_SRC, "//acscdn.com/script/aclib.js", "Adcash library script source must match");
assert.equal(ADCASH_AUTOTAG_ZONE_ID, "7gpx1rimky", "AutoTag zoneId must be 7gpx1rimky");
assert.equal(ADCASH_ZONE_ID, "7gpx1rimky", "Default zoneId alias must match AutoTag");

// 2. Kiểm tra điều kiện kích hoạt an toàn của Adcash
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(adcashEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(adcashEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(adcashEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(adcashEnabled("auto-hh3d.online", { NODE_ENV: "production", ADCASH_DISABLED: "1" }), false);

// 3. Kiểm tra mã nguồn gắn thẻ trên giao diện web
const [layout, headGate, bodyGate, adViewer, adcashCss, clientAds] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/AdcashAds.tsx"),
  read("src/components/AdcashAds.tsx"),
  read("scripts/adViewer.mjs"),
  read("src/app/adcash.css"),
  read("src/components/adcash/AdcashClientAds.tsx"),
]);

assert.match(layout, /<AdcashHead \/>/, "layout must include AdcashHead in <head>");
assert.match(layout, /<AdcashAds \/>/, "layout must include AdcashAds in <body>");
assert.match(layout, /import "\.\/adcash\.css"/, "layout must import adcash.css");

assert.match(headGate, /aclib\.runAutoTag/, "AdcashHead must call aclib.runAutoTag");
assert.match(headGate, /7gpx1rimky|ADCASH_AUTOTAG_ZONE_ID/, "AdcashHead must reference AutoTag zoneId 7gpx1rimky");

// Phải loại bỏ toàn bộ các popunder và banner thủ công
assert.doesNotMatch(headGate, /aclib\.runPop/, "AdcashHead must NOT call aclib.runPop");
assert.doesNotMatch(bodyGate, /aclib\.runBanner/, "AdcashAds must NOT call aclib.runBanner");
assert.doesNotMatch(bodyGate, /adcash-banner-160x600/, "AdcashAds must NOT contain #adcash-banner-160x600");
assert.doesNotMatch(bodyGate, /adcash-banner-728x90/, "AdcashAds must NOT contain #adcash-banner-728x90");

// 4. Kiểm tra CSS và ClientAds
assert.match(adcashCss, /\.adcash-container/, "adcash.css must define .adcash-container");
assert.match(clientAds, /id="adcash-ad-container"/, "clientAds must define #adcash-ad-container for AutoTag");

// 5. Kiểm tra adViewer nhận diện AutoTag duy nhất
assert.match(adViewer, /7gpx1rimky/, "adViewer must recognize AutoTag 7gpx1rimky");
assert.match(adViewer, /ADCASH_CONTAINER_SELECTOR/, "adViewer must define ADCASH_CONTAINER_SELECTOR");
assert.doesNotMatch(adViewer, /adcash-banner-160x600-left/, "adViewer must not depend on removed manual banner IDs");

console.log("PASS: Cấu hình Adcash duy nhất AutoTag (7gpx1rimky) đã được kiểm chứng chuẩn xác.");
