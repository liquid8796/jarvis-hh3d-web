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
  resolveCustomDevice,
} from "./adViewerFingerprint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tự động gia cố PipeTransport trong patchright-core và playwright-core để ngăn chặn
// lỗi tràn bộ đệm ERR_STRING_TOO_LONG khi gặp trang web quảng cáo tải luồng dữ liệu lớn
function ensureResilientPipeTransport() {
  const candidates = [
    "../node_modules/patchright-core/lib/coreBundle.js",
    "node_modules/patchright-core/lib/coreBundle.js",
    "../node_modules/playwright-core/lib/coreBundle.js",
    "node_modules/playwright-core/lib/coreBundle.js",
  ];
  for (const rel of candidates) {
    try {
      const p = path.resolve(__dirname, rel);
      if (!existsSync(p)) continue;
      let content = readFileSync(p, "utf8");
      if (content.includes("// PATCHED_PIPE_TRANSPORT")) continue;

      const target = "this._pendingBuffers.push(buffer.slice(0, end));\n        const message = Buffer.concat(this._pendingBuffers).toString();";
      if (!content.includes(target)) continue;

      const replacement = "// PATCHED_PIPE_TRANSPORT\n" +
        "        this._pendingBuffers.push(buffer.slice(0, end));\n" +
        "        let message = null;\n" +
        "        try {\n" +
        "          message = Buffer.concat(this._pendingBuffers).toString();\n" +
        "        } catch {\n" +
        "          this._pendingBuffers = [];\n" +
        "        }";

      const targetBufferPush = "if (end === -1) {\n          this._pendingBuffers.push(buffer);\n          return;\n        }";
      const replacementBufferPush = "if (end === -1) {\n" +
        "          this._pendingBuffers.push(buffer);\n" +
        "          let totalLen = 0;\n" +
        "          for (let i = 0; i < this._pendingBuffers.length; i++) totalLen += this._pendingBuffers[i].length;\n" +
        "          if (totalLen > 16 * 1024 * 1024) this._pendingBuffers = [];\n" +
        "          return;\n" +
        "        }";

      content = content.replace(target, replacement);
      content = content.replace(targetBufferPush, replacementBufferPush);
      content = content.replace(
        "this.onmessage.call(null, JSON.parse(message));",
        "if (message) { try { this.onmessage.call(null, JSON.parse(message)); } catch {} }"
      );
      writeFileSync(p, content, "utf8");
    } catch {}
  }
}

ensureResilientPipeTransport();

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

// Bắt các lỗi protocol không đồng bộ nội bộ của Patchright/Playwright (như session closed, target closed,
// ERR_STRING_TOO_LONG tràn bộ đệm pipe từ trang đích bên thứ 3) để không làm sập toàn bộ tiến trình auto.
function isIgnorableProtocolError(err) {
  const msg = (err?.message || String(err || "")).toLowerCase();
  const stack = (err?.stack || "").toLowerCase();
  const code = (err?.code || "").toLowerCase();
  const hasIgnorablePattern =
    msg.includes("session closed") ||
    msg.includes("target closed") ||
    msg.includes("browser has been closed") ||
    msg.includes("connection closed") ||
    msg.includes("target page, context or browser has been closed") ||
    msg.includes("network.setcachedisabled") ||
    msg.includes("internal server error, session closed") ||
    msg.includes("cannot create a string longer than") ||
    msg.includes("err_string_too_long") ||
    code === "err_string_too_long" ||
    msg.includes("pipetransport") ||
    msg.includes("pipe has been closed");

  return (
    hasIgnorablePattern &&
    (stack.includes("patchright") ||
      stack.includes("playwright") ||
      stack.includes("pipetransport") ||
      stack.includes("buffer.tostring") ||
      msg.includes("protocol error") ||
      code === "err_string_too_long")
  );
}

process.on("unhandledRejection", (reason) => {
  if (isIgnorableProtocolError(reason)) {
    console.warn(`[Cảnh báo UnhandledRejection - Bỏ qua lỗi giao thức]: ${reason?.message || reason}`);
    return;
  }
  const msg = reason?.message || String(reason || "");
  console.warn(`[Cảnh báo UnhandledRejection]: ${msg}`);
});

process.on("uncaughtException", (err) => {
  if (isIgnorableProtocolError(err)) {
    console.warn(`[Cảnh báo UncaughtException - Bỏ qua lỗi giao thức]: ${err?.message || err}`);
    return;
  }
  console.error("Lỗi chí mạng (Uncaught Exception):", err);
  process.exit(1);
});

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

function getCliArg(flag) {
  const withEq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1).replace(/^["']|["']$/g, "").trim();
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

function parseRenderTimeoutConfig() {
  const cli =
    getCliArg("--render-timeout") ||
    getCliArg("--ad-timeout") ||
    getCliArg("--max-render-wait") ||
    getCliArg("--ad-render-timeout") ||
    process.argv.find((a) => a.startsWith("--render-timeout="))?.split("=")[1] ||
    process.argv.find((a) => a.startsWith("--ad-timeout="))?.split("=")[1] ||
    process.argv.find((a) => a.startsWith("--max-render-wait="))?.split("=")[1] ||
    process.argv.find((a) => a.startsWith("--ad-render-timeout="))?.split("=")[1] ||
    "";
  const env =
    process.env.AD_VIEWER_RENDER_TIMEOUT_MS ||
    process.env.AD_VIEWER_RENDER_TIMEOUT ||
    process.env.AD_VIEWER_AD_READY_TIMEOUT_MS ||
    "";
  const raw = (cli || env || "").trim().toLowerCase();
  if (!raw) {
    return { timeoutMs: 10_000, userSpecified: false };
  }
  let ms = 10_000;
  if (raw.endsWith("ms")) {
    ms = Number(raw.replace("ms", "").trim());
  } else if (raw.endsWith("s")) {
    ms = Number(raw.replace("s", "").trim()) * 1000;
  } else {
    const val = Number(raw);
    if (!Number.isNaN(val)) {
      ms = val < 100 ? val * 1000 : val;
    }
  }
  ms = Math.max(1000, Number.isNaN(ms) ? 10_000 : Math.round(ms));
  return { timeoutMs: ms, userSpecified: true };
}

const RENDER_TIMEOUT_CONFIG = parseRenderTimeoutConfig();
const AD_READY_TIMEOUT_MS = RENDER_TIMEOUT_CONFIG.timeoutMs;

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

function parsePopunderRatio(input) {
  const cli =
    input !== undefined
      ? String(input)
      : getCliArg("--popunder-ratio") ||
        getCliArg("--popunder-prob") ||
        getCliArg("--popunder-probability") ||
        getCliArg("--popunder-rate");
  const env = input === undefined ? process.env.AD_VIEWER_POPUNDER_RATIO || process.env.AD_VIEWER_POPUNDER_PROB : "";
  const raw = (cli || env || "").trim().toLowerCase();
  if (!raw) return 0.8;
  const cleaned = raw.replace(/%/g, "").trim();
  const num = Number(cleaned);
  if (Number.isNaN(num) || num < 0) return 0.8;
  if (num > 1) return Math.min(1, num / 100);
  return Math.min(1, num);
}

const POPUNDER_RATIO = parsePopunderRatio();

const TRAFFIC_SOURCES = {
  google: {
    id: "google",
    name: "Google Search (Organic)",
    referrers: [
      "https://www.google.com/",
      "https://www.google.com/search?q=auto+hh3d",
      "https://www.google.com/search?q=auto+hh3d+online",
      "https://www.google.com.vn/",
      "https://www.google.com.vn/search?q=auto+hoathinh3d",
      "https://www.google.com.vn/search?q=auto+hh3d",
    ],
  },
  facebook: {
    id: "facebook",
    name: "Facebook (Social)",
    referrers: [
      "https://l.facebook.com/",
      "https://www.facebook.com/",
      "https://m.facebook.com/",
      "https://lm.facebook.com/",
    ],
  },
  instagram: {
    id: "instagram",
    name: "Instagram (Social)",
    referrers: [
      "https://l.instagram.com/",
      "https://www.instagram.com/",
    ],
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok (Social)",
    referrers: [
      "https://www.tiktok.com/",
      "https://link.tiktok.com/",
    ],
  },
  x: {
    id: "x",
    name: "X / Twitter (Social)",
    referrers: [
      "https://t.co/",
      "https://x.com/",
      "https://twitter.com/",
    ],
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT (AI Referral)",
    referrers: [
      "https://chatgpt.com/",
      "https://chat.openai.com/",
    ],
  },
  claude: {
    id: "claude",
    name: "Claude (Anthropic AI Referral)",
    referrers: [
      "https://claude.ai/",
      "https://www.claude.ai/",
    ],
  },
  grok: {
    id: "grok",
    name: "Grok (xAI Referral)",
    referrers: [
      "https://grok.com/",
      "https://x.com/i/grok",
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini (AI Referral)",
    referrers: [
      "https://gemini.google.com/",
      "https://gemini.google.com/app",
    ],
  },
};

function parseTrafficSource(argv = process.argv, env = process.env) {
  const cli =
    argv.find((a) => a.startsWith("--traffic-source="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--traffic-src="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--referrer="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--referer="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--source="))?.split("=")[1];

  const envVal = env.AD_VIEWER_TRAFFIC_SOURCE || env.AD_VIEWER_REFERRER || "";
  const raw = (cli || envVal || "none").trim().toLowerCase();

  if (raw === "all" || raw === "random" || raw === "any") return "all";
  if (raw === "google" || raw === "googlesearch" || raw === "search") return "google";
  if (raw === "facebook" || raw === "fb") return "facebook";
  if (raw === "instagram" || raw === "ig" || raw === "insta") return "instagram";
  if (raw === "tiktok" || raw === "tt") return "tiktok";
  if (raw === "x" || raw === "twitter") return "x";
  if (raw === "chatgpt" || raw === "openai") return "chatgpt";
  if (raw === "claude" || raw === "anthropic") return "claude";
  if (raw === "grok" || raw === "xai") return "grok";
  if (raw === "gemini" || raw === "google-gemini") return "gemini";
  return "none";
}

function parseTrafficRatio(argv = process.argv, env = process.env) {
  const cli =
    argv.find((a) => a.startsWith("--traffic-ratio="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--traffic-rate="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--traffic-prob="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--traffic-probability="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--referrer-ratio="))?.split("=")[1] ||
    argv.find((a) => a.startsWith("--source-ratio="))?.split("=")[1];

  const envVal = env.AD_VIEWER_TRAFFIC_RATIO || env.AD_VIEWER_REFERRER_RATIO || "";
  const raw = (cli || envVal || "").trim().toLowerCase();
  if (!raw) return 0.8;
  const cleaned = raw.replace(/%/g, "").trim();
  const num = Number(cleaned);
  if (Number.isNaN(num) || num < 0) return 0.8;
  if (num > 1) return Math.min(1, num / 100);
  return Math.min(1, num);
}

function resolveTrafficReferrer(trafficSource = TRAFFIC_SOURCE, trafficRatio = TRAFFIC_RATIO, rng = Math.random) {
  if (!trafficSource || trafficSource === "none") {
    return {
      active: false,
      sourceKey: "direct",
      sourceName: "Truy cập trực tiếp (Direct Traffic)",
      referrer: null,
    };
  }

  const roll = rng();
  if (roll >= trafficRatio) {
    return {
      active: false,
      sourceKey: "direct",
      sourceName: "Truy cập trực tiếp (Direct Traffic)",
      referrer: null,
    };
  }

  const sourceKey =
    trafficSource === "all"
      ? Object.keys(TRAFFIC_SOURCES)[Math.floor(rng() * Object.keys(TRAFFIC_SOURCES).length)]
      : trafficSource;

  const cfg = TRAFFIC_SOURCES[sourceKey];
  if (!cfg) {
    return {
      active: false,
      sourceKey: "direct",
      sourceName: "Truy cập trực tiếp (Direct Traffic)",
      referrer: null,
    };
  }

  const referrer = cfg.referrers[Math.floor(rng() * cfg.referrers.length)];
  return {
    active: true,
    sourceKey,
    sourceName: cfg.name,
    referrer,
  };
}

const TRAFFIC_SOURCE = parseTrafficSource();
const TRAFFIC_RATIO = parseTrafficRatio();

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
const SOCIAL_BAR_KEY = "977a66f06e979e2830ee60ed1fa88533";
const SOCIAL_BAR_SELECTOR = `iframe[id*="${SOCIAL_BAR_KEY}"], iframe[class*="${SOCIAL_BAR_KEY}"], iframe[style*="2147483647"], iframe[id*="container-"][style*="fixed"]`;
const CLICKADU_CONTAINER_SELECTOR = "#clickadu-ad-container, .clickadu-container, [id*='clickadu']";
const ADCASH_CONTAINER_SELECTOR =
  "#adcash-ad-container, .adcash-container, [id*='aclib'], [class*='aclib'], [id*='adcash'], iframe[src*='acscdn'], iframe[src*='adcash']";

const rawClickMode = (
  process.argv.find((a) => a.startsWith("--click-mode="))?.split("=")[1] ||
  process.env.AD_VIEWER_CLICK_MODE ||
  ""
).toLowerCase();

const IS_EXPLICIT_HEADLESS =
  process.argv.includes("--headless") ||
  process.argv.includes("--headless=new") ||
  process.env.HEADLESS === "1";
const IS_EXPLICIT_HEADED =
  process.argv.includes("--head") ||
  process.argv.includes("--visible") ||
  process.env.HEADLESS === "0";

function parseFocusPopunderSocial(cliArgs = process.argv, env = process.env) {
  if (cliArgs.includes("--no-focus-popunder-social") || cliArgs.includes("--no-focus-popunder") || cliArgs.includes("--with-native")) {
    return false;
  }
  if (
    cliArgs.includes("--focus-popunder-social") ||
    cliArgs.includes("--focus-popunder") ||
    cliArgs.includes("--no-native-click") ||
    cliArgs.includes("--no-native") ||
    cliArgs.includes("--focus-high-cpm") ||
    env.AD_VIEWER_FOCUS_POPUNDER_SOCIAL === "1" ||
    env.AD_VIEWER_NO_NATIVE === "1"
  ) {
    return true;
  }
  const isHeadless =
    cliArgs.includes("--headless") ||
    cliArgs.includes("--headless=new") ||
    env.HEADLESS === "1";
  return isHeadless;
}

const FOCUS_POPUNDER_SOCIAL = parseFocusPopunderSocial();

function parseAdNetwork(cliArgs = process.argv, env = process.env) {
  const cli =
    getCliArg("--ad-network") ||
    getCliArg("--ad-provider") ||
    getCliArg("--network") ||
    cliArgs.find((a) => a.startsWith("--ad-network="))?.split("=")[1] ||
    cliArgs.find((a) => a.startsWith("--ad-provider="))?.split("=")[1] ||
    cliArgs.find((a) => a.startsWith("--network="))?.split("=")[1] ||
    "";
  const envVal = env.AD_VIEWER_AD_NETWORK || env.AD_VIEWER_AD_PROVIDER || env.AD_PROVIDER || "";
  const raw = (cli || envVal || "").trim().toLowerCase();
  if (raw === "adcash") return "adcash";
  if (raw === "clickadu") return "clickadu";
  if (raw === "adsterra") return "adsterra";
  if (raw === "all" || raw === "both") return "all";
  return "adcash";
}

const AD_NETWORK = parseAdNetwork();

function parseAntiDetectProxy(cliArgs = process.argv, env = process.env) {
  if (
    cliArgs.includes("--no-anti-detect-proxy") ||
    cliArgs.includes("--no-antidetect-proxy") ||
    cliArgs.includes("--no-anti-detect")
  ) {
    return false;
  }
  if (env.AD_VIEWER_ANTI_DETECT_PROXY === "0" || env.AD_VIEWER_ANTI_DETECT === "0") {
    return false;
  }
  if (
    cliArgs.includes("--anti-detect-proxy") ||
    cliArgs.includes("--antidetect-proxy") ||
    cliArgs.includes("--anti-detect")
  ) {
    return true;
  }
  if (env.AD_VIEWER_ANTI_DETECT_PROXY === "1" || env.AD_VIEWER_ANTI_DETECT === "1") {
    return true;
  }
  return true;
}

const ANTI_DETECT_PROXY = parseAntiDetectProxy();

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
  (process.argv.includes("--my-chrome") || process.env.USE_MY_CHROME === "1") &&
  !IS_EXPLICIT_HEADLESS
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
    this._currentTag = "";
    this._acquiredAt = 0;
  }

  async acquire(tag = "", timeoutMs = 60000) {
    if (!this._locked) {
      this._locked = true;
      this._currentTag = tag;
      this._acquiredAt = Date.now();
      return () => this.release();
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      const ticket = () => {
        if (timer) clearTimeout(timer);
        this._locked = true;
        this._currentTag = tag;
        this._acquiredAt = Date.now();
        resolve(() => this.release());
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this._queue.indexOf(ticket);
          if (idx !== -1) {
            this._queue.splice(idx, 1);
          }
          reject(new Error(`Timeout acquiring mutex [${tag}] sau ${timeoutMs}ms (dang giu boi ${this._currentTag})`));
        }, timeoutMs);
      }

      this._queue.push(ticket);
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
      this._currentTag = "";
      this._acquiredAt = 0;
    }
  }

  forceRelease() {
    this._locked = false;
    this._currentTag = "";
    this._acquiredAt = 0;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    }
  }

  get isLocked() {
    if (this._locked && this._acquiredAt > 0 && Date.now() - this._acquiredAt > 180000) {
      console.warn(`[AsyncMutex] ⚠ Phat hien lock bi chiem giu qua 180s (${this._currentTag}). Tu dong giai phong phong ngua deadlock!`);
      this.forceRelease();
    }
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
  if (IS_EXPLICIT_HEADLESS || process.platform !== "win32" || !instanceId || instanceId <= 0) return;
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
  if (IS_EXPLICIT_HEADLESS || process.platform !== "win32" || !instanceId || instanceId <= 0) return;
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
  if (IS_EXPLICIT_HEADLESS) return true;
  if (INSTANCE_COUNT <= 1) return true;
  return turnHolder === instanceId;
}

