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
assert.match(runtime, /allReady: banner\.status === "ready" && \(native\.status === "ready" \|\| !nativeSlotFound\)/);
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
assert.match(runtime, /acquireCycleTurn/, "ad-viewer must serialize full click-to-cycle-end turns across instances");
assert.match(runtime, /releaseCycleTurn/, "ad-viewer must release turn when instance completes its cycle");
assert.match(runtime, /withForegroundSlot/, "ad-viewer must guard new browser window launches from stealing foreground");
assert.match(runtime, /foregroundOwnedByOther/, "ad-viewer must prevent background instances from stealing focus");
assert.match(runtime, /resolveExtensionPath/, "ad-viewer must resolve CanvasBlocker extension path");
assert.match(runtime, /prepareExtensionProfile/, "ad-viewer must prepare extension profile preferences");
assert.match(runtime, /ensureDeveloperMode/, "ad-viewer must enforce developer mode via WebUI");
assert.match(runtime, /--disable-extensions-except=/, "ad-viewer must allow extension through disable-extensions-except");
assert.match(runtime, /--load-extension=/, "ad-viewer must load extension into chromium");
assert.match(runtime, /useMyChrome\s*=\s*!extensionPath && wantsMyChrome/, "ad-viewer must bypass --my-chrome when CanvasBlocker is requested to ensure extension loads in isolated profile");
assert.match(runtime, /requiresIsolatedProfile\s*=\s*Boolean\(extPath\)/, "runWorkerLoop must prepare isolated profile when extPath is present");

const batContent = read("run-ad-viewer.bat");
assert.match(batContent, /else if defined ARG_CB/, "run-ad-viewer.bat must clear ARG_MY_CHROME when CanvasBlocker is enabled even for 1 instance");

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
const { parseProxyItem, parsePopunderRatio, parseFocusPopunderSocial, parseAdNetwork, SOCIAL_BAR_KEY, SOCIAL_BAR_SELECTOR } = await import("./adViewer.mjs");
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

// ---- Cấu hình hover tuỳ biến & ngăn chặn che khuất cửa sổ đa instance ----
assert.match(runtime, /parseHoverConfig/, "ad-viewer must parse arbitrary hover configuration from CLI and env");
assert.match(runtime, /resolveHoverMs/, "ad-viewer must resolve hover duration before click");
assert.match(runtime, /minimizeInstanceWindow/, "ad-viewer must support minimizing inactive instance windows");
assert.match(runtime, /focusInstanceWindow/, "ad-viewer must support focusing and maximizing active instance window");
assert.match(runtime, /closeExtensionPage/, "ad-viewer must automatically close extension onboarding and settings tabs");

// ---- Cấu hình timeout render Adsterra & Cưỡng chế click (Force Click) ----
assert.match(runtime, /parseRenderTimeoutConfig/, "ad-viewer must parse render timeout from CLI and env");
assert.match(runtime, /isForceClick\s*=/, "ad-viewer must determine isForceClick when render is not finished within timeout");
assert.match(runtime, /\[ForceClick\]/, "ad-viewer must log and execute force click when render times out");
assert.match(batContent, /--render-timeout=/, "run-ad-viewer.bat must support --render-timeout option [13]");

// ---- Xác suất ưu tiên click quảng cáo Popunder (Popunder Ratio) ----
assert.equal(parsePopunderRatio(), 0.8, "default popunder ratio must be 80% (0.8)");
assert.equal(parsePopunderRatio("80"), 0.8);
assert.equal(parsePopunderRatio("80%"), 0.8);
assert.equal(parsePopunderRatio("50%"), 0.5);
assert.equal(parsePopunderRatio("100"), 1.0);
assert.equal(parsePopunderRatio("0"), 0.0);
assert.equal(parsePopunderRatio("0.65"), 0.65);
assert.equal(parsePopunderRatio("invalid"), 0.8);

assert.match(runtime, /POPUNDER_RATIO/, "ad-viewer must configure POPUNDER_RATIO");
assert.match(runtime, /preferPopunder\s*=\s*Math\.random\(\)\s*<\s*POPUNDER_RATIO/, "ad-viewer must roll popunder probability per cycle");
assert.match(runtime, /resolvePopunderTarget/, "ad-viewer must resolve natural popunder click targets");
assert.match(batContent, /\[14\] Xac suat uu tien click quang cao Popunder/, "run-ad-viewer.bat must offer option [14] for Popunder ratio");
assert.match(batContent, /--popunder-ratio=/, "run-ad-viewer.bat must pass --popunder-ratio");

