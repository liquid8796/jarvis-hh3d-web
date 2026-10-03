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

import { AsyncLocalStorage } from "node:async_hooks";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium as vanillaChromium } from "playwright-core";
import {
  fingerprintInitScript,
  materializeFingerprint,
  parseBrowserList,
  parseDeviceMode,
  pickFingerprintProfile,
} from "./adViewerFingerprint.mjs";

let chromium = vanillaChromium;
let isPatchedEngine = false;
try {
  const patchModule = await import("patchright");
  if (patchModule?.chromium) {
    chromium = patchModule.chromium;
    isPatchedEngine = true;
  }
} catch {
  // Dùng fallback playwright-core nếu không có patchright
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_URL = (process.env.WEB_URL ?? "https://auto-hh3d.online").replace(/\/$/, "");
const FALLBACK_URL = (process.env.WORKER_FALLBACK_URL ?? "").replace(/\/$/, "");
const VIEWER_ID = process.env.AD_VIEWER_ID ?? "github-xem-qc";
const rawLifetimeMin = process.argv.find((a) => a.startsWith("--max-lifetime-min="))?.split("=")[1];
const rawLifetimeMs = process.argv.find((a) => a.startsWith("--max-lifetime-ms="))?.split("=")[1];
const MAX_LIFETIME_MS = Math.max(
  60_000,
  rawLifetimeMin
    ? Number(rawLifetimeMin) * 60_000
    : Number(rawLifetimeMs || process.env.AD_VIEWER_MAX_LIFETIME_MS || 17_400_000) || 17_400_000,
);

const rawDelayMin = process.argv.find((a) => a.startsWith("--delay-min="))?.split("=")[1];
const rawDelayMinMs = process.argv.find((a) => a.startsWith("--delay-min-ms="))?.split("=")[1];
const DELAY_MIN_MS = Math.max(
  1000,
  rawDelayMin
    ? Number(rawDelayMin) * 1000
    : Number(rawDelayMinMs || process.env.AD_VIEWER_DELAY_MIN_MS || 5000) || 5000,
);

const rawDelayMax = process.argv.find((a) => a.startsWith("--delay-max="))?.split("=")[1];
const rawDelayMaxMs = process.argv.find((a) => a.startsWith("--delay-max-ms="))?.split("=")[1];
const DELAY_MAX_MS = Math.max(
  DELAY_MIN_MS,
  rawDelayMax
    ? Number(rawDelayMax) * 1000
    : Number(rawDelayMaxMs || process.env.AD_VIEWER_DELAY_MAX_MS || 10000) || 10000,
);

const rawRecursive = process.argv.find((a) => a.startsWith("--max-recursive-clicks="))?.split("=")[1];
const envRecursive = process.env.AD_VIEWER_MAX_RECURSIVE_CLICKS;
const parsedRecursive =
  rawRecursive !== undefined && rawRecursive !== ""
    ? Number(rawRecursive)
    : envRecursive !== undefined && envRecursive !== ""
    ? Number(envRecursive)
    : 2;
const MAX_RECURSIVE_CLICKS = Math.max(0, Math.min(5, Number.isNaN(parsedRecursive) ? 2 : parsedRecursive));
const AD_READY_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.AD_VIEWER_AD_READY_TIMEOUT_MS ?? 15_000) || 15_000,
);
function getCliArg(flag) {
  const withEq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1).trim();
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1].trim();
  }
  return "";
}

const rawClearCacheCycles =
  getCliArg("--clear-cache-cycles") ||
  getCliArg("--clean-cycles") ||
  process.argv.find((a) => a.startsWith("--clear-cache-cycles="))?.split("=")[1] ||
  process.argv.find((a) => a.startsWith("--clean-cycles="))?.split("=")[1];
const envClearCacheCycles =
  process.env.AD_VIEWER_CLEAR_CACHE_CYCLES || process.env.AD_VIEWER_CLEAN_CYCLES;
const parsedClearCacheCycles = Number(rawClearCacheCycles || envClearCacheCycles || 1);
const CLEAR_CACHE_CYCLES = Math.max(
  0,
  Number.isNaN(parsedClearCacheCycles) ? 1 : Math.floor(parsedClearCacheCycles),
);

const rawInstances =
  getCliArg("--instances") ||
  getCliArg("--instance-count") ||
  getCliArg("--threads") ||
  process.argv.find((a) => a.startsWith("--instances="))?.split("=")[1] ||
  process.argv.find((a) => a.startsWith("--instance-count="))?.split("=")[1];
const envInstances = process.env.AD_VIEWER_INSTANCES || process.env.AD_VIEWER_INSTANCE_COUNT;
const parsedInstances = Number(rawInstances || envInstances || 1);
const INSTANCE_COUNT = Math.max(1, Math.min(10, Number.isNaN(parsedInstances) ? 1 : Math.floor(parsedInstances)));

// Vân tay thiết bị + trình duyệt ngẫu nhiên. Một danh tính sống đúng bằng một cửa sổ cookie
// (CLEAR_CACHE_CYCLES chu kỳ): khách quay lại với cùng cookie mà đổi máy/trình duyệt mỗi vòng
// là một dấu hiệu bất thường rõ hơn cả việc không đổi gì.
const FINGERPRINT_ENABLED =
  !process.argv.includes("--no-fingerprint") && process.env.AD_VIEWER_FINGERPRINT !== "0";
const DEVICE_MODE = parseDeviceMode(getCliArg("--device") || process.env.AD_VIEWER_DEVICE);
const BROWSER_SELECTION = parseBrowserList(getCliArg("--browsers") || getCliArg("--browser") || process.env.AD_VIEWER_BROWSERS);
const rawMobileRatio = Number(getCliArg("--mobile-ratio") || process.env.AD_VIEWER_MOBILE_RATIO || 50);
const MOBILE_RATIO = Math.min(1, Math.max(0, (Number.isNaN(rawMobileRatio) ? 50 : rawMobileRatio) / 100));

const rawPageTimeout = getCliArg("--page-timeout");
const defaultPageTimeout = process.argv.some((a) => a.includes("proxy")) || process.env.AD_VIEWER_PROXY ? 35_000 : 25_000;
const parsedPageTimeout = Number(rawPageTimeout || process.env.AD_VIEWER_PAGE_TIMEOUT_MS || defaultPageTimeout);
const PAGE_GOTO_TIMEOUT_MS = Math.max(
  10_000,
  Number.isNaN(parsedPageTimeout) ? defaultPageTimeout : parsedPageTimeout,
);
const rawReadingTimeout = getCliArg("--reading-timeout");
const parsedReadingTimeout = Number(rawReadingTimeout || process.env.AD_VIEWER_READING_TIMEOUT_MS || 3_000);
const MAX_READING_BEFORE_CLICK_MS = Math.max(
  1_000,
  Number.isNaN(parsedReadingTimeout) ? 3_000 : parsedReadingTimeout,
);
const SELF_UPDATE = process.env.AD_VIEWER_SELF_UPDATE === "1";
const ENABLE_DEV_MODE = process.env.AD_VIEWER_ENABLE_DEV_MODE !== "0";

const BANNER_SLOT_SELECTOR = ".adsterra-leaderboard";
const BANNER_READY_SELECTOR = '.adsterra-leaderboard[data-status="ready"]';
const NATIVE_SLOT_SELECTOR = ".adsterra-native";
const NATIVE_READY_SELECTOR = '.adsterra-native[data-status="ready"]';
const NATIVE_CONTAINER_ID = "container-5e6634da84f8f263d7ab34ae152f1c8d";

const rawClickMode = (
  process.argv.find((a) => a.startsWith("--click-mode="))?.split("=")[1] ||
  process.env.AD_VIEWER_CLICK_MODE ||
  ""
).toLowerCase();

let CLICK_MODE = "cdp";
if (rawClickMode === "mouse") {
  CLICK_MODE = "mouse";
} else if (
  rawClickMode === "ghub" ||
  rawClickMode === "logitech" ||
  process.argv.includes("--ghub") ||
  process.argv.includes("--logitech")
) {
  CLICK_MODE = "ghub";
} else if (
  rawClickMode === "os" ||
  rawClickMode === "os-mouse" ||
  rawClickMode === "win32" ||
  process.argv.includes("--os-mouse") ||
  process.argv.includes("--win32-mouse")
) {
  CLICK_MODE = "os-mouse";
} else if (
  rawClickMode === "manual" ||
  rawClickMode === "hand" ||
  rawClickMode === "semi-auto" ||
  process.argv.includes("--manual") ||
  process.argv.includes("--semi-auto")
) {
  CLICK_MODE = "manual";
} else if (rawClickMode === "cdp") {
  CLICK_MODE = "cdp";
} else if (
  process.platform === "win32" &&
  (process.argv.includes("--my-chrome") || process.env.USE_MY_CHROME === "1")
) {
  CLICK_MODE = "os-mouse";
}

function parseHoverConfig() {
  const cliHover = getCliArg("--hover");
  const cliHoverSec = getCliArg("--hover-sec");
  const cliHoverMs = getCliArg("--hover-ms");
  const cliHoverMinMs = getCliArg("--hover-min-ms");
  const cliHoverMaxMs = getCliArg("--hover-max-ms");

  const envHover = process.env.AD_VIEWER_HOVER;
  const envHoverSec = process.env.AD_VIEWER_HOVER_SEC;
  const envHoverMs = process.env.AD_VIEWER_HOVER_MS;
  const envHoverMinMs = process.env.AD_VIEWER_HOVER_MIN_MS;
  const envHoverMaxMs = process.env.AD_VIEWER_HOVER_MAX_MS;

  // 1. Min / Max rõ ràng
  const minRaw = cliHoverMinMs || envHoverMinMs;
  const maxRaw = cliHoverMaxMs || envHoverMaxMs;
  if (minRaw || maxRaw) {
    const minVal = Math.max(0, Number(minRaw || maxRaw || 1200));
    const maxVal = Math.max(minVal, Number(maxRaw || minRaw || 2500));
    return { minMs: minVal, maxMs: maxVal, userSpecified: true };
  }

  // 2. Tham số milli-giây (--hover-ms)
  const msRaw = cliHoverMs || envHoverMs;
  if (msRaw) {
    const parts = String(msRaw).split(/[-–—]|(\.\.)/g).filter(Boolean).map((p) => Number(p.trim()));
    const validParts = parts.filter((p) => Number.isFinite(p) && p >= 0);
    if (validParts.length >= 2) {
      return {
        minMs: Math.min(validParts[0], validParts[validParts.length - 1]),
        maxMs: Math.max(validParts[0], validParts[validParts.length - 1]),
        userSpecified: true,
      };
    }
    if (validParts.length === 1) {
      return { minMs: validParts[0], maxMs: validParts[0], userSpecified: true };
    }
  }

  // 3. Tham số giây (--hover-sec)
  const secRaw = cliHoverSec || envHoverSec;
  if (secRaw) {
    const parts = String(secRaw).split(/[-–—]|(\.\.)/g).filter(Boolean).map((p) => Number(p.trim()));
    const validParts = parts.filter((p) => Number.isFinite(p) && p >= 0);
    if (validParts.length >= 2) {
      const min = Math.round(Math.min(validParts[0], validParts[validParts.length - 1]) * 1000);
      const max = Math.round(Math.max(validParts[0], validParts[validParts.length - 1]) * 1000);
      return { minMs: min, maxMs: max, userSpecified: true };
    }
    if (validParts.length === 1) {
      const ms = Math.round(validParts[0] * 1000);
      return { minMs: ms, maxMs: ms, userSpecified: true };
    }
  }

  // 4. Tham số tổng quát (--hover) — tự động phân biệt giây và ms
  const generalRaw = cliHover || envHover;
  if (generalRaw) {
    const parseUnitVal = (valStr) => {
      const s = String(valStr).trim().toLowerCase();
      if (s.endsWith("ms")) {
        const n = Number(s.slice(0, -2));
        return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
      }
      if (s.endsWith("s")) {
        const n = Number(s.slice(0, -1));
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
      }
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) return null;
      return n >= 100 ? Math.round(n) : Math.round(n * 1000);
    };

    const parts = String(generalRaw).split(/[-–—]|(\.\.)/g).filter(Boolean).map((p) => parseUnitVal(p.trim()));
    const validParts = parts.filter((p) => p !== null);
    if (validParts.length >= 2) {
      return {
        minMs: Math.min(validParts[0], validParts[validParts.length - 1]),
        maxMs: Math.max(validParts[0], validParts[validParts.length - 1]),
        userSpecified: true,
      };
    }
    if (validParts.length === 1) {
      return { minMs: validParts[0], maxMs: validParts[0], userSpecified: true };
    }
  }

  // Mặc định: 1200ms - 2500ms
  return { minMs: 1200, maxMs: 2500, userSpecified: false };
}

const HOVER_CONFIG = parseHoverConfig();

function resolveHoverMs() {
  if (HOVER_CONFIG.minMs === HOVER_CONFIG.maxMs) {
    return HOVER_CONFIG.minMs;
  }
  return rand(HOVER_CONFIG.minMs, HOVER_CONFIG.maxMs);
}

const USE_CANVAS_BLOCKER =
  process.argv.includes("--canvas-blocker") ||
  process.argv.includes("--with-canvas-blocker") ||
  process.env.AD_VIEWER_CANVAS_BLOCKER === "1";

const PROXY_FILE = (
  getCliArg("--proxy-file") ||
  process.env.AD_VIEWER_PROXY_FILE ||
  ""
).trim();

const DIRECT_PROXY = (
  getCliArg("--proxy") ||
  process.env.AD_VIEWER_PROXY ||
  ""
).trim();

const ROTATE_URL = (
  getCliArg("--rotate-url") ||
  process.env.AD_VIEWER_ROTATE_URL ||
  ""
).trim();

const NO_PROXY =
  process.argv.includes("--no-proxy") ||
  process.env.AD_VIEWER_NO_PROXY === "1";

const PROXY_SHUFFLE =
  process.argv.includes("--proxy-shuffle") ||
  process.env.AD_VIEWER_PROXY_SHUFFLE === "1";

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, fallbackValue = null) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
  });
  return Promise.race([
    Promise.resolve(promise)
      .then((val) => {
        clearTimeout(timer);
        return val;
      })
      .catch(() => {
        clearTimeout(timer);
        return fallbackValue;
      }),
    timeoutPromise,
  ]);
}

const logContext = new AsyncLocalStorage();

function log(msg) {
  const ts = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const instId = logContext.getStore()?.instanceId;
  const tag = INSTANCE_COUNT > 1 && instId ? `[${VIEWER_ID}#${instId}]` : `[${VIEWER_ID}]`;
  console.log(`[${ts}] ${tag} ${msg}`);
}

class AsyncMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire(tag = "") {
    return new Promise((resolve) => {
      const ticket = () => {
        this._locked = true;
        resolve(() => this.release());
      };
      if (!this._locked) {
        this._locked = true;
        resolve(() => this.release());
      } else {
        this._queue.push(ticket);
      }
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }

  get isLocked() {
    return this._locked;
  }

  get queueLength() {
    return this._queue.length;
  }
}

const mouseMutex = new AsyncMutex();

// ---- LƯỢT CHUỘT THEO CHU KỲ (03/10/2026) ----
// Bản đầu khoá chuột theo TỪNG cú click: click xong là nhả. Khi chạy nhiều instance, instance A
// vừa mở trang đích thì B chen vào click, rồi A quay lại click đệ quy trên trang đích, rồi C...
// — các chu kỳ đan xen nhau, một chu kỳ bị click hai lần và ai cũng phải chờ lặp lại. Nay lượt
// chuột thuộc về CẢ CHU KỲ: instance nào click đầu tiên thì giữ chuột cho tới khi chu kỳ của nó
// kết thúc hẳn (đọc trang đích, click đệ quy, đóng tab, dọn trình duyệt). Các instance khác vẫn
// tải trang và chờ quảng cáo song song, chỉ xếp hàng ở bước dùng chuột.
/** instanceId → hàm nhả lượt đang giữ. */
const cycleTurns = new Map();
/** Instance đang giữ lượt chuột (null = rảnh). */
let turnHolder = null;

function isPhysicalClickMode(mode) {
  return (mode === "os-mouse" || mode === "ghub" || mode === "manual" || mode === "mouse") && process.platform === "win32";
}

/**
 * Gắn nhãn [AdViewer-Inst-$instanceId] vào tiêu đề cửa sổ / document.title
 * để winMouse.ps1 định vị chính xác cửa sổ tương ứng trên Windows Desktop.
 */
async function tagInstancePage(page, instanceId = logContext.getStore()?.instanceId) {
  if (!page || !instanceId || instanceId <= 0) return;
  const tag = `[AdViewer-Inst-${instanceId}]`;
  try {
    await page.evaluate((t) => {
      try {
        if (!document.title.includes(t)) {
          document.title = `${t} ${document.title || "AdViewer"}`;
        }
        let el = document.querySelector("title");
        if (el && !el.textContent.includes(t)) {
          el.textContent = `${t} ${el.textContent}`;
        }
      } catch {}
    }, tag).catch(() => {});
  } catch {}
}

/**
 * Kích hoạt và phóng to chính xác cửa sổ Chrome thuộc instanceId lên hàng đầu trên Windows Desktop,
 * đồng thời thu nhỏ các cửa sổ Chrome của các instance khác xuống taskbar để không che khuất.
 */
function focusInstanceWindow(instanceId = logContext.getStore()?.instanceId) {
  if (process.platform !== "win32" || !instanceId || instanceId <= 0) return;
  const psScript = path.join(__dirname, "winMouse.ps1");
  if (!existsSync(psScript)) return;
  try {
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -instanceId ${instanceId} -targetX 0 -targetY 0 -click 0`,
      { stdio: "ignore", timeout: 8000 }
    );
  } catch {}
}

/**
 * Thu nhỏ (minimize) cửa sổ Chrome của instanceId xuống taskbar để không che khuất instance đang tương tác.
 */
function minimizeInstanceWindow(instanceId = logContext.getStore()?.instanceId) {
  if (process.platform !== "win32" || !instanceId || instanceId <= 0) return;
  const psScript = path.join(__dirname, "winMouse.ps1");
  if (!existsSync(psScript)) return;
  try {
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -instanceId ${instanceId} -minimize 1`,
      { stdio: "ignore", timeout: 6000 }
    );
  } catch {}
}

/**
 * Instance này có quyền tương tác màn hình / chuột / đưa cửa sổ lên foreground không?
 * - Nếu chạy đơn instance: Luôn được phép.
 * - Nếu chạy nhiều instance: Chỉ instance đang nắm lượt tương tác (turnHolder) mới được phép.
 */
function canInteractForeground(instanceId = logContext.getStore()?.instanceId) {
  if (INSTANCE_COUNT <= 1) return true;
  return turnHolder === instanceId;
}

async function acquireCycleTurn(instanceId, { quiet = false } = {}) {
  if (cycleTurns.has(instanceId)) return false;
  if (mouseMutex.isLocked && !quiet) {
    const holderDesc = turnHolder !== null ? `#${turnHolder}` : "khác";
    log(`[CycleTurn] Instance ${holderDesc} đang trong lượt click & kết thúc chu kỳ — chờ nó kết thúc chu kỳ (hàng đợi: ${mouseMutex.queueLength + 1})...`);
  }
  const unlock = await mouseMutex.acquire(`inst-${instanceId}`);
  cycleTurns.set(instanceId, unlock);
  turnHolder = instanceId;
  if (!quiet && INSTANCE_COUNT > 1) {
    log("[CycleTurn] ✓ Nhận lượt độc quyền tương tác quảng cáo — giữ tới khi kết thúc trọn chu kỳ này.");
  }
  return true;
}

function releaseCycleTurn(instanceId, { quiet = false } = {}) {
  const unlock = cycleTurns.get(instanceId);
  if (!unlock) return;
  cycleTurns.delete(instanceId);
  if (turnHolder === instanceId) turnHolder = null;
  if (!quiet && INSTANCE_COUNT > 1) {
    log("[CycleTurn] ✓ Kết thúc trọn chu kỳ — nhả lượt tương tác quảng cáo cho instance kế tiếp.");
  }
  unlock();
}

/**
 * Chạy một thao tác làm đổi cửa sổ foreground (mở trình duyệt mới...) khi không ai đang giữ lượt
 * chuột — mở một cửa sổ Chrome mới giữa lúc instance khác đang rê chuột thật sẽ cướp foreground và
 * làm cú click rơi sang cửa sổ khác.
 */
async function withForegroundSlot(instanceId, enabled, fn) {
  if (!enabled || cycleTurns.has(instanceId)) return fn();
  await acquireCycleTurn(instanceId, { quiet: true });
  try {
    return await fn();
  } finally {
    releaseCycleTurn(instanceId, { quiet: true });
  }
}

/**
 * Instance này có bị cấm giành foreground không (vì instance khác đang giữ lượt chuột)?
 * Truyền `instanceId` tường minh khi gọi từ callback sự kiện của Playwright — ở đó
 * AsyncLocalStorage không chắc còn mang ngữ cảnh của instance.
 */
function foregroundOwnedByOther(instanceId = logContext.getStore()?.instanceId) {
  if (INSTANCE_COUNT <= 1 || turnHolder === null) return false;
  return turnHolder !== instanceId;
}

// ============================================================
//  ANTI-DETECT PROXY ENGINE & AUTO-ROTATION MANAGER
//  Quản lý danh sách proxy, xoay proxy mỗi chu kỳ, chống phát hiện
//  và đồng bộ địa lý (Zero-Mismatch Triad: Geo + Timezone + Locale).
// ============================================================

const COUNTRY_TO_LOCALE = {
  VN: "vi-VN",
  US: "en-US",
  GB: "en-GB",
  DE: "de-DE",
  FR: "fr-FR",
  JP: "ja-JP",
  KR: "ko-KR",
  RU: "ru-RU",
  CN: "zh-CN",
  TW: "zh-TW",
  HK: "zh-HK",
  ES: "es-ES",
  MX: "es-MX",
  AR: "es-AR",
  BR: "pt-BR",
  IN: "en-IN",
  ID: "id-ID",
  TH: "th-TH",
  PH: "en-PH",
  SG: "en-SG",
  AU: "en-AU",
  CA: "en-CA",
  IT: "it-IT",
  NL: "nl-NL",
  PL: "pl-PL",
  TR: "tr-TR",
};

/**
 * Trợ thủ phân tích host và port. Trả về { host, port, isIp } nếu hợp lệ.
 */
function parseHostPort(str) {
  if (!str) return null;
  const lastColon = str.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const host = str.slice(0, lastColon).trim().replace(/^\[|\]$/g, "");
  const portStr = str.slice(lastColon + 1).trim();
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (isIpv4) {
    const octets = host.split(".").map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return { host, port, isIp: true };
    }
    return null;
  }
  const isIpv6 = host.includes(":") && /^[0-9a-fA-F:]+$/.test(host);
  if (isIpv6) return { host, port, isIp: true };
  const isDomain = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(host);
  if (isDomain) return { host, port, isIp: false };
  return null;
}

/**
 * Phân tích chuỗi proxy theo các định dạng phổ biến:
 * 1. IP:PORT@USER:PASS hoặc HOST:PORT@USER:PASS
 * 2. USER:PASS@IP:PORT hoặc USER:PASS@HOST:PORT
 * 3. protocol://IP:PORT@USER:PASS hoặc protocol://USER:PASS@HOST:PORT
 * 4. IP:PORT:USER:PASS hoặc USER:PASS:IP:PORT
 * 5. IP:PORT hoặc HOST:PORT (không xác thực)
 */
function parseProxyItem(rawStr) {
  if (!rawStr) return null;
  let str = rawStr.trim();
  if (!str || str.startsWith("#") || str.startsWith("//")) return null;

  let protocol = "http";
  if (str.includes("://")) {
    const protoMatch = str.match(/^([a-zA-Z0-9+.-]+):\/\/(.*)$/);
    if (protoMatch) {
      protocol = protoMatch[1].toLowerCase();
      str = protoMatch[2].trim();
    }
  }

  // 1. Định dạng có dấu @: IP:PORT@USER:PASS hoặc USER:PASS@IP:PORT
  if (str.includes("@")) {
    const firstAt = str.indexOf("@");
    const lastAt = str.lastIndexOf("@");
    const hpFirst = parseHostPort(str.slice(0, firstAt));
    const hpLast = parseHostPort(str.slice(lastAt + 1));

    let host = "";
    let port = 80;
    let username = "";
    let password = "";

    if (hpFirst && (!hpLast || hpFirst.isIp)) {
      // IP:PORT@USER:PASS
      host = hpFirst.host;
      port = hpFirst.port;
      const auth = str.slice(firstAt + 1).trim();
      const c = auth.indexOf(":");
      username = c >= 0 ? auth.slice(0, c).trim() : auth;
      password = c >= 0 ? auth.slice(c + 1).trim() : "";
    } else if (hpLast) {
      // USER:PASS@IP:PORT
      host = hpLast.host;
      port = hpLast.port;
      const auth = str.slice(0, lastAt).trim();
      const c = auth.indexOf(":");
      username = c >= 0 ? auth.slice(0, c).trim() : auth;
      password = c >= 0 ? auth.slice(c + 1).trim() : "";
    } else {
      // Fallback khi không đoán được IP: coi như USER:PASS@HOST:PORT
      const auth = str.slice(0, lastAt).trim();
      const hostPart = str.slice(lastAt + 1).trim();
      const c = auth.indexOf(":");
      username = c >= 0 ? auth.slice(0, c).trim() : auth;
      password = c >= 0 ? auth.slice(c + 1).trim() : "";
      const [h, p] = hostPart.split(":");
      host = (h || "").trim();
      port = Number(p) || 80;
    }

    return {
      protocol,
      host,
      port,
      username: decodeURIComponent(username),
      password: decodeURIComponent(password),
      server: `${protocol}://${host}:${port}`,
      raw: rawStr,
    };
  }

  // 2. Định dạng ngăn cách bằng dấu hai chấm (không có @)
  const parts = str.split(":");
  if (parts.length >= 4) {
    const hp0 = parseHostPort(`${parts[0]}:${parts[1]}`);
    const hp2 = parseHostPort(`${parts[2]}:${parts[3]}`);
    if (hp0 && (!hp2 || hp0.isIp)) {
      // IP:PORT:USER:PASS
      return {
        protocol,
        host: hp0.host,
        port: hp0.port,
        username: parts[2].trim(),
        password: parts.slice(3).join(":").trim(),
        server: `${protocol}://${hp0.host}:${hp0.port}`,
        raw: rawStr,
      };
    } else if (hp2) {
      // USER:PASS:IP:PORT
      return {
        protocol,
        host: hp2.host,
        port: hp2.port,
        username: parts[0].trim(),
        password: parts[1].trim(),
        server: `${protocol}://${hp2.host}:${hp2.port}`,
        raw: rawStr,
      };
    }
  }

  if (parts.length === 2) {
    const host = parts[0].trim();
    const port = Number(parts[1].trim()) || 80;
    return {
      protocol,
      host,
      port,
      username: "",
      password: "",
      server: `${protocol}://${host}:${port}`,
      raw: rawStr,
    };
  }

  return null;
}

class ProxyManager {
  constructor(options = {}) {
    this.proxyList = [];
    this.currentIndex = 0;
    this.rotateUrl = options.rotateUrl || ROTATE_URL;
    this.directProxy = options.directProxy || DIRECT_PROXY;
    this.proxyFile = options.proxyFile || PROXY_FILE;
    this.noProxy = options.noProxy || NO_PROXY;
    this.shuffle = options.shuffle || PROXY_SHUFFLE;
    this.pruneDead = options.pruneDead !== undefined ? options.pruneDead : !process.argv.includes("--no-prune-proxy");
    this.loadedFilePath = null;
    this.deadKeys = new Set();
    this.pendingDeadKeys = new Set();
    this.persistTimer = null;
    this.initialCount = 0;
    this.lastConnectivityCheck = 0;
    this.isOnline = true;
    this.initialized = false;
    this.inUseProxyKeys = new Set();

    if (typeof process !== "undefined" && process.on) {
      process.on("beforeExit", () => this.flush());
    }
  }

  releaseProxy(proxy) {
    if (!proxy) return;
    const key = proxy._inUseKey || (proxy.host && proxy.port ? `${proxy.host}:${proxy.port}` : null);
    if (key) {
      this.inUseProxyKeys.delete(key);
    }
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    if (this.noProxy) {
      log("[ProxyManager] Chế độ: Không dùng proxy (Direct IP của máy).");
      return;
    }

    if (this.rotateUrl) {
      log(`[ProxyManager] Chế độ: API xoay proxy động (${this.rotateUrl}).`);
      return;
    }

    if (this.directProxy) {
      const p = parseProxyItem(this.directProxy);
      if (p) {
        this.proxyList.push(p);
        log(`[ProxyManager] Chế độ: 1 Proxy cố định (${p.server}).`);
      } else {
        log(`[ProxyManager] ⚠ Chuỗi proxy không hợp lệ: "${this.directProxy}"`);
      }
      return;
    }

    // Default proxy file path if none specified
    const defaultListPath = "D:\\Project\\lobby\\proxies\\list-proxies.txt";
    const fileToLoad = this.proxyFile || (existsSync(defaultListPath) ? defaultListPath : "");
    if (fileToLoad && existsSync(fileToLoad)) {
      this.loadedFilePath = fileToLoad;
      try {
        const content = readFileSync(fileToLoad, "utf8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const p = parseProxyItem(line);
          if (p) this.proxyList.push(p);
        }
        this.initialCount = this.proxyList.length;
        if (this.shuffle) {
          this.proxyList.sort(() => Math.random() - 0.5);
          log(`[ProxyManager] Đã xáo trộn ngẫu nhiên danh sách proxy.`);
        }
        log(
          `[ProxyManager] Đã tải ${this.proxyList.length} proxy từ: ${fileToLoad}` +
            (this.pruneDead ? " (Tự động xoá proxy chết khỏi file: BẬT)" : "")
        );
      } catch (err) {
        log(`[ProxyManager] ⚠ Lỗi khi đọc tệp proxy: ${err.message}`);
      }
    } else if (this.proxyFile) {
      log(`[ProxyManager] ⚠ Không tìm thấy tệp proxy tại: ${this.proxyFile}`);
    } else {
      log("[ProxyManager] Không chỉ định proxy. Chạy bằng IP trực tiếp của máy.");
    }
  }