async function acquireCycleTurn(instanceId, { quiet = false, timeoutMs = 90000 } = {}) {
  if (IS_EXPLICIT_HEADLESS) return true;
  if (cycleTurns.has(instanceId)) return false;
  if (mouseMutex.isLocked && !quiet) {
    const holderDesc = turnHolder !== null ? `#${turnHolder}` : "khác";
    log(`[CycleTurn] Instance ${holderDesc} đang trong lượt click & kết thúc chu kỳ — chờ nó kết thúc chu kỳ (hàng đợi: ${mouseMutex.queueLength + 1})...`);
  }
  try {
    const unlock = await mouseMutex.acquire(`inst-${instanceId}`, timeoutMs);
    cycleTurns.set(instanceId, unlock);
    turnHolder = instanceId;
    if (!quiet && INSTANCE_COUNT > 1) {
      log("[CycleTurn] ✓ Nhận lượt độc quyền tương tác quảng cáo — giữ tới khi kết thúc trọn chu kỳ này.");
    }
    return true;
  } catch (err) {
    if (!quiet) {
      log(`[CycleTurn] ⚠ Hết thời gian chờ lượt chuột cho instance #${instanceId}: ${err.message}. Tiếp tục thao tác an toàn.`);
    }
    return false;
  }
}

function releaseCycleTurn(instanceId, { quiet = false } = {}) {
  if (IS_EXPLICIT_HEADLESS) return;
  const unlock = cycleTurns.get(instanceId);
  cycleTurns.delete(instanceId);
  if (turnHolder === instanceId) turnHolder = null;
  if (unlock) {
    if (!quiet && INSTANCE_COUNT > 1) {
      log("[CycleTurn] ✓ Kết thúc trọn chu kỳ — nhả lượt tương tác quảng cáo cho instance kế tiếp.");
    }
    try { unlock(); } catch {}
  } else if (mouseMutex.isLocked && turnHolder === null && cycleTurns.size === 0) {
    mouseMutex.forceRelease();
  }
}

/**
 * Chạy một thao tác làm đổi cửa sổ foreground (mở trình duyệt mới...) khi không ai đang giữ lượt
 * chuột — mở một cửa sổ Chrome mới giữa lúc instance khác đang rê chuột thật sẽ cướp foreground và
 * làm cú click rơi sang cửa sổ khác.
 */
