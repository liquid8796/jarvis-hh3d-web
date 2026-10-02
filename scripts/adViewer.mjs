#!/usr/bin/env node
/**
 * XEM QUẢNG CÁO TỰ ĐỘNG — trình duyệt tự động xem và tương tác quảng cáo trên website.
 *
 * Chạy trên GitHub Actions runner theo kiến trúc hybrid giống khôi lỗi linh-su.
 * Mỗi chu kỳ:
 *   1. Mở Chromium với profile tạm thời và nạp tiện ích CanvasBlocker
 *   2. Vào trang chủ website (WEB_URL)
 *   3. Đợi các vị trí quảng cáo (Adsterra banner 728x90, native ads, popunder) tải đầy đủ
 *   4. Kiểm tra và xác nhận trạng thái hiển thị của banner và native creative
 *   5. Click vào quảng cáo để mở trang đích trên tab mới
 *   6. Dừng ngẫu nhiên 5-10s để đọc trang quảng cáo chính
 *   7. Nếu trang quảng cáo có quảng cáo tiếp, click đệ quy tối đa 2 lần nữa
 *   8. Đóng trình duyệt, xoá sạch cache và cookies
 *   9. Bắt đầu chu kỳ mới cho đến khi hết tuổi thọ ca trực
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_URL = (process.env.WEB_URL ?? "https://auto-hh3d.online").replace(/\/$/, "");
const FALLBACK_URL = (process.env.WORKER_FALLBACK_URL ?? "").replace(/\/$/, "");
const VIEWER_ID = process.env.AD_VIEWER_ID ?? "github-xem-qc";
const MAX_LIFETIME_MS = Math.max(
  60_000,
  Number(process.env.AD_VIEWER_MAX_LIFETIME_MS ?? 17_400_000) || 17_400_000,
);
const DELAY_MIN_MS = Math.max(1000, Number(process.env.AD_VIEWER_DELAY_MIN_MS ?? 5000) || 5000);
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, Number(process.env.AD_VIEWER_DELAY_MAX_MS ?? 10000) || 10000);
const MAX_RECURSIVE_CLICKS = Math.max(0, Math.min(5, Number(process.env.AD_VIEWER_MAX_RECURSIVE_CLICKS ?? 2) || 2));
const AD_READY_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.AD_VIEWER_AD_READY_TIMEOUT_MS ?? 15_000) || 15_000,
);
const SELF_UPDATE = process.env.AD_VIEWER_SELF_UPDATE === "1";
const ENABLE_DEV_MODE = process.env.AD_VIEWER_ENABLE_DEV_MODE !== "0";

const BANNER_SLOT_SELECTOR = ".adsterra-leaderboard";
const BANNER_READY_SELECTOR = '.adsterra-leaderboard[data-status="ready"]';
const NATIVE_SLOT_SELECTOR = ".adsterra-native";
const NATIVE_READY_SELECTOR = '.adsterra-native[data-status="ready"]';
const NATIVE_CONTAINER_ID = "container-5e6634da84f8f263d7ab34ae152f1c8d";

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg) {
  const ts = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  console.log(`[${ts}] [${VIEWER_ID}] ${msg}`);
}

function resolveExtensionPath() {
  const candidates = [
    path.join(__dirname, "canvas-blocker"),
    path.join(__dirname, "../deploy/extensions/canvas-blocker"),
    "D:\\Backup\\Chrome\\CanvasBlocker",
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "manifest.json"))) {
      return c;
    }
  }
  return null;
}

function readOwnVersion() {
  for (const rel of ["./package.json", "../package.json"]) {
    try {
      const p = path.resolve(__dirname, rel);
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, "utf8"));
        if (parsed.version) return String(parsed.version).trim();
      }
    } catch {
      // bỏ qua
    }
  }
  return null;
}

const currentVersion = readOwnVersion();

async function checkRemoteVersion(url) {
  try {
    const res = await fetch(`${url}/api/version`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "ad-viewer-updater" },
    });
    if (res.ok) {
      const data = await res.json();
      return data?.version ?? null;
    }
  } catch {
    // lỗi mạng nhẹ, bỏ qua
  }
  return null;
}

function formatBox(box) {
  if (!box) return "không có";
  return `${Math.round(box.width)}×${Math.round(box.height)} @ ${Math.round(box.x)},${Math.round(box.y)}`;
}

function classifyPlacement(rawStatus, readySelectorFound, creativeCount) {
  if (rawStatus === "blocked") return "blocked";
  if (readySelectorFound && creativeCount > 0) return "ready";
  return "no-fill";
}

async function inspectAdsterraPlacements(page, startedAt = Date.now()) {
  const terminalWaitMs = Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt));

  // Đợi cả hai slot rời trạng thái loading. Selector ready được kiểm tra lại bên dưới cùng
  // creative thật; chỉ một thuộc tính data-status không đủ để kết luận quảng cáo đã render.
  if (terminalWaitMs > 0) {
    await page
      .waitForFunction(
        ({ bannerSelector, nativeSelector }) => {
          const terminal = (selector) => {
            const status = document.querySelector(selector)?.getAttribute("data-status") ?? "";
            return status === "ready" || status === "blocked";
          };
          return terminal(bannerSelector) && terminal(nativeSelector);
        },
        { bannerSelector: BANNER_SLOT_SELECTOR, nativeSelector: NATIVE_SLOT_SELECTOR },
        { timeout: terminalWaitMs },
      )
      .catch(() => {});
  }

  const bannerSlot = page.locator(BANNER_SLOT_SELECTOR).first();
  const nativeSlot = page.locator(NATIVE_SLOT_SELECTOR).first();
  const bannerSlotFound = (await bannerSlot.count()) > 0;
  const nativeSlotFound = (await nativeSlot.count()) > 0;
  const bannerRawStatus = bannerSlotFound
    ? (await bannerSlot.getAttribute("data-status").catch(() => null)) ?? "loading"
    : "missing";
  const nativeRawStatus = nativeSlotFound
    ? (await nativeSlot.getAttribute("data-status").catch(() => null)) ?? "loading"
    : "missing";

  const bannerReady = page.locator(BANNER_READY_SELECTOR).first();
  const bannerReadyFound = (await bannerReady.count()) > 0;
  const bannerIframe = page
    .locator(`${BANNER_READY_SELECTOR} iframe[width="728"][height="90"]`)
    .first();
  const bannerIframeFound = (await bannerIframe.count()) > 0;
  let bannerCreativeCount = 0;

  if (bannerIframeFound) {
    const iframeHandle = await bannerIframe.elementHandle().catch(() => null);
    const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
    if (frame) {
      const creativeWaitMs = Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt));
      if (creativeWaitMs > 0) {
        await frame.locator("a[href] img, a[href]").first().waitFor({
          state: "attached",
          timeout: creativeWaitMs,
        }).catch(() => {});
      }
      const linkedImages = await frame.locator("a[href] img").count().catch(() => 0);
      const linkedCreatives = await frame.locator("a[href]").count().catch(() => 0);
      bannerCreativeCount = linkedImages > 0 ? linkedImages : linkedCreatives;
    }
  }

  const nativeReady = page.locator(NATIVE_READY_SELECTOR).first();
  const nativeReadyFound = (await nativeReady.count()) > 0;
  const nativeContainer = page
    .locator(`${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID}`)
    .first();
  const nativeWaitMs = Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt));
  if (nativeReadyFound && nativeWaitMs > 0) {
    await nativeContainer.locator('[class*="__bn-container"], a[target="_blank"]').first().waitFor({
      state: "attached",
      timeout: nativeWaitMs,
    }).catch(() => {});
  }
  const nativeCards = await nativeContainer.locator('[class*="__bn-container"]').count().catch(() => 0);
  const nativeLinks = await nativeContainer.locator('a[target="_blank"]').count().catch(() => 0);
  const nativeCreativeCount = Math.max(nativeCards, nativeLinks);

  const banner = {
    status: classifyPlacement(bannerRawStatus, bannerReadyFound && bannerIframeFound, bannerCreativeCount),
    rawStatus: bannerRawStatus,
    iframe728x90: bannerIframeFound,
    creativeCount: bannerCreativeCount,
    slotBox: bannerSlotFound ? await bannerSlot.boundingBox().catch(() => null) : null,
    iframeBox: bannerIframeFound ? await bannerIframe.boundingBox().catch(() => null) : null,
  };
  const native = {
    status: classifyPlacement(nativeRawStatus, nativeReadyFound, nativeCreativeCount),
    rawStatus: nativeRawStatus,
    creativeCount: nativeCreativeCount,
    slotBox: nativeSlotFound ? await nativeSlot.boundingBox().catch(() => null) : null,
  };

  return {
    renderMs: Date.now() - startedAt,
    banner,
    native,
    allReady: banner.status === "ready" && native.status === "ready",
    bannerIframeFound,
    bannerIframe,
  };
}

async function handleRecursiveAdClicks(targetPage, depth, maxDepth) {
  if (depth >= maxDepth) return;

  try {
    const waitMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
    log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Đọc trang quảng cáo trong ${Math.round(waitMs / 1000)}s...`);
    await sleep(waitMs);

    // Tìm quảng cáo hoặc liên kết ngoài trên trang quảng cáo
    const adSelectors = [
      'iframe[src*="ad"]',
      'iframe[src*="banner"]',
      'a[href*="googleads"]',
      'a[href*="doubleclick"]',
      'a[target="_blank"]',
      'button[type="submit"]',
      'a.btn',
      'a.button',
    ];

    let clicked = false;
    for (const sel of adSelectors) {
      const handles = await targetPage.$$(sel);
      for (const handle of handles) {
        try {
          const visible = await handle.isVisible().catch(() => false);
          if (visible) {
            log(`  [Đệ quy cấp ${depth + 1}] Tìm thấy phần tử (${sel}), đang click...`);
            const [newPage] = await Promise.all([
              targetPage.context().waitForEvent("page", { timeout: 8000 }).catch(() => null),
              handle.click({ timeout: 5000, force: true }).catch(() => null),
            ]);

            clicked = true;
            if (newPage) {
              await newPage.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
              await handleRecursiveAdClicks(newPage, depth + 1, maxDepth);
              await newPage.close().catch(() => {});
            } else {
              await sleep(rand(DELAY_MIN_MS, DELAY_MAX_MS));
            }
            break;
          }
        } catch {
          // Bỏ qua phần tử lỗi
        }
      }
      if (clicked) break;
    }
  } catch (err) {
    log(`  Lỗi trong bước đệ quy click: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function prepareExtensionProfile(profileDir) {
  if (!ENABLE_DEV_MODE) return;
  try {
    const defaultDir = path.join(profileDir, "Default");
    mkdirSync(defaultDir, { recursive: true });
    const prefs = {
      extensions: {
        ui: {
          developer_mode: true,
        },
        alerts: {
          initialized: true,
        },
      },
    };
    writeFileSync(path.join(defaultDir, "Preferences"), JSON.stringify(prefs, null, 2), "utf8");

    const localState = {
      extensions: {
        ui: {
          developer_mode: true,
        },
      },
    };
    writeFileSync(path.join(profileDir, "Local State"), JSON.stringify(localState, null, 2), "utf8");
  } catch {
    // không chặn nếu ghi preferences thất bại
  }
}

async function ensureCdpServer(cdpPort, extensionPath) {
  const isListening = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
    signal: AbortSignal.timeout(1000),
  })
    .then((r) => r.ok)
    .catch(() => false);

  if (isListening) {
    log(`✓ Phát hiện Chrome đang lắng nghe trên cổng CDP ${cdpPort}.`);
    return;
  }

  log(`Chưa thấy Chrome mở cổng CDP ${cdpPort}; tự động khởi chạy Chrome với cổng gỡ lỗi...`);
  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "google-chrome",
    "chrome",
  ];
  const chromeBin = chromePaths.find((p) => existsSync(p)) || "chrome";

  const debugProfileDir = path.join(tmpdir(), "chrome-cdp-profile");
  prepareExtensionProfile(debugProfileDir);

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${debugProfileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1366,768",
    "--enable-experimental-extension-apis",
    "--extensions-on-chrome-urls",
    "--silent-debugger-extension-api",
  ];

  if (extensionPath) {
    args.push(`--disable-extensions-except=${extensionPath}`);
    args.push(`--load-extension=${extensionPath}`);
  }

  const child = spawn(chromeBin, args, { detached: true, stdio: "ignore" });
  child.unref();

  // Đợi cổng sẵn sàng (tối đa 10s)
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const ok = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(500),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      log(`✓ Chrome đã sẵn sàng trên cổng CDP ${cdpPort}.`);
      return;
    }
  }

  throw new Error(`Không thể khởi động Chrome trên cổng CDP ${cdpPort} sau 10 giây.`);
}

async function runOneCycle(extensionPath) {
  const cdpArg = process.argv.find((a) => a.startsWith("--cdp"));
  const cdpPort = cdpArg && cdpArg.includes("=") ? cdpArg.split("=")[1] : "9222";
  const cdpUrl =
    process.env.CDP_URL ||
    (cdpArg ? (cdpPort.startsWith("http") ? cdpPort : `http://127.0.0.1:${cdpPort}`) : null);

  const useMyChrome =
    process.argv.includes("--my-chrome") ||
    process.argv.includes("--my-profile") ||
    process.env.USE_MY_CHROME === "1";

  let context = null;
  let browser = null;
  let profileDir = null;
  let isTempProfile = false;
  let page = null;

  try {
    if (cdpUrl) {
      log(`Kết nối tới Chrome hiện tại qua CDP: ${cdpUrl}...`);
      try {
        if (cdpUrl.includes("127.0.0.1") || cdpUrl.includes("localhost")) {
          await ensureCdpServer(cdpPort, extensionPath);
        }
        browser = await chromium.connectOverCDP(cdpUrl);
        context = browser.contexts()[0] || (await browser.newContext());
        log("✓ Đã kết nối thành công tới Chrome qua CDP.");
      } catch (err) {
        log(`✗ Không thể kết nối tới Chrome tại ${cdpUrl}: ${err.message}`);
        log(`  Gợi ý: Mở Chrome bằng lệnh: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${cdpPort}`);
        process.exit(1);
      }
    } else if (useMyChrome) {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
      profileDir = path.join(localAppData, "Google", "Chrome", "User Data");
      log(`Sử dụng trực tiếp profile Chrome hiện tại: ${profileDir}`);
    } else {
      profileDir = mkdtempSync(path.join(tmpdir(), "ad-viewer-profile-"));
      isTempProfile = true;
      prepareExtensionProfile(profileDir);
    }

    if (!cdpUrl) {
      const args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1366,768",
        "--enable-experimental-extension-apis",
        "--extensions-on-chrome-urls",
        "--silent-debugger-extension-api",
        "--no-default-browser-check",
        "--no-first-run",
      ];

      if (extensionPath && isTempProfile) {
        args.push(`--disable-extensions-except=${extensionPath}`);
        args.push(`--load-extension=${extensionPath}`);
        if (ENABLE_DEV_MODE) {
          log("✓ Đã bật chế độ Developer Mode cho tiện ích CanvasBlocker trong profile.");
        }
      }

      const isHeadless =
        !useMyChrome &&
        !process.argv.includes("--head") &&
        !process.argv.includes("--visible") &&
        process.env.HEADLESS !== "0";
      const launchArgs = isHeadless ? [...args, "--headless=new"] : args;

      const launchOptions = {
        headless: false,
        args: launchArgs,
        viewport: { width: 1366, height: 768 },
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      };

      const channel = useMyChrome ? "chrome" : "chromium";

      try {
        context = await chromium.launchPersistentContext(profileDir, {
          ...launchOptions,
          channel,
        });
      } catch (err) {
        if (useMyChrome) {
          log("⚠ Không thể mở trực tiếp profile Chrome (có thể do Chrome đang mở sẵn trên máy).");
          log(`  Gợi ý: Mở Chrome bằng: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222`);
          log("  Sau đó chạy: npm run ad-viewer -- --cdp");
          throw err;
        }
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
      }
    }

    page = context.pages()[0] || (await context.newPage());

    const renderStartedAt = Date.now();
    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Cuộn nhẹ trang để kích hoạt các script lazy-load quảng cáo
    await page.evaluate(() => {
      window.scrollBy({ top: 300, behavior: "smooth" });
    });

    // Cuộn tiếp xuống phần thân trang
    await page.evaluate(() => {
      window.scrollBy({ top: 500, behavior: "smooth" });
    });

    await page.locator(".adsterra-stack").scrollIntoViewIfNeeded().catch(() => {});
    const diagnostic = await inspectAdsterraPlacements(page, renderStartedAt);

    log(
      `Adsterra banner: ${diagnostic.banner.status} ` +
        `(DOM=${diagnostic.banner.rawStatus}, iframe 728×90=${diagnostic.banner.iframe728x90 ? "có" : "không"}, ` +
        `creative=${diagnostic.banner.creativeCount}, slot=${formatBox(diagnostic.banner.slotBox)}, ` +
        `iframe=${formatBox(diagnostic.banner.iframeBox)})`,
    );
    log(
      `Adsterra native: ${diagnostic.native.status} ` +
        `(DOM=${diagnostic.native.rawStatus}, creative=${diagnostic.native.creativeCount}, ` +
        `slot=${formatBox(diagnostic.native.slotBox)})`,
    );
    log(`Thời gian chờ render Adsterra: ${diagnostic.renderMs}ms.`);

    let adClicked = false;
    let openedPage = null;

    // Thu thập tất cả các quảng cáo khả dụng trên trang để chọn ngẫu nhiên
    const adCandidates = [];

    // 1. Toàn bộ các thẻ Native Ads (nếu ready)
    if (diagnostic.native.status === "ready") {
      try {
        const nativeLinks = page.locator(
          `${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID} a[target="_blank"], ${NATIVE_READY_SELECTOR} a`,
        );
        const count = await nativeLinks.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          adCandidates.push({
            name: `Native ad card ${i + 1}/${count}`,
            locator: nativeLinks.nth(i),
          });
        }
      } catch (err) {
        log(`Lỗi khi quét native ads: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Banner ad creative trong iframe 728x90 (nếu ready)
    if (diagnostic.banner.status === "ready" && diagnostic.bannerIframeFound) {
      try {
        const iframeHandle = await diagnostic.bannerIframe.elementHandle().catch(() => null);
        const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
        if (frame) {
          const bannerLinks = frame.locator("a[href]");
          const bannerCount = await bannerLinks.count().catch(() => 0);
          for (let i = 0; i < bannerCount; i++) {
            adCandidates.push({
              name: `Banner 728×90 iframe link ${i + 1}/${bannerCount}`,
              locator: bannerLinks.nth(i),
            });
          }
        }
      } catch (err) {
        log(`Lỗi khi quét banner ad: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Adsterra Smartlink
    try {
      const smartlink = page.locator(
        '.adsterra-smartlink, a[href*="deliberatewatchful.com"], a[href*="f06720140b3b11ad092d96fa65ca5110"]',
      );
      const smartCount = await smartlink.count().catch(() => 0);
      for (let i = 0; i < smartCount; i++) {
        adCandidates.push({
          name: `Adsterra Smartlink ${i + 1}/${smartCount}`,
          locator: smartlink.nth(i),
        });
      }
    } catch {
      // bỏ qua
    }

    // Xáo trộn ngẫu nhiên toàn bộ danh sách quảng cáo tìm thấy (Fisher-Yates)
    for (let i = adCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [adCandidates[i], adCandidates[j]] = [adCandidates[j], adCandidates[i]];
    }

    if (adCandidates.length > 0) {
      log(`Tìm thấy tổng cộng ${adCandidates.length} vị trí quảng cáo khả dụng. Đang chọn ngẫu nhiên để click...`);
      for (const candidate of adCandidates) {
        log(`-> Click ngẫu nhiên quảng cáo [${candidate.name}]...`);
        const [newPage] = await Promise.all([
          context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
          candidate.locator.click({ timeout: 5000, force: true }).catch(() => null),
        ]);
        if (newPage) {
          openedPage = newPage;
          adClicked = true;
          log(`✓ Đã mở tab quảng cáo thành công từ [${candidate.name}].`);
          break;
        } else {
          await sleep(2500);
          const allPages = context.pages();
          if (allPages.length > 1) {
            openedPage = allPages[allPages.length - 1];
            adClicked = true;
            log(`✓ Đã bắt được trang quảng cáo từ tab phụ [${candidate.name}].`);
            break;
          }
        }
      }
    }

    // 4. Danh sách bộ chọn quảng cáo dự phòng cần tương tác
    const candidateSelectors = [
      '.adsterra-smartlink',
      'a[href*="deliberatewatchful.com"]',
      '#container-5e6634da84f8f263d7ab34ae152f1c8d a[target="_blank"]',
      '#container-5e6634da84f8f263d7ab34ae152f1c8d a',
      '.adsterra-native a[target="_blank"]',
      '.adsterra-native a',
      'iframe[width="728"]',
      'iframe[src*="alwingulla"]',
      'iframe[src*="adsterra"]',
      'iframe[src*="deliberatewatchful.com"]',
      'a[href*="alwingulla"]',
      'a[href*="smartlink"]',
      'aside.adsterra-stack a',
      '[class*="adsterra"] iframe',
      '[id*="container-"] a',
      'a[target="_blank"]',
    ];

    if (!adClicked) {
      // Xáo trộn ngẫu nhiên thứ tự selector dự phòng
      const shuffledSelectors = [...candidateSelectors].sort(() => Math.random() - 0.5);
      for (const selector of shuffledSelectors) {
        const elements = await page.$$(selector);
        const shuffledElements = [...elements].sort(() => Math.random() - 0.5);
        for (const el of shuffledElements) {
          try {
            const visible = await el.isVisible().catch(() => false);
            if (visible) {
              log(`Tìm thấy quảng cáo khớp [${selector}], đang click chuyển trang...`);
              const [newPage] = await Promise.all([
                context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
                el.click({ timeout: 5000, force: true }).catch(() => null),
              ]);
              if (newPage) {
                openedPage = newPage;
                adClicked = true;
                log("✓ Đã mở tab quảng cáo đích thành công.");
                break;
              } else {
                await sleep(3000);
                const allPages = context.pages();
                if (allPages.length > 1) {
                  openedPage = allPages[allPages.length - 1];
                  adClicked = true;
                  log("✓ Đã bắt được trang quảng cáo từ tab phụ.");
                  break;
                }
              }
            }
          } catch {
            // thử tiếp phần tử sau
          }
        }
        if (adClicked) break;
      }
    }

    // 4. Click ngẫu nhiên để kích hoạt popunder nếu chưa click được
    if (!adClicked) {
      log("Không click được quảng cáo cụ thể bằng selector; kích hoạt click mô phỏng trên trang...");
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 8000 }).catch(() => null),
        page.mouse.click(rand(200, 600), rand(200, 500)).catch(() => null),
      ]);
      if (popup) {
        openedPage = popup;
        adClicked = true;
        log("✓ Popunder đã được kích hoạt.");
      }
    }

    // 5. Đọc trang quảng cáo chính và đệ quy click nếu có
    if (openedPage) {
      await openedPage.waitForLoadState("domcontentloaded", { timeout: 25000 }).catch(() => {});
      const readingMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
      log(`Dừng đọc trang quảng cáo chính trong ${Math.round(readingMs / 1000)}s...`);
      await sleep(readingMs);

      // Đệ quy click thêm nếu còn quảng cáo trên trang đích (tối đa MAX_RECURSIVE_CLICKS)
      if (MAX_RECURSIVE_CLICKS > 0) {
        await handleRecursiveAdClicks(openedPage, 0, MAX_RECURSIVE_CLICKS);
      }

      await openedPage.close().catch(() => {});
    } else {
      log("Chu kỳ này chỉ xem quảng cáo trên trang, không có tab chuyển hướng mới.");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`Lỗi trong chu kỳ xem quảng cáo: ${errMsg}`);
    if (useMyChrome && errMsg.includes("Opening in existing browser session")) {
      log("⚠ Dừng tiến trình: Profile Chrome đang bị tiến trình Chrome chạy ngầm chiếm giữ.");
      log("  Gợi ý: Chạy `Stop-Process -Name chrome -Force` để tắt sạch Chrome ngầm, hoặc chạy `npm run ad-viewer:head` để chạy cửa sổ độc lập không bị xung đột.");
      process.exit(1);
    }
  } finally {
    // 1. Dọn dẹp sạch cache và cookies sau mỗi chu kỳ (áp dụng cho mọi chế độ, kể cả CDP)
    if (context) {
      try {
        await context.clearCookies().catch(() => {});
        if (page && !page.isClosed()) {
          const client = await context.newCDPSession(page).catch(() => null);
          if (client) {
            await client.send("Network.clearBrowserCookies").catch(() => {});
            await client.send("Network.clearBrowserCache").catch(() => {});
            await client.detach().catch(() => {});
          }
        }
        log("✓ Đã dọn dẹp sạch cache và cookies của trình duyệt.");
      } catch {
        // bỏ qua lỗi CDP session
      }
    }

    if (cdpUrl) {
      // Trong chế độ CDP, không đóng context/browser của người dùng, chỉ đóng tab do chu kỳ mở
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    } else {
      if (context) {
        await context.close().catch(() => {});
      }
      if (isTempProfile && profileDir) {
        try {
          rmSync(profileDir, { recursive: true, force: true });
          log("✓ Đã dọn dẹp thư mục profile tạm thời.");
        } catch {
          // bỏ qua lỗi dọn temp
        }
      }
    }
  }
}

async function main() {
  log(`Khởi động tiến trình xem quảng cáo (bản: ${currentVersion ?? "chưa rõ"})`);
  log(`Website đích: ${WEB_URL}`);
  log(`Tuổi thọ tối đa: ${Math.round(MAX_LIFETIME_MS / 60000)} phút`);
  log(`Thời gian chờ placement ready tối đa: ${Math.round(AD_READY_TIMEOUT_MS / 1000)} giây`);

  const extPath = resolveExtensionPath();
  if (extPath) {
    log(`✓ Đã nạp tiện ích CanvasBlocker từ: ${extPath}`);
  } else {
    log("⚠ Không tìm thấy thư mục tiện ích CanvasBlocker; chạy Chromium tiêu chuẩn.");
  }

  const startTime = Date.now();
  let cycle = 0;

  while (Date.now() - startTime < MAX_LIFETIME_MS) {
    cycle++;
    log(`\n=================== BẮT ĐẦU CHU KỲ ${cycle} ===================`);
    await runOneCycle(extPath);

    const elapsedMs = Date.now() - startTime;
    const remainingMs = MAX_LIFETIME_MS - elapsedMs;
    log(`Hoàn thành chu kỳ ${cycle}. Thời gian đã chạy: ${Math.round(elapsedMs / 60000)}m (còn ${Math.round(remainingMs / 60000)}m)`);

    // Kiểm tra nâng cấp runtime nếu bật
    if (SELF_UPDATE && currentVersion && cycle % 5 === 0) {
      const remoteVer = (await checkRemoteVersion(WEB_URL)) || (FALLBACK_URL ? await checkRemoteVersion(FALLBACK_URL) : null);
      if (remoteVer && remoteVer !== currentVersion) {
        log(`Phát hiện bản phát hành mới (${remoteVer} != ${currentVersion}). Kết thúc với mã 90 để nhận bản mới.`);
        process.exit(90);
      }
    }

    if (remainingMs <= 30_000) {
      log("Hết thời gian tuổi thọ ca trực. Đóng ca an toàn.");
      break;
    }

    const restMs = rand(2000, 5000);
    await sleep(restMs);
  }

  log("Ca trực hoàn tất bình thường. Thoát mã 0.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi chí mạng:", err);
  process.exit(1);
});