  hasActiveProxy() {
    return !this.noProxy && (Boolean(this.rotateUrl) || this.proxyList.length > 0);
  }

  hasMultipleProxies() {
    return Boolean(this.rotateUrl || this.proxyList.length > 1);
  }

  /**
   * Kiểm tra khả năng kết nối tới proxy qua HTTP CONNECT tunnel.
   * Hỗ trợ xác thực Proxy Basic Auth và bảo đảm không loại bỏ nhầm proxy quốc tế có độ trễ cao.
   */
  async probe(proxy, timeoutMs = 6000) {
    if (!proxy || !proxy.host || !proxy.port) return false;
    return new Promise((resolve) => {
      let settled = false;
      let socket = null;
      let timer = null;
      const done = (val) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          if (socket) {
            try { socket.destroy(); } catch {}
          }
          resolve(val);
        }
      };

      timer = setTimeout(() => done(false), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();

      try {
        socket = net.createConnection({
          host: proxy.host,
          port: Number(proxy.port),
        });
      } catch {
        return done(false);
      }

      socket.on("connect", () => {
        let req = `CONNECT auto-hh3d.online:443 HTTP/1.1\r\nHost: auto-hh3d.online:443\r\n`;
        if (proxy.username && proxy.password) {
          const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
          req += `Proxy-Authorization: Basic ${auth}\r\n`;
        }
        req += `\r\n`;
        try {
          socket.write(req);
        } catch {
          done(true);
        }
      });

      socket.on("data", (chunk) => {
        const str = chunk.toString("latin1");
        if (str.startsWith("HTTP/1.") || str.startsWith("HTTP/2.")) {
          if (str.includes(" 200 ") || str.includes(" 200\r\n")) {
            done(true);
          } else {
            // Loại bỏ 407 (đòi mật khẩu), 400 (web server thường), 403, 502, 503...
            done(false);
          }
        } else {
          // Giao thức khác (SOCKS hoặc stream)
          done(true);
        }
      });

      socket.on("timeout", () => done(false));
      socket.on("error", () => done(false));
      socket.on("close", () => done(false));
    });
  }

  /**
   * Kiểm tra nhanh trạng thái kết nối mạng của máy chủ để tránh xoá nhầm khi đứt cáp / mất mạng.
   */
  async checkConnectivity() {
    const now = Date.now();
    if (now - this.lastConnectivityCheck < 10000) {
      return this.isOnline;
    }
    this.lastConnectivityCheck = now;
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          this.isOnline = val;
          resolve(val);
        }
      };

      try {
        const socket = net.createConnection({ host: "1.1.1.1", port: 53, timeout: 1500 });
        socket.on("connect", () => {
          try { socket.destroy(); } catch {}
          done(true);
        });
        socket.on("error", () => {
          try { socket.destroy(); } catch {}
          try {
            const s2 = net.createConnection({ host: "8.8.8.8", port: 53, timeout: 1500 });
            s2.on("connect", () => { try { s2.destroy(); } catch {} done(true); });
            s2.on("error", () => { try { s2.destroy(); } catch {} done(false); });
            s2.on("timeout", () => { try { s2.destroy(); } catch {} done(false); });
          } catch {
            done(false);
          }
        });
        socket.on("timeout", () => {
          try { socket.destroy(); } catch {}
          done(false);
        });
      } catch {
        done(false);
      }
    });
  }

  /**
   * Đánh dấu proxy đã chết, loại bỏ khỏi bộ nhớ và lên lịch lưu lại tệp trên đĩa.
   */
  markDead(proxy) {
    if (!this.pruneDead || !proxy || !proxy.host || !proxy.port) return;
    const key = `${proxy.host}:${proxy.port}`;
    if (this.deadKeys.has(key)) return;
    this.deadKeys.add(key);
    this.pendingDeadKeys.add(key);

    this.proxyList = this.proxyList.filter((p) => `${p.host}:${p.port}` !== key);

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistProxyList();
    }, 400);
    if (this.persistTimer && typeof this.persistTimer.unref === "function") {
      this.persistTimer.unref();
    }
  }

  /**
   * Ghi nhận và xoá các proxy chết khỏi danh sách bộ nhớ và tệp trên đĩa.
   */
  removeDeadProxies(deadProxies) {
    if (!this.pruneDead || !deadProxies || deadProxies.length === 0) return;
    for (const p of deadProxies) {
      this.markDead(p);
    }
    this.flush();
  }

  /**
   * Ghi đè danh sách proxy còn hoạt động trở lại tệp trên đĩa để lần sau không phải gặp lại proxy chết.
   */
  persistProxyList() {
    if (!this.pruneDead || !this.loadedFilePath || !existsSync(this.loadedFilePath)) return;
    if (this.pendingDeadKeys.size === 0) return;

    try {
      if (this.proxyList.length === 0 && this.initialCount > 0) {
        log(`[ProxyManager] ⚠ Cảnh báo: Toàn bộ proxy trong danh sách đều không phản hồi; bảo vệ tệp gốc, không xoá trắng.`);
        return;
      }
      const lines = this.proxyList.map((p) => p.raw || `${p.host}:${p.port}`);
      const uniqueLines = Array.from(new Set(lines));
      writeFileSync(this.loadedFilePath, uniqueLines.join("\r\n") + (uniqueLines.length > 0 ? "\r\n" : ""), "utf8");
      const removedCount = this.pendingDeadKeys.size;
      log(`[ProxyManager] 🗑 Đã loại bỏ ${removedCount} proxy chết khỏi tệp: ${this.loadedFilePath} (còn lại: ${uniqueLines.length} proxy).`);
      this.pendingDeadKeys.clear();
    } catch (err) {
      log(`[ProxyManager] ⚠ Không thể cập nhật tệp proxy trên đĩa: ${err.message}`);
    }
  }

  /**
   * Đồng bộ ngay lập tức các proxy chết chưa lưu vào tệp trên đĩa.
   */
  flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistProxyList();
  }

  /**
   * Thăm dò song song đồng thời một nhóm (batch) proxy qua HTTP CONNECT tunnel.
   * Ngay khi có bất kỳ proxy nào phản hồi thành công (HTTP 200), lập tức trả về proxy đó.
   * Các kết nối còn lại tiếp tục chạy nền và tự động bị đánh dấu chết nếu thất bại/timeout.
   */
  async probeBatch(candidates, timeoutMs = 4000) {
    if (!candidates || candidates.length === 0) return null;
    return new Promise((resolve) => {
      let resolved = false;
      let remaining = candidates.length;

      for (const candidate of candidates) {
        this.probe(candidate, timeoutMs)
          .then((alive) => {
            if (alive) {
              if (!resolved) {
                resolved = true;
                resolve(candidate);
              }
            } else {
              this.markDead(candidate);
              remaining--;
              if (remaining <= 0 && !resolved) {
                resolved = true;
                resolve(null);
              }
            }
          })
          .catch(() => {
            this.markDead(candidate);
            remaining--;
            if (remaining <= 0 && !resolved) {
              resolved = true;
              resolve(null);
            }
          });
      }
    });
  }

  /**
   * Tra cứu thông tin Geolocation, Timezone, và Locale theo IP của proxy.
   */
  async resolveGeo(proxy) {
    if (!proxy || !proxy.host) return null;
    try {
      const res = await fetch(
        `http://ip-api.com/json/${proxy.host}?fields=status,message,country,countryCode,regionName,city,lat,lon,timezone,query`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success") {
          const locale = COUNTRY_TO_LOCALE[data.countryCode] || "en-US";
          return {
            country: data.country || "United States",
            countryCode: data.countryCode || "US",
            region: data.regionName || "",
            city: data.city || "",
            lat: Number(data.lat) || 40.7128,
            lon: Number(data.lon) || -74.006,
            timezoneId: data.timezone || "America/New_York",
            locale,
            query: data.query || proxy.host,
          };
        }
      }
    } catch {}

    return {
      country: "United States",
      countryCode: "US",
      region: "New York",
      city: "New York",
      lat: 40.7128,
      lon: -74.006,
      timezoneId: "America/New_York",
      locale: "en-US",
      query: proxy.host,
    };
  }

  async getNextWorkingProxy(instanceId = 1, previousProxy = null) {
    this.init();
    if (previousProxy) {
      this.releaseProxy(previousProxy);
    }
    if (!this.hasActiveProxy()) return null;

    if (this.rotateUrl) {
      try {
        log(`[ProxyManager] Đang lấy proxy mới từ rotate URL: ${this.rotateUrl}...`);
        const res = await fetch(this.rotateUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const text = (await res.text()).trim();
          let proxyStr = text;
          try {
            const json = JSON.parse(text);
            proxyStr = json.proxy || json.data?.proxy || json.ip || text;
          } catch {}
          const p = parseProxyItem(proxyStr);
          if (p) {
            p.geo = await this.resolveGeo(p);
            log(
              `[ProxyManager] ✓ Đã nhận proxy mới từ API cho instance #${instanceId}: ${p.server} | ` +
              `Vị trí: ${p.geo?.city}, ${p.geo?.country} | Timezone: ${p.geo?.timezoneId} | Locale: ${p.geo?.locale}`
            );
            return p;
          }
        }
      } catch (err) {
        log(`[ProxyManager] ⚠ Lỗi khi lấy proxy từ rotate URL: ${err.message}`);
      }
      return null;
    }

    const total = this.proxyList.length;
    if (total === 1) {
      const single = this.proxyList[0];
      const isAlive = await this.probe(single, 6000);
      if (!isAlive) {
        log(`[ProxyManager] ⚠ Proxy duy nhất (${single.server}) không phản hồi kết nối.`);
        this.markDead(single);
        this.flush();
        return null;
      }
      if (!single.geo) single.geo = await this.resolveGeo(single);
      return single;
    }

    const batchSize = 35;
    const maxScan = Math.min(this.proxyList.length, 500);
    const batchesCount = Math.ceil(maxScan / batchSize);

    // Khi danh sách có nhiều proxy hơn số instance đang dùng, ưu tiên chọn proxy chưa bị chiếm
    const canIsolate = this.proxyList.length > this.inUseProxyKeys.size;
    log(
      `[ProxyManager] Quét song song siêu tốc danh sách proxy (đang dò tối đa ${maxScan}/${this.proxyList.length} proxy ` +
      `theo từng lô ${batchSize} kết nối đồng thời${this.pruneDead ? ", tự động loại bỏ proxy chết" : ""}${canIsolate ? ", lọc trùng instance" : ""})...`
    );

    const visitedKeys = new Set();
    let checkedSoFar = 0;
    const scanStartIndex = this.currentIndex;

    for (let b = 0; b < batchesCount; b++) {
      if (this.proxyList.length === 0) break;

      const currentBatch = [];
      for (let i = 0; i < this.proxyList.length && currentBatch.length < batchSize && checkedSoFar < maxScan; i++) {
        const candidate = this.proxyList[(scanStartIndex + checkedSoFar) % this.proxyList.length];
        const key = `${candidate.host}:${candidate.port}`;
        if (!visitedKeys.has(key)) {
          visitedKeys.add(key);
          checkedSoFar++;
          if (!canIsolate || !this.inUseProxyKeys.has(key)) {
            currentBatch.push(candidate);
          }
        }
      }

      if (currentBatch.length === 0) continue;

      const displayFrom = checkedSoFar - currentBatch.length + 1;
      const displayTo = checkedSoFar;
      log(`[ProxyManager] Đang kiểm tra đồng thời lô ${b + 1}/${batchesCount} (${currentBatch.length} proxy khả dụng, vị trí #${displayFrom} - #${displayTo})...`);

      const alive = await this.probeBatch(currentBatch, 4000);
      if (alive) {
        const aliveKey = `${alive.host}:${alive.port}`;
        this.inUseProxyKeys.add(aliveKey);
        alive._inUseKey = aliveKey;
        alive.geo = await this.resolveGeo(alive);
        const aliveIdx = this.proxyList.findIndex((p) => p.host === alive.host && p.port === alive.port);
        if (aliveIdx !== -1) {
          this.currentIndex = (aliveIdx + 1) % Math.max(1, this.proxyList.length);
        }
        log(
          `[ProxyManager] ✓ Đã tìm thấy Proxy kết nối tốt cho instance #${instanceId}: ${alive.server} | ` +
          `Vị trí: ${alive.geo?.city}, ${alive.geo?.country} (${alive.geo?.countryCode}) | ` +
          `Timezone: ${alive.geo?.timezoneId} | Locale: ${alive.geo?.locale}`
        );
        return alive;
      }
      log(`[ProxyManager] ⚠ Lô ${b + 1} (${currentBatch.length} proxy) không có proxy nào phản hồi; chuyển sang lô kế tiếp...`);
    }

    this.flush();
    log(`[ProxyManager] ⚠ Đã quét qua ${checkedSoFar} proxy nhưng không có proxy nào phản hồi. Chạy chu kỳ này bằng IP máy.`);
    return null;
  }
}

// ============================================================
//  HUMAN BEHAVIOR & CLICK SIMULATION ENGINE
//  Mô phỏng hành vi người dùng tự nhiên khi tương tác quảng cáo.
//  Hai chế độ: "cdp" (Input.dispatchMouseEvent) và "mouse" (page.mouse API).
// ============================================================

/** Vị trí chuột ảo hiện tại — dùng để bắt đầu đường cong Bézier liên tục giữa các thao tác. */
let lastMouseX = 300;
let lastMouseY = 250;

/** Nội suy một điểm trên đường Cubic Bézier. */
function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Hàm easing sinh học — chậm đầu, nhanh giữa, chậm cuối. */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Sinh chuỗi toạ độ di chuyển chuột theo đường Bézier với rung lắc tự nhiên (micro-tremor).
 * @returns {{ x: number, y: number }[]}
 */