async function withForegroundSlot(instanceId, enabled, fn) {
  if (IS_EXPLICIT_HEADLESS || !enabled || cycleTurns.has(instanceId)) return fn();
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
  if (IS_EXPLICIT_HEADLESS) return false;
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
    this.antiDetectProxy = options.antiDetectProxy !== undefined ? options.antiDetectProxy : ANTI_DETECT_PROXY;
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
        log(`[ProxyManager] Chế độ: 1 Proxy cố định (${p.server}) [Bảo vệ cố định, không chuyển về Direct IP].`);
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
    return !this.noProxy && (Boolean(this.directProxy) || Boolean(this.rotateUrl) || this.proxyList.length > 0);
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
    if (this.directProxy) {
      // Proxy cố định do người dùng chỉ định tuyệt đối không tự ý huỷ bỏ hoặc đánh dấu chết
      return;
    }
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
    if (this.directProxy) return;
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
    if (!this.antiDetectProxy || !proxy || !proxy.host) return null;
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

    if (this.directProxy) {
      let single = this.proxyList[0];
      if (!single) {
        single = parseProxyItem(this.directProxy);
        if (single) this.proxyList = [single];
      }
      if (single) {
        if (this.antiDetectProxy && !single.geo) {
          single.geo = await this.resolveGeo(single);
        }
        return single;
      }
      return null;
    }

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
            if (this.antiDetectProxy) {
              p.geo = await this.resolveGeo(p);
              log(
                `[ProxyManager] ✓ Đã nhận proxy mới từ API cho instance #${instanceId}: ${p.server} | ` +
                `Vị trí: ${p.geo?.city}, ${p.geo?.country} | Timezone: ${p.geo?.timezoneId} | Locale: ${p.geo?.locale}`
              );
            } else {
              log(`[ProxyManager] ✓ Đã nhận proxy mới từ API cho instance #${instanceId}: ${p.server} (Anti-Detect Proxy: TẮT)`);
            }
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
      if (this.antiDetectProxy && !single.geo) single.geo = await this.resolveGeo(single);
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
        if (this.antiDetectProxy) {
          alive.geo = await this.resolveGeo(alive);
        }
        const aliveIdx = this.proxyList.findIndex((p) => p.host === alive.host && p.port === alive.port);
        if (aliveIdx !== -1) {
          this.currentIndex = (aliveIdx + 1) % Math.max(1, this.proxyList.length);
        }
        if (this.antiDetectProxy && alive.geo) {
          log(
            `[ProxyManager] ✓ Đã tìm thấy Proxy kết nối tốt cho instance #${instanceId}: ${alive.server} | ` +
            `Vị trí: ${alive.geo?.city}, ${alive.geo?.country} (${alive.geo?.countryCode}) | ` +
            `Timezone: ${alive.geo?.timezoneId} | Locale: ${alive.geo?.locale}`
          );
        } else {
          log(`[ProxyManager] ✓ Đã tìm thấy Proxy kết nối tốt cho instance #${instanceId}: ${alive.server} (Anti-Detect Proxy: TẮT)`);
        }
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

/** Vị trí chuột ảo theo từng instance — dùng để bắt đầu đường cong Bézier liên tục giữa các thao tác song song. */
const instanceMousePositions = new Map();

function getMousePos(instanceId = logContext.getStore()?.instanceId ?? 0) {
  let pos = instanceMousePositions.get(instanceId);
  if (!pos) {
    pos = { x: 300, y: 250 };
    instanceMousePositions.set(instanceId, pos);
  }
  return pos;
}

function setMousePos(instanceId = logContext.getStore()?.instanceId ?? 0, x, y) {
  instanceMousePositions.set(instanceId, { x, y });
}

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
async function humanClickCdp(page, ctx, targetX, targetY, instanceId = logContext.getStore()?.instanceId ?? 0) {
  let client = null;
  try {
    client = await withTimeout(ctx.newCDPSession(page), 3500, null).catch(() => null);
  } catch {}

  if (!client) {
    return humanClickMouse(page, targetX, targetY, instanceId);
  }

  try {
    const mousePos = getMousePos(instanceId);
    const movePath = generateBezierPath(mousePos.x, mousePos.y, targetX, targetY);
    for (const pt of movePath) {
      await withTimeout(
        client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }),
        1000,
      ).catch(() => {});
      await sleep(rand(8, 22));
    }
    // Dwell / Hover — dừng lại như đang đọc nội dung quảng cáo trước khi nhấn
    await sleep(resolveHoverMs());
    // Press
    await withTimeout(
      client.send("Input.dispatchMouseEvent", {
        type: "mousePressed", button: "left", clickCount: 1, x: targetX, y: targetY,
      }),
      2500,
    ).catch(() => {});
    // Hold — giữ nút chuột 70-160ms như bàn tay người thật
    await sleep(rand(70, 160));
    // Release
    await withTimeout(
      client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", button: "left", clickCount: 1, x: targetX, y: targetY,
      }),
      2500,
    ).catch(() => {});
    setMousePos(instanceId, targetX, targetY);
  } catch {
    await humanClickMouse(page, targetX, targetY, instanceId).catch(() => {});
  } finally {
    if (client) {
      await withTimeout(client.detach(), 1500, null).catch(() => {});
    }
  }
}

/**
 * Di chuột dọc đường Bézier và click bằng Playwright page.mouse API.
 */
async function humanClickMouse(page, targetX, targetY, instanceId = logContext.getStore()?.instanceId ?? 0) {
  const mousePos = getMousePos(instanceId);
  const movePath = generateBezierPath(mousePos.x, mousePos.y, targetX, targetY);
  for (const pt of movePath) {
    await page.mouse.move(pt.x, pt.y);
    await sleep(rand(8, 22));
  }
  await sleep(resolveHoverMs());
  await page.mouse.down({ button: "left" });
  await sleep(rand(70, 160));
  await page.mouse.up({ button: "left" });
  setMousePos(instanceId, targetX, targetY);
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

    setMousePos(instanceId, safeTargetX, safeTargetY);
    log("[OS-Mouse] ✓ Thao tác rê chuột phần cứng & click Windows hoàn tất (MOUSEEVENTF_MOVE stream).");
  } catch (err) {
    log(`[OS-Mouse] ⚠ Lỗi khi điều khiển chuột Windows (${err.message}); dùng fallback CDP click.`);
    return humanClickCdp(page, ctx, targetX, targetY, instanceId);
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
  if (!IS_EXPLICIT_HEADLESS) {
    await page.bringToFront().catch(() => {});
  }
  if (clickMode === "ghub") {
    return humanClickGhub(page, ctx, x, y, instanceId);
  }
  if (clickMode === "os-mouse") {
    return humanClickOs(page, ctx, x, y, instanceId);
  }
  if (clickMode === "cdp") {
    return humanClickCdp(page, ctx, x, y, instanceId);
  }
  return humanClickMouse(page, x, y, instanceId);
}

/**
 * Mô phỏng tiếp cận tự nhiên trước khi click: di chuột đến vùng lân cận quảng cáo,
 * dừng lại như đang nhìn, rồi từ từ rê vào vị trí đích.
 */
async function preClickEngagement(page, ctx, targetX, targetY, instanceId = 0, clickMode = CLICK_MODE) {
  if (!IS_EXPLICIT_HEADLESS) {
    await page.bringToFront().catch(() => {});
  }
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
      setMousePos(instanceId, safeNearX, safeNearY);
      await sleep(Math.min(2500, Math.max(800, resolveHoverMs())));
      return;
    } catch {}
  }

  // 1. Di chuyển đến vùng lân cận trước (lệch 35-70px) như ánh mắt vừa lướt qua
  const nearX = targetX + rand(-70, 70);
  const nearY = targetY + rand(-50, 50);
  const mousePos1 = getMousePos(instanceId);
  const approachPath = generateBezierPath(mousePos1.x, mousePos1.y, nearX, nearY, rand(12, 22));
  for (const pt of approachPath) {
    await page.mouse.move(pt.x, pt.y).catch(() => {});
    await sleep(rand(12, 28));
  }
  setMousePos(instanceId, nearX, nearY);

  // 2. Dừng lại như đang đọc tiêu đề quảng cáo và quyết định bấm (áp dụng thời gian hover cấu hình)
  await sleep(resolveHoverMs());

  // 3. Rê chuột nhẹ nhàng từ vị trí lân cận vào đúng vị trí click đích
  const mousePos2 = getMousePos(instanceId);
  const finalGlide = generateBezierPath(mousePos2.x, mousePos2.y, targetX, targetY, rand(8, 14));
  for (const pt of finalGlide) {
    await page.mouse.move(pt.x, pt.y).catch(() => {});
    await sleep(rand(10, 22));
  }
  setMousePos(instanceId, targetX, targetY);
  await sleep(rand(150, 450));
}

/**
 * Xác định toạ độ click tự nhiên trên trang web để kích hoạt Popunder.
 * Tìm kiếm các vùng nội dung chính (tiêu đề, đoạn văn, hero text) và loại trừ
 * hoàn toàn các khung quảng cáo (adsterra-unit, adsterra-stack, adsterra-flank, iframe)
 * để tránh việc click kích hoạt nhầm vào NativeBanner hoặc banner ngoài ý muốn.
 */
async function resolvePopunderTarget(page) {
  try {
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    // Lấy toạ độ các khối quảng cáo để tránh click nhầm vào ads
    const adBoxes = [];
    try {
      const adLocators = page.locator(".adsterra-unit, .adsterra-stack, .adsterra-flank, iframe");
      const adCount = await adLocators.count().catch(() => 0);
      for (let i = 0; i < Math.min(50, adCount); i++) {
        const b = await adLocators.nth(i).boundingBox().catch(() => null);
        if (b) adBoxes.push(b);
      }
    } catch {}

    const isInsideAd = (x, y) =>
      adBoxes.some((b) => x >= b.x - 5 && x <= b.x + b.width + 5 && y >= b.y - 5 && y <= b.y + b.height + 5);

    const contentSelectors = [
      "h1",
      "h2",
      "h3",
      "p",
      ".hero-description",
      "section p",
    ];
    for (const sel of contentSelectors) {
      const locators = page.locator(sel);
      const count = await locators.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const loc = locators.nth(i);
        const isInteractive = await loc.evaluate((el) => Boolean(el.closest("a, button, input, textarea, select"))).catch(() => false);
        if (isInteractive) continue;
        const box = await loc.boundingBox().catch(() => null);
        if (box && box.width >= 40 && box.height >= 20) {
          const cx = Math.floor(box.x + box.width * 0.5);
          const cy = Math.floor(box.y + box.height * 0.5);
          if (cx > 20 && cx < vp.width - 20 && cy > 50 && cy < vp.height - 20 && !isInsideAd(cx, cy)) {
            return { x: cx + rand(-15, 15), y: cy + rand(-5, 5) };
          }
        }
      }
    }

    // Fallback: chọn toạ độ an toàn trong vùng nội dung nửa trên màn hình (tránh mép và tránh ads)
    for (let attempts = 0; attempts < 10; attempts++) {
      const candidateX = rand(Math.floor(vp.width * 0.3), Math.floor(vp.width * 0.7));
      const candidateY = rand(150, Math.min(480, vp.height - 50));
      if (!isInsideAd(candidateX, candidateY)) {
        return { x: candidateX, y: candidateY };
      }
    }
    return {
      x: rand(Math.floor(vp.width * 0.35), Math.floor(vp.width * 0.65)),
      y: rand(220, 420),
    };
  } catch {
    return { x: rand(300, 600), y: rand(200, 400) };
  }
}

/**
 * Chuỗi tương tác hoàn chỉnh (tiếp cận + click) kết hợp lượt chuột vật lý theo chu kỳ:
 * cú click vật lý đầu tiên của một chu kỳ nhận lượt chuột và GIỮ nó tới khi `runOneCycle` kết
 * thúc (nhả trong khối finally), nên các click đệ quy trên trang đích không phải xếp hàng lại và
 * không instance nào chen vào giữa chu kỳ. Gắn tag tiêu đề cửa sổ để winMouse.ps1 phóng to đúng
 * cửa sổ trước khi click.
 */
