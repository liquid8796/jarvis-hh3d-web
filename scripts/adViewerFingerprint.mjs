/**
 * VÂN TAY THIẾT BỊ + TRÌNH DUYỆT NGẪU NHIÊN cho trình xem quảng cáo.
 *
 * Hai bước, cố ý tách rời:
 *
 *   pickFingerprintProfile()   chọn THỨ GÌ (thiết bị, hệ điều hành, trình duyệt, GPU, số nhân…)
 *                              — gọi một lần cho mỗi "danh tính", không cần biết bản engine.
 *   materializeFingerprint()   dựng CHUỖI cụ thể (User-Agent, Client Hints, navigator…) từ hồ sơ
 *                              + số bản Chromium THẬT đang chạy.
 *
 * Vì sao số bản phải lấy từ engine thật: trang web dò tính năng (CSS, API) theo engine, không
 * theo chuỗi UA. Khai "Chrome 120" trên engine 141 là một mâu thuẫn đo được. Nên mọi trình duyệt
 * họ Chromium (Chrome, Edge, Opera, Brave, Cốc Cốc, Samsung) đều khai đúng major của engine.
 *
 * GIỚI HẠN PHẢI NÓI RÕ: Firefox và Safari ở đây là GIẢ LẬP trên engine Chromium. Lớp JavaScript
 * được vá cho khớp (không có userAgentData, không có window.chrome, vendor/oscpu/productSub đúng
 * họ), nhưng dấu vân tay tầng TLS/HTTP2 và hành vi engine vẫn là Chromium. Ai cần nhất quán tuyệt
 * đối thì dùng `--browsers=chromium`.
 */

/** @typedef {"desktop" | "mobile"} DeviceClass */
/** @typedef {"windows" | "macos" | "linux" | "android" | "ios"} OsId */
/** @typedef {"chromium" | "firefox" | "webkit"} EngineFamily */

export const BROWSER_IDS = ["chrome", "edge", "opera", "brave", "coccoc", "samsung", "firefox", "safari"];
export const CHROMIUM_BROWSER_IDS = ["chrome", "edge", "opera", "brave", "coccoc", "samsung"];

/**
 * Trọng số phỏng theo thị phần thực tế (có nghiêng về Việt Nam: Cốc Cốc). `os` liệt kê nơi
 * trình duyệt ấy thật sự tồn tại — Samsung Internet không có trên Windows, Safari chỉ có trên
 * hệ Apple. Trên iOS mọi trình duyệt đều chạy WebKit, nên họ engine đổi theo hệ điều hành.
 */
const BROWSERS = {
  chrome: { label: "Chrome", desktopWeight: 55, mobileWeight: 45, os: ["windows", "macos", "linux", "android", "ios"] },
  edge: { label: "Edge", desktopWeight: 14, mobileWeight: 3, os: ["windows", "macos", "android", "ios"] },
  opera: { label: "Opera", desktopWeight: 5, mobileWeight: 4, os: ["windows", "macos", "linux", "android"] },
  brave: { label: "Brave", desktopWeight: 4, mobileWeight: 3, os: ["windows", "macos", "linux", "android"] },
  coccoc: { label: "Cốc Cốc", desktopWeight: 8, mobileWeight: 5, os: ["windows", "macos", "android"] },
  samsung: { label: "Samsung Internet", desktopWeight: 0, mobileWeight: 9, os: ["android"] },
  firefox: { label: "Firefox", desktopWeight: 8, mobileWeight: 3, os: ["windows", "macos", "linux", "android", "ios"] },
  safari: { label: "Safari", desktopWeight: 6, mobileWeight: 28, os: ["macos", "ios"] },
};

const OS_WEIGHTS = { windows: 75, macos: 17, linux: 8, android: 65, ios: 35 };
const DESKTOP_OS = ["windows", "macos", "linux"];
const MOBILE_OS = ["android", "ios"];

const WINDOWS_SCREENS = [
  { w: 1920, h: 1080, dpr: 1, weight: 35 },
  { w: 1366, h: 768, dpr: 1, weight: 20 },
  { w: 1536, h: 864, dpr: 1.25, weight: 14 },
  { w: 1600, h: 900, dpr: 1, weight: 6 },
  { w: 1440, h: 900, dpr: 1, weight: 6 },
  { w: 2560, h: 1440, dpr: 1, weight: 7 },
  { w: 1280, h: 720, dpr: 1, weight: 4 },
  { w: 1680, h: 1050, dpr: 1, weight: 3 },
];
const MAC_SCREENS = [
  { w: 1440, h: 900, dpr: 2, weight: 25 },
  { w: 1512, h: 982, dpr: 2, weight: 25 },
  { w: 1470, h: 956, dpr: 2, weight: 20 },
  { w: 1728, h: 1117, dpr: 2, weight: 15 },
  { w: 2560, h: 1440, dpr: 1, weight: 15 },
];
const LINUX_SCREENS = [
  { w: 1920, h: 1080, dpr: 1, weight: 60 },
  { w: 1366, h: 768, dpr: 1, weight: 25 },
  { w: 2560, h: 1440, dpr: 1, weight: 15 },
];

