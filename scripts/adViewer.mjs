#!/usr/bin/env node
/**
 * XEM QUẢNG CÁO TỰ ĐỘNG — trình duyệt tự động xem và tương tác quảng cáo trên website.
 *
 * Chạy trên GitHub Actions runner theo kiến trúc hybrid giống khôi lỗi linh-su.
 * Mỗi chu kỳ:
 *   1. Mở Chromium với profile tạm thời và nạp tiện ích CanvasBlocker
 *   2. Vào trang chủ website (WEB_URL)
 *   3. Đợi các vị trí quảng cáo (Adsterra banner, native, social bar, popunder) tải đầy đủ
 *   4. Click vào quảng cáo để mở trang đích trên tab mới
 *   5. Dừng ngẫu nhiên 5-10s để đọc trang quảng cáo
 *   6. Nếu trang quảng cáo có quảng cáo tiếp, click đệ quy tối đa 2 lần nữa
 *   7. Đóng trình duyệt, xoá sạch cache và cookies
 *   8. Bắt đầu chu kỳ mới cho đến khi hết tuổi thọ ca trực
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
const MAX_LIFETIME_MS = Math.max(60_000, Number(process.env.AD_VIEWER_MAX_LIFETIME_MS ?? 17_400_000) || 17_400_000);
const DELAY_MIN_MS = Math.max(1000, Number(process.env.AD_VIEWER_DELAY_MIN_MS ?? 5000) || 5000);
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, Number(process.env.AD_VIEWER_DELAY_MAX_MS ?? 10000) || 10000);
const MAX_RECURSIVE_CLICKS = Math.max(0, Math.min(5, Number(process.env.AD_VIEWER_MAX_RECURSIVE_CLICKS ?? 2) || 2));
const SELF_UPDATE = process.env.AD_VIEWER_SELF_UPDATE === "1";

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

    // Playwright persistent context nạp extension
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chromium",
      args: [...args, "--headless=new"],
      viewport: { width: 1366, height: 768 },
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    });

    const page = context.pages()[0] || (await context.newPage());

    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Cuộn nhẹ trang để kích hoạt các script lazy-load quảng cáo
    await page.evaluate(() => {
      window.scrollBy({ top: 300, behavior: "smooth" });
    });

    const loadWaitMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
    log(`Đợi quảng cáo tải đầy đủ (${Math.round(loadWaitMs / 1000)}s)...`);
    await sleep(loadWaitMs);

    // Cuộn tiếp xuống phần thân trang
    await page.evaluate(() => {
      window.scrollBy({ top: 500, behavior: "smooth" });
    });
    await sleep(2000);

    // Danh sách bộ chọn quảng cáo cần tương tác:
    // 1. Iframe Adsterra 728x90, banner, social bar
    // 2. Container native ads
    // 3. Smartlink anchor tag
    // 4. Các iframe quảng cáo khác
    const candidateSelectors = [
      'iframe[width="728"]',
      'iframe[src*="alwingulla"]',
      'iframe[src*="adsterra"]',
      'a[href*="alwingulla"]',
      'a[href*="smartlink"]',
      '[class*="adsterra"] iframe',
      '[id*="container-"] iframe',
      '[id*="container-"] a',
      '#adsterra-native a',
      'a[target="_blank"]',
    ];

    let adClicked = false;
    let openedPage = null;

    for (const selector of candidateSelectors) {
      const elements = await page.$$(selector);
      for (const el of elements) {
        try {
          const visible = await el.isVisible().catch(() => false);
          if (visible) {
            log(`Tìm thấy quảng cáo khớp [${selector}], đang click chuyển trang...`);

            // Đón trang mới mở ra khi click
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
              // Click có thể đã kích hoạt chuyển hướng hoặc popunder
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

    if (!adClicked) {
      log("Không click được quảng cáo cụ thể bằng selector; kích hoạt click mô phỏng trên trang...");
      // Click ngẫu nhiên vào khu vực nội dung để kích hoạt popunder nếu có
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
