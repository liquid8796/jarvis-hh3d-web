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

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium as vanillaChromium } from "playwright-core";

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
const SELF_UPDATE = process.env.AD_VIEWER_SELF_UPDATE === "1";
const ENABLE_DEV_MODE = process.env.AD_VIEWER_ENABLE_DEV_MODE !== "0";

const BANNER_SLOT_SELECTOR = ".adsterra-leaderboard";
const BANNER_READY_SELECTOR = '.adsterra-leaderboard[data-status="ready"]';
const NATIVE_SLOT_SELECTOR = ".adsterra-native";
const NATIVE_READY_SELECTOR = '.adsterra-native[data-status="ready"]';
const NATIVE_CONTAINER_ID = "container-5e6634da84f8f263d7ab34ae152f1c8d";

const CLICK_MODE = (
  process.argv.find((a) => a.startsWith("--click-mode="))?.split("=")[1] ||
  process.env.AD_VIEWER_CLICK_MODE ||
  "cdp"
).toLowerCase();

const USE_CANVAS_BLOCKER =
  process.argv.includes("--canvas-blocker") ||
  process.argv.includes("--with-canvas-blocker") ||
  process.env.AD_VIEWER_CANVAS_BLOCKER === "1";

const PROXY_FILE = (
  process.argv.find((a) => a.startsWith("--proxy-file="))?.split("=")[1] ||
  process.env.AD_VIEWER_PROXY_FILE ||
  ""
).trim();

const DIRECT_PROXY = (
  process.argv.find((a) => a.startsWith("--proxy="))?.split("=")[1] ||
  process.env.AD_VIEWER_PROXY ||
  ""
).trim();