function generateBezierPath(fromX, fromY, toX, toY, steps) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Vector pháp tuyến vuông góc với đường nối — dùng để tạo độ cong ngẫu nhiên
  const nx = -dy / dist;
  const ny = dx / dist;

  // Hai điểm điều khiển Bézier lệch ngẫu nhiên tạo đường cong tự nhiên
  const cp1x = fromX + dx * 0.25 + nx * (Math.random() - 0.5) * dist * 0.5;
  const cp1y = fromY + dy * 0.25 + ny * (Math.random() - 0.5) * dist * 0.5;
  const cp2x = fromX + dx * 0.75 + nx * (Math.random() - 0.5) * dist * 0.35;
  const cp2y = fromY + dy * 0.75 + ny * (Math.random() - 0.5) * dist * 0.35;

  const n = steps ?? rand(22, 38);
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = easeInOutCubic(i / n);
    let x = cubicBezier(t, fromX, cp1x, cp2x, toX);
    let y = cubicBezier(t, fromY, cp1y, cp2y, toY);
    // Rung lắc vi mô (micro-tremor) ±1.5px — bỏ qua điểm đầu và cuối
    if (i > 0 && i < n) {
      x += (Math.random() - 0.5) * 3;
      y += (Math.random() - 0.5) * 3;
    }
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return points;
}

/** Sinh số ngẫu nhiên phân phối xấp xỉ Gaussian (Box-Muller transform). */
function gaussianRand() {
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Tính toạ độ click lệch tâm theo phân phối Gaussian.
 * Người thật không bao giờ click chính xác tâm hình học — toạ độ rải trong vùng 15%-85%.
 */
function computeClickTarget(box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const spreadX = box.width * 0.15;
  const spreadY = box.height * 0.15;
  const tx = Math.max(box.x + box.width * 0.15, Math.min(box.x + box.width * 0.85, cx + gaussianRand() * spreadX));
  const ty = Math.max(box.y + box.height * 0.15, Math.min(box.y + box.height * 0.85, cy + gaussianRand() * spreadY));
  return { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10 };
}

/** Giải toạ độ viewport cho phần tử bất kỳ (kể cả trong iframe). Trả null nếu không xác định. */
async function resolveAdClickTarget(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
  await sleep(100);
  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width < 2 || box.height < 2) return null;
  return computeClickTarget(box);
}

/** Sinh khoảng delay theo phân phối log-normal — giống thời gian phản ứng người thật. */
function logNormalDelay(medianMs, sigma) {
  const z = gaussianRand();
  return Math.max(medianMs * 0.3, Math.round(medianMs * Math.exp(z * (sigma ?? 0.5))));
}

/**
 * Cuộn trang tự nhiên — từng nhịp nhỏ có quán tính và khoảng dừng mắt đọc nội dung.
 * Khi chạy nhiều instance và chưa đến lượt tương tác, cuộn thuần qua DOM window.scrollBy để không chiếm chuột.
 */
async function organicScroll(page, totalDistance, instanceId = logContext.getStore()?.instanceId) {
  if (!page || Math.abs(totalDistance) < 30) return;
  const dir = totalDistance > 0 ? 1 : -1;
  let remaining = Math.abs(totalDistance);
  const useDomScroll = INSTANCE_COUNT > 1 && !canInteractForeground(instanceId);
  while (remaining > 0) {
    const chunk = Math.min(remaining, rand(60, 200));
    if (useDomScroll) {
      await page.evaluate((d) => {
        window.scrollBy({ top: d, behavior: "smooth" });
      }, chunk * dir).catch(() => {});
    } else {
      try {
        await page.mouse.wheel(0, chunk * dir);
      } catch {
        await page.evaluate((d) => {
          window.scrollBy({ top: d, behavior: "smooth" });
        }, chunk * dir).catch(() => {});
      }
    }
    remaining -= chunk;
    await sleep(rand(120, 450));
  }
}

/**
 * Di chuột dọc đường Bézier và click bằng CDP Input.dispatchMouseEvent.
 * Chuỗi sự kiện: mouseMoved×N → dwell → mousePressed → hold → mouseReleased.
 * Sự kiện do CDP phát có isTrusted = true trong Chrome renderer.
 */
async function humanClickCdp(page, ctx, targetX, targetY) {
  const client = await ctx.newCDPSession(page);
  try {
    const movePath = generateBezierPath(lastMouseX, lastMouseY, targetX, targetY);
    for (const pt of movePath) {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
      await sleep(rand(8, 22));
    }
    // Dwell / Hover — dừng lại như đang đọc nội dung quảng cáo trước khi nhấn
    await sleep(resolveHoverMs());
    // Press
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed", button: "left", clickCount: 1, x: targetX, y: targetY,
    });
    // Hold — giữ nút chuột 70-160ms như bàn tay người thật
    await sleep(rand(70, 160));
    // Release
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", button: "left", clickCount: 1, x: targetX, y: targetY,
    });
    lastMouseX = targetX;
    lastMouseY = targetY;
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Di chuột dọc đường Bézier và click bằng Playwright page.mouse API.
 */
async function humanClickMouse(page, targetX, targetY) {
  const movePath = generateBezierPath(lastMouseX, lastMouseY, targetX, targetY);
  for (const pt of movePath) {
    await page.mouse.move(pt.x, pt.y);
    await sleep(rand(8, 22));
  }
  await sleep(resolveHoverMs());
  await page.mouse.down({ button: "left" });
  await sleep(rand(70, 160));
  await page.mouse.up({ button: "left" });
  lastMouseX = targetX;
  lastMouseY = targetY;
}

/**
 * Di chuột vật lý cấp Hệ điều hành Windows (OS Physical Mouse) qua PowerShell và user32.dll SendInput/mouse_event.
 * Di chuyển con trỏ chuột thật của Windows trên màn hình Desktop và click thật vào cửa sổ Chrome.
 */
async function humanClickOs(page, ctx, targetX, targetY, instanceId = 0) {
  if (process.platform !== "win32") {
    log("[OS-Mouse] ⚠ Hệ điều hành không phải Windows; tự động chuyển sang CDP Input.dispatchMouseEvent.");
    return humanClickCdp(page, ctx, targetX, targetY);
  }

  try {
    await page.bringToFront().catch(() => {});
    const metrics = await page.evaluate(() => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      outerHeight: window.outerHeight,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    }));

    const borderLeft = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
    const borderTop = Math.max(0, metrics.outerHeight - metrics.innerHeight - borderLeft);
    const dpr = metrics.dpr || 1;

    // Giới hạn an toàn trong vùng nội dung trang của Chrome (cách mép tối thiểu 12px)
    // để chuột phần cứng không bao giờ bị văng ra ngoài khung cửa sổ Chrome
    const safeTargetX = Math.max(12, Math.min(Math.max(12, metrics.innerWidth - 12), targetX));
    const safeTargetY = Math.max(12, Math.min(Math.max(12, metrics.innerHeight - 12), targetY));

    const desktopX = Math.round((metrics.screenX + borderLeft + safeTargetX) * dpr);
    const desktopY = Math.round((metrics.screenY + borderTop + safeTargetY) * dpr);

    log(`[OS-Mouse] Di chuyển chuột phần cứng Windows tới toạ độ Desktop (${desktopX}, ${desktopY}) & rê lượn tương tác...`);

    const psScript = path.join(__dirname, "winMouse.ps1");
    if (!existsSync(psScript)) {
      throw new Error(`Không tìm thấy tệp kịch bản: ${psScript}`);
    }

    const hoverMs = resolveHoverMs();
    const instArg = instanceId > 0 ? ` -instanceId ${instanceId}` : "";
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -targetX ${desktopX} -targetY ${desktopY} -steps 25 -hoverMs ${hoverMs} -click 1${instArg}`;
    execSync(cmd, { stdio: "ignore", timeout: Math.max(25000, hoverMs + 15000) });

    lastMouseX = safeTargetX;
    lastMouseY = safeTargetY;
    log("[OS-Mouse] ✓ Thao tác rê chuột phần cứng & click Windows hoàn tất (MOUSEEVENTF_MOVE stream).");
  } catch (err) {
    log(`[OS-Mouse] ⚠ Lỗi khi điều khiển chuột Windows (${err.message}); dùng fallback CDP click.`);
    return humanClickCdp(page, ctx, targetX, targetY);
  }
}

/**
 * Đợi thao tác click chuột thật của người dùng trong chế độ bán tự động (Manual Assist).
 * Tự động phát hiện khi có tab mới mở ra hoặc tab hiện tại chuyển hướng sang trang quảng cáo.
 */
async function waitForManualUserClick(context, page, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    const onNewPage = (newPage) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        context.off("page", onNewPage);
        resolve(newPage);
      }
    };
    context.on("page", onNewPage);

    const onNavigated = (frame) => {
      if (!settled && frame === page.mainFrame()) {
        const u = frame.url();
        if (u && !u.includes(WEB_URL) && u !== "about:blank") {
          settled = true;
          clearTimeout(timer);
          page.off("framenavigated", onNavigated);
          context.off("page", onNewPage);
          resolve(page);
        }
      }
    };
    page.on("framenavigated", onNavigated);
  });
}

/**
 * Chế độ kết hợp Logitech G-HUB: Auto rê chuột phần cứng đến quảng cáo, sau đó phát chuông báo
 * để người dùng bấm nút hông G4/G5 trên chuột Logitech G304 nhằm kích hoạt click từ driver Logitech.
 * Nếu không thấy phản hồi sau 25s, tự động click fallback bằng OS Hardware Mouse.
 */
async function humanClickGhub(page, ctx, targetX, targetY, instanceId = 0) {
  if (process.platform !== "win32") {
    return humanClickCdp(page, ctx, targetX, targetY);
  }

  try {
    await page.bringToFront().catch(() => {});
    const metrics = await page.evaluate(() => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      outerHeight: window.outerHeight,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    }));

    const borderLeft = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
    const borderTop = Math.max(0, metrics.outerHeight - metrics.innerHeight - borderLeft);
    const dpr = metrics.dpr || 1;

    const safeTargetX = Math.max(12, Math.min(Math.max(12, metrics.innerWidth - 12), targetX));
    const safeTargetY = Math.max(12, Math.min(Math.max(12, metrics.innerHeight - 12), targetY));

    const desktopX = Math.round((metrics.screenX + borderLeft + safeTargetX) * dpr);
    const desktopY = Math.round((metrics.screenY + borderTop + safeTargetY) * dpr);

    const psScript = path.join(__dirname, "winMouse.ps1");
    if (existsSync(psScript)) {
      const hoverMs = resolveHoverMs();
      const instArg = instanceId > 0 ? ` -instanceId ${instanceId}` : "";
      execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -targetX ${desktopX} -targetY ${desktopY} -steps 20 -hoverMs ${hoverMs} -click 0${instArg}`,
        { stdio: "ignore", timeout: Math.max(20000, hoverMs + 10000) },
      );
    }
  } catch {}

  log("\n" + "=".repeat(64));
  log("🔔 [CHẾ ĐỘ LOGITECH G-HUB ASSIST]");
  log("👉 Chuột đã rê trúng tâm quảng cáo trên Chrome!");
  log("👉 Vui lòng bấm nút G4/G5 (nút hông) trên chuột Logitech G304 để phát click driver...");
  log("⏳ Đang chờ tín hiệu click từ chuột Logitech (tối đa 25 giây)...");
  log("=".repeat(64) + "\n");
  try { process.stdout.write("\x07"); } catch {}

  const userPage = await waitForManualUserClick(ctx, page, 25000);
  if (userPage) {
    log("✓ Đã nhận diện thao tác click driver thành công từ chuột Logitech G304!");
    return;
  }

  log("⚠ Hết thời gian chờ click từ chuột G304; tự động click bằng OS Mouse.");
  return humanClickOs(page, ctx, targetX, targetY, instanceId);
}

/** Dispatcher thống nhất — chọn engine theo CLICK_MODE. */
async function humanClick(page, ctx, x, y, instanceId = 0, clickMode = CLICK_MODE) {
  await page.bringToFront().catch(() => {});
  if (clickMode === "ghub") {
    return humanClickGhub(page, ctx, x, y, instanceId);
  }
  if (clickMode === "os-mouse") {
    return humanClickOs(page, ctx, x, y, instanceId);
  }
  if (clickMode === "cdp") {
    return humanClickCdp(page, ctx, x, y);
  }
  return humanClickMouse(page, x, y);
}

/**
 * Mô phỏng tiếp cận tự nhiên trước khi click: di chuột đến vùng lân cận quảng cáo,
 * dừng lại như đang nhìn, rồi từ từ rê vào vị trí đích.
 */