async function performEngageAndClick(page, ctx, targetX, targetY, instanceId = 0, clickMode = CLICK_MODE) {
  return withTimeout((async () => {
    if (!IS_EXPLICIT_HEADLESS && (isPhysicalClickMode(clickMode) || INSTANCE_COUNT > 1)) {
      if (!cycleTurns.has(instanceId)) {
        await acquireCycleTurn(instanceId, { quiet: true, timeoutMs: 15000 });
      }
      if (instanceId > 0) {
        await tagInstancePage(page, instanceId).catch(() => {});
      }
      await page.bringToFront().catch(() => {});
      await maximizeAndFocusWindow(ctx, page, instanceId).catch(() => {});
      if (process.platform === "win32") {
        focusInstanceWindow(instanceId);
      }
    }
    await withTimeout(
      preClickEngagement(page, ctx, targetX, targetY, instanceId, clickMode),
      8000,
    ).catch(() => {});

    let newPage = null;
    const pageEventPromise = ctx.waitForEvent("page", { timeout: 6000 }).then((p) => {
      newPage = p;
      return p;
    }).catch(() => null);

    const clickPromise = withTimeout(
      humanClick(page, ctx, targetX, targetY, instanceId, clickMode),
      8000,
      null,
    ).catch(() => null);

    await Promise.all([pageEventPromise, clickPromise]);
    return newPage;
  })(), 20000, null);
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
      const mousePos = getMousePos(instanceId);
      const driftX = Math.max(100, Math.min(1200, mousePos.x + rand(-150, 150)));
      const driftY = Math.max(80, Math.min(700, mousePos.y + rand(-80, 80)));
      const path = generateBezierPath(mousePos.x, mousePos.y, driftX, driftY, rand(6, 10));
      for (const pt of path) {
        if (Date.now() - started >= durationMs) break;
        await page.mouse.move(pt.x, pt.y).catch(() => {});
        await sleep(rand(10, 20));
      }
      setMousePos(instanceId, driftX, driftY);
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
 * Gắn bộ xử lý an toàn ngăn chặn dialog (alert/confirm/prompt) và download tự động làm treo Playwright/CDP.
 */
function attachSafePageListeners(targetPage) {
  if (!targetPage) return;
  try {
    targetPage.on?.("dialog", async (dialog) => {
      try {
        await dialog.dismiss().catch(() => {});
      } catch {}
    });
    targetPage.on?.("download", async (dl) => {
      try {
        await dl.cancel().catch(() => {});
      } catch {}
    });
  } catch {}
}

/**
 * Mô phỏng người dùng trải nghiệm trang đích (Landing Page):
 * - Cuộn qua các phân đoạn trang (150px - 350px).
 * - Rê chuột lên các phần tử nội dung, nút bấm, tiêu đề.
 * - Dừng đọc từ 20 đến 45 giây (ngăn chặn triệt để gắn cờ Bot Bounce / Accidental Click).
 */
async function simulateLandingPageEngagement(page, durationMs, instanceId = logContext.getStore()?.instanceId) {
  if (!page || durationMs <= 0 || page.isClosed?.()) return;
  return withTimeout(
    (async () => {
      const started = Date.now();
      log(`  Đang trải nghiệm nội dung trang đích tự nhiên trong ${Math.round(durationMs / 1000)}s...`);

      let scrolledDown = 0;
      while (Date.now() - started < durationMs) {
        if (page.isClosed?.()) break;
        const remaining = durationMs - (Date.now() - started);
        if (remaining < 1500) break;

        // Cuộn xuống nhịp 150 - 350px
        const scrollStep = rand(150, 350);
        await withTimeout(organicScroll(page, scrollStep, instanceId), 6000).catch(() => {});
        if (page.isClosed?.()) break;
        scrolledDown += scrollStep;
        await sleep(rand(1000, 2500));
        if (page.isClosed?.()) break;

        // Rê chuột tự nhiên trên trang đích
        const mousePos = getMousePos(instanceId);
        const targetX = rand(200, 1000);
        const targetY = rand(150, 650);
        const movePath = generateBezierPath(mousePos.x, mousePos.y, targetX, targetY, rand(10, 18));
        for (const pt of movePath) {
          if (page.isClosed?.()) break;
          await page.mouse.move(pt.x, pt.y).catch(() => {});
          await sleep(rand(12, 26));
        }
        setMousePos(instanceId, targetX, targetY);

        // Dừng đọc
        await sleep(rand(1500, 3500));
        if (page.isClosed?.()) break;

        // Nếu đã cuộn sâu (> 800px), thỉnh thoảng cuộn nhẹ lên 80-160px để xem lại
        if (scrolledDown > 800 && Math.random() < 0.35) {
          await withTimeout(organicScroll(page, -rand(80, 160), instanceId), 6000).catch(() => {});
          await sleep(rand(800, 1800));
        }
      }
    })(),
    durationMs + 10000,
  ).catch(() => {});
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
            const el = document.querySelector(selector);
            if (!el) return true;
            const status = el.getAttribute("data-status") ?? "";
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
    .locator(`${BANNER_READY_SELECTOR} iframe[width="728"][height="90"], .adsterra-banner[data-status="ready"] iframe, .adsterra-unit iframe`)
    .first();
  const bannerIframeFound = (await bannerIframe.count()) > 0;
  let bannerCreativeCount = 0;

  if (bannerIframeFound) {
    const candidateIframes = page.locator(
      `${BANNER_READY_SELECTOR} iframe[width="728"][height="90"], .adsterra-banner[data-status="ready"] iframe, .adsterra-unit iframe`
    );
    const ifrCount = await candidateIframes.count().catch(() => 0);
    for (let f = 0; f < ifrCount; f++) {
      const iframeHandle = await candidateIframes.nth(f).elementHandle().catch(() => null);
      const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
      if (frame) {
        const creativeWaitMs = Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt));
        if (creativeWaitMs > 0 && bannerCreativeCount === 0) {
          await frame.locator("a[href] img, a[href]").first().waitFor({
            state: "attached",
            timeout: Math.min(creativeWaitMs, 3000),
          }).catch(() => {});
        }
        const linkedImages = await frame.locator("a[href] img").count().catch(() => 0);
        const linkedCreatives = await frame.locator("a[href]").count().catch(() => 0);
        const countCreatives = linkedImages > 0 ? linkedImages : linkedCreatives;
        if (countCreatives > 0) {
          bannerCreativeCount += countCreatives;
        }
      }
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

  const socialBarIframe = page.locator(SOCIAL_BAR_SELECTOR).first();
  const socialBarFound = (await socialBarIframe.count().catch(() => 0)) > 0;
  let socialBarCreativeCount = 0;
  let socialBarBox = null;
  if (socialBarFound) {
    socialBarBox = await socialBarIframe.boundingBox().catch(() => null);
    const iframeHandle = await socialBarIframe.elementHandle().catch(() => null);
    const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
    if (frame) {
      const socialLinks = await frame.locator('a[href], [class*="__link"]').count().catch(() => 0);
      socialBarCreativeCount = socialLinks;
    }
  }

  const socialBar = {
    found: socialBarFound,
    creativeCount: socialBarCreativeCount,
    box: socialBarBox,
    status: socialBarFound ? "ready" : "waiting",
  };

  return {
    renderMs: Date.now() - startedAt,
    banner,
    native,
    socialBar,
    allReady: banner.status === "ready" && (native.status === "ready" || !nativeSlotFound),
    bannerIframeFound,
    bannerIframe,
    socialBarFound,
    socialBarIframe,
  };
}

async function inspectAdcashPlacements(page, startedAt = Date.now()) {
  const waitMs = Math.min(3000, Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt)));
  let ready = false;
  let scriptCount = 0;
  try {
    if (waitMs > 0) {
      await page
        .waitForFunction(() => {
          return (
            typeof window.aclib !== "undefined" ||
            document.getElementById("aclib") !== null ||
            document.getElementById("adcash-ad-container") !== null
          );
        }, { timeout: waitMs })
        .catch(() => {});
    }
    const info = await page
      .evaluate(() => {
        const aclibReady = typeof window.aclib !== "undefined";
        const scripts = Array.from(document.querySelectorAll("script"))
          .map((s) => s.src)
          .filter((src) => src.includes("acscdn"));
        const hasAdcashElements = Boolean(
          document.querySelector("#adcash-ad-container, [id*='aclib'], [class*='aclib'], iframe[src*='acscdn']")
        );
        return { aclibReady, scriptCount: scripts.length, hasAdcashElements };
      })
      .catch(() => ({ aclibReady: false, scriptCount: 0, hasAdcashElements: false }));
    ready = info.aclibReady || info.hasAdcashElements;
    scriptCount = info.scriptCount;
  } catch {}
  return {
    status: ready ? "ready" : "no-fill",
    scriptCount,
    renderMs: Math.max(0, Date.now() - startedAt),
  };
}

async function inspectClickaduPlacements(page, startedAt = Date.now()) {
  const waitMs = Math.min(3000, Math.max(0, AD_READY_TIMEOUT_MS - (Date.now() - startedAt)));
  let ready = false;
  try {
    const selector = "#clickadu-ad-container, meta[name='clckd'], iframe[src*='clickadu']";
    if (waitMs > 0) {
      await page.waitForSelector(selector, { timeout: waitMs }).catch(() => {});
    }
    ready = (await page.locator(selector).count().catch(() => 0)) > 0;
  } catch {}
  return {
    status: ready ? "ready" : "no-fill",
    renderMs: Date.now() - startedAt,
  };
}