const ROTATE_URL = (
  process.argv.find((a) => a.startsWith("--rotate-url="))?.split("=")[1] ||
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

function log(msg) {
  const ts = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  console.log(`[${ts}] [${VIEWER_ID}] ${msg}`);
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
 * Phân tích chuỗi proxy theo các định dạng phổ biến:
 * 1. host:port (như D:\Project\lobby\proxies\list-proxies.txt)
 * 2. host:port:username:password
 * 3. protocol://username:password@host:port
 * 4. username:password@host:port
 */
function parseProxyItem(rawStr) {
  if (!rawStr) return null;
  const str = rawStr.trim();
  if (!str || str.startsWith("#") || str.startsWith("//")) return null;

  // 1. URL format: protocol://user:pass@host:port
  if (str.includes("://")) {
    try {
      const u = new URL(str);
      const protocol = u.protocol.replace(":", "").toLowerCase();
      const port = Number(u.port) || (protocol === "https" ? 443 : 80);
      return {
        protocol,
        host: u.hostname,
        port,
        username: decodeURIComponent(u.username || ""),
        password: decodeURIComponent(u.password || ""),
        server: `${protocol}://${u.hostname}:${port}`,
        raw: str,
      };
    } catch {
      return null;
    }
  }

  // 2. Format: user:pass@host:port
  if (str.includes("@")) {
    const atIndex = str.lastIndexOf("@");
    const authPart = str.slice(0, atIndex);
    const hostPart = str.slice(atIndex + 1);
    const authColon = authPart.indexOf(":");
    const username = authColon >= 0 ? authPart.slice(0, authColon) : authPart;
    const password = authColon >= 0 ? authPart.slice(authColon + 1) : "";
    const [host, port] = hostPart.split(":");
    const p = Number(port) || 80;
    return {
      protocol: "http",
      host: host.trim(),
      port: p,
      username: username.trim(),
      password: password.trim(),
      server: `http://${host.trim()}:${p}`,
      raw: str,
    };
  }

  // 3. Format: host:port:user:pass or host:port
  const parts = str.split(":");
  if (parts.length >= 4) {
    const host = parts[0].trim();
    const port = Number(parts[1].trim()) || 80;
    const username = parts[2].trim();
    const password = parts.slice(3).join(":").trim();
    return {
      protocol: "http",
      host,
      port,
      username,
      password,
      server: `http://${host}:${port}`,
      raw: str,
    };
  }

  if (parts.length === 2) {
    const host = parts[0].trim();
    const port = Number(parts[1].trim()) || 80;
    return {
      protocol: "http",
      host,
      port,
      username: "",
      password: "",
      server: `http://${host}:${port}`,
      raw: str,
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

    if (typeof process !== "undefined" && process.on) {
      process.on("beforeExit", () => this.flush());
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
   * Kiểm tra khả năng kết nối tới proxy trong 2.5 giây.
   * Thử nghiệm HTTP CONNECT tunnel để phát hiện proxy sống thật và tự động loại bỏ proxy đòi hỏi mật khẩu (407) hoặc lỗi (400/403/502).
   */
  async probe(proxy, timeoutMs = 2500) {
    if (!proxy || !proxy.host || !proxy.port) return false;
    return new Promise((resolve) => {
      let settled = false;
      let socket = null;
      const done = (val) => {
        if (!settled) {
          settled = true;
          if (socket) {
            try { socket.destroy(); } catch {}
          }
          resolve(val);
        }
      };

      try {
        socket = net.createConnection({
          host: proxy.host,
          port: Number(proxy.port),
          timeout: timeoutMs,
        });
      } catch {
        return resolve(false);
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
  async probeBatch(candidates, timeoutMs = 2500) {
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

  async getNextWorkingProxy() {
    this.init();
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
              `[ProxyManager] ✓ Đã nhận proxy mới từ API: ${p.server} | ` +
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
      const isAlive = await this.probe(single, 2500);
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

    log(
      `[ProxyManager] Quét song song siêu tốc danh sách proxy (đang dò tối đa ${maxScan}/${this.proxyList.length} proxy ` +
      `theo từng lô ${batchSize} kết nối đồng thời${this.pruneDead ? ", tự động loại bỏ proxy chết" : ""})...`
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
          currentBatch.push(candidate);
          checkedSoFar++;
        }
      }

      if (currentBatch.length === 0) break;

      const displayFrom = checkedSoFar - currentBatch.length + 1;
      const displayTo = checkedSoFar;
      log(`[ProxyManager] Đang kiểm tra đồng thời lô ${b + 1}/${batchesCount} (${currentBatch.length} proxy, vị trí #${displayFrom} - #${displayTo})...`);

      const alive = await this.probeBatch(currentBatch, 2500);
      if (alive) {
        alive.geo = await this.resolveGeo(alive);
        const aliveIdx = this.proxyList.findIndex((p) => p.host === alive.host && p.port === alive.port);
        if (aliveIdx !== -1) {
          this.currentIndex = (aliveIdx + 1) % Math.max(1, this.proxyList.length);
        }
        log(
          `[ProxyManager] ✓ Đã tìm thấy Proxy kết nối tốt siêu tốc: ${alive.server} | ` +
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
 */
async function organicScroll(page, totalDistance) {
  if (Math.abs(totalDistance) < 30) return;
  const dir = totalDistance > 0 ? 1 : -1;
  let remaining = Math.abs(totalDistance);
  while (remaining > 0) {
    const chunk = Math.min(remaining, rand(60, 200));
    await page.mouse.wheel(0, chunk * dir);
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
    // Dwell — dừng lại như đang đọc nội dung quảng cáo
    await sleep(logNormalDelay(600, 0.4));
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
  await sleep(logNormalDelay(600, 0.4));
  await page.mouse.down({ button: "left" });
  await sleep(rand(70, 160));
  await page.mouse.up({ button: "left" });
  lastMouseX = targetX;
  lastMouseY = targetY;
}

/** Dispatcher thống nhất — chọn engine theo CLICK_MODE. */
async function humanClick(page, ctx, x, y) {
  if (CLICK_MODE === "cdp") {
    return humanClickCdp(page, ctx, x, y);
  }
  return humanClickMouse(page, x, y);
}

/**
 * Mô phỏng tiếp cận tự nhiên trước khi click: di chuột đến vùng lân cận quảng cáo,
 * dừng lại như đang nhìn, rồi từ từ rê vào vị trí đích.
 */
async function preClickEngagement(page, ctx, targetX, targetY) {
  // 1. Di chuyển đến vùng lân cận trước (lệch 35-70px) như ánh mắt vừa lướt qua
  const nearX = targetX + rand(-70, 70);
  const nearY = targetY + rand(-50, 50);
  const approachPath = generateBezierPath(lastMouseX, lastMouseY, nearX, nearY, rand(12, 22));
  if (CLICK_MODE === "cdp") {
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

  // 2. Dừng lại như đang đọc tiêu đề quảng cáo và quyết định bấm
  await sleep(rand(1200, 2500));

  // 3. Rê chuột nhẹ nhàng từ vị trí lân cận vào đúng vị trí click đích
  const finalGlide = generateBezierPath(lastMouseX, lastMouseY, targetX, targetY, rand(8, 14));
  if (CLICK_MODE === "cdp") {
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
 * Mô phỏng người dùng dừng lại đọc nội dung trang web:
 * - Cuộn nhẹ lên xuống theo nhịp đọc.
 * - Rê chuột vi mô ngẫu nhiên theo dòng chữ hoặc khối bài viết.
 * - Dừng lại ngẫu nhiên để mắt đọc thông tin trước khi chuyển sang xem quảng cáo.
 */
async function simulateHumanReading(page, durationMs) {
  if (!page || durationMs <= 0) return;
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const remaining = durationMs - (Date.now() - started);
    if (remaining < 800) break;

    // Rê chuột vi mô theo dòng đọc (drift)
    const driftX = Math.max(100, Math.min(1200, lastMouseX + rand(-150, 150)));
    const driftY = Math.max(80, Math.min(700, lastMouseY + rand(-80, 80)));
    const path = generateBezierPath(lastMouseX, lastMouseY, driftX, driftY, rand(8, 16));
    for (const pt of path) {
      await page.mouse.move(pt.x, pt.y).catch(() => {});
      await sleep(rand(10, 25));
    }
    lastMouseX = driftX;
    lastMouseY = driftY;

    // Dừng đọc đoạn văn bản
    await sleep(rand(700, 1900));

    // Thao tác cuộn nhẹ mô phỏng mắt đọc xuống
    if (Math.random() < 0.4) {
      const scrollDistance = rand(-80, 200);
      await organicScroll(page, scrollDistance);
      await sleep(rand(400, 1200));
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

async function handleRecursiveAdClicks(targetPage, depth, maxDepth, ctx) {
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
          const elBox = await handle.boundingBox().catch(() => null);
          if (!elBox || elBox.width < 2 || elBox.height < 2) continue;
          const target = computeClickTarget(elBox);
          log(`  [Đệ quy cấp ${depth + 1}] Tìm thấy phần tử (${sel}), click tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
          const resolvedCtx = ctx || targetPage.context();
          await preClickEngagement(targetPage, resolvedCtx, target.x, target.y);
          const [newPage] = await Promise.all([
            resolvedCtx.waitForEvent("page", { timeout: 8000 }).catch(() => null),
            humanClick(targetPage, resolvedCtx, target.x, target.y).catch(() => null),
          ]);

          clicked = true;
          if (newPage) {
            await newPage.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
            await handleRecursiveAdClicks(newPage, depth + 1, maxDepth, resolvedCtx);
            await newPage.close().catch(() => {});
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

function killChromeProcesses() {
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /IM chrome.exe /T", { stdio: "ignore" });
    } else {
      execSync("pkill -9 -f chrome", { stdio: "ignore" });
    }
  } catch {}
}

async function cleanupTargetedCookies(client, visitedDomains = []) {
  if (!client) return;
  try {
    const { cookies } = await client.send("Network.getCookies").catch(() => ({ cookies: [] }));
    if (!Array.isArray(cookies) || cookies.length === 0) return;

    let targetHost = "";
    try {
      targetHost = new URL(WEB_URL).hostname.toLowerCase();
    } catch {}

    const adKeywords = [
      targetHost,
      "auto-hh3d",
      "deliberatewatchful",
      "alwingulla",
      "adsterra",
      "profitablecpmrate",
      "highcpmgate",
      "ad-score",
      "doubleclick",
      "googleads",
      "adnxs",
      "popads",
      "onclick",
      "syndication",
      ...visitedDomains.map((d) => String(d).toLowerCase()),
    ].filter(Boolean);

    let deletedCount = 0;
    for (const c of cookies) {
      const domain = (c.domain || "").toLowerCase().replace(/^\./, "");
      const isTarget = adKeywords.some((kw) => domain.includes(kw));
      if (isTarget) {
        await client
          .send("Network.deleteCookies", {
            name: c.name,
            domain: c.domain,
            path: c.path,
          })
          .catch(() => {});
        deletedCount++;
      }
    }
    await client.send("Network.clearBrowserCache").catch(() => {});
    log(`✓ Đã dọn dẹp có chọn lọc ${deletedCount} cookie quảng cáo và cache (bảo vệ an toàn tài khoản cá nhân).`);
  } catch (err) {
    log(`Lỗi khi dọn dẹp cookie có chọn lọc: ${err instanceof Error ? err.message : String(err)}`);
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

    const args = [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--restore-last-session",
      ...webrtcAntiLeakFlags,
      ...proxyFlags,
    ];

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
      "--window-size=1366,768",
      "--enable-experimental-extension-apis",
      "--extensions-on-chrome-urls",
      "--silent-debugger-extension-api",
      ...webrtcAntiLeakFlags,
      ...proxyFlags,
    ];

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

async function runOneCycle(extensionPath, currentProxy = null, proxyManager = null) {
  const useMyChrome =
    process.argv.includes("--my-chrome") ||
    process.argv.includes("--my-profile") ||
    process.env.USE_MY_CHROME === "1";

  const cdpArg = process.argv.find((a) => a.startsWith("--cdp"));
  const cdpPort = cdpArg && cdpArg.includes("=") ? cdpArg.split("=")[1] : "9222";
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
        log(`✓ Đã kết nối thành công tới Chrome ${useMyChrome ? "chính (đầy đủ extension) " : ""}qua CDP.`);
      } catch (err) {
        log(`✗ Không thể kết nối tới Chrome tại ${cdpUrl}: ${err.message}`);
        log(`  Gợi ý: Mở Chrome bằng lệnh: & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${cdpPort}`);
        process.exit(1);
      }
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
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--enforce-webrtc-ip-permission-check",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
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

      const defaultDesktopUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

      const launchOptions = {
        headless: false,
        args: launchArgs,
        viewport: { width: 1366, height: 768 },
        locale: currentProxy?.geo?.locale || "vi-VN",
        timezoneId: currentProxy?.geo?.timezoneId || "Asia/Ho_Chi_Minh",
        userAgent: defaultDesktopUA,
      };

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

    page = useMyChrome || cdpUrl ? await context.newPage() : context.pages()[0] || (await context.newPage());

    // Cài đặt Anti-Detect overrides và xác thực Proxy qua CDP
    try {
      const cdpClient = await context.newCDPSession(page).catch(() => null);
      if (cdpClient) {
        if (currentProxy?.username && currentProxy?.password) {
          await cdpClient.send("Fetch.enable", { handleAuthRequests: true }).catch(() => {});
          cdpClient.on("Fetch.authRequired", async (event) => {
            if (event.authChallenge?.source === "Proxy") {
              await cdpClient.send("Fetch.continueWithAuth", {
                requestId: event.requestId,
                authChallengeResponse: {
                  response: "ProvideCredentials",
                  username: currentProxy.username,
                  password: currentProxy.password,
                },
              }).catch(() => {});
            } else {
              await cdpClient.send("Fetch.continueWithAuth", {
                requestId: event.requestId,
                authChallengeResponse: { response: "Default" },
              }).catch(() => {});
            }
          });
        }

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
          if (currentProxy.geo.locale) {
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
    }).catch(() => {});

    const renderStartedAt = Date.now();
    log(`Mở trang chủ ${WEB_URL}...`);
    await page.goto(WEB_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Cuộn trang tự nhiên để kích hoạt lazy-load quảng cáo (từng nhịp, có quán tính)
    await organicScroll(page, rand(250, 400));
    await sleep(rand(300, 600));
    await organicScroll(page, rand(350, 550));

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

    // Dừng đọc nội dung trang web tự nhiên trước khi click (chống cờ click tức thì của mạng quảng cáo)
    const readingBeforeClickMs = rand(6000, 12000);
    log(`Đang đọc nội dung bài viết và lướt xem trang web trong ${Math.round(readingBeforeClickMs / 1000)}s...`);
    await simulateHumanReading(page, readingBeforeClickMs);

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
      log(`Tìm thấy tổng cộng ${adCandidates.length} vị trí quảng cáo khả dụng. Đang chọn ngẫu nhiên để click (${CLICK_MODE} mode)...`);
      for (const candidate of adCandidates) {
        const clickTarget = await resolveAdClickTarget(candidate.locator);
        if (!clickTarget) {
          log(`  Bỏ qua [${candidate.name}] — không xác định được toạ độ.`);
          continue;
        }
        log(`-> Click ngẫu nhiên quảng cáo [${candidate.name}] tại (${Math.round(clickTarget.x)}, ${Math.round(clickTarget.y)})...`);
        await preClickEngagement(page, context, clickTarget.x, clickTarget.y);
        const [newPage] = await Promise.all([
          context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
          humanClick(page, context, clickTarget.x, clickTarget.y).catch(() => null),
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
            if (!visible) continue;
            const elBox = await el.boundingBox().catch(() => null);
            if (!elBox || elBox.width < 2 || elBox.height < 2) continue;
            const target = computeClickTarget(elBox);
            log(`Tìm thấy quảng cáo khớp [${selector}], click tại (${Math.round(target.x)}, ${Math.round(target.y)})...`);
            await preClickEngagement(page, context, target.x, target.y);
            const [newPage] = await Promise.all([
              context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
              humanClick(page, context, target.x, target.y).catch(() => null),
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
          } catch {
            // thử tiếp phần tử sau
          }
        }
        if (adClicked) break;
      }
    }

    // 4. Click tự nhiên để kích hoạt popunder nếu chưa click được
    if (!adClicked) {
      log("Không click được quảng cáo cụ thể bằng selector; kích hoạt click mô phỏng tự nhiên trên trang...");
      const popTarget = { x: rand(200, 600), y: rand(200, 500) };
      await preClickEngagement(page, context, popTarget.x, popTarget.y);
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 8000 }).catch(() => null),
        humanClick(page, context, popTarget.x, popTarget.y).catch(() => null),
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
      try {
        const u = new URL(openedPage.url());
        if (u.hostname) visitedDomains.push(u.hostname);
      } catch {}
      const readingMs = rand(DELAY_MIN_MS, DELAY_MAX_MS);
      log(`Trải nghiệm và tương tác tự nhiên trên trang đích trong ${Math.round(readingMs / 1000)}s...`);
      await simulateLandingPageEngagement(openedPage, readingMs);

      // Đệ quy click thêm nếu còn quảng cáo trên trang đích (tối đa MAX_RECURSIVE_CLICKS)
      if (MAX_RECURSIVE_CLICKS > 0) {
        await handleRecursiveAdClicks(openedPage, 0, MAX_RECURSIVE_CLICKS, context);
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
    if (
      currentProxy &&
      (errMsg.includes("ERR_PROXY") ||
        errMsg.includes("ERR_TUNNEL") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("ETIMEDOUT") ||
        errMsg.includes("ERR_CONNECTION") ||
        errMsg.includes("ERR_NAME_NOT_RESOLVED"))
    ) {
      log(`[ProxyManager] ⚠ Proxy ${currentProxy.server} phát sinh lỗi kết nối trong phiên duyệt web; tiến hành loại bỏ khỏi danh sách.`);
      proxyManager?.markDead(currentProxy);
      proxyManager?.flush();
    }
  } finally {
    // 1. Dọn dẹp cache và cookies sau mỗi chu kỳ
    if (context) {
      try {
        if (useMyChrome) {
          // Xoá cookie có chọn lọc cho website và các domain quảng cáo — bảo vệ tài khoản cá nhân
          if (page && !page.isClosed()) {
            const client = await context.newCDPSession(page).catch(() => null);
            if (client) {
              await cleanupTargetedCookies(client, visitedDomains);
              await client.detach().catch(() => {});
            }
          }
        } else {
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
        }
      } catch {
        // bỏ qua lỗi CDP session
      }
    }

    if (cdpUrl) {
      // Trong chế độ CDP, không đóng context/browser của người dùng, chỉ đóng tab do chu kỳ mở
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      if (useMyChrome && proxyManager?.hasMultipleProxies()) {
        log("✓ Hoàn thành chu kỳ. Tắt Chrome để chuẩn bị xoay sang Proxy mới cho chu kỳ tiếp theo...");
        killChromeProcesses();
        await sleep(1500);
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
  log(`Chế độ click: ${CLICK_MODE} (${CLICK_MODE === "cdp" ? "CDP Input.dispatchMouseEvent — isTrusted:true" : "Playwright Mouse API — Bézier trajectory"})`);

  const extPath = USE_CANVAS_BLOCKER ? resolveExtensionPath() : null;
  if (extPath) {
    log(`✓ Đã nạp tiện ích CanvasBlocker từ: ${extPath}`);
  } else if (USE_CANVAS_BLOCKER) {
    log("⚠ Bật cờ CanvasBlocker nhưng không tìm thấy thư mục tiện ích; chạy Chromium tiêu chuẩn.");
  } else {
    log("Tiện ích CanvasBlocker: tắt (mặc định). Dùng --canvas-blocker để bật.");
  }

  const proxyManager = new ProxyManager();
  proxyManager.init();

  const startTime = Date.now();
  let cycle = 0;

  while (Date.now() - startTime < MAX_LIFETIME_MS) {
    cycle++;
    log(`\n=================== BẮT ĐẦU CHU KỲ ${cycle} ===================`);
    const currentProxy = await proxyManager.getNextWorkingProxy();
    await runOneCycle(extPath, currentProxy, proxyManager);

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