async function preClickEngagement(page, ctx, targetX, targetY, instanceId = 0, clickMode = CLICK_MODE) {
  await page.bringToFront().catch(() => {});
  if ((clickMode === "os-mouse" || clickMode === "ghub") && process.platform === "win32") {
    try {
      const nearX = targetX + rand(-60, 60);
      const nearY = targetY + rand(-40, 40);
      const metrics = await page.evaluate(() => ({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        innerWidth: window.innerWidth,
        outerHeight: window.outerHeight,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      }));
      const borderLeft = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
      const borderTop = Math.max(0, metrics.outerHeight - metrics.innerHeight - borderLeft);
      const dpr = metrics.dpr || 1;
      const safeNearX = Math.max(12, Math.min(Math.max(12, metrics.innerWidth - 12), nearX));
      const safeNearY = Math.max(12, Math.min(Math.max(12, metrics.innerHeight - 12), nearY));
      const nearDesktopX = Math.round((metrics.screenX + borderLeft + safeNearX) * dpr);
      const nearDesktopY = Math.round((metrics.screenY + borderTop + safeNearY) * dpr);

      const psScript = path.join(__dirname, "winMouse.ps1");
      if (existsSync(psScript)) {
        const hoverMs = resolveHoverMs();
        const nearHoverMs = Math.min(1000, Math.round(hoverMs / 2));
        const instArg = instanceId > 0 ? ` -instanceId ${instanceId}` : "";
        execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -targetX ${nearDesktopX} -targetY ${nearDesktopY} -steps 18 -hoverMs ${nearHoverMs} -click 0${instArg}`,
          { stdio: "ignore", timeout: Math.max(15000, nearHoverMs + 8000) }
        );
      }
      lastMouseX = safeNearX;
      lastMouseY = safeNearY;
      await sleep(Math.min(2500, Math.max(800, resolveHoverMs())));
      return;
    } catch {}
  }

  // 1. Di chuyển đến vùng lân cận trước (lệch 35-70px) như ánh mắt vừa lướt qua
  const nearX = targetX + rand(-70, 70);
  const nearY = targetY + rand(-50, 50);
  const approachPath = generateBezierPath(lastMouseX, lastMouseY, nearX, nearY, rand(12, 22));
  if (clickMode === "cdp") {
    const client = await ctx.newCDPSession(page);
    for (const pt of approachPath) {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
      await sleep(rand(12, 28));
    }
    await client.detach().catch(() => {});
  } else {
    for (const pt of approachPath) {
      await page.mouse.move(pt.x, pt.y);
      await sleep(rand(12, 28));
    }
  }
  lastMouseX = nearX;
  lastMouseY = nearY;

  // 2. Dừng lại như đang đọc tiêu đề quảng cáo và quyết định bấm (áp dụng thời gian hover cấu hình)
  await sleep(resolveHoverMs());

  // 3. Rê chuột nhẹ nhàng từ vị trí lân cận vào đúng vị trí click đích
  const finalGlide = generateBezierPath(lastMouseX, lastMouseY, targetX, targetY, rand(8, 14));
  if (clickMode === "cdp") {
    const client = await ctx.newCDPSession(page);
    for (const pt of finalGlide) {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
      await sleep(rand(10, 22));
    }
    await client.detach().catch(() => {});
  } else {
    for (const pt of finalGlide) {
      await page.mouse.move(pt.x, pt.y);
      await sleep(rand(10, 22));
    }
  }
  lastMouseX = targetX;
  lastMouseY = targetY;
  await sleep(rand(150, 450));
}

/**
 * Chuỗi tương tác hoàn chỉnh (tiếp cận + click) kết hợp lượt chuột vật lý theo chu kỳ:
 * cú click vật lý đầu tiên của một chu kỳ nhận lượt chuột và GIỮ nó tới khi `runOneCycle` kết
 * thúc (nhả trong khối finally), nên các click đệ quy trên trang đích không phải xếp hàng lại và
 * không instance nào chen vào giữa chu kỳ. Gắn tag tiêu đề cửa sổ để winMouse.ps1 phóng to đúng
 * cửa sổ trước khi click.
 */
async function performEngageAndClick(page, ctx, targetX, targetY, instanceId = 0, clickMode = CLICK_MODE) {
  if (isPhysicalClickMode(clickMode) || INSTANCE_COUNT > 1) {
    await acquireCycleTurn(instanceId);
    if (instanceId > 0) {
      await tagInstancePage(page, instanceId);
    }
    await page.bringToFront().catch(() => {});
    await maximizeAndFocusWindow(ctx, page, instanceId);
    if (process.platform === "win32") {
      focusInstanceWindow(instanceId);
    }
  }
  await preClickEngagement(page, ctx, targetX, targetY, instanceId, clickMode);
  const [newPage] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null),
    humanClick(page, ctx, targetX, targetY, instanceId, clickMode).catch(() => null),
  ]);
  return newPage;
}

/**
 * Mô phỏng người dùng dừng lại đọc nội dung trang web:
 * - Cuộn nhẹ lên xuống theo nhịp đọc.
 * - Rê chuột vi mô ngẫu nhiên theo dòng chữ hoặc khối bài viết (chỉ rê khi đang giữ lượt chuột).
 * - Dừng lại ngẫu nhiên để mắt đọc thông tin trước khi chuyển sang xem quảng cáo.
 */
async function simulateHumanReading(page, durationMs, instanceId = logContext.getStore()?.instanceId) {
  if (!page || durationMs <= 0) return;
  const started = Date.now();
  const canMoveMouse = canInteractForeground(instanceId);
  while (Date.now() - started < durationMs) {
    const elapsed = Date.now() - started;
    const remaining = durationMs - elapsed;
    if (remaining < 250) break;

    if (canMoveMouse) {
      // Rê chuột vi mô theo dòng đọc (drift)
      const driftX = Math.max(100, Math.min(1200, lastMouseX + rand(-150, 150)));
      const driftY = Math.max(80, Math.min(700, lastMouseY + rand(-80, 80)));
      const path = generateBezierPath(lastMouseX, lastMouseY, driftX, driftY, rand(6, 10));
      for (const pt of path) {
        if (Date.now() - started >= durationMs) break;
        await page.mouse.move(pt.x, pt.y).catch(() => {});
        await sleep(rand(10, 20));
      }
      lastMouseX = driftX;
      lastMouseY = driftY;
    }

    // Dừng đọc đoạn văn bản (không vượt quá thời gian còn lại)
    const pauseRemaining = durationMs - (Date.now() - started);
    if (pauseRemaining <= 100) break;
    await sleep(Math.min(rand(300, 600), pauseRemaining));

    // Thao tác cuộn nhẹ mô phỏng mắt đọc xuống
    const scrollRemaining = durationMs - (Date.now() - started);
    if (scrollRemaining > 300 && Math.random() < 0.5) {
      const scrollDistance = rand(-50, 120);
      await organicScroll(page, scrollDistance, instanceId);
      const postScrollRemaining = durationMs - (Date.now() - started);
      if (postScrollRemaining > 100) {
        await sleep(Math.min(rand(200, 400), postScrollRemaining));
      }
    }
  }
}

/**
 * Mô phỏng người dùng trải nghiệm trang đích (Landing Page):
 * - Cuộn qua các phân đoạn trang (150px - 350px).
 * - Rê chuột lên các phần tử nội dung, nút bấm, tiêu đề.
 * - Dừng đọc từ 20 đến 45 giây (ngăn chặn triệt để gắn cờ Bot Bounce / Accidental Click).
 */
async function simulateLandingPageEngagement(page, durationMs) {
  if (!page || durationMs <= 0) return;
  const started = Date.now();
  log(`  Đang trải nghiệm nội dung trang đích tự nhiên trong ${Math.round(durationMs / 1000)}s...`);

  let scrolledDown = 0;
  while (Date.now() - started < durationMs) {
    const remaining = durationMs - (Date.now() - started);
    if (remaining < 1500) break;

    // Cuộn xuống nhịp 150 - 350px
    const scrollStep = rand(150, 350);
    await organicScroll(page, scrollStep);
    scrolledDown += scrollStep;
    await sleep(rand(1000, 2500));

    // Rê chuột tự nhiên trên trang đích
    const targetX = rand(200, 1000);
    const targetY = rand(150, 650);
    const movePath = generateBezierPath(lastMouseX, lastMouseY, targetX, targetY, rand(10, 18));
    for (const pt of movePath) {
      await page.mouse.move(pt.x, pt.y).catch(() => {});
      await sleep(rand(12, 26));
    }
    lastMouseX = targetX;
    lastMouseY = targetY;

    // Dừng đọc
    await sleep(rand(1500, 3500));

    // Nếu đã cuộn sâu (> 800px), thỉnh thoảng cuộn nhẹ lên 80-160px để xem lại
    if (scrolledDown > 800 && Math.random() < 0.35) {
      await organicScroll(page, -rand(80, 160));
      await sleep(rand(800, 1800));
    }
  }
}

function resolveExtensionPath() {
  const custom = getCliArg("--canvas-blocker-path") || process.env.CANVAS_BLOCKER_PATH || "";
  const candidates = [
    ...(custom ? [custom] : []),
    path.join(__dirname, "canvas-blocker"),
    path.join(__dirname, "../deploy/extensions/canvas-blocker"),
    "D:\\Backup\\Chrome\\CanvasBlocker",
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "manifest.json"))) {
      return path.resolve(c);
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

async function handleRecursiveAdClicks(targetPage, depth, maxDepth, ctx, instanceId = 0, clickMode = CLICK_MODE) {
  if (depth >= maxDepth) return;

  try {
    const waitMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
    log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Trải nghiệm và đọc trang quảng cáo trong ${Math.round(waitMs / 1000)}s...`);
    await simulateLandingPageEngagement(targetPage, waitMs);

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
    const shuffled = [...adSelectors].sort(() => Math.random() - 0.5);
    for (const sel of shuffled) {
      const handles = await targetPage.$$(sel);
      const shuffledHandles = [...handles].sort(() => Math.random() - 0.5);
      for (const handle of shuffledHandles) {
        try {
          const visible = await handle.isVisible().catch(() => false);
          if (!visible) continue;
          await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await sleep(100);
          const elBox = await handle.boundingBox().catch(() => null);
          if (!elBox || elBox.width < 2 || elBox.height < 2) continue;
          const target = computeClickTarget(elBox);
          log(`  [Đệ quy cấp ${depth + 1}] Tìm thấy phần tử (${sel}), click tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
          const resolvedCtx = ctx || targetPage.context();
          const newPage = await performEngageAndClick(targetPage, resolvedCtx, target.x, target.y, instanceId, clickMode);

          clicked = true;
          if (newPage) {
            await newPage.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
            await handleRecursiveAdClicks(newPage, depth + 1, maxDepth, resolvedCtx, instanceId, clickMode);
            await withTimeout(newPage.close().catch(() => {}), 2500);
          } else {
            await simulateLandingPageEngagement(targetPage, rand(DELAY_MIN_MS, DELAY_MAX_MS));
          }
          break;
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
  if (!ENABLE_DEV_MODE || !profileDir) return;
  try {
    const defaultDir = path.join(profileDir, "Default");
    mkdirSync(defaultDir, { recursive: true });

    const prefsPath = path.join(defaultDir, "Preferences");
    let prefs = {};
    if (existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(readFileSync(prefsPath, "utf8")) || {};
      } catch {}
    }
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.ui = prefs.extensions.ui || {};
    prefs.extensions.ui.developer_mode = true;
    prefs.extensions.alerts = prefs.extensions.alerts || {};
    prefs.extensions.alerts.initialized = true;
    writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), "utf8");

    const secPrefsPath = path.join(defaultDir, "Secure Preferences");
    let secPrefs = {};
    if (existsSync(secPrefsPath)) {
      try {
        secPrefs = JSON.parse(readFileSync(secPrefsPath, "utf8")) || {};
      } catch {}
    }
    secPrefs.extensions = secPrefs.extensions || {};
    secPrefs.extensions.ui = secPrefs.extensions.ui || {};
    secPrefs.extensions.ui.developer_mode = true;
    writeFileSync(secPrefsPath, JSON.stringify(secPrefs, null, 2), "utf8");

    const localStatePath = path.join(profileDir, "Local State");
    let localState = {};
    if (existsSync(localStatePath)) {
      try {
        localState = JSON.parse(readFileSync(localStatePath, "utf8")) || {};
      } catch {}
    }
    localState.extensions = localState.extensions || {};
    localState.extensions.ui = localState.extensions.ui || {};
    localState.extensions.ui.developer_mode = true;
    writeFileSync(localStatePath, JSON.stringify(localState, null, 2), "utf8");
  } catch {
    // không chặn nếu ghi preferences thất bại
  }
}

async function ensureDeveloperMode(context) {
  if (!ENABLE_DEV_MODE || !context) return;
  try {
    const hadExistingPages = context.pages().length > 0;
    const devPage = await context.newPage();
    await devPage.goto("chrome://extensions", { timeout: 4000, waitUntil: "domcontentloaded" });
    await devPage.evaluate(() => {
      const m = document.querySelector("extensions-manager");
      const t = m?.shadowRoot?.querySelector("extensions-toolbar");
      const dev = t?.shadowRoot?.querySelector("#devMode");
      if (dev && dev.getAttribute("aria-pressed") !== "true") {
        dev.click();
      }
    }).catch(() => {});
    if (hadExistingPages) {
      await devPage.close().catch(() => {});
    }
  } catch {
    // Không chặn tiến trình nếu WebUI chrome://extensions không khả dụng
  }
}

function isChromeProcessRunning() {
  try {
    if (process.platform === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe"', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.toLowerCase().includes("chrome.exe");
    } else {
      const out = execSync("pgrep -f chrome", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return Boolean(out.trim());
    }
  } catch {
    return false;
  }
}

function killChromeProcesses(force = false) {
  if (INSTANCE_COUNT > 1 && !force) {
    return;
  }
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /IM chrome.exe /T", { stdio: "ignore" });
    } else {
      execSync("pkill -9 -f chrome", { stdio: "ignore" });
    }
  } catch {}
}

async function cleanupAllBrowserData(context, page) {
  try {
    if (context) {
      await context.clearCookies().catch(() => {});
      await context.clearPermissions().catch(() => {});
    }

    const activePage = page && !page.isClosed() ? page : context?.pages?.().find((p) => !p.isClosed());
    if (activePage && !activePage.isClosed()) {
      await activePage
        .evaluate(() => {
          try {
            localStorage.clear();
          } catch {}
          try {
            sessionStorage.clear();
          } catch {}
        })
        .catch(() => {});
    }

    if (activePage && context) {
      const client = await context.newCDPSession(activePage).catch(() => null);
      if (client) {
        // 1. Xoá triệt để dữ liệu lưu trữ (LocalStorage, IndexedDB, CacheStorage, ServiceWorkers, v.v.) của mọi domain
        await client
          .send("Storage.clearDataForOrigin", { origin: "*", storageTypes: "all" })
          .catch(async () => {
            await client.send("Storage.clearDataForStorageKey", { storageKey: "*", storageTypes: "all" }).catch(() => {});
          });
        // 2. Xoá sạch toàn bộ cookies của toàn bộ trình duyệt
        await client.send("Network.clearBrowserCookies").catch(() => {});
        // 3. Xoá sạch toàn bộ HTTP disk và memory cache của toàn bộ trình duyệt
        await client.send("Network.clearBrowserCache").catch(() => {});
        await client.detach().catch(() => {});
      }
    }
    log("✓ Đã dọn dẹp triệt để 100% cache, cookies và storage của toàn bộ trình duyệt.");
  } catch (err) {
    log(`Lỗi khi dọn dẹp toàn bộ dữ liệu trình duyệt: ${err instanceof Error ? err.message : String(err)}`);
  }
}


function discoverMainChromeExtensions() {
  const extsDir = path.join(
    process.env.LOCALAPPDATA || "",
    "Google",
    "Chrome",
    "User Data",
    "Default",
    "Extensions",
  );
  if (!existsSync(extsDir)) return [];
  const extPaths = [];
  try {
    const extIds = readdirSync(extsDir, { withFileTypes: true });
    for (const extId of extIds) {
      if (!extId.isDirectory()) continue;
      const extIdPath = path.join(extsDir, extId.name);
      const versions = readdirSync(extIdPath, { withFileTypes: true });
      for (const ver of versions) {
        if (!ver.isDirectory()) continue;
        const manifestPath = path.join(extIdPath, ver.name, "manifest.json");
        if (existsSync(manifestPath)) {
          extPaths.push(path.join(extIdPath, ver.name));
          break;
        }
      }
    }
  } catch {}
  return extPaths;
}

async function ensureCdpServer(cdpPort, extensionPath, useRealProfile = false, proxy = null) {
  const isListening = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
    signal: AbortSignal.timeout(1000),
  })
    .then((r) => r.ok)
    .catch(() => false);

  if (isListening && !proxy) {
    log(`✓ Phát hiện Chrome đang lắng nghe trên cổng CDP ${cdpPort}.`);
    return;
  }
  if (isListening && proxy) {
    log(`Khởi động lại Chrome trên cổng CDP ${cdpPort} để áp dụng Proxy mới...`);
    killChromeProcesses();
    await sleep(1500);
  }

  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "google-chrome",
    "chrome",
  ];
  const chromeBin = chromePaths.find((p) => existsSync(p)) || "chrome";

  const webrtcAntiLeakFlags = [
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--enforce-webrtc-ip-permission-check",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];

  const proxyFlags = proxy
    ? [`--proxy-server=${proxy.server}`, "--proxy-bypass-list=<-loopback>"]
    : [];

  if (useRealProfile) {
    if (isChromeProcessRunning()) {
      log("Phát hiện Chrome đang mở. Đang khởi động lại Chrome với cổng gỡ lỗi 9222...");
      killChromeProcesses();
      await sleep(1500);
    } else {
      log(`Khởi chạy Chrome chính trên thư mục User Data mặc định với cổng gỡ lỗi ${cdpPort}...`);
    }

    const realUserData = path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "User Data"
    );
    const junctionPath = path.join(
      process.env.LOCALAPPDATA || tmpdir(),
      "Google",
      "Chrome",
      "User Data-Direct"
    );

    try {
      if (existsSync(junctionPath)) {
        rmSync(junctionPath, { recursive: true, force: true });
      }
      symlinkSync(realUserData, junctionPath, "junction");
      log("✓ Đã tạo liên kết trực tiếp (NTFS Junction) vào thư mục User Data mặc định của máy.");
    } catch {
      // nếu không tạo được junction, dùng trực tiếp realUserData
    }

    const userDataDir = existsSync(junctionPath) ? junctionPath : realUserData;

    if (ENABLE_DEV_MODE) {
      prepareExtensionProfile(userDataDir);
    }

    const args = [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--restore-last-session",
      "--start-maximized",
      ...webrtcAntiLeakFlags,
      ...proxyFlags,
    ];

    if (ENABLE_DEV_MODE) {
      args.push(
        "--enable-experimental-extension-apis",
        "--extensions-on-chrome-urls",
        "--silent-debugger-extension-api"
      );
    }

    if (extensionPath) {
      args.push(`--disable-extensions-except=${extensionPath}`);
      args.push(`--load-extension=${extensionPath}`);
    }

    const child = spawn(chromeBin, args, { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    log(`Chưa thấy Chrome mở cổng CDP ${cdpPort}; tự động khởi chạy Chrome với cổng gỡ lỗi...`);
    const debugProfileDir = path.join(tmpdir(), "chrome-cdp-profile");
    prepareExtensionProfile(debugProfileDir);

    const args = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${debugProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      ...webrtcAntiLeakFlags,
      ...proxyFlags,
    ];

    if (ENABLE_DEV_MODE) {
      args.push(
        "--enable-experimental-extension-apis",
        "--extensions-on-chrome-urls",
        "--silent-debugger-extension-api"
      );
    }

    if (extensionPath) {
      args.push(`--disable-extensions-except=${extensionPath}`);
      args.push(`--load-extension=${extensionPath}`);
    }

    const child = spawn(chromeBin, args, { detached: true, stdio: "ignore" });
    child.unref();
  }

  // Đợi cổng sẵn sàng (tối đa 15s)
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const ok = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(500),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      log(`✓ Chrome đã sẵn sàng trên cổng CDP ${cdpPort}${proxy ? ` (Proxy: ${proxy.server})` : ""}.`);
      return;
    }
  }

  throw new Error(`Không thể khởi động Chrome trên cổng CDP ${cdpPort} sau 15 giây.`);
}

// ---- Vân tay thiết bị / trình duyệt ---------------------------------------------------------

let cachedEngineMajor = null;

function parseMajor(text) {
  const match = /(\d{2,3})\.\d+\.\d+/.exec(String(text ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * Đọc major của Chromium TRƯỚC khi mở (cho chế độ tự khởi chạy): UA truyền lúc launch phải khớp
 * engine thật, bằng không request đầu của tab popup quảng cáo sẽ khai sai số bản.
 */
function detectEngineMajorFromExecutable() {
  if (cachedEngineMajor) return cachedEngineMajor;
  try {
    const exe = chromium.executablePath();
    if (!exe || !existsSync(exe)) return null;
    const out =
      process.platform === "win32"
        ? execSync(`powershell -NoProfile -Command "(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion"`, {
            encoding: "utf8",
            timeout: 8000,
          })
        : execSync(`"${exe}" --version`, { encoding: "utf8", timeout: 8000 });
    return parseMajor(out);
  } catch {
    return null;
  }
}

async function detectEngineMajorFromPage(context, page) {
  try {
    const session = await context.newCDPSession(page);
    const info = await session.send("Browser.getVersion");
    await session.detach().catch(() => {});
    return parseMajor(info?.product);
  } catch {
    return null;
  }
}

/**
 * Áp vân tay lên MỘT tab qua phiên CDP riêng. Phiên phải được GIỮ suốt chu kỳ: Chromium gỡ mọi
 * override Emulation ngay khi phiên đặt nó tách ra.
 */
async function applyFingerprintToPage(context, page, fp, { emulateMobileMetrics }) {
  const session = await context.newCDPSession(page);
  const override = {
    userAgent: fp.userAgent,
    acceptLanguage: fp.acceptLanguage,
    platform: fp.navigatorPlatform,
  };
  if (fp.userAgentMetadata) override.userAgentMetadata = fp.userAgentMetadata;
  await session
    .send("Emulation.setUserAgentOverride", override)
    .catch(() => session.send("Network.setUserAgentOverride", override).catch(() => {}));

  if (fp.isMobile) {
    if (emulateMobileMetrics) {
      await session
        .send("Emulation.setDeviceMetricsOverride", {
          width: fp.viewport.width,
          height: fp.viewport.height,
          deviceScaleFactor: fp.deviceScaleFactor,
          mobile: true,
          screenWidth: fp.screen.width,
          screenHeight: fp.screen.height,
        })
        .catch(() => {});
      await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
    }
    // Chuột → cảm ứng: trang di động nhận touchstart/touchend/click như ngón tay thật.
    await session.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" }).catch(() => {});
  }
  return session;
}

/**
 * Phóng to tối đa cửa sổ Chrome (Maximized) và đưa lên foreground để giao diện rộng nhất
 * và chuột phần cứng không bao giờ bị click tràn ra ngoài phạm vi cửa sổ.
 */
async function ensureWindowMaximized(session, page, instanceId = logContext.getStore()?.instanceId) {
  // Instance khác đang giữ lượt chuột hoặc chưa đến lượt tương tác: không giành foreground
  if (foregroundOwnedByOther(instanceId) || !canInteractForeground(instanceId)) return;
  try {
    if (page) await page.bringToFront().catch(() => {});
    const { windowId } = await session.send("Browser.getWindowForTarget");
    if (windowId) {
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "maximized" },
      });
    }
  } catch {}
}

async function maximizeAndFocusWindow(context, page, instanceId = logContext.getStore()?.instanceId) {
  if (foregroundOwnedByOther(instanceId) || !canInteractForeground(instanceId)) return;
  try {
    if (page) await page.bringToFront().catch(() => {});
    const session = await context.newCDPSession(page);
    try {
      await ensureWindowMaximized(session, page, instanceId);
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {}
}

async function runOneCycle(
  extensionPath,
  currentProxy = null,
  proxyManager = null,
  cycleIndex = 1,
  sharedProfileDir = null,
  fingerprintProfile = null,
  instanceId = 1
) {
  const useMyChrome =
    process.argv.includes("--my-chrome") ||
    process.argv.includes("--my-profile") ||
    process.env.USE_MY_CHROME === "1";

  const cdpArg = process.argv.find((a) => a.startsWith("--cdp"));
  const defaultCdpPort = instanceId > 1 ? String(9222 + (instanceId - 1)) : "9222";
  const cdpPort = cdpArg && cdpArg.includes("=") ? cdpArg.split("=")[1] : defaultCdpPort;
  const cdpUrl =
    process.env.CDP_URL ||
    (cdpArg
      ? cdpPort.startsWith("http")
        ? cdpPort
        : `http://127.0.0.1:${cdpPort}`
      : useMyChrome
      ? `http://127.0.0.1:${cdpPort}`
      : null);

  let context = null;
  let browser = null;
  let profileDir = null;
  let isTempProfile = false;
  let page = null;
  let navigationSucceeded = false;
  // Vân tay của chu kỳ này. Dựng sớm bằng số bản ước lượng (cần cho UA lúc launch), dựng lại
  // ngay khi đọc được engine thật nếu hai số lệch nhau.
  const fpLocale = currentProxy?.geo?.locale || "vi-VN";
  let fp = fingerprintProfile
    ? materializeFingerprint(fingerprintProfile, {
        engineMajor: cdpUrl ? cachedEngineMajor : cachedEngineMajor ?? detectEngineMajorFromExecutable(),
        locale: fpLocale,
      })
    : null;
  const fpSessions = [];
  let onFingerprintPage = null;
  let cycleClickMode = CLICK_MODE;
  const baseClickMode = cycleClickMode;
  const visitedDomains = [];

  try {
    log(
      isPatchedEngine
        ? "[AntiDetect] ✓ Kích hoạt Patched Chromium Engine (Patchright) — triệt tiêu rò rỉ CDP, Runtime.enable và cờ tự động hoá cấp trình duyệt."
        : "[AntiDetect] Chạy với Playwright Core mặc định."
    );
    log(`[AntiDetect] Cấu hình đệ quy click: ${MAX_RECURSIVE_CLICKS > 0 ? `Tối đa ${MAX_RECURSIVE_CLICKS} lần` : "Tắt (0 lần)"}`);
    if (cdpUrl) {
      log(`Kết nối tới Chrome ${useMyChrome ? "chính " : ""}qua CDP: ${cdpUrl}...`);
      try {
        if (cdpUrl.includes("127.0.0.1") || cdpUrl.includes("localhost")) {
          await ensureCdpServer(cdpPort, extensionPath, useMyChrome, currentProxy);
        }
        browser = await chromium.connectOverCDP(cdpUrl);
        context = browser.contexts()[0] || (await browser.newContext());
        if (ENABLE_DEV_MODE && context) {
          await ensureDeveloperMode(context);
        }
        if (currentProxy?.username && currentProxy?.password) {
          for (const ctx of browser.contexts()) {
            await ctx.setHTTPCredentials({
              username: currentProxy.username,
              password: currentProxy.password,
            }).catch(() => {});
          }
          browser.on("context", async (newCtx) => {
            await newCtx.setHTTPCredentials({
              username: currentProxy.username,
              password: currentProxy.password,
            }).catch(() => {});
          });
          log(`[Proxy] ✓ Đã cấu hình xác thực Proxy cho CDP Context (${currentProxy.username}).`);
        }
        log(`✓ Đã kết nối thành công tới Chrome ${useMyChrome ? "chính (đầy đủ extension) " : ""}qua CDP.`);
      } catch (err) {
        log(`✗ Không thể kết nối tới Chrome tại ${cdpUrl}: ${err.message}`);
        log(`  Gợi ý: Mở Chrome bằng lệnh: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${cdpPort}`);
        process.exit(1);
      }
    } else {
      if (sharedProfileDir) {
        profileDir = sharedProfileDir;
        isTempProfile = false;
        prepareExtensionProfile(profileDir);
      } else {
        profileDir = mkdtempSync(path.join(tmpdir(), "ad-viewer-profile-"));
        isTempProfile = true;
        prepareExtensionProfile(profileDir);
      }
    }

    if (!cdpUrl) {
      const args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--enable-experimental-extension-apis",
        "--extensions-on-chrome-urls",
        "--silent-debugger-extension-api",
        "--no-default-browser-check",
        "--no-first-run",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--enforce-webrtc-ip-permission-check",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      ];
      if (INSTANCE_COUNT <= 1) {
        args.push("--start-maximized");
      }

      if (extensionPath) {
        args.push(`--disable-extensions-except=${extensionPath}`);
        args.push(`--load-extension=${extensionPath}`);
        if (ENABLE_DEV_MODE) {
          log("✓ Đã nạp tiện ích CanvasBlocker và kích hoạt Developer Mode cho profile.");
        }
      }

      const isHeadless =
        !useMyChrome &&
        cycleClickMode !== "manual" &&
        cycleClickMode !== "os-mouse" &&
        cycleClickMode !== "ghub" &&
        !process.argv.includes("--head") &&
        !process.argv.includes("--visible") &&
        process.env.HEADLESS !== "0";
      const launchArgs = isHeadless ? [...args, "--headless=new"] : args;

      const defaultDesktopUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

      // Chuột phần cứng tính toạ độ từ cửa sổ THẬT, nên desktop ở các chế độ ấy không được giả lập
      // viewport (viewport: null = trang lấp đúng cửa sổ). Mobile luôn giả lập — chu kỳ mobile tự
      // chuyển sang click CDP ở dưới.
      const physicalMouse = cycleClickMode === "os-mouse" || cycleClickMode === "ghub" || cycleClickMode === "manual";
      const launchOptions = {
        headless: false,
        args: launchArgs,
        viewport: physicalMouse || !isHeadless ? null : { width: 1366, height: 768 },
        locale: fpLocale,
        timezoneId: currentProxy?.geo?.timezoneId || "Asia/Ho_Chi_Minh",
        userAgent: fp ? fp.userAgent : defaultDesktopUA,
      };
      if (fp) {
        if (fp.isMobile) {
          Object.assign(launchOptions, {
            viewport: physicalMouse || !isHeadless ? null : fp.viewport,
            screen: fp.screen,
            deviceScaleFactor: fp.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
          });
        } else if (physicalMouse || !isHeadless) {
          launchOptions.viewport = null;
        } else {
          Object.assign(launchOptions, {
            viewport: fp.viewport,
            screen: fp.screen,
            deviceScaleFactor: fp.deviceScaleFactor,
          });
        }
      }

      if (currentProxy) {
        launchOptions.proxy = {
          server: currentProxy.server,
          username: currentProxy.username || undefined,
          password: currentProxy.password || undefined,
        };
        if (currentProxy.geo?.lat !== undefined && currentProxy.geo?.lon !== undefined) {
          launchOptions.geolocation = {
            latitude: currentProxy.geo.lat,
            longitude: currentProxy.geo.lon,
            accuracy: 10,
          };
          launchOptions.permissions = ["geolocation"];
        }
      }

      const channel = useMyChrome ? "chrome" : "chromium";

      // Mở cửa sổ Chrome mới sẽ cướp foreground: khi nhiều instance, chỉ mở lúc
      // không instance nào đang trong lượt chuột.
      const guardLaunch = INSTANCE_COUNT > 1;
      await withForegroundSlot(instanceId, guardLaunch, async () => {
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
        if (ENABLE_DEV_MODE && context) {
          await ensureDeveloperMode(context);
        }
      });
      if (context && currentProxy?.username && currentProxy?.password) {
        await context.setHTTPCredentials({
          username: currentProxy.username,
          password: currentProxy.password,
        }).catch(() => {});
      }
    }

    // Tự động phát hiện và đóng sạch các tab cài đặt/giới thiệu của tiện ích (CanvasBlocker options/presets.html...)
    const closeExtensionPage = async (targetPage) => {
      if (!targetPage) return false;
      try {
        const u = targetPage.url();
        if (
          u.startsWith("chrome-extension://") ||
          u.includes("presets.html") ||
          u.includes("settings.html") ||
          u.includes("options.html") ||
          u.includes("canvasblocker")
        ) {
          log(`[Extension] Tự động đóng tab cài đặt/giới thiệu tiện ích CanvasBlocker (${u})...`);
          await targetPage.close().catch(() => {});
          return true;
        }
      } catch {}
      return false;
    };

    for (const p of context.pages()) {
      await closeExtensionPage(p);
    }

    context.on("page", (newPage) => {
      closeExtensionPage(newPage).catch(() => {});
      newPage.on("domcontentloaded", () => { closeExtensionPage(newPage).catch(() => {}); });
      newPage.on("framenavigated", (frame) => {
        if (frame === newPage.mainFrame()) {
          closeExtensionPage(newPage).catch(() => {});
        }
      });
    });

    const nonExtPages = context.pages().filter((p) => {
      const u = p.url();
      return (
        !u.startsWith("chrome-extension://") &&
        !u.includes("presets.html") &&
        !u.includes("settings.html") &&
        !u.includes("options.html")
      );
    });
    page = useMyChrome || cdpUrl ? await context.newPage() : nonExtPages[0] || (await context.newPage());
    await page.bringToFront().catch(() => {});
    await tagInstancePage(page, instanceId);
    page.on("domcontentloaded", () => { tagInstancePage(page, instanceId).catch(() => {}); });
    page.on("load", () => { tagInstancePage(page, instanceId).catch(() => {}); });

    if (foregroundOwnedByOther(instanceId)) {
      minimizeInstanceWindow(instanceId);
    } else {
      await maximizeAndFocusWindow(context, page, instanceId);
    }

    if (fp) {
      const realMajor = await detectEngineMajorFromPage(context, page);
      if (realMajor) {
        cachedEngineMajor = realMajor;
        fp = materializeFingerprint(fingerprintProfile, { engineMajor: realMajor, locale: fpLocale });
      }
      // Khi Chrome đã mở sẵn (CDP), không có tuỳ chọn launch nào áp được — mọi thứ đi qua CDP,
      // kể cả kích thước màn hình di động.
      const emulateMobileMetrics = Boolean(cdpUrl);
      const mainSession = await applyFingerprintToPage(context, page, fp, { emulateMobileMetrics }).catch(() => null);
      if (mainSession) {
        fpSessions.push(mainSession);
        if (canInteractForeground(instanceId)) {
          await ensureWindowMaximized(mainSession, page, instanceId);
        }
      }
      // Tab popup / popunder do quảng cáo mở ra cũng phải mang cùng danh tính và được phóng to.
      onFingerprintPage = (newPage) => {
        if (
          newPage.url().startsWith("chrome-extension://") ||
          newPage.url().includes("presets.html") ||
          newPage.url().includes("settings.html") ||
          newPage.url().includes("options.html")
        ) {
          newPage.close().catch(() => {});
          return;
        }
        tagInstancePage(newPage, instanceId).catch(() => {});
        applyFingerprintToPage(context, newPage, fp, { emulateMobileMetrics })
          .then((s) => {
            fpSessions.push(s);
            if (canInteractForeground(instanceId)) {
              return ensureWindowMaximized(s, newPage, instanceId);
            }
          })
          .catch(() => {});
      };
      context.on("page", onFingerprintPage);

      if (fp.isMobile && (cycleClickMode === "os-mouse" || cycleClickMode === "ghub")) {
        // Chuột phần cứng không ánh xạ được lên màn hình di động giả lập (viewport + DPR bị co
        // giãn trong cửa sổ). Chu kỳ này dùng CDP — vẫn là sự kiện isTrusted, và được Chromium
        // đổi thành chạm (touch) nhờ setEmitTouchEventsForMouse.
        cycleClickMode = "cdp";
        log(`[Fingerprint] Chu kỳ mobile: tạm chuyển chế độ click ${baseClickMode} → cdp (chạm cảm ứng).`);
      }
      log(`[Fingerprint] ${fp.summary}`);
      log(`[Fingerprint] UA: ${fp.userAgent}`);
    }

    // Cài đặt Anti-Detect overrides qua CDP
    try {
      const cdpClient = await context.newCDPSession(page).catch(() => null);
      if (cdpClient) {

        if (currentProxy?.geo) {
          if (currentProxy.geo.timezoneId) {
            await cdpClient.send("Emulation.setTimezoneOverride", {
              timezoneId: currentProxy.geo.timezoneId,
            }).catch(() => {});
          }
          if (currentProxy.geo.lat !== undefined && currentProxy.geo.lon !== undefined) {
            await cdpClient.send("Emulation.setGeolocationOverride", {
              latitude: currentProxy.geo.lat,
              longitude: currentProxy.geo.lon,
              accuracy: 10,
            }).catch(() => {});
            await context.grantPermissions(["geolocation"], { origin: WEB_URL }).catch(() => {});
          }
          // Khi bật vân tay, UA + ngôn ngữ đã được applyFingerprintToPage đặt theo locale của proxy.
          if (currentProxy.geo.locale && !fp) {
            const lang = currentProxy.geo.locale;
            const baseLang = lang.split("-")[0];
            const liveVer = (context.browser()?.version() || "134.0.0.0").split(".")[0] || "134";
            await cdpClient.send("Network.setUserAgentOverride", {
              userAgent:
                `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${liveVer}.0.0.0 Safari/537.36`,
              acceptLanguage: `${lang},${baseLang};q=0.9,en;q=0.8`,
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      log(`[AntiDetect] ⚠ Không thể cấu hình CDP overrides: ${err.message}`);
    }

    // Tiêm các lớp bảo vệ chống phát hiện và rò rỉ (Stealth Anti-Tracker Injections)
    await context.addInitScript(() => {
      // 1. Chống rò rỉ IP qua WebRTC STUN request
      if (window.RTCPeerConnection) {
        const origSetConfiguration = RTCPeerConnection.prototype.setConfiguration;
        if (origSetConfiguration) {
          RTCPeerConnection.prototype.setConfiguration = function (config) {
            if (config && config.iceCandidatePoolSize) config.iceCandidatePoolSize = 0;
            return origSetConfiguration.call(this, config);
          };
        }
      }

      // 2. Ẩn hoàn toàn cờ tự động hoá navigator.webdriver
      try {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
          configurable: true,
        });
      } catch {}

      // 3. Chuẩn hoá đối tượng window.chrome theo đúng chuẩn Chrome desktop thương mại
      try {
        if (!window.chrome) {
          window.chrome = {};
        }
        if (!window.chrome.app) {
          window.chrome.app = {
            isInstalled: false,
            InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
            RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
          };
        }
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            OnInstalledReason: {
              CHROME_UPDATE: "chrome_update",
              INSTALL: "install",
              SHARED_MODULE_UPDATE: "shared_module_update",
              UPDATE: "update",
            },
            PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
            PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
            PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
            RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
          };
        }
        if (!window.chrome.loadTimes) {
          window.chrome.loadTimes = function () {
            const now = Date.now() / 1000;
            return {
              commitLoadTime: now,
              connectionInfo: "http/1.1",
              finishDocumentLoadTime: now,
              finishLoadTime: now,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: now,
              navigationType: "Other",
              npnNegotiatedProtocol: "unknown",
              requestTime: now - 0.35,
              startLoadTime: now - 0.35,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: false,
            };
          };
        }
        if (!window.chrome.csi) {
          window.chrome.csi = function () {
            const now = Math.floor(Date.now());
            return { onloadT: now, pageT: now - 350, startE: now - 350, tran: 15 };
          };
        }
      } catch {}

      // 4. Chuẩn hoá plugins/mimeTypes nếu bị trống (đặc trưng của bot headless)
      try {
        if (!navigator.plugins || navigator.plugins.length === 0) {
          const fakePlugins = [
            { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          ];
          Object.defineProperty(navigator, "plugins", {
            get: () => fakePlugins,
            configurable: true,
          });
        }
      } catch {}

      // 5. Quét và triệt tiêu các thuộc tính tự động hoá nội bộ (cdc_...)
      try {
        for (const k of Object.keys(window)) {
          if (k.startsWith("cdc_") || k.includes("cdc_")) {
            delete window[k];
          }
        }
      } catch {}

      // 6. Cố định tag instance trên tiêu đề trang, ngăn chặn các script trang web (như thông báo tin nhắn mới) xoá mất tag
      try {
        const instTag = `[AdViewer-Inst-${instanceId}]`;
        let _docTitle = document.title || "";
        Object.defineProperty(document, "title", {
          configurable: true,
          enumerable: true,
          get: () => _docTitle,
          set: (val) => {
            const str = String(val || "");
            _docTitle = str.includes(instTag) ? str : `${instTag} ${str}`;
            try {
              let el = document.querySelector("title");
              if (!el) {
                el = document.createElement("title");
                document.head?.appendChild(el);
              }
              el.textContent = _docTitle;
            } catch {}
          },
        });
        if (!_docTitle.includes(instTag)) {
          document.title = `${instTag} ${_docTitle || "AdViewer"}`;
        }
        setInterval(() => {
          try {
            if (document.title && !document.title.includes(instTag)) {
              document.title = `${instTag} ${document.title}`;
            }
          } catch {}
        }, 500);
      } catch {}
    }).catch(() => {});

    // Vân tay chạy SAU lớp stealth: lớp stealth dựng lại window.chrome, mà hồ sơ Firefox/Safari
    // phải xoá nó đi.
    if (fp) await context.addInitScript(fingerprintInitScript, fp.inject).catch(() => {});

    if (!foregroundOwnedByOther(instanceId)) {
      await page.bringToFront().catch(() => {});
      await maximizeAndFocusWindow(context, page, instanceId);
    }

    const renderStartedAt = Date.now();
    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_GOTO_TIMEOUT_MS,
    });
    navigationSucceeded = true;
    await tagInstancePage(page, instanceId);

    // Cuộn trang tự nhiên để kích hoạt lazy-load quảng cáo (từng nhịp, có quán tính)
    await organicScroll(page, rand(250, 400), instanceId);
    await sleep(rand(300, 600));
    await organicScroll(page, rand(350, 550), instanceId);

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

    // Dừng đọc nội dung trang web tự nhiên trước khi click (tối đa 3 giây)
    const minReadingMs = Math.min(1500, MAX_READING_BEFORE_CLICK_MS);
    const readingBeforeClickMs = rand(minReadingMs, MAX_READING_BEFORE_CLICK_MS);
    log(`Đang đọc nội dung bài viết và lướt xem trang web trong ${(readingBeforeClickMs / 1000).toFixed(1)}s...`);
    await simulateHumanReading(page, readingBeforeClickMs, instanceId);

    // Nhận lượt độc quyền tương tác quảng cáo TRƯỚC khi quét quảng cáo: nếu phải chờ instance khác
    // xong chu kỳ, toạ độ và iframe banner quét từ trước có thể đã đổi — quét sau khi nhận lượt thì luôn mới.
    // Lượt được giữ tới cuối chu kỳ và nhả trong khối finally bên dưới.
    if (isPhysicalClickMode(cycleClickMode) || INSTANCE_COUNT > 1) {
      await acquireCycleTurn(instanceId);
      await tagInstancePage(page, instanceId);
      await page.bringToFront().catch(() => {});
      await maximizeAndFocusWindow(context, page, instanceId);
      if (process.platform === "win32") {
        focusInstanceWindow(instanceId);
      }
    }

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

    // 2. Banner ad creative trong các iframe quảng cáo (728x90, 468x60, 320x50, 300x250, 160x600, 160x300)
    try {
      const bannerIframes = page.locator(
        '.adsterra-banner[data-status="ready"] iframe, .adsterra-leaderboard[data-status="ready"] iframe, .adsterra-unit iframe',
      );
      const iframeCount = await bannerIframes.count().catch(() => 0);
      for (let f = 0; f < iframeCount; f++) {
        const iframeHandle = await bannerIframes.nth(f).elementHandle().catch(() => null);
        const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
        if (frame) {
          const bannerLinks = frame.locator("a[href]");
          const bannerCount = await bannerLinks.count().catch(() => 0);
          for (let i = 0; i < bannerCount; i++) {
            adCandidates.push({
              name: `Banner iframe #${f + 1} link ${i + 1}/${bannerCount}`,
              locator: bannerLinks.nth(i),
            });
          }
        }
      }
    } catch (err) {
      log(`Lỗi khi quét banner ads: ${err instanceof Error ? err.message : String(err)}`);
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

    if (CLICK_MODE === "manual") {
      const targetCandidate = adCandidates.length > 0 ? adCandidates[0] : null;
      const targetDesc = targetCandidate ? targetCandidate.name : "Vùng quảng cáo / Trang web";
      log("\n" + "=".repeat(64));
      log("🔔 [CHẾ ĐỘ BÁN TỰ ĐỘNG - THỦ CÔNG]");
      log(`👉 Đã định vị mục tiêu: "${targetDesc}"`);
      log("👉 Vui lòng dùng CHUỘT THẬT click vào khung quảng cáo viền đỏ trên màn hình Chrome!");
      log("⏳ Auto đang đếm ngược chờ bạn click (tối đa 45 giây)...");
      log("=".repeat(64) + "\n");
      try { process.stdout.write("\x07"); } catch {}

      if (targetCandidate?.locator) {
        await targetCandidate.locator.scrollIntoViewIfNeeded().catch(() => {});
        await targetCandidate.locator.evaluate((el) => {
          el.style.outline = "4px dashed #ff0055";
          el.style.outlineOffset = "4px";
          el.style.boxShadow = "0 0 30px #ff0055";
          const badge = document.createElement("div");
          badge.id = "manual-ad-badge";
          badge.innerText = "👉 DÙNG CHUỘT THẬT CLICK VÀO ĐÂY!";
          badge.style.position = "absolute";
          badge.style.top = "-38px";
          badge.style.left = "50%";
          badge.style.transform = "translateX(-50%)";
          badge.style.background = "#ff0055";
          badge.style.color = "#ffffff";
          badge.style.padding = "6px 14px";
          badge.style.borderRadius = "20px";
          badge.style.fontWeight = "bold";
          badge.style.fontSize = "13px";
          badge.style.zIndex = "2147483647";
          badge.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
          badge.style.pointerEvents = "none";
          el.parentElement?.appendChild(badge);
        }).catch(() => {});
      }
      await page.bringToFront().catch(() => {});

      const manualPage = await waitForManualUserClick(context, page, 45000);
      if (manualPage) {
        openedPage = manualPage;
        adClicked = true;
        log("✓ Đã nhận diện thao tác click chuột thật thành công từ người dùng!");
        log("🤖 Auto tự động tiếp quản: Bắt đầu đọc bài và tương tác trang đích...");
      } else {
        log("⚠ Đã hết thời gian 45s chờ click thủ công; chuyển sang chu kỳ tiếp theo.");
      }
    } else if (adCandidates.length > 0) {
      log(`Tìm thấy tổng cộng ${adCandidates.length} vị trí quảng cáo khả dụng. Đang chọn ngẫu nhiên để click (${cycleClickMode} mode)...`);
      for (const candidate of adCandidates) {
        const clickTarget = await resolveAdClickTarget(candidate.locator);
        if (!clickTarget) {
          log(`  Bỏ qua [${candidate.name}] — không xác định được toạ độ.`);
          continue;
        }
        log(`-> Click ngẫu nhiên quảng cáo [${candidate.name}] tại (${Math.round(clickTarget.x)}, ${Math.round(clickTarget.y)})...`);
        const newPage = await performEngageAndClick(page, context, clickTarget.x, clickTarget.y, instanceId, cycleClickMode);
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

    if (!adClicked && cycleClickMode !== "manual") {
      // Xáo trộn ngẫu nhiên thứ tự selector dự phòng
      const shuffledSelectors = [...candidateSelectors].sort(() => Math.random() - 0.5);
      for (const selector of shuffledSelectors) {
        const elements = await page.$$(selector);
        const shuffledElements = [...elements].sort(() => Math.random() - 0.5);
        for (const el of shuffledElements) {
          try {
            const visible = await el.isVisible().catch(() => false);
            if (!visible) continue;
            await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            await sleep(100);
            const elBox = await el.boundingBox().catch(() => null);
            if (!elBox || elBox.width < 2 || elBox.height < 2) continue;
            const target = computeClickTarget(elBox);
            log(`Tìm thấy quảng cáo khớp [${selector}], click tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
            const newPage = await performEngageAndClick(page, context, target.x, target.y, instanceId, cycleClickMode);
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
          } catch {
            // thử tiếp phần tử sau
          }
        }
        if (adClicked) break;
      }
    }

    // 4. Click tự nhiên để kích hoạt popunder nếu chưa click được
    if (!adClicked && cycleClickMode !== "manual") {
      log("Không click được quảng cáo cụ thể bằng selector; kích hoạt click mô phỏng tự nhiên trên trang...");
      const popTarget = { x: rand(200, 600), y: rand(200, 500) };
      const popup = await performEngageAndClick(page, context, popTarget.x, popTarget.y, instanceId, cycleClickMode);
      if (popup) {
        openedPage = popup;
        adClicked = true;
        log("✓ Popunder đã được kích hoạt.");
      }
    }

    // 5. Đọc trang quảng cáo chính và đệ quy click nếu có
    if (openedPage) {
      await tagInstancePage(openedPage, instanceId);
      if (process.platform === "win32") {
        focusInstanceWindow(instanceId);
      }
      await openedPage.waitForLoadState("domcontentloaded", { timeout: 25000 }).catch(() => {});
      try {
        const u = new URL(openedPage.url());
        if (u.hostname) visitedDomains.push(u.hostname);
      } catch {}
      const readingMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
      log(`Trải nghiệm và tương tác tự nhiên trên trang đích trong ${Math.round(readingMs / 1000)}s...`);
      await simulateLandingPageEngagement(openedPage, readingMs);

      // Đệ quy click thêm nếu còn quảng cáo trên trang đích (tối đa MAX_RECURSIVE_CLICKS)
      if (MAX_RECURSIVE_CLICKS > 0) {
        await handleRecursiveAdClicks(openedPage, 0, MAX_RECURSIVE_CLICKS, context, instanceId, cycleClickMode);
      }

      await withTimeout(openedPage.close().catch(() => {}), 2500);
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
    const isProxyNetworkError =
      errMsg.includes("ERR_PROXY") ||
      errMsg.includes("ERR_TUNNEL") ||
      errMsg.includes("ECONNRESET") ||
      errMsg.includes("ETIMEDOUT") ||
      errMsg.includes("ERR_TIMED_OUT") ||
      errMsg.includes("ERR_CONNECTION") ||
      errMsg.includes("ERR_NAME_NOT_RESOLVED") ||
      errMsg.includes("ERR_EMPTY_RESPONSE") ||
      errMsg.toLowerCase().includes("timeout") ||
      errMsg.toLowerCase().includes("exceeded");
    if (currentProxy && isProxyNetworkError) {
      log(`[ProxyManager] ⚠ Proxy ${currentProxy.server} phát sinh lỗi kết nối / timeout trong phiên duyệt web; tiến hành loại bỏ khỏi danh sách.`);
      proxyManager?.markDead(currentProxy);
      proxyManager?.flush();
    }
  } finally {
    // 1. Dọn dẹp triệt để 100% cache, cookies và storage của toàn bộ trình duyệt sau mỗi n chu kỳ
    const shouldCleanBrowserData =
      CLEAR_CACHE_CYCLES > 0 && cycleIndex % CLEAR_CACHE_CYCLES === 0;

    if (context && shouldCleanBrowserData) {
      log(
        `\n[Cache & Cookies] ✓ Đã hoàn thành mốc chu kỳ ${cycleIndex} (cứ mỗi ${CLEAR_CACHE_CYCLES} chu kỳ) — đang dọn dẹp triệt để 100% cache, cookies và storage toàn trình duyệt...`
      );
      try {
        await withTimeout(
          cleanupAllBrowserData(context, page),
          5000,
        ).catch(() => {});
      } catch {
        // bỏ qua lỗi dọn dẹp
      }
    } else if (CLEAR_CACHE_CYCLES > 0) {
      const step = ((cycleIndex - 1) % CLEAR_CACHE_CYCLES) + 1;
      log(
        `[Cache & Cookies] Bảo lưu cache và cookies phiên duyệt (tiến độ: ${step}/${CLEAR_CACHE_CYCLES} chu kỳ).`
      );
    } else {
      log("[Cache & Cookies] Bảo lưu cache và cookies toàn thời gian (tắt tự động xoá định kỳ).");
    }

    // Gỡ vân tay của chu kỳ: listener popup và các phiên CDP giữ override.
    if (onFingerprintPage && context) context.off("page", onFingerprintPage);
    for (const session of fpSessions) await session.detach().catch(() => {});

    if (cdpUrl) {
      // Trong chế độ CDP, đóng tất cả tab quảng cáo phụ nếu còn mở, và đóng tab chu kỳ với timeout bảo vệ
      try {
        if (context) {
          const allTabs = context.pages();
          for (const tab of allTabs) {
            if (tab !== page && !tab.isClosed()) {
              await withTimeout(tab.close().catch(() => {}), 1500).catch(() => {});
            }
          }
        }
      } catch {}
      if (page && !page.isClosed()) {
        await withTimeout(page.close().catch(() => {}), 2000);
      }
      // Ngắt kết nối CDP của chu kỳ. Với connectOverCDP, browser.close() CHỈ đóng WebSocket (đã
      // đọc mã Playwright: browserProcess.close = transport.closeAndWait) — Chrome thật vẫn chạy.
      // Không ngắt thì init script của danh tính cũ vẫn tiêm vào tab của danh tính mới.
      if (browser && fingerprintProfile) {
        await withTimeout(browser.close().catch(() => {}), 3000).catch(() => {});
      }
      if ((useMyChrome || cdpUrl) && (proxyManager?.hasMultipleProxies() || !navigationSucceeded)) {
        log("✓ Tắt Chrome để làm mới socket mạng và chuẩn bị chu kỳ tiếp theo...");
        killChromeProcesses();
        await sleep(1500);
      }
    } else {
      if (context) {
        await withTimeout(context.close().catch(() => {}), 3500);
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
    releaseCycleTurn(instanceId);
  }
}

async function main() {
  log(`Khởi động tiến trình xem quảng cáo (bản: ${currentVersion ?? "chưa rõ"})`);
  log(`Website đích: ${WEB_URL}`);
  log(`Tuổi thọ tối đa: ${Math.round(MAX_LIFETIME_MS / 60000)} phút`);
  const clickModeDesc =
    CLICK_MODE === "os-mouse"
      ? "OS Physical Mouse — Windows SendInput/mouse_event phần cứng"
      : CLICK_MODE === "manual"
      ? "Bán tự động / Thủ công — Dừng chờ bạn click tay rồi tự động chạy tiếp"
      : CLICK_MODE === "mouse"
      ? "Playwright Mouse API — Quỹ đạo cong Bézier"
      : "CDP Input.dispatchMouseEvent — isTrusted:true";
  log(`Chế độ click: ${CLICK_MODE} (${clickModeDesc})`);

  const hoverDesc =
    HOVER_CONFIG.minMs === HOVER_CONFIG.maxMs
      ? `${HOVER_CONFIG.minMs}ms (${(HOVER_CONFIG.minMs / 1000).toFixed(1)}s)`
      : `${HOVER_CONFIG.minMs}-${HOVER_CONFIG.maxMs}ms (${(HOVER_CONFIG.minMs / 1000).toFixed(1)}-${(HOVER_CONFIG.maxMs / 1000).toFixed(1)}s)`;
  log(`Thời gian hover trên quảng cáo trước khi click: ${hoverDesc}${HOVER_CONFIG.userSpecified ? " (tuỳ chỉnh)" : " (mặc định)"}`);

  const extPath = USE_CANVAS_BLOCKER ? resolveExtensionPath() : null;
  if (extPath) {
    log(`✓ Đã nạp tiện ích CanvasBlocker từ: ${extPath}`);
  } else if (USE_CANVAS_BLOCKER) {
    log("⚠ Bật cờ CanvasBlocker nhưng không tìm thấy thư mục tiện ích; chạy Chromium tiêu chuẩn.");
  } else {
    log("Tiện ích CanvasBlocker: tắt (mặc định). Dùng --canvas-blocker để bật.");
  }

  const cleanCyclesDesc =
    CLEAR_CACHE_CYCLES === 0
      ? "Tắt (không tự động xoá)"
      : CLEAR_CACHE_CYCLES === 1
      ? "Sau mỗi chu kỳ (1 chu kỳ)"
      : `Sau mỗi ${CLEAR_CACHE_CYCLES} chu kỳ`;
  log(`Chu kỳ xoá cache & cookies: ${cleanCyclesDesc}`);

  if (FINGERPRINT_ENABLED) {
    const deviceDesc =
      DEVICE_MODE === "desktop" ? "Chỉ desktop" : DEVICE_MODE === "mobile" ? "Chỉ mobile" : `Ngẫu nhiên (mobile ${Math.round(MOBILE_RATIO * 100)}%)`;
    log(`Vân tay thiết bị: ${deviceDesc} · Trình duyệt: ${BROWSER_SELECTION.browsers.join(", ")}`);
    if (BROWSER_SELECTION.unknown.length > 0) {
      log(`⚠ Bỏ qua tên trình duyệt không nhận ra: ${BROWSER_SELECTION.unknown.join(", ")}`);
    }
  } else {
    log("Vân tay thiết bị: tắt (--no-fingerprint) — dùng UA Chrome Windows cố định.");
  }

  log(`Số lượng instance: ${INSTANCE_COUNT}${INSTANCE_COUNT > 1 ? " (Chế độ chạy song song đa instance)" : " (Chế độ đơn lẻ)"}`);

  const proxyManager = new ProxyManager();
  proxyManager.init();

  const startTime = Date.now();

  if (INSTANCE_COUNT === 1) {
    await runInstanceLoop(1, proxyManager, extPath, startTime);
  } else {
    log(`Khởi chạy đồng thời ${INSTANCE_COUNT} instance (Mỗi instance độc lập profile, proxy, fingerprint và điều phối mutex chuột)...`);
    const instancePromises = [];
    for (let id = 1; id <= INSTANCE_COUNT; id++) {
      instancePromises.push(runInstanceLoop(id, proxyManager, extPath, startTime));
    }
    const results = await Promise.allSettled(instancePromises);
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === "rejected") {
        log(`⚠ Instance #${i + 1} kết thúc với lỗi: ${res.reason?.message || res.reason}`);
      }
    }
  }

  log("Ca trực hoàn tất bình thường. Thoát mã 0.");
  process.exit(0);
}

async function runInstanceLoop(instanceId, proxyManager, extPath, startTime) {
  return logContext.run({ instanceId }, async () => {
    if (instanceId > 1) {
      const staggerDelayMs = (instanceId - 1) * 8000;
      log(`Khởi động so le (Staggered start): Chờ ${staggerDelayMs / 1000}s trước khi mở instance #${instanceId}...`);
      await sleep(staggerDelayMs);
    }

    let cycle = 0;
    let sharedProfileDir = null;
    let fingerprintProfile = null;
    let currentProxy = null;

    try {
      while (Date.now() - startTime < MAX_LIFETIME_MS) {
        cycle++;
        log(`\n=================== BẮT ĐẦU CHU KỲ ${cycle} ===================`);
        currentProxy = await proxyManager.getNextWorkingProxy(instanceId, currentProxy);

        // Danh tính mới chỉ ra đời ở đầu một cửa sổ cookie (ngay sau lượt xoá cache) — n = 0 thì
        // giữ một danh tính cho cả ca trực.
        const identityWindowStart = CLEAR_CACHE_CYCLES > 0 && (cycle - 1) % CLEAR_CACHE_CYCLES === 0;
        if (FINGERPRINT_ENABLED && (!fingerprintProfile || identityWindowStart)) {
          fingerprintProfile = pickFingerprintProfile({
            device: DEVICE_MODE,
            browsers: BROWSER_SELECTION.browsers,
            mobileRatio: MOBILE_RATIO,
          });
          for (const note of fingerprintProfile.notes) log(`[Fingerprint] ⚠ ${note}`);
          log(`[Fingerprint] Danh tính mới cho ${CLEAR_CACHE_CYCLES > 0 ? `${CLEAR_CACHE_CYCLES} chu kỳ tới` : "cả ca trực"}.`);
        }

        if (
          !process.argv.some((a) => a.startsWith("--cdp")) &&
          !process.env.CDP_URL &&
          !process.argv.includes("--my-chrome") &&
          !process.argv.includes("--my-profile") &&
          process.env.USE_MY_CHROME !== "1"
        ) {
          if (!sharedProfileDir) {
            sharedProfileDir = mkdtempSync(path.join(tmpdir(), `ad-viewer-profile-inst${instanceId}-`));
            prepareExtensionProfile(sharedProfileDir);
          }
        }

        try {
          await runOneCycle(
            extPath,
            currentProxy,
            proxyManager,
            cycle,
            sharedProfileDir,
            fingerprintProfile,
            instanceId
          );
        } finally {
          proxyManager.releaseProxy(currentProxy);
          currentProxy = null;
        }

        if (sharedProfileDir && CLEAR_CACHE_CYCLES > 0 && cycle % CLEAR_CACHE_CYCLES === 0) {
          try {
            rmSync(sharedProfileDir, { recursive: true, force: true });
          } catch {}
          sharedProfileDir = null;
        }

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
          log("Hết thời gian tuổi thọ ca trực. Đóng instance an toàn.");
          break;
        }

        const restMs = rand(2000, 5000);
        await sleep(restMs);
      }
    } finally {
      releaseCycleTurn(instanceId, { quiet: true });
      if (sharedProfileDir) {
        try {
          rmSync(sharedProfileDir, { recursive: true, force: true });
        } catch {}
      }
      if (currentProxy) {
        proxyManager.releaseProxy(currentProxy);
      }
    }
  });
}

const isDirectExecution =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith("adViewer.mjs") ||
    process.argv[1].endsWith("ad-viewer.mjs"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Lỗi chí mạng:", err);
    process.exit(1);
  });
}

export { ProxyManager, parseProxyItem };