async function handleRecursiveAdClicks(targetPage, depth, maxDepth, ctx, instanceId = 0, clickMode = CLICK_MODE) {
  if (!targetPage || targetPage.isClosed?.() || depth >= maxDepth) return;

  return withTimeout(
    (async () => {
      try {
        attachSafePageListeners(targetPage);
        const waitMs = Math.min(rand(DELAY_MIN_MS, DELAY_MAX_MS), 15000);
        log(`  [Đệ quy cấp ${depth + 1}/${maxDepth}] Trải nghiệm và đọc trang quảng cáo trong ${Math.round(waitMs / 1000)}s...`);
        await simulateLandingPageEngagement(targetPage, waitMs, instanceId);

        if (targetPage.isClosed?.() || depth + 1 >= maxDepth) return;

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
          if (targetPage.isClosed?.()) break;
          const handles = await withTimeout(targetPage.$$(sel), 3000, []).catch(() => []);
          if (!handles || handles.length === 0) continue;
          const shuffledHandles = [...handles].sort(() => Math.random() - 0.5);
          for (const handle of shuffledHandles) {
            if (targetPage.isClosed?.()) break;
            try {
              const visible = await withTimeout(handle.isVisible(), 2000, false).catch(() => false);
              if (!visible) continue;

              // Bỏ qua các nút tải file (download / apk / exe / zip / installer...) để tránh kích hoạt download làm tràn bộ nhớ pipe
              const isDownload = await withTimeout(
                handle.evaluate((el) => {
                  const href = (el.getAttribute("href") || "").toLowerCase();
                  const downloadAttr = el.getAttribute("download");
                  const text = (el.innerText || el.textContent || "").toLowerCase();
                  const badExtensions = [".exe", ".apk", ".msi", ".zip", ".rar", ".dmg", ".iso", ".tar", ".gz", ".bin", ".7z", ".pkg"];
                  const hasBadExt = badExtensions.some((ext) => href.includes(ext));
                  const hasDownloadWord = text.includes("download") || text.includes("tải về") || text.includes("tải game") || text.includes("tải ngay") || text.includes("cài đặt") || text.includes("install");
                  return Boolean(downloadAttr) || hasBadExt || hasDownloadWord || href.startsWith("blob:") || href.startsWith("data:");
                }),
                2000,
                false,
              ).catch(() => false);
              if (isDownload) continue;

              await withTimeout(handle.scrollIntoViewIfNeeded({ timeout: 2000 }), 2500).catch(() => {});
              await sleep(100);
              const elBox = await withTimeout(handle.boundingBox(), 2000, null).catch(() => null);
              if (!elBox || elBox.width < 2 || elBox.height < 2) continue;
              const target = computeClickTarget(elBox);
              log(`  [Đệ quy cấp ${depth + 1}] Tìm thấy phần tử (${sel}), click tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
              const resolvedCtx = ctx || targetPage.context();

              // Ghi nhận tập các trang trước khi click để chỉ nhận diện trang MỚI sinh ra
              const pagesBefore = new Set(resolvedCtx?.pages?.() || []);
              const urlBefore = targetPage.url();

              const newPage = await performEngageAndClick(targetPage, resolvedCtx, target.x, target.y, instanceId, clickMode);

              clicked = true;
              if (newPage && !newPage.isClosed()) {
                attachSafePageListeners(newPage);
                await withTimeout(newPage.waitForLoadState("domcontentloaded", { timeout: 15000 }), 16000).catch(() => {});
                await handleRecursiveAdClicks(newPage, depth + 1, maxDepth, resolvedCtx, instanceId, clickMode);
                await withTimeout(newPage.close().catch(() => {}), 2500).catch(() => {});
              } else {
                const pagesAfter = resolvedCtx?.pages?.() || [];
                const extraPage = pagesAfter.find((p) => !pagesBefore.has(p) && !p.isClosed());
                if (extraPage) {
                  attachSafePageListeners(extraPage);
                  await withTimeout(extraPage.waitForLoadState("domcontentloaded", { timeout: 15000 }), 16000).catch(() => {});
                  await handleRecursiveAdClicks(extraPage, depth + 1, maxDepth, resolvedCtx, instanceId, clickMode);
                  await withTimeout(extraPage.close().catch(() => {}), 2500).catch(() => {});
                } else if (!targetPage.isClosed?.() && targetPage.url() !== urlBefore) {
                  await withTimeout(targetPage.waitForLoadState("domcontentloaded", { timeout: 15000 }), 16000).catch(() => {});
                  await handleRecursiveAdClicks(targetPage, depth + 1, maxDepth, resolvedCtx, instanceId, clickMode);
                } else if (!targetPage.isClosed?.()) {
                  await simulateLandingPageEngagement(targetPage, rand(DELAY_MIN_MS, DELAY_MAX_MS), instanceId);
                }
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
    })(),
    35000,
  ).catch(() => {});
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

    if (activePage && !activePage.isClosed() && context) {
      const client = await context.newCDPSession(activePage).catch(() => null);
      if (client) {
        try {
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
        } catch {
          // bỏ qua lỗi protocol
        } finally {
          await client.detach().catch(() => {});
        }
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

  const webrtcAntiLeakFlags = ANTI_DETECT_PROXY
    ? [
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--enforce-webrtc-ip-permission-check",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      ]
    : [];

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
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

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
  if (IS_EXPLICIT_HEADLESS) return;
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
  if (IS_EXPLICIT_HEADLESS) return;
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
  const explicitCdp = process.argv.some((a) => a.startsWith("--cdp")) || Boolean(process.env.CDP_URL);
  const wantsMyChrome =
    (process.argv.includes("--my-chrome") ||
    process.argv.includes("--my-profile") ||
    process.env.USE_MY_CHROME === "1") &&
    !IS_EXPLICIT_HEADLESS;

  if (IS_EXPLICIT_HEADLESS && (process.argv.includes("--my-chrome") || process.argv.includes("--my-profile") || process.env.USE_MY_CHROME === "1") && !explicitCdp) {
    log("[AntiDetect] ⚠ Chế độ chạy ẩn (Headless) yêu cầu profile độc lập; tự động bỏ qua --my-chrome để Chromium chạy ngầm.");
  }

  // Khi nạp tiện ích mở rộng (CanvasBlocker), Google Chrome bảo vệ thư mục User Data thật
  // bằng cách chặn --load-extension. Đồng thời phiên kết nối CDP có sẵn cũng không thể nạp thêm extension.
  // Do đó, khi có extensionPath, ad-viewer tự động sử dụng profile độc lập với launchPersistentContext
  // để tiện ích luôn được nạp đầy đủ và Developer Mode luôn được kích hoạt.
  const useMyChrome = !extensionPath && wantsMyChrome && !IS_EXPLICIT_HEADLESS;
  if (extensionPath && wantsMyChrome && !explicitCdp) {
    log("[AntiDetect] ⚠ Tiện ích CanvasBlocker yêu cầu profile độc lập để nạp extension; tự động chuyển sang profile riêng thay vì --my-chrome.");
  }

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
  const fpLocale = (ANTI_DETECT_PROXY && currentProxy?.geo?.locale) ? currentProxy.geo.locale : "vi-VN";
  let fp = fingerprintProfile
    ? materializeFingerprint(fingerprintProfile, {
        engineMajor: cdpUrl ? cachedEngineMajor : cachedEngineMajor ?? detectEngineMajorFromExecutable(),
        locale: fpLocale,
      })
    : null;
  const fpSessions = [];
  let onFingerprintPage = null;
  let cycleClickMode = CLICK_MODE;
  const wantsHeadless =
    IS_EXPLICIT_HEADLESS ||
    (!IS_EXPLICIT_HEADED && !useMyChrome && !explicitCdp);

  if (wantsHeadless && (cycleClickMode === "os-mouse" || cycleClickMode === "ghub" || cycleClickMode === "manual")) {
    log(`[Headless] ⚠ Chế độ chạy ẩn không thể sử dụng chuột phần cứng/thao tác thủ công (${cycleClickMode}); tự động chuyển sang CDP Input Dispatch.`);
    cycleClickMode = "cdp";
  }
  const isHeadless =
    !useMyChrome &&
    cycleClickMode !== "manual" &&
    cycleClickMode !== "os-mouse" &&
    cycleClickMode !== "ghub" &&
    !IS_EXPLICIT_HEADED &&
    (IS_EXPLICIT_HEADLESS || process.env.HEADLESS !== "0");
  const baseClickMode = cycleClickMode;
  const visitedDomains = [];

  try {
    log(
      isPatchedEngine
        ? "[AntiDetect] ✓ Kích hoạt Patched Chromium Engine (Patchright) — triệt tiêu rò rỉ CDP, Runtime.enable và cờ tự động hoá cấp trình duyệt."
        : "[AntiDetect] Chạy với Playwright Core mặc định."
    );
    const adNetworkDesc =
      AD_NETWORK === "adcash"
        ? "🚀 Adcash (AutoTag qmnntqoxdc)"
        : AD_NETWORK === "clickadu"
        ? "Clickadu"
        : AD_NETWORK === "adsterra"
        ? "Adsterra"
        : "Tất cả nhà mạng";
    log(`[Nhà Mạng Quảng Cáo] Mục tiêu: ${AD_NETWORK.toUpperCase()} (${adNetworkDesc})`);
    if (AD_NETWORK === "adcash") {
      log(`[Trọng Tâm Định Dạng] Chế độ quảng cáo: 🚀 AutoTag tự động tối ưu hoá định dạng Adcash (Không phân biệt Popunder/Native)`);
    } else {
      log(`[Trọng Tâm Định Dạng] Chế độ quảng cáo: ${FOCUS_POPUNDER_SOCIAL ? "🎯 ƯU TIÊN POPUNDER + SOCIALBAR (Triệt tiêu impression & click NativeBanner)" : "Cân bằng mọi định dạng (Popunder + SocialBar + Banner + Native)"}`);
    }
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
        "--disable-popup-blocking",
        "--enable-experimental-extension-apis",
        "--extensions-on-chrome-urls",
        "--silent-debugger-extension-api",
        "--no-default-browser-check",
        "--no-first-run",
        ...(ANTI_DETECT_PROXY
          ? [
              "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
              "--enforce-webrtc-ip-permission-check",
              "--webrtc-ip-handling-policy=disable_non_proxied_udp",
            ]
          : []),
      ];
      if (INSTANCE_COUNT <= 1 && !isHeadless) {
        args.push("--start-maximized");
      }

      if (extensionPath) {
        args.push(`--disable-extensions-except=${extensionPath}`);
        args.push(`--load-extension=${extensionPath}`);
        if (ENABLE_DEV_MODE) {
          log("✓ Đã nạp tiện ích CanvasBlocker và kích hoạt Developer Mode cho profile.");
        }
      }

      const launchWidth = fp?.screen?.width || (fp?.viewport?.width ? fp.viewport.width : 1920);
      const launchHeight = fp?.screen?.height || (fp?.viewport?.height ? fp.viewport.height : 1080);
      const headlessArgs = isHeadless
        ? [
            "--headless=new",
            `--window-size=${launchWidth},${launchHeight}`,
            "--disable-features=UserAgentClientHint",
            "--enable-unsafe-swiftshader",
            "--use-gl=angle",
            "--ignore-gpu-blocklist",
            "--enable-webgl",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
          ]
        : [];

      const launchArgs = [...args, ...headlessArgs];

      const defaultDesktopUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

      // Chuột phần cứng tính toạ độ từ cửa sổ THẬT, nên desktop ở các chế độ ấy không được giả lập
      // viewport (viewport: null = trang lấp đúng cửa sổ). Mobile luôn giả lập — chu kỳ mobile tự
      // chuyển sang click CDP ở dưới.
      const physicalMouse = !isHeadless && (cycleClickMode === "os-mouse" || cycleClickMode === "ghub" || cycleClickMode === "manual");
      const launchOptions = {
        headless: isHeadless,
        args: launchArgs,
        viewport: physicalMouse || !isHeadless ? null : { width: 1366, height: 768 },
        locale: fpLocale,
        timezoneId: (ANTI_DETECT_PROXY && currentProxy?.geo?.timezoneId) ? currentProxy.geo.timezoneId : "Asia/Ho_Chi_Minh",
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
        if (ANTI_DETECT_PROXY && currentProxy.geo?.lat !== undefined && currentProxy.geo?.lon !== undefined) {
          launchOptions.geolocation = {
            latitude: currentProxy.geo.lat,
            longitude: currentProxy.geo.lon,
            accuracy: 10,
          };
          launchOptions.permissions = ["geolocation"];
        }
      }

      const channel = useMyChrome ? "chrome" : "chromium";

      // Mở cửa sổ Chrome mới sẽ cướp foreground: khi nhiều instance và không phải headless,
      // chỉ mở lúc không instance nào đang trong lượt chuột.
      const guardLaunch = INSTANCE_COUNT > 1 && !isHeadless;
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
      attachSafePageListeners(newPage);
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
    attachSafePageListeners(page);
    if (!isHeadless) {
      await page.bringToFront().catch(() => {});
    }
    await tagInstancePage(page, instanceId);
    page.on("domcontentloaded", () => { tagInstancePage(page, instanceId).catch(() => {}); });
    page.on("load", () => { tagInstancePage(page, instanceId).catch(() => {}); });

    if (!isHeadless) {
      if (foregroundOwnedByOther(instanceId)) {
        minimizeInstanceWindow(instanceId);
      } else {
        await maximizeAndFocusWindow(context, page, instanceId);
      }
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
        if (!isHeadless && canInteractForeground(instanceId)) {
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
            if (!isHeadless && canInteractForeground(instanceId)) {
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

        if (ANTI_DETECT_PROXY && currentProxy?.geo) {
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
    if (ANTI_DETECT_PROXY) {
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
      });
    }

    await context.addInitScript(() => {

      // 2. Ẩn hoàn toàn cờ tự động hoá navigator.webdriver
      try {
        Object.defineProperty(Navigator.prototype, "webdriver", {
          get: () => false,
          configurable: true,
          enumerable: true,
        });
      } catch {}
      try {
        delete navigator.webdriver;
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

    if (!isHeadless && !foregroundOwnedByOther(instanceId)) {
      await page.bringToFront().catch(() => {});
      await maximizeAndFocusWindow(context, page, instanceId);
    }

    const trafficInfo = resolveTrafficReferrer(TRAFFIC_SOURCE, TRAFFIC_RATIO);
    if (trafficInfo.active && trafficInfo.referrer) {
      await page
        .addInitScript((ref) => {
          try {
            Object.defineProperty(document, "referrer", {
              get: () => ref,
              configurable: true,
            });
          } catch {}
        }, trafficInfo.referrer)
        .catch(() => {});
      log(`[Traffic Source] 🌐 Đến từ ${trafficInfo.sourceName} — Referrer: ${trafficInfo.referrer}`);
    } else {
      log(`[Traffic Source] 🌐 Truy cập trực tiếp (Direct Traffic)`);
    }

    const renderStartedAt = Date.now();
    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_GOTO_TIMEOUT_MS,
      ...(trafficInfo.referrer ? { referer: trafficInfo.referrer } : {}),
    });
    navigationSucceeded = true;
    await tagInstancePage(page, instanceId);

    // Cuộn trang tự nhiên để kích hoạt lazy-load quảng cáo (từng nhịp, có quán tính)
    await organicScroll(page, rand(250, 400), instanceId);
    await sleep(rand(300, 600));
    await organicScroll(page, rand(350, 550), instanceId);

    let isRenderFinished = false;
    let isForceClick = false;
    let diagnostic = null;

    if (AD_NETWORK === "adcash") {
      const adcDiagnostic = await inspectAdcashPlacements(page, renderStartedAt);
      log(`Adcash: ${adcDiagnostic.status} (scripts acscdn=${adcDiagnostic.scriptCount}, render=${adcDiagnostic.renderMs}ms).`);
      isRenderFinished = adcDiagnostic.status === "ready";
      isForceClick = !isRenderFinished;
      if (isForceClick) {
        log(
          `[ForceClick] ⚡ Quá thời gian chờ render Adcash (${adcDiagnostic.renderMs}ms / tối đa ${AD_READY_TIMEOUT_MS}ms) — KÍCH HOẠT CƯỠNG CHẾ (Force Click) ngay!`,
        );
      }
    } else if (AD_NETWORK === "clickadu") {
      const clkDiagnostic = await inspectClickaduPlacements(page, renderStartedAt);
      log(`Clickadu: ${clkDiagnostic.status} (render=${clkDiagnostic.renderMs}ms).`);
      isRenderFinished = clkDiagnostic.status === "ready";
      isForceClick = !isRenderFinished;
      if (isForceClick) {
        log(
          `[ForceClick] ⚡ Quá thời gian chờ render Clickadu (${clkDiagnostic.renderMs}ms / tối đa ${AD_READY_TIMEOUT_MS}ms) — KÍCH HOẠT CƯỠNG CHẾ (Force Click) ngay!`,
        );
      }
    } else {
      if (!FOCUS_POPUNDER_SOCIAL) {
        await page.locator(".adsterra-stack").scrollIntoViewIfNeeded().catch(() => {});
      }
      diagnostic = await inspectAdsterraPlacements(page, renderStartedAt);

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
      log(
        `Adsterra social-bar: ${diagnostic.socialBar?.status || (diagnostic.socialBarFound ? "ready" : "waiting")} ` +
          `(found=${diagnostic.socialBarFound ? "có" : "không"}, creative=${diagnostic.socialBar?.creativeCount || 0}, ` +
          `frame=${formatBox(diagnostic.socialBar?.box)})`,
      );
      log(`Thời gian chờ render Adsterra: ${diagnostic.renderMs}ms.`);

      isRenderFinished = FOCUS_POPUNDER_SOCIAL
        ? (diagnostic.socialBarFound || diagnostic.banner.status === "ready")
        : (diagnostic.allReady || (diagnostic.banner.status === "ready" && diagnostic.native.status === "ready"));
      isForceClick = !isRenderFinished;
      if (isForceClick) {
        log(
          `[ForceClick] ⚡ Quá thời gian chờ render Adsterra (${diagnostic.renderMs}ms / tối đa ${AD_READY_TIMEOUT_MS}ms) mà quảng cáo chưa hoàn tất tải (banner=${diagnostic.banner.status}, native=${diagnostic.native.status}, socialBar=${diagnostic.socialBarFound ? "có" : "không"}) — KÍCH HOẠT CƯỠNG CHẾ (Force Click) 1 quảng cáo bất kỳ ngay lập tức!`,
        );
      }
    }

    if (!isForceClick) {
      // Dừng đọc nội dung trang web tự nhiên trước khi click (tối đa 3 giây)
      const minReadingMs = Math.min(1500, MAX_READING_BEFORE_CLICK_MS);
      const readingBeforeClickMs = rand(minReadingMs, MAX_READING_BEFORE_CLICK_MS);
      log(`Đang đọc nội dung bài viết và lướt xem trang web trong ${(readingBeforeClickMs / 1000).toFixed(1)}s...`);
      await simulateHumanReading(page, readingBeforeClickMs, instanceId);
    } else {
      log("[ForceClick] Bỏ qua thời gian đọc bài viết; giữ khung nhìn tối thiểu 1.5s để ghi nhận impression rồi click cưỡng chế!");
      await sleep(rand(1500, 2500));
    }

    // Nhận lượt độc quyền tương tác quảng cáo TRƯỚC khi quét quảng cáo: chỉ cần thiết khi có GUI/chuột vật lý.
    // Trong Headless mode, các instance tương tác qua CDP độc lập hoàn toàn, không cần khoá lượt.
    // Lượt được giữ tới cuối chu kỳ và nhả trong khối finally bên dưới.
    const needsCycleLock = !isHeadless && (isPhysicalClickMode(cycleClickMode) || INSTANCE_COUNT > 1);
    if (needsCycleLock) {
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

    // 0. Adcash Ads (AutoTag / Banner / Container / Links)
    if (AD_NETWORK === "adcash" || AD_NETWORK === "all") {
      try {
        const adcashSelector = isForceClick
          ? '#adcash-ad-container a[href], .adcash-container a[href], iframe[src*="acscdn"], iframe[src*="adcash"], a[href*="adcash"], a[href*="acscdn"], [id*="aclib"] a[href], #adcash-ad-container, .adcash-container'
          : '#adcash-ad-container a[href], .adcash-container a[href], iframe[src*="acscdn"], iframe[src*="adcash"], a[href*="adcash"], a[href*="acscdn"], [id*="aclib"] a[href]';
        const adcashLocators = page.locator(adcashSelector);
        const adcCount = await adcashLocators.count().catch(() => 0);
        for (let i = 0; i < adcCount; i++) {
          adCandidates.push({
            name: `${isForceClick ? "[Force] " : ""}Adcash Ad unit #${i + 1}/${adcCount}`,
            locator: adcashLocators.nth(i),
            isAdcash: true,
          });
        }
      } catch (err) {
        log(`Lỗi khi quét Adcash ads: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 0. Clickadu Ads (Banner / In-Page Push / Container / Links)
    if (AD_NETWORK === "clickadu" || AD_NETWORK === "all") {
      try {
        const clickaduSelector = isForceClick
          ? '#clickadu-ad-container a[href], .clickadu-container a[href], iframe[src*="clickadu"], a[href*="clickadu"], [data-clickadu] a[href], #clickadu-ad-container, .clickadu-container'
          : '#clickadu-ad-container a[href], .clickadu-container a[href], iframe[src*="clickadu"], a[href*="clickadu"], [data-clickadu] a[href]';
        const clickaduLocators = page.locator(clickaduSelector);
        const clkCount = await clickaduLocators.count().catch(() => 0);
        for (let i = 0; i < clkCount; i++) {
          adCandidates.push({
            name: `${isForceClick ? "[Force] " : ""}Clickadu Ad unit #${i + 1}/${clkCount}`,
            locator: clickaduLocators.nth(i),
            isClickadu: true,
          });
        }
      } catch (err) {
        log(`Lỗi khi quét Clickadu ads: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const shouldScanAdsterra = AD_NETWORK === "adsterra" || AD_NETWORK === "all";

    // 1. Toàn bộ các thẻ Native Ads (chỉ quét nếu KHÔNG bật FOCUS_POPUNDER_SOCIAL và cho phép Adsterra)
    if (!FOCUS_POPUNDER_SOCIAL) {
      try {
        const nativeSelector = isForceClick
          ? `${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID} a, ${NATIVE_READY_SELECTOR} a, #${NATIVE_CONTAINER_ID} a, .adsterra-native a, [id*="container-"] a`
          : diagnostic?.native?.status === "ready"
          ? `${NATIVE_READY_SELECTOR} #${NATIVE_CONTAINER_ID} a[target="_blank"], ${NATIVE_READY_SELECTOR} a`
          : null;
        if (shouldScanAdsterra && nativeSelector) {
          const nativeLinks = page.locator(nativeSelector);
          const count = await nativeLinks.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            adCandidates.push({
              name: `${isForceClick ? "[Force] " : ""}Native ad card ${i + 1}/${count}`,
              locator: nativeLinks.nth(i),
            });
          }
        }
      } catch (err) {
        log(`Lỗi khi quét native ads: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 1b. SocialBar (Floating Notification iframe - CPM cao, ưu tiên đặc biệt)
    if (shouldScanAdsterra) {
      try {
        const socialBarIframe = page.locator(SOCIAL_BAR_SELECTOR).first();
        const socialBarCount = await socialBarIframe.count().catch(() => 0);
        if (socialBarCount > 0) {
          const iframeHandle = await socialBarIframe.elementHandle().catch(() => null);
          const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
          let foundSocialLinks = false;
          if (frame) {
            const socialLinks = frame.locator('a[href], [class*="__link"]');
            const scCount = await socialLinks.count().catch(() => 0);
            for (let i = 0; i < scCount; i++) {
              foundSocialLinks = true;
              adCandidates.push({
                name: `${isForceClick ? "[Force] " : ""}SocialBar Notification link ${i + 1}/${scCount}`,
                locator: socialLinks.nth(i),
                isSocialBar: true,
              });
            }
          }
          if (!foundSocialLinks) {
            adCandidates.push({
              name: `${isForceClick ? "[Force] " : ""}SocialBar Notification iframe`,
              locator: socialBarIframe,
              isSocialBar: true,
            });
          }
        }
      } catch (err) {
        log(`Lỗi khi quét SocialBar: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Banner ad creative trong các iframe quảng cáo (728x90, 468x60, 320x50, 300x250, 160x600, 160x300)
    if (shouldScanAdsterra) {
      try {
        const bannerSelector = isForceClick
          ? '.adsterra-banner iframe, .adsterra-leaderboard iframe, .adsterra-unit iframe, .adsterra-stack iframe, iframe[width="728"], iframe[src*="adsterra"], iframe[src*="alwingulla"], iframe[src*="doubleclick"], iframe[src*="banner"]'
          : '.adsterra-banner[data-status="ready"] iframe, .adsterra-leaderboard[data-status="ready"] iframe, .adsterra-unit iframe';
        const bannerIframes = page.locator(bannerSelector);
        const iframeCount = await bannerIframes.count().catch(() => 0);
        for (let f = 0; f < iframeCount; f++) {
          const iframeHandle = await bannerIframes.nth(f).elementHandle().catch(() => null);
          const frame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
          let foundFrameLinks = false;
          if (frame) {
            const bannerLinks = frame.locator("a[href]");
            const bannerCount = await bannerLinks.count().catch(() => 0);
            for (let i = 0; i < bannerCount; i++) {
              foundFrameLinks = true;
              adCandidates.push({
                name: `${isForceClick ? "[Force] " : ""}Banner iframe #${f + 1} link ${i + 1}/${bannerCount}`,
                locator: bannerLinks.nth(i),
              });
            }
          }
          if (isForceClick && !foundFrameLinks) {
            adCandidates.push({
              name: `[Force] Banner iframe #${f + 1} element`,
              locator: bannerIframes.nth(f),
            });
          }
        }
      } catch (err) {
        log(`Lỗi khi quét banner ads: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Adsterra Smartlink
    if (shouldScanAdsterra) {
      try {
        const smartlink = page.locator(
          '.adsterra-smartlink, a[href*="deliberatewatchful.com"], a[href*="alwingulla"], a[href*="f06720140b3b11ad092d96fa65ca5110"]',
        );
        const smartCount = await smartlink.count().catch(() => 0);
        for (let i = 0; i < smartCount; i++) {
          adCandidates.push({
            name: `${isForceClick ? "[Force] " : ""}Adsterra Smartlink ${i + 1}/${smartCount}`,
            locator: smartlink.nth(i),
          });
        }
      } catch {
        // bỏ qua
      }
    }

    // 4. Dự phòng cưỡng chế nếu trang tải quá chậm chưa có link nào
    if (isForceClick && adCandidates.length === 0) {
      const fallbackLocators = [
        ...(AD_NETWORK === "adcash" || AD_NETWORK === "all"
          ? [{ name: "[Force] Adcash Container", sel: ADCASH_CONTAINER_SELECTOR }]
          : []),
        ...(AD_NETWORK === "clickadu" || AD_NETWORK === "all"
          ? [{ name: "[Force] Clickadu Container", sel: CLICKADU_CONTAINER_SELECTOR }]
          : []),
        ...(shouldScanAdsterra
          ? [
              { name: "[Force] Adsterra Banner Slot", sel: ".adsterra-banner, .adsterra-leaderboard" },
              ...(FOCUS_POPUNDER_SOCIAL
                ? []
                : [
                    { name: "[Force] Adsterra Native Slot", sel: ".adsterra-native, #container-5e6634da84f8f263d7ab34ae152f1c8d" },
                    { name: "[Force] Adsterra Stack Container", sel: ".adsterra-stack" },
                  ]),
              { name: "[Force] Adsterra SocialBar", sel: SOCIAL_BAR_SELECTOR },
            ]
          : []),
        { name: "[Force] External Link", sel: "a[target='_blank']" },
      ];
      for (const fb of fallbackLocators) {
        const loc = page.locator(fb.sel).first();
        if ((await loc.count().catch(() => 0)) > 0) {
          adCandidates.push({
            name: fb.name,
            locator: loc,
            isSocialBar: fb.sel === SOCIAL_BAR_SELECTOR,
          });
        }
      }
    }

    // Xáo trộn ngẫu nhiên toàn bộ danh sách quảng cáo tìm thấy (Fisher-Yates)
    for (let i = adCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [adCandidates[i], adCandidates[j]] = [adCandidates[j], adCandidates[i]];
    }

    const preferPopunder = Math.random() < POPUNDER_RATIO;

    if (CLICK_MODE === "manual") {
      const targetCandidate = adCandidates.length > 0 ? adCandidates[0] : null;
      const targetDesc = targetCandidate ? targetCandidate.name : "Vùng quảng cáo / Trang web";
      log("\n" + "=".repeat(64));
      log(`🔔 [CHẾ ĐỘ BÁN TỰ ĐỘNG - THỦ CÔNG${isForceClick ? " - CƯỠNG CHẾ" : ""}]`);
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
    } else {
      // 3. Chế độ tự động: Ưu tiên click Popunder hoặc tương tác tự nhiên theo mạng quảng cáo
      const allowPopunderAttempt = FOCUS_POPUNDER_SOCIAL || POPUNDER_RATIO > 0;
      if (allowPopunderAttempt && preferPopunder) {
        log(
          `🎯 [Popunder Ưu Tiên ${Math.round(POPUNDER_RATIO * 100)}%] Kích hoạt click tự nhiên trên trang web để ưu tiên nổ Popunder (${cycleClickMode} mode)...`,
        );
        const popTarget = await resolvePopunderTarget(page);
        log(`-> Click tự nhiên tại (${Math.round(popTarget.x)}, ${Math.round(popTarget.y)}) để kích hoạt Popunder...`);
        const popup = await performEngageAndClick(page, context, popTarget.x, popTarget.y, instanceId, cycleClickMode);
        log("  Đang kiểm tra kết quả mở tab Popunder...");
        if (popup) {
          openedPage = popup;
          adClicked = true;
          log("✓ Popunder đã được kích hoạt thành công!");
        } else {
          await sleep(2500);
          const allPages = context.pages();
          if (allPages.length > 1) {
            openedPage = allPages[allPages.length - 1];
            adClicked = true;
            log("✓ Đã bắt được trang Popunder từ tab phụ.");
          } else {
            log("Popunder chưa mở tab mới (có thể do cooldown mạng quảng cáo); chuyển sang click banner dự phòng...");
          }
        }
      } else if (isAdcash && preferPopunder) {
        log(
          `🚀 [Adcash AutoTag] Kích hoạt tương tác tự nhiên trên trang web để kích hoạt AutoTag (${cycleClickMode} mode)...`,
        );
        const popTarget = await resolvePopunderTarget(page);
        log(`-> Click tương tác tự nhiên tại (${Math.round(popTarget.x)}, ${Math.round(popTarget.y)})...`);
        const popup = await performEngageAndClick(page, context, popTarget.x, popTarget.y, instanceId, cycleClickMode);
        if (popup) {
          openedPage = popup;
          adClicked = true;
          log("✓ AutoTag Adcash đã mở trang quảng cáo thành công!");
        } else {
          await sleep(2500);
          const allPages = context.pages();
          if (allPages.length > 1) {
            openedPage = allPages[allPages.length - 1];
            adClicked = true;
            log("✓ Đã bắt được trang quảng cáo từ tab phụ Adcash.");
          }
        }
      }

      // 4. Ưu tiên click SocialBar nếu Popunder chưa mở tab
      if (!adClicked) {
        const socialCandidate = adCandidates.find((c) => c.isSocialBar);
        if (socialCandidate) {
          log(
            `🔔 [SocialBar Ưu Tiên] Phát hiện quảng cáo SocialBar nổi; tiến hành click [${socialCandidate.name}] (${cycleClickMode} mode)...`,
          );
          const clickTarget = await resolveAdClickTarget(socialCandidate.locator);
          if (clickTarget) {
            log(`-> Click SocialBar tại (${Math.round(clickTarget.x)}, ${Math.round(clickTarget.y)})...`);
            const sbPage = await performEngageAndClick(page, context, clickTarget.x, clickTarget.y, instanceId, cycleClickMode);
            if (sbPage) {
              openedPage = sbPage;
              adClicked = true;
              log(`✓ Đã mở tab quảng cáo thành công từ SocialBar [${socialCandidate.name}].`);
            } else {
              await sleep(2500);
              const allPages = context.pages();
              if (allPages.length > 1) {
                openedPage = allPages[allPages.length - 1];
                adClicked = true;
                log(`✓ Đã bắt được trang quảng cáo từ tab phụ SocialBar [${socialCandidate.name}].`);
              } else {
                log("SocialBar chưa mở tab mới; chuyển sang danh sách banner dự phòng...");
              }
            }
          }
        }
      }

      if (!adClicked && adCandidates.length > 0) {
        const remainingCandidates = adCandidates.filter((c) => !c.isSocialBar);
        const candidatesToClick = remainingCandidates.length > 0 ? remainingCandidates : adCandidates;
        const maxCandidates = FOCUS_POPUNDER_SOCIAL ? 2 : 3;
        let candidateAttempts = 0;
        log(
          `${isForceClick ? "[ForceClick] " : ""}${preferPopunder ? "[Banner Dự Phòng] " : ""}Tìm thấy ${candidatesToClick.length} vị trí quảng cáo khả dụng${isForceClick ? " (kể cả chưa ready)" : ""}. Chọn ngẫu nhiên tối đa ${maxCandidates} vị trí (${cycleClickMode} mode)...`,
        );
        const shuffledCandidates = [...candidatesToClick].sort(() => Math.random() - 0.5);
        for (const candidate of shuffledCandidates) {
          if (candidateAttempts >= maxCandidates) break;
          const clickTarget = await resolveAdClickTarget(candidate.locator);
          if (!clickTarget) {
            log(`  Bỏ qua [${candidate.name}] — không xác định được toạ độ.`);
            continue;
          }
          candidateAttempts++;
          log(`-> ${isForceClick ? "[ForceClick] " : ""}Click ngẫu nhiên quảng cáo [${candidate.name}] (${candidateAttempts}/${maxCandidates}) tại (${Math.round(clickTarget.x)}, ${Math.round(clickTarget.y)})...`);
          const newPage = await performEngageAndClick(page, context, clickTarget.x, clickTarget.y, instanceId, cycleClickMode);
          if (newPage) {
            openedPage = newPage;
            adClicked = true;
            log(`✓ ${isForceClick ? "[ForceClick] " : ""}Đã mở tab quảng cáo thành công từ [${candidate.name}].`);
            break;
          } else {
            await sleep(2000);
            const allPages = context.pages();
            if (allPages.length > 1) {
              openedPage = allPages[allPages.length - 1];
              adClicked = true;
              log(`✓ ${isForceClick ? "[ForceClick] " : ""}Đã bắt được trang quảng cáo từ tab phụ [${candidate.name}].`);
              break;
            }
          }
        }
      }
    }

    // 4. Nếu Popunder/SocialBar vẫn chưa mở được tab: Thử lại 1 lần click tự nhiên Popunder (chỉ áp dụng cho Adsterra)
    if (!adClicked && cycleClickMode !== "manual" && shouldScanAdsterra) {
      log("🎯 [Popunder Thử Lại] Kích hoạt click mô phỏng tự nhiên trên trang để thử lại Popunder...");
      const popTarget = await resolvePopunderTarget(page);
      const popup = await performEngageAndClick(page, context, popTarget.x, popTarget.y, instanceId, cycleClickMode);
      if (popup) {
        openedPage = popup;
        adClicked = true;
        log("✓ Popunder đã được kích hoạt thành công!");
      } else {
        await sleep(2000);
        const allPages = context.pages();
        if (allPages.length > 1) {
          openedPage = allPages[allPages.length - 1];
          adClicked = true;
          log("✓ Đã bắt được trang Popunder từ tab phụ.");
        }
      }
    }

    // 5. Dự phòng selector cuối cùng (giới hạn tối đa 2 lần thử, TUYỆT ĐỐI không click Native khi bật FOCUS_POPUNDER_SOCIAL)
    if (!adClicked && cycleClickMode !== "manual") {
      const candidateSelectors = [
        ...(AD_NETWORK === "adcash" || AD_NETWORK === "all"
          ? [
              '#adcash-ad-container a[href]',
              '.adcash-container a[href]',
              'iframe[src*="acscdn"]',
              'iframe[src*="adexchangerapid"]',
              '[id*="aclib"] a[href]',
              'div[id*="aclib"]',
              'div[class*="aclib"]',
            ]
          : []),
        ...(AD_NETWORK === "clickadu" || AD_NETWORK === "all"
          ? [
              '#clickadu-ad-container a[href]',
              '.clickadu-container a[href]',
              'iframe[src*="clickadu"]',
            ]
          : []),
        ...(shouldScanAdsterra
          ? (FOCUS_POPUNDER_SOCIAL
              ? [
                  SOCIAL_BAR_SELECTOR,
                  '.adsterra-smartlink',
                  '.adsterra-banner[data-status="ready"] iframe',
                  '.adsterra-leaderboard[data-status="ready"] iframe',
                  'iframe[src*="deliberatewatchful.com"]',
                  'iframe[src*="adsterra"]',
                ]
              : [
                  '.adsterra-smartlink',
                  'a[href*="deliberatewatchful.com"]',
                  '.adsterra-banner[data-status="ready"] iframe',
                  '#container-5e6634da84f8f263d7ab34ae152f1c8d a[target="_blank"]',
                  '.adsterra-native a[target="_blank"]',
                ])
          : []),
      ];

      const maxFallbackAttempts = FOCUS_POPUNDER_SOCIAL ? 2 : 3;
      let fallbackAttempts = 0;
      const clickedTargets = [];

      const shuffledSelectors = [...candidateSelectors].sort(() => Math.random() - 0.5);
      for (const selector of shuffledSelectors) {
        if (fallbackAttempts >= maxFallbackAttempts) break;
        const elements = await page.$$(selector);
        if (!elements || elements.length === 0) continue;
        const shuffledElements = [...elements].sort(() => Math.random() - 0.5);
        for (const el of shuffledElements) {
          if (fallbackAttempts >= maxFallbackAttempts) break;
          try {
            const visible = await el.isVisible().catch(() => false);
            if (!visible) continue;
            await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await sleep(100);
            const elBox = await el.boundingBox().catch(() => null);
            if (!elBox || elBox.width < 5 || elBox.height < 5) continue;
            const target = computeClickTarget(elBox);
            // Kiểm tra xem đã click gần toạ độ này chưa (tránh click lặp đi lặp lại cùng 1 phần tử)
            const alreadyClicked = clickedTargets.some(
              (p) => Math.hypot(p.x - target.x, p.y - target.y) < 25,
            );
            if (alreadyClicked) continue;
            clickedTargets.push(target);
            fallbackAttempts++;

            log(`[Dự phòng #${fallbackAttempts}/${maxFallbackAttempts}] Thử click quảng cáo khớp [${selector}] tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
            const newPage = await performEngageAndClick(page, context, target.x, target.y, instanceId, cycleClickMode);
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
              }
            }
          } catch {
            // thử tiếp
          }
        }
        if (adClicked) break;
      }
    }

    // 5. Đọc trang quảng cáo chính và đệ quy click nếu có
    if (openedPage) {
      await tagInstancePage(openedPage, instanceId);
      if (process.platform === "win32" && !isHeadless) {
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
        await withTimeout(
          handleRecursiveAdClicks(openedPage, 0, MAX_RECURSIVE_CLICKS, context, instanceId, cycleClickMode),
          Math.max(45000, MAX_RECURSIVE_CLICKS * 35000),
        ).catch(() => {});
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
      if (proxyManager?.directProxy) {
        log(`[ProxyManager] ⚠ Proxy cố định ${currentProxy.server} phát sinh lỗi/timeout (${errMsg}), bảo lưu proxy không loại bỏ để tiếp tục các chu kỳ sau.`);
      } else {
        log(`[ProxyManager] ⚠ Proxy ${currentProxy.server} phát sinh lỗi kết nối / timeout trong phiên duyệt web; tiến hành loại bỏ khỏi danh sách.`);
        proxyManager?.markDead(currentProxy);
        proxyManager?.flush();
      }
    }
  } finally {
    // 0. Đóng tất cả tab popup phụ còn sót lại trước khi dọn dẹp cache hoặc kết thúc chu kỳ
    try {
      if (context) {
        const extraTabs = context.pages().filter((p) => p !== page && !p.isClosed());
        for (const tab of extraTabs) {
          await withTimeout(tab.close().catch(() => {}), 1500).catch(() => {});
        }
      }
    } catch {}

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
    try {
      if (onFingerprintPage && context) context.off("page", onFingerprintPage);
    } catch {}
    for (const session of fpSessions) {
      try { await session.detach().catch(() => {}); } catch {}
    }

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
        await withTimeout(page.close().catch(() => {}), 2000).catch(() => {});
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
        try {
          const allTabs = context.pages();
          for (const tab of allTabs) {
            if (!tab.isClosed()) {
              await withTimeout(tab.close().catch(() => {}), 1500).catch(() => {});
            }
          }
        } catch {}
        await withTimeout(context.close().catch(() => {}), 3500).catch(() => {});
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
    try { releaseCycleTurn(instanceId); } catch {}
  }
}

async function main() {
  log(`Khởi động tiến trình xem quảng cáo (bản: ${currentVersion ?? "chưa rõ"})`);
  log(`Website đích: ${WEB_URL}`);
  log(`Tuổi thọ tối đa: ${Math.round(MAX_LIFETIME_MS / 60000)} phút`);
  const displayModeDesc = IS_EXPLICIT_HEADLESS
    ? "Chạy ẩn (Headless - không mở cửa sổ)"
    : IS_EXPLICIT_HEADED
    ? "Hiện cửa sổ trình duyệt (Headed)"
    : "Tự động (Headless nếu không dùng chuột phần cứng)";
  log(`Chế độ hiển thị: ${displayModeDesc}`);
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

  const renderTimeoutDesc = `${AD_READY_TIMEOUT_MS}ms (${(AD_READY_TIMEOUT_MS / 1000).toFixed(1)}s)`;
  log(`Thời gian chờ render Adsterra tối đa: ${renderTimeoutDesc}${RENDER_TIMEOUT_CONFIG.userSpecified ? " (tuỳ chỉnh)" : " (mặc định)"} [Quá hạn sẽ cưỡng chế click ngay]`);

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
      DEVICE_MODE === "desktop"
        ? "Chỉ desktop"
        : DEVICE_MODE === "mobile"
        ? "Chỉ mobile"
        : DEVICE_MODE === "random"
        ? `Ngẫu nhiên (mobile ${Math.round(MOBILE_RATIO * 100)}%)`
        : `Tuỳ chỉnh [${DEVICE_MODE}]`;
    log(`Vân tay thiết bị: ${deviceDesc} · Trình duyệt: ${BROWSER_SELECTION.browsers.join(", ")}`);
    if (BROWSER_SELECTION.unknown.length > 0) {
      log(`⚠ Bỏ qua tên trình duyệt không nhận ra: ${BROWSER_SELECTION.unknown.join(", ")}`);
    }
  } else {
    log("Vân tay thiết bị: tắt (--no-fingerprint) — dùng UA Chrome Windows cố định.");
  }

  log(
    `Số lượng instance: ${INSTANCE_COUNT}${
      INSTANCE_COUNT > 1
        ? ` (Chế độ chạy song song đa instance${IS_EXPLICIT_HEADLESS ? " — Chạy ngầm 100% không khoá Mutex" : ""})`
        : " (Chế độ đơn lẻ)"
    }`
  );
  if (FOCUS_POPUNDER_SOCIAL || POPUNDER_RATIO > 0) {
    log(`Xác suất ưu tiên click Popunder: ${Math.round(POPUNDER_RATIO * 100)}% (tự nhiên hóa hành vi tương tác web)`);
  } else {
    log(`Định dạng quảng cáo: Cân bằng tất cả định dạng (không ưu tiên riêng Popunder)`);
  }

  const proxyManager = new ProxyManager();
  proxyManager.init();

  log(
    `Anti-Detect Proxy: ${
      ANTI_DETECT_PROXY
        ? "BẬT [Zero-Mismatch Triad — Đồng bộ Timezone, Geolocation, Locale theo proxy & chống rò rỉ WebRTC]"
        : "TẮT [Proxy tunnel thuần túy, không can thiệp Geo/Timezone/Locale/WebRTC]"
    }`
  );

  const trafficSourceDesc =
    TRAFFIC_SOURCE === "none"
      ? "TẮT [Truy cập trực tiếp - Direct Traffic]"
      : TRAFFIC_SOURCE === "all"
      ? `BẬT [Ngẫu nhiên tất cả nguồn: Google, Facebook, Instagram, TikTok, X, ChatGPT, Claude, Grok, Gemini — Tỉ lệ có Referrer: ${Math.round(TRAFFIC_RATIO * 100)}%]`
      : `BẬT [${TRAFFIC_SOURCES[TRAFFIC_SOURCE]?.name || TRAFFIC_SOURCE} — Tỉ lệ có Referrer: ${Math.round(TRAFFIC_RATIO * 100)}%]`;
  log(`Nguồn lưu lượng (Traffic Source): ${trafficSourceDesc}`);

  const startTime = Date.now();

  if (INSTANCE_COUNT === 1) {
    await runInstanceSupervisor(1, proxyManager, extPath, startTime);
  } else {
    log(
      `Khởi chạy đồng thời ${INSTANCE_COUNT} instance (${
        IS_EXPLICIT_HEADLESS
          ? "Mỗi instance độc lập profile, proxy, fingerprint và chạy song song 100% không khoá Mutex chuột"
          : "Mỗi instance độc lập profile, proxy, fingerprint và điều phối mutex chuột"
      })...`
    );
    const instancePromises = [];
    for (let id = 1; id <= INSTANCE_COUNT; id++) {
      instancePromises.push(runInstanceSupervisor(id, proxyManager, extPath, startTime));
    }
    await Promise.allSettled(instancePromises);
  }

  log("Ca trực hoàn tất bình thường. Thoát mã 0.");
  process.exit(0);
}