export const ANDROID_DEVICES = [
  { model: "SM-S928B", name: "Galaxy S24 Ultra", w: 384, h: 824, dpr: 3.75, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 750", weight: 12 },
  { model: "SM-S921B", name: "Galaxy S24", w: 360, h: 780, dpr: 3, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 750", weight: 12 },
  { model: "SM-S918B", name: "Galaxy S23 Ultra", w: 384, h: 824, dpr: 3.75, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 740", weight: 10 },
  { model: "SM-A546E", name: "Galaxy A54", w: 384, h: 832, dpr: 2.8125, gpuVendor: "ARM", gpu: "Mali-G68 MC4", weight: 16 },
  { model: "SM-A155F", name: "Galaxy A15", w: 384, h: 832, dpr: 2.8125, gpuVendor: "ARM", gpu: "Mali-G57 MC2", weight: 14 },
  { model: "SM-A556B", name: "Galaxy A55", w: 384, h: 832, dpr: 2.8125, gpuVendor: "Samsung", gpu: "Xclipse 530", weight: 12 },
  { model: "Pixel 8 Pro", name: "Pixel 8 Pro", w: 412, h: 892, dpr: 3.5, gpuVendor: "ARM", gpu: "Mali-G715", weight: 8 },
  { model: "Pixel 8", name: "Pixel 8", w: 412, h: 915, dpr: 2.625, gpuVendor: "ARM", gpu: "Mali-G715", weight: 8 },
  { model: "Pixel 7a", name: "Pixel 7a", w: 412, h: 915, dpr: 2.625, gpuVendor: "ARM", gpu: "Mali-G710", weight: 6 },
  { model: "Pixel 7", name: "Pixel 7", w: 412, h: 915, dpr: 2.625, gpuVendor: "ARM", gpu: "Mali-G710", weight: 6 },
  { model: "Pixel 9 Pro", name: "Pixel 9 Pro", w: 412, h: 915, dpr: 3, gpuVendor: "ARM", gpu: "Mali-G715", weight: 8 },
  { model: "Pixel 9", name: "Pixel 9", w: 412, h: 915, dpr: 2.625, gpuVendor: "ARM", gpu: "Mali-G715", weight: 8 },
  { model: "23129RAA4G", name: "Redmi Note 13", w: 393, h: 873, dpr: 2.75, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 610", weight: 16 },
  { model: "2311DRK48G", name: "Xiaomi 14", w: 393, h: 873, dpr: 3, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 750", weight: 10 },
  { model: "CPH2591", name: "OPPO Reno11", w: 412, h: 915, dpr: 2.625, gpuVendor: "ARM", gpu: "Mali-G610 MC4", weight: 14 },
  { model: "V2250", name: "vivo V27", w: 388, h: 862, dpr: 2.75, gpuVendor: "Qualcomm", gpu: "Adreno (TM) 642L", weight: 14 },
];
export const ANDROID_VERSIONS = [
  { major: 13, weight: 25 },
  { major: 14, weight: 40 },
  { major: 15, weight: 35 },
];
export const IPHONES = [
  { name: "iPhone 11", w: 414, h: 896, dpr: 2, weight: 8 },
  { name: "iPhone SE", w: 375, h: 667, dpr: 2, weight: 5 },
  { name: "iPhone 12", w: 390, h: 844, dpr: 3, weight: 10 },
  { name: "iPhone 12 Pro", w: 390, h: 844, dpr: 3, weight: 10 },
  { name: "iPhone 13", w: 390, h: 844, dpr: 3, weight: 16 },
  { name: "iPhone 13 Pro", w: 390, h: 844, dpr: 3, weight: 12 },
  { name: "iPhone 14", w: 390, h: 844, dpr: 3, weight: 15 },
  { name: "iPhone 14 Pro", w: 393, h: 852, dpr: 3, weight: 12 },
  { name: "iPhone 14 Pro Max", w: 430, h: 932, dpr: 3, weight: 12 },
  { name: "iPhone 15", w: 393, h: 852, dpr: 3, weight: 18 },
  { name: "iPhone 15 Pro", w: 393, h: 852, dpr: 3, weight: 15 },
  { name: "iPhone 15 Pro Max", w: 430, h: 932, dpr: 3, weight: 14 },
  { name: "iPhone 16", w: 393, h: 852, dpr: 3, weight: 14 },
  { name: "iPhone 16 Pro", w: 402, h: 874, dpr: 3, weight: 13 },
  { name: "iPhone 16 Pro Max", w: 440, h: 956, dpr: 3, weight: 11 },
  { name: "iPad Pro 11", w: 834, h: 1194, dpr: 2, weight: 5 },
  { name: "iPad Air", w: 820, h: 1180, dpr: 2, weight: 5 },
];

const WINDOWS_GPUS = [
  { vendor: "NVIDIA", renderer: "NVIDIA GeForce RTX 3060 (0x00002504)" },
  { vendor: "NVIDIA", renderer: "NVIDIA GeForce GTX 1650 (0x00001F82)" },
  { vendor: "NVIDIA", renderer: "NVIDIA GeForce RTX 4060 (0x00002882)" },
  { vendor: "Intel", renderer: "Intel(R) UHD Graphics 630 (0x00003E92)" },
  { vendor: "Intel", renderer: "Intel(R) Iris(R) Xe Graphics (0x00009A49)" },
  { vendor: "AMD", renderer: "AMD Radeon RX 6600 (0x000073FF)" },
  { vendor: "AMD", renderer: "AMD Radeon(TM) Graphics (0x00001638)" },
];
const MAC_CHIPS = ["Apple M1", "Apple M2", "Apple M3", "Apple M1 Pro", "Apple M2 Pro", "Apple M4"];
const LINUX_GPUS = [
  { vendor: "Intel", renderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" },
  { vendor: "AMD", renderer: "AMD Radeon Graphics (radeonsi, renoir, LLVM 15.0.7)" },
];

// ---- Ngẫu nhiên có trọng số -----------------------------------------------------------------

function weightedPick(items, weightOf, rng) {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

const pickOne = (items, rng) => items[Math.floor(rng() * items.length)];
const randInt = (min, max, rng) => Math.floor(rng() * (max - min + 1)) + min;

// ---- Đọc lựa chọn người dùng ----------------------------------------------------------------

/**
 * `"random" | "all" | ""` → mọi trình duyệt; `"chromium"` → họ Chromium; còn lại là danh sách
 * cách nhau dấu phẩy. Tên lạ bị bỏ qua và trả về riêng để nơi gọi báo cho người dùng.
 */
export function parseBrowserList(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || text === "random" || text === "all" || text === "*") {
    return { browsers: [...BROWSER_IDS], unknown: [] };
  }
  const aliases = {
    "google-chrome": "chrome", "msedge": "edge", "microsoft-edge": "edge", "opr": "opera",
    "coc-coc": "coccoc", "cốc-cốc": "coccoc", "coc_coc": "coccoc", "samsung-internet": "samsung",
    "samsungbrowser": "samsung", "ff": "firefox", "mozilla": "firefox",
  };
  const picked = new Set();
  const unknown = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    if (part === "chromium") {
      for (const id of CHROMIUM_BROWSER_IDS) picked.add(id);
      continue;
    }
    const id = aliases[part] ?? part;
    if (BROWSER_IDS.includes(id)) picked.add(id);
    else unknown.push(part);
  }
  return { browsers: [...picked], unknown };
}

export function parseDeviceMode(raw) {
  const text = String(raw ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const lower = text.toLowerCase();
  if (!lower || ["random", "all", "auto", "ngau-nhien", "*"].includes(lower)) return "random";
  if (["desktop", "pc", "laptop", "may-tinh"].includes(lower)) return "desktop";
  if (["mobile", "phone", "dien-thoai", "smartphone"].includes(lower)) return "mobile";
  return text;
}

/**
 * Phân tích thiết bị hoặc hệ điều hành tuỳ chỉnh do người dùng nhập.
 * @param {string} deviceInput
 */
export function resolveCustomDevice(deviceInput) {
  if (!deviceInput || typeof deviceInput !== "string") return null;
  const raw = deviceInput.trim().replace(/^["']|["']$/g, "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[-_]/g, " ");

  if (["random", "all", "auto", "ngau-nhien", "*"].includes(lower)) return null;
  if (["desktop", "pc", "laptop", "may-tinh"].includes(lower)) {
    return { type: "class", deviceClass: "desktop", name: "Desktop" };
  }
  if (["mobile", "phone", "dien-thoai", "smartphone"].includes(lower)) {
    return { type: "class", deviceClass: "mobile", name: "Mobile" };
  }

  // 1. Hệ điều hành máy tính (Desktop OS)
  if (["windows", "win", "win10", "win11", "desktop-windows"].some((k) => lower === k || lower.startsWith(k + " "))) {
    return { type: "os", os: "windows", deviceClass: "desktop", name: "Windows PC" };
  }
  if (["macos", "mac", "macbook", "osx", "apple mac", "desktop-mac"].some((k) => lower === k || lower.startsWith(k + " "))) {
    return { type: "os", os: "macos", deviceClass: "desktop", name: "Apple Mac" };
  }
  if (["linux", "ubuntu", "debian", "fedora", "desktop-linux"].some((k) => lower === k || lower.startsWith(k + " "))) {
    return { type: "os", os: "linux", deviceClass: "desktop", name: "Linux PC" };
  }

  // 2. Hệ điều hành di động chung (Mobile OS)
  if (lower === "android") {
    return { type: "os", os: "android", deviceClass: "mobile", name: "Android" };
  }
  if (lower === "ios") {
    return { type: "os", os: "ios", deviceClass: "mobile", name: "Apple iOS" };
  }

  // 3. Khớp chính xác hoặc gần đúng trong IPHONES
  const exactIphone = IPHONES.find((p) => p.name.toLowerCase() === lower);
  if (exactIphone) {
    return { type: "device", os: "ios", deviceClass: "mobile", device: exactIphone, name: exactIphone.name };
  }
  const subIphone = IPHONES.find((p) => {
    const pLower = p.name.toLowerCase();
    return pLower.includes(lower) || lower.includes(pLower);
  });
  if (subIphone) {
    return { type: "device", os: "ios", deviceClass: "mobile", device: subIphone, name: subIphone.name };
  }

  // 4. Khớp chính xác hoặc gần đúng trong ANDROID_DEVICES
  const exactAndroid = ANDROID_DEVICES.find(
    (d) => d.name.toLowerCase() === lower || d.model.toLowerCase() === lower,
  );
  if (exactAndroid) {
    return { type: "device", os: "android", deviceClass: "mobile", device: exactAndroid, name: exactAndroid.name };
  }
  const subAndroid = ANDROID_DEVICES.find((d) => {
    const dLower = d.name.toLowerCase();
    const mLower = d.model.toLowerCase();
    return dLower.includes(lower) || lower.includes(dLower) || mLower.includes(lower);
  });
  if (subAndroid) {
    return { type: "device", os: "android", deviceClass: "mobile", device: subAndroid, name: subAndroid.name };
  }

  // 5. Từ khoá nhận diện thiết bị Apple (iPhone, iPad, iPod)
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ipod")) {
    const isTablet = lower.includes("ipad");
    const synthetic = {
      name: raw,
      w: isTablet ? 834 : 393,
      h: isTablet ? 1194 : 852,
      dpr: isTablet ? 2 : 3,
    };
    return { type: "custom-mobile", os: "ios", deviceClass: "mobile", device: synthetic, name: raw };
  }

  // 6. Từ khoá nhận diện thiết bị Android (Galaxy, Pixel, Xiaomi, Redmi, Samsung, OPPO, vivo...)
  if (
    lower.includes("galaxy") ||
    lower.includes("pixel") ||
    lower.includes("xiaomi") ||
    lower.includes("redmi") ||
    lower.includes("samsung") ||
    lower.includes("oppo") ||
    lower.includes("vivo") ||
    lower.includes("sony") ||
    lower.includes("huawei") ||
    lower.includes("phone") ||
    lower.includes("mobile")
  ) {
    const synthetic = {
      model: raw.replace(/\s+/g, "-"),
      name: raw,
      w: 412,
      h: 915,
      dpr: 2.625,
      gpuVendor: lower.includes("samsung") || lower.includes("galaxy") ? "Qualcomm" : "ARM",
      gpu: lower.includes("samsung") || lower.includes("galaxy") ? "Adreno (TM) 750" : "Mali-G715",
    };
    return { type: "custom-mobile", os: "android", deviceClass: "mobile", device: synthetic, name: raw };
  }

  // 7. Dự phòng: Coi như thiết bị máy tính tuỳ chỉnh
  return {
    type: "custom-desktop",
    name: raw,
    deviceClass: "desktop",
    os: "windows",
  };
}

// ---- Bước 1: chọn hồ sơ --------------------------------------------------------------------

/**
 * @param {{ device?: string, browsers?: string[], mobileRatio?: number, rng?: () => number }} [options]
 */
export function pickFingerprintProfile(options = {}) {
  const rng = options.rng ?? Math.random;
  const allowed = (options.browsers?.length ? options.browsers : BROWSER_IDS).filter((id) => BROWSERS[id]);
  const mobileRatio = Math.min(1, Math.max(0, options.mobileRatio ?? 0.5));

  const customMatch =
    options.device && options.device !== "random" && options.device !== "desktop" && options.device !== "mobile"
      ? resolveCustomDevice(options.device)
      : null;

  const supports = (id, cls) => {
    const def = BROWSERS[id];
    const weight = cls === "desktop" ? def.desktopWeight : def.mobileWeight;
    const osList = cls === "desktop" ? DESKTOP_OS : MOBILE_OS;
    return weight > 0 && def.os.some((os) => osList.includes(os));
  };

  /** @type {DeviceClass} */
  let deviceClass =
    customMatch
      ? customMatch.deviceClass
      : options.device === "desktop" || options.device === "mobile"
      ? options.device
      : rng() < mobileRatio
      ? "mobile"
      : "desktop";

  let candidates = allowed.filter((id) => supports(id, deviceClass));
  const notes = [];
  if (candidates.length === 0) {
    // Ví dụ: --device=desktop --browsers=samsung. Ưu tiên giữ trình duyệt người dùng đã chọn
    // và đổi lớp thiết bị; chỉ khi vẫn không được mới quay về toàn bộ danh sách.
    const other = deviceClass === "desktop" ? "mobile" : "desktop";
    const flipped = allowed.filter((id) => supports(id, other));
    if (flipped.length > 0) {
      notes.push(`Không trình duyệt nào đã chọn có bản ${deviceClass}; chuyển sang ${other}.`);
      deviceClass = other;
      candidates = flipped;
    } else {
      notes.push("Danh sách trình duyệt không hợp lệ; dùng toàn bộ danh sách mặc định.");
      candidates = BROWSER_IDS.filter((id) => supports(id, deviceClass));
    }
  }

  const browser = weightedPick(
    candidates,
    (id) => (deviceClass === "desktop" ? BROWSERS[id].desktopWeight : BROWSERS[id].mobileWeight),
    rng,
  );

  let os;
  if (customMatch?.os && (deviceClass === "desktop" ? DESKTOP_OS : MOBILE_OS).includes(customMatch.os)) {
    if (BROWSERS[browser].os.includes(customMatch.os)) {
      os = customMatch.os;
    } else {
      const osPool = BROWSERS[browser].os.filter((o) => (deviceClass === "desktop" ? DESKTOP_OS : MOBILE_OS).includes(o));
      os = weightedPick(osPool, (id) => OS_WEIGHTS[id], rng);
      notes.push(`Trình duyệt ${browser} không hỗ trợ trên ${customMatch.os}; đổi sang ${os}.`);
    }
  } else {
    const osPool = BROWSERS[browser].os.filter((o) => (deviceClass === "desktop" ? DESKTOP_OS : MOBILE_OS).includes(o));
    os = weightedPick(osPool, (id) => OS_WEIGHTS[id], rng);
  }

  /** @type {EngineFamily} */
  const family = os === "ios" ? "webkit" : browser === "firefox" ? "firefox" : browser === "safari" ? "webkit" : "chromium";

  if (customMatch) {
    notes.push(`Thiết bị theo yêu cầu: ${customMatch.name || options.device}`);
  }

  const profile = {
    deviceClass,
    os,
    browser,
    family,
    notes,
    /** @type {{ model?: string, name?: string } | null} */
    device: null,
    // Số build ngẫu nhiên được chốt NGAY tại đây để cả danh tính dùng một bộ số duy nhất.
    build: randInt(7000, 7600, rng),
    patch: randInt(40, 220, rng),
    edgeBuild: randInt(3200, 3600, rng),
    safariMinor: randInt(0, 1, rng),
  };

  if (deviceClass === "desktop") {
    const screens = os === "macos" ? MAC_SCREENS : os === "linux" ? LINUX_SCREENS : WINDOWS_SCREENS;
    const screen = weightedPick(screens, (s) => s.weight, rng);
    profile.screen = { width: screen.w, height: screen.h, dpr: screen.dpr };
    profile.hardwareConcurrency = os === "macos" ? pickOne([8, 8, 10, 12], rng) : pickOne([4, 6, 8, 8, 12, 16], rng);
    profile.deviceMemory = pickOne([4, 8, 8, 8], rng);
    profile.osVersion =
      os === "windows" ? pickOne(["10.0.0", "15.0.0", "15.0.0", "19.0.0"], rng) : os === "macos" ? pickOne(["14.6.1", "15.3.0", "15.5.0"], rng) : "6.5.0";
    if (os === "windows") profile.gpu = pickOne(WINDOWS_GPUS, rng);
    else if (os === "macos") profile.gpu = { vendor: "Apple", renderer: pickOne(MAC_CHIPS, rng) };
    else profile.gpu = pickOne(LINUX_GPUS, rng);
  } else if (os === "android") {
    const device =
      customMatch?.device && customMatch.os === "android"
        ? customMatch.device
        : weightedPick(ANDROID_DEVICES, (d) => d.weight, rng);
    const version = weightedPick(ANDROID_VERSIONS, (v) => v.weight, rng);
    profile.device = { model: device.model, name: device.name };
    profile.screen = { width: device.w, height: device.h, dpr: device.dpr };
    profile.osVersion = `${version.major}.0.0`;
    profile.androidMajor = version.major;
    profile.hardwareConcurrency = 8;
    profile.deviceMemory = pickOne([4, 8, 8], rng);
    profile.gpu = { vendor: device.gpuVendor || "Qualcomm", renderer: device.gpu || "Adreno (TM) 750" };
  } else {
    // os === "ios"
    const device =
      customMatch?.device && customMatch.os === "ios"
        ? customMatch.device
        : weightedPick(IPHONES, (d) => d.weight, rng);
    profile.device = { model: device.name?.includes("iPad") ? "iPad" : "iPhone", name: device.name };
    profile.screen = { width: device.w, height: device.h, dpr: device.dpr };
    profile.hardwareConcurrency = 6;
    profile.gpu = { vendor: "Apple", renderer: "Apple GPU" };
  }

  return profile;
}

// ---- Số bản theo ngày (cho trình duyệt không thuộc engine đang chạy) ----------------------

const DAY_MS = 86_400_000;

/** Chrome 120 ra 05/12/2023, mỗi bản cách 4 tuần. Chỉ dùng khi không đọc được engine thật. */
export function estimateChromiumMajor(now = new Date()) {
  return 120 + Math.max(0, Math.floor((now.getTime() - Date.UTC(2023, 11, 5)) / (28 * DAY_MS)));
}

/** Firefox 128 ra 09/07/2024, nhịp 4 tuần. */
export function estimateFirefoxMajor(now = new Date()) {
  return 128 + Math.max(0, Math.floor((now.getTime() - Date.UTC(2024, 6, 9)) / (28 * DAY_MS)));
}

/** Safari đổi số theo năm từ 2025 (Safari 26), ra bản lớn giữa tháng 9. */
export function estimateSafariMajor(now = new Date()) {
  const year = now.getUTCFullYear();
  const released = now.getTime() >= Date.UTC(year, 8, 15);
  return Math.max(18, released ? year - 1999 : year - 2000);
}

/** Bản .1 của Safari chỉ ra ~10 tuần sau bản lớn; trước đó khai .1 là khai một bản chưa tồn tại. */
function safariMinor(profile, now) {
  const year = now.getUTCFullYear();
  const release = now.getTime() >= Date.UTC(year, 8, 15) ? Date.UTC(year, 8, 15) : Date.UTC(year - 1, 8, 15);
  return now.getTime() - release > 70 * DAY_MS ? profile.safariMinor : 0;
}

// ---- Bước 2: dựng chuỗi cụ thể --------------------------------------------------------------

function platformToken(profile) {
  switch (profile.os) {
    case "windows":
      return "Windows NT 10.0; Win64; x64";
    case "macos":
      return "Macintosh; Intel Mac OS X 10_15_7";
    case "linux":
      return "X11; Linux x86_64";
    case "android":
      // Chrome Android đã "giảm UA": phiên bản và model thật chỉ nằm trong Client Hints.
      return "Linux; Android 10; K";
    default:
      return profile.device?.model === "iPad"
        ? "iPad; CPU OS 18_6 like Mac OS X"
        : "iPhone; CPU iPhone OS 18_6 like Mac OS X";
  }
}

function brandList(entries, major, full) {
  // Thứ tự brand trong Chrome thật được xáo theo major; GREASE brand luôn có mặt.
  const grease = { brand: "Not)A;Brand", version: "8", full: "8.0.0.0" };
  const list = [grease, ...entries];
  const rotate = major % list.length;
  const ordered = [...list.slice(rotate), ...list.slice(0, rotate)];
  return {
    brands: ordered.map((e) => ({ brand: e.brand, version: e.version })),
    fullVersionList: ordered.map((e) => ({ brand: e.brand, version: e.full })),
    fullVersion: full,
  };
}

/**
 * @param {ReturnType<typeof pickFingerprintProfile>} profile
 * @param {{ engineMajor?: number, locale?: string, now?: Date }} [options]
 */
export function materializeFingerprint(profile, options = {}) {
  const now = options.now ?? new Date();
  const major = Number(options.engineMajor) > 0 ? Number(options.engineMajor) : estimateChromiumMajor(now);
  const locale = options.locale || "vi-VN";
  const baseLang = locale.split("-")[0];
  const languages = baseLang === "en" ? [locale, "en"] : [locale, baseLang, "en-US", "en"];
  const acceptLanguage = baseLang === "en" ? `${locale},en;q=0.9` : `${locale},${baseLang};q=0.9,en-US;q=0.8,en;q=0.7`;
  const chromeFull = `${major}.0.${profile.build}.${profile.patch}`;
  const mobile = profile.deviceClass === "mobile";
  const token = platformToken(profile);

  let userAgent;
  let brandEntries = null;
  let extra = null;

  if (profile.os === "ios") {
    const safariMajor = estimateSafariMajor(now);
    const tail = `Mobile/15E148 Safari/604.1`;
    if (profile.browser === "chrome") userAgent = `Mozilla/5.0 (${token}) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${chromeFull} ${tail}`;
    else if (profile.browser === "edge") userAgent = `Mozilla/5.0 (${token}) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/${major}.0.${profile.edgeBuild}.${profile.patch} Version/${safariMajor}.0 ${tail}`;
    else if (profile.browser === "firefox") userAgent = `Mozilla/5.0 (${token}) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/${estimateFirefoxMajor(now)}.0 Mobile/15E148 Safari/605.1.15`;
    else userAgent = `Mozilla/5.0 (${token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariMajor}.${safariMinor(profile, now)} ${tail}`;
  } else if (profile.browser === "safari") {
    const safariMajor = estimateSafariMajor(now);
    userAgent = `Mozilla/5.0 (${token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariMajor}.${safariMinor(profile, now)} Safari/605.1.15`;
  } else if (profile.browser === "firefox") {
    const ff = estimateFirefoxMajor(now);
    if (profile.os === "android") userAgent = `Mozilla/5.0 (Android ${profile.androidMajor}; Mobile; rv:${ff}.0) Gecko/${ff}.0 Firefox/${ff}.0`;
    else {
      const ffToken = profile.os === "windows" ? "Windows NT 10.0; Win64; x64" : profile.os === "macos" ? "Macintosh; Intel Mac OS X 10.15" : "X11; Linux x86_64";
      userAgent = `Mozilla/5.0 (${ffToken}; rv:${ff}.0) Gecko/20100101 Firefox/${ff}.0`;
    }
  } else {
    const safariTail = mobile ? "Mobile Safari/537.36" : "Safari/537.36";
    const chromeToken = `Chrome/${major}.0.0.0`;
    const chromiumEntry = { brand: "Chromium", version: String(major), full: chromeFull };
    switch (profile.browser) {
      case "edge": {
        const edgeFull = `${major}.0.${profile.edgeBuild}.${profile.patch}`;
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeToken} ${safariTail} ${mobile ? "EdgA" : "Edg"}/${edgeFull}`;
        brandEntries = [chromiumEntry, { brand: "Microsoft Edge", version: String(major), full: edgeFull }];
        break;
      }
      case "opera": {
        // Opera desktop chạy sau Chromium ~15 bản; Opera Mobile có dãy số riêng (~ -50).
        const oprMajor = Math.max(60, mobile ? major - 50 : major - 15);
        const oprFull = `${oprMajor}.0.${randomlike(profile.build, 4000, 5999)}.${profile.patch}`;
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeToken} ${safariTail} OPR/${oprFull}`;
        brandEntries = [chromiumEntry, { brand: "Opera", version: String(oprMajor), full: oprFull }];
        extra = "opera";
        break;
      }
      case "brave":
        // Brave cố ý giấu mình trong UA (giống hệt Chrome); chỉ Client Hints và navigator.brave lộ ra.
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeToken} ${safariTail}`;
        brandEntries = [chromiumEntry, { brand: "Brave", version: String(major), full: chromeFull }];
        extra = "brave";
        break;
      case "coccoc": {
        const ccFull = `${major}.0.${profile.patch}`;
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/${ccFull} Chrome/${chromeFull} ${safariTail}`;
        brandEntries = [chromiumEntry, { brand: "CocCoc", version: String(major), full: chromeFull }];
        break;
      }
      case "samsung": {
        const sbMajor = Math.max(25, 28 + Math.floor((major - 130) / 5));
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/${sbMajor}.0 ${chromeToken} ${safariTail}`;
        brandEntries = [chromiumEntry, { brand: "Samsung Internet", version: String(sbMajor), full: `${sbMajor}.0.0.0` }];
        break;
      }
      default:
        userAgent = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeToken} ${safariTail}`;
        brandEntries = [chromiumEntry, { brand: "Google Chrome", version: String(major), full: chromeFull }];
    }
  }

  const uaPlatform = { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iOS" }[profile.os];
  /** Chỉ họ Chromium gửi Client Hints. Firefox/Safari không có navigator.userAgentData. */
  const userAgentMetadata =
    profile.family === "chromium" && brandEntries
      ? (() => {
          const list = brandList(brandEntries, major, chromeFull);
          return {
            brands: list.brands,
            fullVersionList: list.fullVersionList,
            fullVersion: list.fullVersion,
            platform: uaPlatform,
            platformVersion: profile.osVersion ?? "",
            architecture: mobile ? "" : profile.os === "macos" ? "arm" : "x86",
            model: profile.os === "android" ? profile.device?.model ?? "" : "",
            mobile,
            bitness: mobile ? "" : "64",
            wow64: false,
          };
        })()
      : null;

  const navigatorPlatform =
    profile.os === "windows" ? "Win32"
      : profile.os === "macos" ? "MacIntel"
      : profile.os === "linux" ? "Linux x86_64"
      : profile.os === "android" ? (profile.family === "firefox" ? "Linux aarch64" : "Linux armv81")
      : profile.device?.model === "iPad" ? "iPad" : "iPhone";

  const webgl = buildWebgl(profile);

  const screen = profile.screen;
  // Phần diện tích trang thật sự thấy được: trừ thanh tác vụ + thanh công cụ trình duyệt.
  const viewport = mobile
    ? { width: screen.width, height: Math.round(screen.height * (profile.os === "ios" ? 0.78 : 0.86)) }
    : { width: screen.width, height: screen.height - (profile.os === "macos" ? 25 : 48) - (profile.family === "webkit" ? 78 : 85) };
  const windowSize = mobile ? null : { width: screen.width, height: screen.height - (profile.os === "macos" ? 25 : 48) };

  const browserLabel = BROWSERS[profile.browser]?.label ?? profile.browser;
  const osLabel =
    profile.os === "windows" ? (profile.osVersion?.startsWith("1") && Number(profile.osVersion.split(".")[0]) >= 13 ? "Windows 11" : "Windows 10")
      : profile.os === "macos" ? `macOS ${profile.osVersion}`
      : profile.os === "linux" ? "Linux"
      : profile.os === "android" ? `Android ${profile.androidMajor}`
      : "iOS";
  const summary = [
    mobile ? "Mobile" : "Desktop",
    osLabel,
    profile.device?.name,
    `${browserLabel}${profile.family !== "chromium" ? " (giả lập trên engine Chromium)" : ""}`,
    `${screen.width}×${screen.height}@${screen.dpr}x`,
  ].filter(Boolean).join(" · ");

  return {
    profile,
    summary,
    userAgent,
    userAgentMetadata,
    acceptLanguage,
    locale,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: screen.dpr,
    viewport,
    windowSize,
    screen: { width: screen.width, height: screen.height },
    navigatorPlatform,
    // Thứ được tiêm vào trang qua init script — phải tự đứng được (được tuần tự hoá sang trình duyệt).
    inject: {
      family: profile.family,
      os: profile.os,
      platform: navigatorPlatform,
      vendor: profile.family === "chromium" ? "Google Inc." : profile.family === "webkit" ? "Apple Computer, Inc." : "",
      productSub: profile.family === "firefox" ? "20100101" : "20030107",
      oscpu:
        profile.family === "firefox"
          ? profile.os === "windows" ? "Windows NT 10.0; Win64; x64" : profile.os === "macos" ? "Intel Mac OS X 10.15" : profile.os === "android" ? "Linux aarch64" : "Linux x86_64"
          : null,
      hardwareConcurrency: profile.hardwareConcurrency,
      deviceMemory: profile.family === "chromium" ? profile.deviceMemory ?? null : null,
      maxTouchPoints: mobile ? 5 : 0,
      languages,
      webglVendor: webgl.vendor,
      webglRenderer: webgl.renderer,
      userAgentMetadata,
      extra,
    },
  };
}

/** Số giả-ngẫu-nhiên nhưng CỐ ĐỊNH theo hồ sơ (để một danh tính luôn ra cùng một chuỗi). */
function randomlike(seed, min, max) {
  return min + (Math.abs(Math.imul(seed, 2654435761)) % (max - min + 1));
}

function buildWebgl(profile) {
  const gpu = profile.gpu ?? { vendor: "Intel", renderer: "Intel(R) UHD Graphics 630" };
  if (profile.os === "ios" || profile.family === "webkit") return { vendor: "Apple Inc.", renderer: "Apple GPU" };
  if (profile.os === "android") return { vendor: gpu.vendor, renderer: gpu.renderer };
  const stripId = (name) => name.replace(/\s*\(0x[0-9A-F]+\)/i, "");
  if (profile.family === "firefox") {
    if (profile.os === "macos") return { vendor: "Apple", renderer: `${gpu.renderer}, or similar` };
    if (profile.os === "linux") return { vendor: gpu.vendor, renderer: `${stripId(gpu.renderer)}, or similar` };
    return { vendor: `Google Inc. (${gpu.vendor})`, renderer: `ANGLE (${gpu.vendor}, ${stripId(gpu.renderer)} Direct3D11 vs_5_0 ps_5_0), or similar` };
  }
  if (profile.os === "macos") return { vendor: "Google Inc. (Apple)", renderer: `ANGLE (Apple, ANGLE Metal Renderer: ${gpu.renderer}, Unspecified Version)` };
  if (profile.os === "linux") return { vendor: `Google Inc. (${gpu.vendor})`, renderer: `ANGLE (${gpu.vendor}, ${gpu.renderer}, OpenGL 4.6)` };
  return { vendor: `Google Inc. (${gpu.vendor})`, renderer: `ANGLE (${gpu.vendor}, ${gpu.renderer} Direct3D11 vs_5_0 ps_5_0, D3D11)` };
}

// ---- Init script chạy TRONG trang ---------------------------------------------------------

/**
 * Tiêm vào mỗi document trước mọi script của trang. Phải tự chứa — Playwright tuần tự hoá hàm
 * này sang trình duyệt, nên không được tham chiếu bất cứ thứ gì bên ngoài thân hàm.
 * @param {ReturnType<typeof materializeFingerprint>["inject"]} fp
 */
export function fingerprintInitScript(fp) {
  const define = (target, key, value) => {
    try {
      Object.defineProperty(target, key, { get: () => value, configurable: true, enumerable: true });
    } catch {}
  };
  const nav = Navigator.prototype;
  define(nav, "webdriver", false);
  try {
    delete navigator.webdriver;
  } catch {}
  define(nav, "platform", fp.platform);
  define(nav, "vendor", fp.vendor);
  define(nav, "productSub", fp.productSub);
  define(nav, "hardwareConcurrency", fp.hardwareConcurrency);
  define(nav, "maxTouchPoints", fp.maxTouchPoints);
  define(nav, "languages", Object.freeze([...fp.languages]));
  define(nav, "language", fp.languages[0]);

  if (fp.family === "chromium" && fp.userAgentMetadata) {
    try {
      define(nav, "userAgentData", {
        brands: fp.userAgentMetadata.brands,
        mobile: fp.userAgentMetadata.mobile,
        platform: fp.userAgentMetadata.platform,
        getHighEntropyValues: () => Promise.resolve(fp.userAgentMetadata),
        toJSON: () => ({
          brands: fp.userAgentMetadata.brands,
          mobile: fp.userAgentMetadata.mobile,
          platform: fp.userAgentMetadata.platform,
        }),
      });
    } catch {}
  }

  if (fp.deviceMemory) define(nav, "deviceMemory", fp.deviceMemory);
  else {
    try {
      delete nav.deviceMemory;
    } catch {}
  }

  if (fp.family !== "chromium") {
    // Firefox/Safari không có các API chỉ-Chromium này; để lại là tự khai mình là Chromium.
    for (const key of ["userAgentData", "deviceMemory"]) {
      try {
        delete nav[key];
      } catch {}
    }
    try {
      delete window.chrome;
    } catch {}
    try {
      define(window, "chrome", undefined);
    } catch {}
  }
  if (fp.family === "firefox") {
    define(nav, "oscpu", fp.oscpu);
    define(nav, "buildID", "20181001000000");
  }
  if (fp.extra === "brave") {
    define(nav, "brave", { isBrave: () => Promise.resolve(true) });
  }
  if (fp.extra === "opera") {
    try {
      window.opr = window.opr || { addons: {} };
    } catch {}
  }

  // WebGL: trả GPU khớp với hệ điều hành đã khai. Proxy giữ nguyên toString kiểu "[native code]".
  const UNMASKED_VENDOR = 0x9245;
  const UNMASKED_RENDERER = 0x9246;
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto?.getParameter) continue;
    const original = proto.getParameter;
    try {
      proto.getParameter = new Proxy(original, {
        apply(target, thisArg, args) {
          if (args[0] === UNMASKED_VENDOR) return fp.webglVendor;
          if (args[0] === UNMASKED_RENDERER) return fp.webglRenderer;
          return Reflect.apply(target, thisArg, args);
        },
      });
    } catch {}
  }
}
