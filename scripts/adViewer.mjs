#!/usr/bin/env node
/**
 * XEM QUẢNG CÁO TỰ ĐỘNG — trình duyệt Obscura tự động xem và tương tác quảng cáo trên website.
 *
 * Chạy trên GitHub Actions runner và máy cục bộ sử dụng Obscura headless browser (Rust/V8)
 * kết nối qua giao thức Chrome DevTools Protocol (CDP).
 *
 * Điểm cốt lõi:
 *   1. Không bật cờ `--stealth` trên Obscura để tránh cơ chế Tracker Blocking chặn mất quảng cáo Adsterra.
 *   2. Tích hợp module CanvasBlocker qua CDP Init Script (`page.addInitScript`) gieo nhiễu canvas/webgl
 *      chống theo dõi fingerprinting xuyên chu kỳ mà không cần Chrome extension.
 *   3. Mỗi chu kỳ:
 *      - Khởi động Obscura CDP server (`obscura serve --port <port> --allow-private-network`)
 *      - Kết nối Playwright qua `chromium.connectOverCDP`
 *      - Nạp CanvasBlocker init script
 *      - Tải trang chủ website (`WEB_URL`)
 *      - Chờ các vị trí quảng cáo (Adsterra banner 728x90, native ads, Smartlink, popunder) tải đầy đủ
 *      - Kiểm tra và xác nhận trạng thái hiển thị của banner và native creative
 *      - Click vào quảng cáo / Smartlink để điều hướng tới trang đích
 *      - Dừng ngẫu nhiên 5-10s để đọc trang quảng cáo chính
 *      - Nếu trang quảng cáo có quảng cáo tiếp, click đệ quy tối đa 2 lần nữa
 *      - Đóng kết nối browser và tắt tiến trình Obscura server bằng killProcessTree
 *      - Bắt đầu chu kỳ mới cho đến khi hết tuổi thọ ca trực
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { getCanvasBlockerInitScript } from "./obscuraCanvasBlocker.mjs";

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

function killProcessTree(proc) {
  if (!proc) return;
  try {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

async function safeQueryAll(page, selector, timeoutMs = 3000) {
  try {
    return await Promise.race([
      page.$$(selector),
      new Promise((_, reject) => setTimeout(() => reject(new Error("query timeout")), timeoutMs)),
    ]);
  } catch {
    return [];
  }
}

export function resolveObscuraBin() {
  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "obscura.exe" : "obscura";

  const candidates = [
    process.env.OBSCURA_BIN,
    path.join(__dirname, binaryName),
    path.join(__dirname, "bin", binaryName),
    path.join(__dirname, "obscura", binaryName),
    path.join(process.env.RUNNER_TEMP || tmpdir(), "xem-qc-runtime", "bin", binaryName),
    path.join(process.env.RUNNER_TEMP || tmpdir(), "xem-qc-runtime", binaryName),
    path.join(tmpdir(), "obscura-spike", "bin", binaryName),
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  // Thử gọi trực tiếp từ PATH nếu có
  return binaryName;
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
  const [bannerReadyFound, nativeReadyFound] = await Promise.all([
    page
      .waitForSelector(BANNER_READY_SELECTOR, { timeout: AD_READY_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false),
    page
      .waitForSelector(NATIVE_READY_SELECTOR, { timeout: AD_READY_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false),
  ]);

  const bannerSlot = page.locator(BANNER_SLOT_SELECTOR);
  const nativeSlot = page.locator(NATIVE_SLOT_SELECTOR);

  const bannerSlotBox = await bannerSlot.boundingBox().catch(() => null);
  const nativeSlotBox = await nativeSlot.boundingBox().catch(() => null);

  const bannerRawStatus =
    (await bannerSlot.getAttribute("data-status").catch(() => null)) ?? "missing";
  const nativeRawStatus =
    (await nativeSlot.getAttribute("data-status").catch(() => null)) ?? "missing";

  const bannerIframe = page.locator(`${BANNER_SLOT_SELECTOR} iframe[width="728"][height="90"], ${BANNER_SLOT_SELECTOR} iframe`).first();
  const bannerIframeFound = (await bannerIframe.count().catch(() => 0)) > 0;
  const bannerIframeBox = bannerIframeFound ? await bannerIframe.boundingBox().catch(() => null) : null;

  let bannerCreativeCount = 0;
  if (bannerIframeFound) {
    const handle = await bannerIframe.elementHandle().catch(() => null);
    const frame = handle ? await handle.contentFrame().catch(() => null) : null;
    if (frame) {
      await frame.waitForSelector("a[href], a[href] img", { timeout: 3000 }).catch(() => {});
      bannerCreativeCount = await frame.locator("a[href], a[href] img").count().catch(() => 0);
    }
  }

  const nativeContainer = page.locator(`${NATIVE_SLOT_SELECTOR} #${NATIVE_CONTAINER_ID}, ${NATIVE_SLOT_SELECTOR} [id*="container-"]`);
  const nativeContainerFound = (await nativeContainer.count().catch(() => 0)) > 0;

  let nativeCount = 0;
  if (nativeContainerFound) {
    await page
      .waitForSelector(
        `${NATIVE_SLOT_SELECTOR} #${NATIVE_CONTAINER_ID} a[href], ${NATIVE_SLOT_SELECTOR} [class*="__bn-container"]`,
        { timeout: 3000 },
      )
      .catch(() => {});
    nativeCount = await page
      .locator(
        `${NATIVE_SLOT_SELECTOR} #${NATIVE_CONTAINER_ID} a[href], ${NATIVE_SLOT_SELECTOR} [class*="__bn-container"], ${NATIVE_SLOT_SELECTOR} a[href]`,
      )
      .count()
      .catch(() => 0);
  }
  const nativeCreativeCount = nativeCount;

  const banner = {
    status: classifyPlacement(bannerRawStatus, bannerReadyFound, bannerCreativeCount),
    rawStatus: bannerRawStatus,
    readySelectorFound: bannerReadyFound,
    creativeCount: bannerCreativeCount,
    iframe728x90: bannerIframeFound,
    slotBox: bannerSlotBox,
    iframeBox: bannerIframeBox,
  };

  const native = {
    status: classifyPlacement(nativeRawStatus, nativeReadyFound, nativeCreativeCount),
    rawStatus: nativeRawStatus,
    readySelectorFound: nativeReadyFound,
    creativeCount: nativeCreativeCount,
    containerFound: nativeContainerFound,
    slotBox: nativeSlotBox,
  };

  return {
    renderMs: Date.now() - startedAt,
    banner,
    native,
    allReady: banner.status === "ready" && native.status === "ready",
    bannerIframeFound,
    bannerIframe,
    nativeContainerFound,
  };
}

async function handleRecursiveAdClicks(targetPage, depth, maxDepth) {
  if (depth >= maxDepth) return;

  try {
    const nextAdSelectors = [
      'a[href*="google"]',
      'a[href*="doubleclick"]',
      'a[href*="adsterra"]',
      'a[href*="alwingulla"]',
      'a[href*="deliberatewatchful.com"]',
      'a[href*="smartlink"]',
      'iframe[src*="ad"]',
      'a[target="_blank"]',
    ];

    let clicked = false;
    for (const sel of nextAdSelectors) {
      const candidates = await safeQueryAll(targetPage, sel, 2500);
      for (const cand of candidates) {
        try {
          const visible = await Promise.race([
            cand.isVisible().catch(() => false),
            sleep(1500).then(() => false),
          ]);
          if (visible) {
            log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Tìm thấy quảng cáo khớp [${sel}], click tiếp...`);
            await Promise.race([
              cand.click({ timeout: 4000, force: true }).catch(() => null),
              sleep(4500),
            ]);
            clicked = true;
            break;
          }
        } catch {
          // thử tiếp
        }
      }
      if (clicked) break;
    }

    if (clicked) {
      await targetPage.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      const dwell = rand(DELAY_MIN_MS, DELAY_MAX_MS);
      log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Dừng xem trang quảng cáo kế tiếp trong ${Math.round(dwell / 1000)}s...`);
      await sleep(dwell);
      await handleRecursiveAdClicks(targetPage, depth + 1, maxDepth);
    } else {
      log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Không tìm thấy liên kết quảng cáo tiếp theo.`);
    }
  } catch (err) {
    log(`  Lỗi trong bước đệ quy click: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function startObscuraServer(binPath, port) {
  log(`Khởi động Obscura CDP server (port ${port}, --allow-private-network)...`);
  const server = spawn(binPath, ["serve", "--port", String(port), "--allow-private-network", "--quiet"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout?.on("data", (d) => {
    const text = d.toString().trim();
    if (text) log(`[obscura] ${text}`);
  });
  server.stderr?.on("data", (d) => {
    const text = d.toString().trim();
    if (text && !text.includes("DEBUG") && !text.includes("WARN")) {
      log(`[obscura err] ${text}`);
    }
  });

  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();
  let ready = false;

  while (Date.now() - startedAt < 15000) {
    try {
      const res = await fetch(versionUrl, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // chờ server khởi động
    }
    await sleep(300);
  }

  if (!ready) {
    killProcessTree(server);
    throw new Error(`Obscura CDP server trên port ${port} không phản hồi sau 15s.`);
  }

  log(`✓ Obscura CDP server đã sẵn sàng trên cổng ${port}.`);
  return server;
}

async function runOneCycle(obscuraBin) {
  const port = 9222 + rand(0, 50);
  let server = null;
  let browser = null;

  try {
    server = await startObscuraServer(obscuraBin, port);
    log(`Kết nối Playwright tới Obscura qua CDP ws://127.0.0.1:${port}...`);
    browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    // Nạp CanvasBlocker CDP init script
    const cycleSeed = Date.now();
    await page.addInitScript(getCanvasBlockerInitScript(cycleSeed));
    log("✓ Đã nạp CDP CanvasBlocker init script chống fingerprinting cho Obscura.");

    const renderStartedAt = Date.now();
    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    // Cuộn nhẹ trang để kích hoạt các script lazy-load quảng cáo
    await page.evaluate(() => {
      window.scrollBy({ top: 300, behavior: "smooth" });
    });
    await sleep(1000);

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
    const initialUrl = page.url();

    // 1. Thử click native ads nếu ready
    if (diagnostic.native.status === "ready") {
      try {
        const nativeLinks = page.locator(`${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID} a[target="_blank"], ${NATIVE_READY_SELECTOR} a`);
        const count = await nativeLinks.count().catch(() => 0);
        if (count > 0) {
          log("Tìm thấy native ad card, đang click chuyển trang...");
          const [newPage] = await Promise.all([
            context.waitForEvent("page", { timeout: 6000 }).catch(() => null),
            nativeLinks.first().click({ timeout: 5000, force: true }).catch(() => null),
          ]);
          if (newPage) {
            openedPage = newPage;
            adClicked = true;
            log("✓ Đã mở tab quảng cáo native thành công.");
          } else {
            await sleep(2000);
            const allPages = context.pages();
            if (allPages.length > 1) {
              openedPage = allPages[allPages.length - 1];
              adClicked = true;
              log("✓ Đã bắt được trang quảng cáo native từ tab phụ.");
            } else if (page.url() !== initialUrl && !page.url().includes("auto-hh3d.online")) {
              openedPage = page;
              adClicked = true;
              log("✓ Trình duyệt Obscura đã chuyển hướng tới trang đích native.");
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
              context.waitForEvent("page", { timeout: 6000 }).catch(() => null),
              bannerLink.click({ timeout: 5000, force: true }).catch(() => null),
            ]);
            if (newPage) {
              openedPage = newPage;
              adClicked = true;
              log("✓ Đã mở tab quảng cáo banner thành công.");
            } else {
              await sleep(2000);
              const allPages = context.pages();
              if (allPages.length > 1) {
                openedPage = allPages[allPages.length - 1];
                adClicked = true;
                log("✓ Đã bắt được trang quảng cáo banner từ tab phụ.");
              } else if (page.url() !== initialUrl && !page.url().includes("auto-hh3d.online")) {
                openedPage = page;
                adClicked = true;
                log("✓ Trình duyệt Obscura đã chuyển hướng tới trang đích banner.");
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
            context.waitForEvent("page", { timeout: 6000 }).catch(() => null),
            smartlink.click({ timeout: 5000, force: true }).catch(() => null),
          ]);
          if (newPage) {
            openedPage = newPage;
            adClicked = true;
            log("✓ Đã mở tab quảng cáo Smartlink thành công.");
          } else {
            await sleep(2000);
            const allPages = context.pages();
            if (allPages.length > 1) {
              openedPage = allPages[allPages.length - 1];
              adClicked = true;
              log("✓ Đã bắt được trang quảng cáo Smartlink từ tab phụ.");
            } else if (page.url() !== initialUrl && !page.url().includes("auto-hh3d.online")) {
              openedPage = page;
              adClicked = true;
              log("✓ Trình duyệt Obscura đã chuyển hướng tới trang đích Smartlink.");
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
        const elements = await safeQueryAll(page, selector, 2000);
        for (const el of elements) {
          try {
            const visible = await Promise.race([
              el.isVisible().catch(() => false),
              sleep(1500).then(() => false),
            ]);
            if (visible) {
              log(`Tìm thấy quảng cáo khớp [${selector}], đang click chuyển trang...`);
              const [newPage] = await Promise.all([
                context.waitForEvent("page", { timeout: 6000 }).catch(() => null),
                el.click({ timeout: 5000, force: true }).catch(() => null),
              ]);
              if (newPage) {
                openedPage = newPage;
                adClicked = true;
                log("✓ Đã mở tab quảng cáo đích thành công.");
                break;
              } else {
                await sleep(2000);
                const allPages = context.pages();
                if (allPages.length > 1) {
                  openedPage = allPages[allPages.length - 1];
                  adClicked = true;
                  log("✓ Đã bắt được trang quảng cáo từ tab phụ.");
                  break;
                } else if (page.url() !== initialUrl && !page.url().includes("auto-hh3d.online")) {
                  openedPage = page;
                  adClicked = true;
                  log("✓ Trình duyệt Obscura đã chuyển hướng tới trang đích dự phòng.");
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

    // 5. Click ngẫu nhiên để kích hoạt popunder nếu chưa click được
    if (!adClicked) {
      log("Không click được quảng cáo cụ thể bằng selector; kích hoạt click mô phỏng trên trang...");
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
        page.mouse.click(rand(200, 600), rand(200, 500)).catch(() => null),
      ]);
      if (popup) {
        openedPage = popup;
        adClicked = true;
        log("✓ Popunder đã được kích hoạt.");
      } else if (page.url() !== initialUrl && !page.url().includes("auto-hh3d.online")) {
        openedPage = page;
        adClicked = true;
        log("✓ Popunder đã chuyển hướng trên trang hiện tại.");
      }
    }

    // 6. Đọc trang quảng cáo chính và đệ quy click nếu có
    if (openedPage) {
      log(`✓ Đang tương tác trên trang đích quảng cáo: ${openedPage.url()}`);
      await openedPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      const readingMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
      log(`Dừng đọc trang quảng cáo chính trong ${Math.round(readingMs / 1000)}s...`);
      await sleep(readingMs);

      // Đệ quy click thêm nếu còn quảng cáo trên trang đích (tối đa MAX_RECURSIVE_CLICKS)
      if (MAX_RECURSIVE_CLICKS > 0) {
        await handleRecursiveAdClicks(openedPage, 0, MAX_RECURSIVE_CLICKS);
      }

      if (openedPage !== page) {
        await openedPage.close().catch(() => {});
      }
    } else {
      log("Chu kỳ này chỉ xem quảng cáo trên trang, không có tab chuyển hướng mới.");
    }
  } catch (err) {
    log(`Lỗi trong chu kỳ xem quảng cáo: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (browser) {
      await Promise.race([browser.close(), sleep(2000)]).catch(() => {});
    }
    killProcessTree(server);
    await sleep(1000);
  }
}

async function main() {
  log(`Bắt đầu tiến trình xem quảng cáo Obscura ID=${VIEWER_ID}`);
  log(`Mục tiêu: ${WEB_URL}, Tuổi thọ tối đa: ${Math.round(MAX_LIFETIME_MS / 60000)} phút`);
  log(`Browser engine: Obscura CDP server (chạy không bật --stealth để xem ads)`);

  const obscuraBin = resolveObscuraBin();
  log(`✓ Nhận diện đường dẫn binary Obscura: ${obscuraBin}`);
  log(`✓ Tích hợp module chống fingerprinting CanvasBlocker qua CDP init script.`);

  const startTime = Date.now();
  let cycle = 0;

  while (Date.now() - startTime < MAX_LIFETIME_MS) {
    cycle++;
    log(`\n=================== BẮT ĐẦU CHU KỲ ${cycle} ===================`);
    await runOneCycle(obscuraBin);

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
