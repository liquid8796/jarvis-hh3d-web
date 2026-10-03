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
assert.match(runtime, /CLEAR_CACHE_CYCLES/, "ad-viewer must configure clear cache cycles");
assert.match(runtime, /cycleIndex % CLEAR_CACHE_CYCLES === 0/, "ad-viewer must clear browser data every n cycles");
assert.match(runtime, /ensureWindowMaximized/, "ad-viewer must ensure the window is maximized to prevent clicking outside bounds");
assert.match(runtime, /INSTANCE_COUNT/, "ad-viewer must parse instance count");
assert.match(runtime, /mouseMutex/, "ad-viewer must coordinate physical mouse clicks via mutex");
assert.match(runtime, /inUseProxyKeys/, "ad-viewer must isolate proxies across instances");
assert.match(runtime, /performEngageAndClick/, "ad-viewer must synchronize physical engagement and clicks");
assert.match(runtime, /runInstanceLoop/, "ad-viewer must support concurrent instance loops");

// ---- Vân tay thiết bị + trình duyệt ----
assert.match(runtime, /identityWindowStart/, "a new device/browser identity must only start with a new cookie window");
assert.match(runtime, /context\.on\("page", onFingerprintPage\)/, "popup tabs must inherit the cycle's fingerprint");
assert.match(runtime, /browser && fingerprintProfile/, "CDP connection must be dropped so stale identities stop injecting");
// @ts-ignore
const fpMod = await import("./adViewerFingerprint.mjs");
let seed = 7;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const seen = { desktop: 0, mobile: 0, browsers: new Set<string>() };
for (let i = 0; i < 400; i++) {
  const profile = fpMod.pickFingerprintProfile({ rng });
  const fp = fpMod.materializeFingerprint(profile, { engineMajor: 141, now: new Date("2026-10-03T00:00:00Z") });
  seen[profile.deviceClass as "desktop" | "mobile"]++;
  seen.browsers.add(profile.browser);
  const label = `${profile.browser}/${profile.os}/${profile.deviceClass}`;
  if (profile.family === "chromium") {
    assert.ok(fp.userAgentMetadata, `${label}: Chromium-family must send Client Hints`);
    assert.ok(fp.userAgent.includes("Chrome/141."), `${label}: Chromium token must match the real engine major`);
    assert.equal(fp.userAgentMetadata.mobile, profile.deviceClass === "mobile", `${label}: UA-CH mobile flag`);
    assert.equal(fp.inject.vendor, "Google Inc.");
  } else {
    assert.equal(fp.userAgentMetadata, null, `${label}: Firefox/Safari/iOS must not send Client Hints`);
    assert.equal(fp.inject.deviceMemory, null, `${label}: deviceMemory is Chromium-only`);
  }
  if (profile.browser === "samsung") assert.equal(profile.os, "android", "Samsung Internet only exists on Android");
  if (profile.browser === "safari") assert.ok(["macos", "ios"].includes(profile.os), "Safari only exists on Apple OSes");
  if (profile.os === "ios") assert.equal(profile.family, "webkit", "every iOS browser is WebKit");
  if (profile.deviceClass === "mobile") {
    assert.ok(fp.isMobile && fp.hasTouch && fp.inject.maxTouchPoints === 5, `${label}: mobile must have touch`);
    assert.ok(/Mobile|iPhone|Android/.test(fp.userAgent), `${label}: mobile UA`);
  } else {
    assert.equal(fp.inject.maxTouchPoints, 0);
    assert.ok(!/Mobile/.test(fp.userAgent), `${label}: desktop UA must not say Mobile`);
  }
  if (profile.browser === "edge" && profile.family === "chromium") {
    assert.ok(fp.userAgentMetadata?.brands.some((b: { brand: string }) => b.brand === "Microsoft Edge"));
  }
  if (profile.browser === "firefox" && profile.os !== "ios") assert.equal(fp.inject.productSub, "20100101");
}
assert.ok(seen.desktop > 120 && seen.mobile > 120, "random device mode must produce both desktop and mobile");
for (const id of fpMod.BROWSER_IDS) assert.ok(seen.browsers.has(id), `random pool must reach ${id}`);

const onlyDesktopSamsung = fpMod.pickFingerprintProfile({ device: "desktop", browsers: ["samsung"], rng });
assert.equal(onlyDesktopSamsung.deviceClass, "mobile", "impossible desktop+Samsung keeps the browser and flips to mobile");
assert.deepEqual(fpMod.parseBrowserList("chromium").browsers, fpMod.CHROMIUM_BROWSER_IDS);
assert.deepEqual(fpMod.parseBrowserList("Edge, FF, xyz"), { browsers: ["edge", "firefox"], unknown: ["xyz"] });
assert.equal(fpMod.estimateSafariMajor(new Date("2026-10-03T00:00:00Z")), 27);
assert.equal(fpMod.estimateSafariMajor(new Date("2026-06-01T00:00:00Z")), 26);
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