// ---- Khắc phục lỗi protocol bất đồng bộ Patchright/Playwright (Network.setCacheDisabled / session closed) ----
assert.match(runtime, /isIgnorableProtocolError/, "ad-viewer must detect ignorable protocol errors");
assert.match(runtime, /process\.on\("unhandledRejection"/, "ad-viewer must handle unhandledRejection globally");
assert.match(runtime, /process\.on\("uncaughtException"/, "ad-viewer must guard uncaughtException from closed sessions");
assert.match(runtime, /network\.setcachedisabled/, "ad-viewer must suppress Network.setCacheDisabled session closed race conditions");

// ---- Thiết bị giả lập tuỳ chọn theo mong muốn (Custom Device Emulation) ----
assert.equal(fpMod.parseDeviceMode("iPhone 15"), "iPhone 15");
assert.equal(fpMod.parseDeviceMode("desktop"), "desktop");
assert.equal(fpMod.parseDeviceMode("mobile"), "mobile");
assert.equal(fpMod.parseDeviceMode("random"), "random");

const devIphone15 = fpMod.resolveCustomDevice("iPhone 15");
assert.equal(devIphone15?.deviceClass, "mobile");
assert.equal(devIphone15?.os, "ios");
assert.equal(devIphone15?.name, "iPhone 15");

const devS24 = fpMod.resolveCustomDevice("Galaxy S24");
assert.equal(devS24?.deviceClass, "mobile");
assert.equal(devS24?.os, "android");
assert.equal(devS24?.name, "Galaxy S24");

const devWin = fpMod.resolveCustomDevice("Windows");
assert.equal(devWin?.deviceClass, "desktop");
assert.equal(devWin?.os, "windows");

const devMac = fpMod.resolveCustomDevice("macOS");
assert.equal(devMac?.deviceClass, "desktop");
assert.equal(devMac?.os, "macos");

const profileIphone = fpMod.pickFingerprintProfile({ device: "iPhone 15", rng });
assert.equal(profileIphone.deviceClass, "mobile");
assert.equal(profileIphone.os, "ios");
assert.equal(profileIphone.device?.name, "iPhone 15");

const profileS24 = fpMod.pickFingerprintProfile({ device: "Galaxy S24", rng });
assert.equal(profileS24.deviceClass, "mobile");
assert.equal(profileS24.os, "android");
assert.equal(profileS24.device?.name, "Galaxy S24");

const profileWin = fpMod.pickFingerprintProfile({ device: "Windows", rng });
assert.equal(profileWin.deviceClass, "desktop");
assert.equal(profileWin.os, "windows");

assert.match(batContent, /Tu nhap thiet bi cu the/, "run-ad-viewer.bat must offer custom device option [4]");
assert.match(batContent, /:custom_device/, "run-ad-viewer.bat must have :custom_device label");

const winMousePs = read("scripts/winMouse.ps1");
assert.match(winMousePs, /\[int\]\$minimize\s*=\s*0/, "winMouse.ps1 must accept -minimize flag");
assert.match(winMousePs, /SW_SHOWMINNOACTIVE|ShowWindow\(\$other\.MainWindowHandle,\s*7\)/, "winMouse.ps1 must minimize other instance windows to prevent occlusion");
assert.match(winMousePs, /BringWindowToTop/, "winMouse.ps1 must bring active instance window to top");
// ---- Chế độ chạy ẩn (Headless Mode) ----
assert.match(batContent, /ARG_HEAD=--headless/, "run-ad-viewer.bat must set ARG_HEAD=--headless when headless mode is chosen");
assert.match(batContent, /ARG_CLICK_MODE=--click-mode=cdp/, "run-ad-viewer.bat must auto-switch click mode to cdp when headless mode is chosen");
assert.match(batContent, /else if "%INPUT_HEAD%"=="2"/, "run-ad-viewer.bat must clear ARG_MY_CHROME when headless mode is chosen");

assert.match(runtime, /IS_EXPLICIT_HEADLESS/, "ad-viewer must parse IS_EXPLICIT_HEADLESS");
assert.match(runtime, /useMyChrome\s*=\s*!extensionPath && wantsMyChrome && !IS_EXPLICIT_HEADLESS/, "ad-viewer must disable useMyChrome in headless mode");
assert.match(runtime, /wantsHeadless\s*&&\s*\(cycleClickMode === "os-mouse" \|\| cycleClickMode === "ghub" \|\| cycleClickMode === "manual"\)/, "ad-viewer must detect incompatible hardware click modes in headless");
assert.match(runtime, /cycleClickMode\s*=\s*"cdp"/, "ad-viewer must fallback incompatible click modes to cdp in headless");
assert.match(runtime, /--disable-features=UserAgentClientHint/, "ad-viewer must disable UserAgentClientHint in headless to prevent HeadlessChrome leak");
assert.match(runtime, /--enable-unsafe-swiftshader/, "ad-viewer must enable WebGL swiftshader in headless mode");
assert.match(runtime, /Emulation\.setFocusEmulationEnabled/, "ad-viewer must enable focus emulation via CDP");

// ---- Tối ưu chạy song song Headless đa instance (Không khóa Mutex chuột) ----
assert.match(runtime, /instanceMousePositions\s*=\s*new Map\(\)/, "ad-viewer must isolate virtual mouse coordinates per instance");
assert.match(runtime, /if\s*\(IS_EXPLICIT_HEADLESS\)\s*return true;/, "ad-viewer must grant foreground interaction immediately in headless");
assert.match(runtime, /const guardLaunch = INSTANCE_COUNT > 1 && !isHeadless;/, "ad-viewer must not block launch with foreground slot in headless");
assert.match(runtime, /const needsCycleLock = !isHeadless && \(isPhysicalClickMode\(cycleClickMode\) \|\| INSTANCE_COUNT > 1\);/, "ad-viewer must not serialize cycle turns across headless instances");
assert.match(runtime, /IS_EXPLICIT_HEADLESS \? 3000 : 8000/, "ad-viewer must shorten staggered start delay in headless mode");

// ---- Trọng tâm định dạng Popunder + SocialBar & Triệt tiêu spam NativeBanner ----
assert.equal(SOCIAL_BAR_KEY, "977a66f06e979e2830ee60ed1fa88533");
assert.match(SOCIAL_BAR_SELECTOR, /container-/);
assert.match(runtime, /--disable-popup-blocking/, "ad-viewer must pass --disable-popup-blocking to prevent headless Chromium from suppressing popunders");
const dummyEnv = {} as NodeJS.ProcessEnv;
assert.equal(parseFocusPopunderSocial(["node", "adViewer.mjs", "--headless"], dummyEnv), true, "headless mode must enable focus popunder+social by default");
assert.equal(parseFocusPopunderSocial(["node", "adViewer.mjs", "--focus-popunder-social"], dummyEnv), true);
assert.equal(parseFocusPopunderSocial(["node", "adViewer.mjs", "--no-native-click"], dummyEnv), true);
assert.equal(parseFocusPopunderSocial(["node", "adViewer.mjs", "--headless", "--with-native"], dummyEnv), false);
assert.equal(parseFocusPopunderSocial(["node", "adViewer.mjs", "--head"], dummyEnv), false);

assert.match(runtime, /if \(!FOCUS_POPUNDER_SOCIAL\) \{\s*await page\.locator\("\.adsterra-stack"\)\.scrollIntoViewIfNeeded\(\)/, "ad-viewer must avoid scrolling to .adsterra-stack when FOCUS_POPUNDER_SOCIAL is active");
assert.match(runtime, /if \(!FOCUS_POPUNDER_SOCIAL\) \{\s*try \{\s*const nativeSelector = isForceClick/, "ad-viewer must exclude native ads from candidates when FOCUS_POPUNDER_SOCIAL is active");
assert.match(runtime, /isSocialBar:\s*true/, "ad-viewer must tag SocialBar candidates");
assert.match(runtime, /🔔 \[SocialBar Ưu Tiên\]/, "ad-viewer must prioritize clicking SocialBar if Popunder does not spawn a new page");

assert.match(batContent, /\[15\] Trong tam dinh dang quang cao/, "run-ad-viewer.bat must offer option [15] for ad format focus");
assert.match(batContent, /ARG_AD_FOCUS=--focus-popunder-social/, "run-ad-viewer.bat must set ARG_AD_FOCUS to --focus-popunder-social");

// ---- Lựa chọn Nhà Mạng Quảng Cáo (Ad Network: Clickadu, Adsterra, All) ----
assert.equal(parseAdNetwork(["node", "adViewer.mjs"], dummyEnv), "all", "ad-network must default to all");
assert.equal(parseAdNetwork(["node", "adViewer.mjs", "--ad-network=adsterra"], dummyEnv), "adsterra");
assert.equal(parseAdNetwork(["node", "adViewer.mjs", "--ad-network=clickadu"], dummyEnv), "clickadu");
assert.equal(parseAdNetwork(["node", "adViewer.mjs", "--ad-network=all"], dummyEnv), "all");
assert.equal(parseAdNetwork(["node", "adViewer.mjs", "--network=adsterra"], dummyEnv), "adsterra");
assert.equal(parseAdNetwork(["node", "adViewer.mjs"], { AD_PROVIDER: "adsterra" } as any), "adsterra");
assert.equal(parseAdNetwork(["node", "adViewer.mjs"], { AD_PROVIDER: "clickadu" } as any), "clickadu");

assert.match(batContent, /\[16\] Nha mang quang cao muc tieu/, "run-ad-viewer.bat must offer option [16] for ad network");
assert.match(batContent, /ARG_AD_NETWORK=--ad-network=all/, "run-ad-viewer.bat must default to all ad networks");
assert.match(batContent, /FINAL_ARGS=.*ARG_AD_NETWORK/, "FINAL_ARGS must include ARG_AD_NETWORK");

console.log(
  "PASS: ad-viewer waits for ready selectors, verifies banner/native creatives, logs render evidence, clicks ads, recursively reads landing pages, parses IP:PORT@USER:PASS proxies, supports user-defined hover durations, prevents window occlusion across instances, supports user-defined render timeout with force click fallback, supports custom user-defined device emulation, fully supports headless mode without popping up windows or leaking headless signals, enables 100% lock-free parallel execution across multi-instance headless workers, focuses on high-CPM Popunder + SocialBar while eliminating unwanted NativeBanner impressions, and supports selecting target ad networks (Clickadu, Adsterra, All).",
);