async function runInstanceSupervisor(instanceId, proxyManager, extPath, startTime) {
  let restarts = 0;
  while (Date.now() - startTime < MAX_LIFETIME_MS - 30_000) {
    try {
      await runInstanceLoop(instanceId, proxyManager, extPath, startTime);
      break;
    } catch (fatalErr) {
      restarts++;
      const remainingMs = MAX_LIFETIME_MS - (Date.now() - startTime);
      if (remainingMs <= 30_000) {
        log(`[Supervisor] Instance #${instanceId} hoàn thành theo hạn mức ca trực.`);
        break;
      }
      log(`🔥 [Supervisor] Instance #${instanceId} gặp sự cố ngoài dự kiến (Lần #${restarts}): ${fatalErr?.message || fatalErr}. Tự động phục hồi và tiếp tục ca trực sau 6 giây...`);
      try { releaseCycleTurn(instanceId, { quiet: true }); } catch {}
      await sleep(6000);
    }
  }
}

async function runInstanceLoop(instanceId, proxyManager, extPath, startTime) {
  return logContext.run({ instanceId }, async () => {
    if (instanceId > 1) {
      const staggerStep = IS_EXPLICIT_HEADLESS ? 3000 : 8000;
      const staggerDelayMs = (instanceId - 1) * staggerStep;
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

        try {
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

          const requiresIsolatedProfile = Boolean(extPath) || IS_EXPLICIT_HEADLESS;
          const bypassSharedProfile =
            !requiresIsolatedProfile &&
            (process.argv.some((a) => a.startsWith("--cdp")) ||
             Boolean(process.env.CDP_URL) ||
             process.argv.includes("--my-chrome") ||
             process.argv.includes("--my-profile") ||
             process.env.USE_MY_CHROME === "1");

          if (!bypassSharedProfile) {
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
        } catch (cycleErr) {
          log(`⚠ [Instance #${instanceId}] Sự cố chu kỳ ${cycle}: ${cycleErr?.message || cycleErr}. Đang tự động dọn dẹp và tiếp tục chu kỳ mới sau 5s...`);
          try { releaseCycleTurn(instanceId, { quiet: true }); } catch {}
          if (currentProxy) {
            try { proxyManager.releaseProxy(currentProxy); } catch {}
            currentProxy = null;
          }
          if (sharedProfileDir && CLEAR_CACHE_CYCLES > 0) {
            try { rmSync(sharedProfileDir, { recursive: true, force: true }); } catch {}
            sharedProfileDir = null;
          }
          const remainingMs = MAX_LIFETIME_MS - (Date.now() - startTime);
          if (remainingMs <= 30_000) {
            log(`[Instance #${instanceId}] Hết thời gian tuổi thọ ca trực. Đóng instance an toàn.`);
            break;
          }
          await sleep(5000);
        }
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

export {
  ProxyManager,
  parseProxyItem,
  parseAntiDetectProxy,
  ANTI_DETECT_PROXY,
  parsePopunderRatio,
  resolvePopunderTarget,
  parseFocusPopunderSocial,
  FOCUS_POPUNDER_SOCIAL,
  parseAdNetwork,
  AD_NETWORK,
  ADCASH_CONTAINER_SELECTOR,
  CLICKADU_CONTAINER_SELECTOR,
  SOCIAL_BAR_KEY,
  SOCIAL_BAR_SELECTOR,
  parseTrafficSource,
  parseTrafficRatio,
  resolveTrafficReferrer,
  TRAFFIC_SOURCES,
  TRAFFIC_SOURCE,
  TRAFFIC_RATIO,
};
