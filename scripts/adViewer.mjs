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

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

async function runOneCycle(extensionPath) {
  const profileDir = mkdtempSync(path.join(tmpdir(), "ad-viewer-profile-"));
  let context = null;

  try {
    const args = [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
    ];

    if (extensionPath) {
      args.push(`--disable-extensions-except=${extensionPath}`);
      args.push(`--load-extension=${extensionPath}`);
    }

    const launchOptions = {
      headless: false,
      args: [...args, "--headless=new"],
      viewport: { width: 1366, height: 768 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    };

    try {
      context = await chromium.launchPersistentContext(profileDir, {
        ...launchOptions,
        channel: "chromium",
      });
    } catch {
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    }

    const page = context.pages()[0] || (await context.newPage());

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

    // 1. Thử click native ads nếu ready
    if (diagnostic.native.status === "ready") {
      try {
        const nativeLinks = page.locator(`${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID} a[target="_blank"], ${NATIVE_READY_SELECTOR} a`);
        const count = await nativeLinks.count().catch(() => 0);
        if (count > 0) {
          log("Tìm thấy native ad card, đang click chuyển trang...");
          const [newPage] = await Promise.all([
            context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
            nativeLinks.first().click({ timeout: 5000, force: true }).catch(() => null),
          ]);
          if (newPage) {
            openedPage = newPage;
            adClicked = true;
            log("✓ Đã mở tab quảng cáo native thành công.");
          } else {
            await sleep(3000);
            const allPages = context.pages();
            if (allPages.length > 1) {
              openedPage = allPages[allPages.length - 1];
              adClicked = true;
              log("✓ Đã bắt được trang quảng cáo native từ tab phụ.");
            }
          }
        }
      } catch (err) {
        log(`Thử click native ad gặp lỗi: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Thử click banner ad trong iframe nếu ready
    if (!adClicked && diagnostic.banner.status === "ready" && diagnostic.bannerIframeFound) {
      try {
        const iframeHandle = await diagnostic.bannerIframe.elementHandle().catch(() => null);
        const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
        if (frame) {
          const bannerLink = frame.locator("a[href]").first();
          if ((await bannerLink.count().catch(() => 0)) > 0) {
            log("Tìm thấy banner ad creative trong iframe, đang click chuyển trang...");
            const [newPage] = await Promise.all([
              context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
              bannerLink.click({ timeout: 5000, force: true }).catch(() => null),
            ]);
            if (newPage) {
              openedPage = newPage;
              adClicked = true;
              log("✓ Đã mở tab quảng cáo banner thành công.");
            } else {
              await sleep(3000);
              const allPages = context.pages();
              if (allPages.length > 1) {
                openedPage = allPages[allPages.length - 1];
                adClicked = true;
                log("✓ Đã bắt được trang quảng cáo banner từ tab phụ.");
              }
            }
          }
        }
      } catch (err) {
        log(`Thử click banner ad gặp lỗi: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Thử click Adsterra Smartlink nếu chưa click được
    if (!adClicked) {
      try {
        const smartlink = page.locator('.adsterra-smartlink, a[href*="deliberatewatchful.com"], a[href*="f06720140b3b11ad092d96fa65ca5110"]').first();
        const smartlinkFound = (await smartlink.count().catch(() => 0)) > 0;
        if (smartlinkFound) {
          log("Tìm thấy Adsterra Smartlink, đang click chuyển trang...");
          const [newPage] = await Promise.all([
            context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
            smartlink.click({ timeout: 5000, force: true }).catch(() => null),
          ]);
          if (newPage) {
            openedPage = newPage;
            adClicked = true;
            log("✓ Đã mở tab quảng cáo Smartlink thành công.");
          } else {
            await sleep(3000);
            const allPages = context.pages();
            if (allPages.length > 1) {
              openedPage = allPages[allPages.length - 1];
              adClicked = true;
              log("✓ Đã bắt được trang quảng cáo Smartlink từ tab phụ.");
            }
          }
        }
      } catch (err) {
        log(`Thử click Smartlink gặp lỗi: ${err instanceof Error ? err.message : String(err)}`);
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
      for (const selector of candidateSelectors) {
        const elements = await page.$$(selector);
        for (const el of elements) {
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
    log(`Lỗi trong chu kỳ xem quảng cáo: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    // Dọn dẹp triệt để thư mục profile (xoá sạch cache + cookies)
    try {
      rmSync(profileDir, { recursive: true, force: true });
      log("✓ Đã dọn dẹp cache và cookies.");
    } catch {
      // bỏ qua lỗi dọn temp
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
