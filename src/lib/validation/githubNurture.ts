/** Shared limits and pure input validation; safe to import in the admin client. */
export const DEFAULT_COMPANION_COUNT = 3;
export const MAX_COMPANION_COUNT = 20;
export const DEFAULT_OLLAMA_MODEL = "gemma4:31b-cloud";
export const DEFAULT_OLLAMA_CONTEXT_WINDOW = 32768;
export const MIN_OLLAMA_CONTEXT_WINDOW = 8192;
export const MAX_OLLAMA_CONTEXT_WINDOW = 1048576;
export const MAX_OLLAMA_API_KEYS = 100;
export const MAX_KEY_IMPORT_BYTES = 256 * 1024;
/** Matches JarvisCode.Core/Settings/AppSettings.cs; the web host adds public-URL guards. */
export const DEFAULT_WEB_SEARCH_ENABLED = true;
export const DEFAULT_SEARXNG_BASE_URL = "https://jarvis-searxng.vercel.app";

/** Syntax guard only: the fetch layer must also validate every resolved address/redirect. */
export function parseSearxngUrl(value: string): string {
  const input = value.trim();
  const invalid = () => new Error("SearXNG cần URL HTTPS công khai, không có tài khoản, query, fragment, cổng riêng hoặc địa chỉ nội bộ.");
  if (!/^https:\/\/[^/]/i.test(input) || input.length > 2048 || /[\s\\?#]/.test(input)
    || input.slice(input.indexOf("://") + 3).split("/")[0].includes("@")) throw invalid();
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) throw invalid();
  const host = url.hostname.toLowerCase();
  // Require a public DNS hostname. IP literals (including normalized integer/hex IPv4),
  // single-label intranet names and private/reserved suffixes cannot be configured.
  const labels = host.split(".");
  const privateSuffixes = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "arpa", "test", "invalid", "example", "onion", "svc"];
  if (host.length > 253 || labels.length < 2 || /^[\d.]+$/.test(host)
    || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1) ?? "")
    || privateSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw invalid();
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

/** Omitted fields stay omitted so older forms preserve the current search settings. */
export function parseWebSearchSettings(form: Pick<FormData, "get" | "has">): {
  webSearchEnabled?: boolean;
  searxngBaseUrl?: string;
} {
  const patch: { webSearchEnabled?: boolean; searxngBaseUrl?: string } = {};
  if (form.has("webSearchSettingsPresent") || form.has("webSearchEnabled")) {
    patch.webSearchEnabled = form.get("webSearchEnabled") === "on";
  }
  if (form.has("searxngBaseUrl")) {
    patch.searxngBaseUrl = parseSearxngUrl(String(form.get("searxngBaseUrl") ?? ""));
  }
  return patch;
}

export function effectiveCompanionCount(
  station: { companionCountOverride?: number | null },
  config: { defaultCompanionCount: number },
): number {
  return station.companionCountOverride ?? config.defaultCompanionCount;
}

export function parseCompanionCount(value: string, allowDefault = false): number | null {
  const input = value.trim();
  if (input === "" && allowDefault) return null;
  if (!/^\d+$/.test(input)) throw new Error(`Số kho phụ phải là số nguyên từ 0 đến ${MAX_COMPANION_COUNT}.`);
  const count = Number(input);
  if (!Number.isSafeInteger(count) || count > MAX_COMPANION_COUNT) {
    throw new Error(`Số kho phụ phải nằm trong khoảng 0–${MAX_COMPANION_COUNT}.`);
  }
  return count;
}

/** Accept newline-separated keys, a JSON array, or {keys: [...]}/{apiKeys: [...]}. */
export function parseOllamaKeyImport(text: string): string[] {
  if (new TextEncoder().encode(text).byteLength > MAX_KEY_IMPORT_BYTES) {
    throw new Error("Danh sách API key vượt quá 256 KiB.");
  }
  const input = text.replace(/^\uFEFF/, "").trim();
  if (!input) return [];

  let values: unknown[];
  if (input.startsWith("[") || input.startsWith("{")) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(input);
    } catch {
      // Do not echo JSON parser errors: they can contain portions of a secret.
      throw new Error("Tệp JSON không hợp lệ. Dùng danh sách chuỗi hoặc danh sách đối tượng có trường key.");
    }
    if (Array.isArray(decoded)) {
      values = decoded;
    } else if (decoded !== null && typeof decoded === "object") {
      const record = decoded as Record<string, unknown>;
      const list = record.apiKeys ?? record.keys;
      if (!Array.isArray(list)) throw new Error("JSON phải chứa một danh sách keys hoặc apiKeys.");
      values = list;
    } else {
      throw new Error("JSON phải là một danh sách API key.");
    }
  } else {
    values = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  if (values.length > MAX_OLLAMA_API_KEYS) {
    throw new Error(`Mỗi lượt nhập tối đa ${MAX_OLLAMA_API_KEYS} API key.`);
  }
  const keys = values.map((value, index) => {
    let candidate = value;
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      candidate = record.key ?? record.apiKey ?? record.token ?? record.secret;
    }
    if (typeof candidate !== "string") throw new Error(`Mục ${index + 1} không có API key dạng chuỗi.`);
    const key = candidate.trim();
    if (key.length < 8 || key.length > 512 || /[^\x21-\x7e]/.test(key)) {
      throw new Error(`API key ở mục ${index + 1} không hợp lệ: dùng 8–512 ký tự, không có khoảng trắng.`);
    }
    return key;
  });
  return [...new Set(keys)];
}
