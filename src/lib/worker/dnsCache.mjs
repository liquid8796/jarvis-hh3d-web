/**
 * DNS cache dành riêng cho gương trạm cố định `auto-hh3d.vercel.app`.
 *
 * Worker gõ cửa `/api/worker` liên tục trong nhiều giờ. `fetch` mặc định của Node để việc phân
 * giải tên cho tầng socket, nên mỗi lần pool phải mở kết nối mới có thể lại hỏi DNS. Gương trạm
 * là một origin tin cậy, cố định và được dùng làm cửa cứu hộ; giữ kết quả lookup trong một ngày
 * giảm phụ thuộc vào resolver của máy chạy mà vẫn để TLS dùng đúng hostname/SNI.
 *
 * Hai lớp được tách rõ:
 *   1. `createCachedDnsLookup` là Strategy thuần cho `https.request`, dễ kiểm thử không mạng.
 *   2. `createMirrorDnsCachedFetch` là Decorator quanh `fetch`: chỉ chặn đúng hostname gương,
 *      mọi URL khác đi nguyên đường fetch cũ. Nhờ vậy activeUrl động vẫn hoạt động như trước.
 */
import { lookup as systemLookup } from "node:dns";
import { request as systemHttpsRequest } from "node:https";

export const MIRROR_DNS_HOSTNAME = "auto-hh3d.vercel.app";
export const MIRROR_DNS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const normalizeHostname = (value) => String(value ?? "").trim().replace(/\.$/, "").toLowerCase();

function lookupOptions(value) {
  if (typeof value === "number") return { family: value };
  return value && typeof value === "object" ? value : {};
}

function dnsError(code, hostname, message) {
  const error = new Error(message);
  error.code = code;
  error.hostname = hostname;
  return error;
}

function resolveAll(lookupImpl, hostname) {
  return new Promise((resolve, reject) => {
    lookupImpl(hostname, { all: true, verbatim: false }, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      const unique = [];
      const seen = new Set();
      for (const row of Array.isArray(rows) ? rows : []) {
        const address = typeof row?.address === "string" ? row.address.trim() : "";
        const family = Number(row?.family);
        if (!address || (family !== 4 && family !== 6)) continue;
        const key = `${family}:${address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ address, family });
      }

      if (unique.length === 0) {
        reject(dnsError("ENOTFOUND", hostname, `DNS không trả địa chỉ nào cho ${hostname}`));
        return;
      }
      resolve(unique);
    });
  });
}

/**
 * Tạo callback `lookup(hostname, options, callback)` tương thích `https.request`.
 *
 * - Chỉ cache đúng `hostname` đã khai; host khác uỷ quyền thẳng cho resolver hệ thống.
 * - Một lượt refresh đang bay được dùng chung cho mọi request đồng thời.
 * - Giữ cả IPv4 lẫn IPv6 rồi quay vòng địa chỉ trên mỗi socket mới, không ghim một IP duy nhất.
 */
export function createCachedDnsLookup({
  hostname = MIRROR_DNS_HOSTNAME,
  ttlMs = MIRROR_DNS_CACHE_TTL_MS,
  lookupImpl = systemLookup,
  nowImpl = Date.now,
} = {}) {
  const target = normalizeHostname(hostname);
  const ttl = Math.max(1_000, Number(ttlMs) || MIRROR_DNS_CACHE_TTL_MS);
  let records = [];
  let expiresAt = 0;
  let refreshInFlight = null;
  let cursor = 0;

  const currentRecords = () => {
    const now = nowImpl();
    if (records.length > 0 && now < expiresAt) return Promise.resolve(records);
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = resolveAll(lookupImpl, target)
      .then((next) => {
        records = next;
        expiresAt = nowImpl() + ttl;
        cursor = 0;
        return records;
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };

  return (requestedHostname, options, callback) => {
    if (normalizeHostname(requestedHostname) !== target) {
      lookupImpl(requestedHostname, options, callback);
      return;
    }

    const opts = lookupOptions(options);
    currentRecords()
      .then((allRecords) => {
        const family = Number(opts.family) || 0;
        const candidates = family === 4 || family === 6
          ? allRecords.filter((row) => row.family === family)
          : allRecords;
        if (candidates.length === 0) {
          throw dnsError(
            "EAI_ADDRFAMILY",
            target,
            `DNS cache của ${target} không có địa chỉ IPv${family}`,
          );
        }

        if (opts.all === true) {
          callback(null, candidates.map((row) => ({ ...row })));
          return;
        }

        const selected = candidates[cursor % candidates.length];
        cursor = (cursor + 1) % Number.MAX_SAFE_INTEGER;
        callback(null, selected.address, selected.family);
      })
      .catch((error) => callback(error));
  };
}

function nodeHeaders(input) {
  const out = {};
  const headers = new Headers(input ?? {});
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

function requestBody(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new TypeError("DNS-cached fetch chỉ nhận body chuỗi hoặc bytes của worker.");
}

function responseHeaders(raw) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (Array.isArray(value)) {
      for (const part of value) headers.append(name, String(part));
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  return headers;
}

/**
 * Decorator tương thích phần Response mà worker dùng (`ok/status/headers/text/json/body.cancel`).
 * URL vẫn mang hostname gốc, chỉ callback `lookup` trả IP cache; vì vậy Host header, chứng thư và
 * TLS SNI vẫn là `auto-hh3d.vercel.app`, không có cú rewrite URL sang IP trần.
 */
export function createMirrorDnsCachedFetch({
  hostname = MIRROR_DNS_HOSTNAME,
  ttlMs = MIRROR_DNS_CACHE_TTL_MS,
  fetchImpl = fetch,
  lookupImpl = systemLookup,
  requestImpl = systemHttpsRequest,
  nowImpl = Date.now,
} = {}) {
  const target = normalizeHostname(hostname);
  const cachedLookup = createCachedDnsLookup({ hostname: target, ttlMs, lookupImpl, nowImpl });

  return async (input, init = {}) => {
    let url;
    try {
      url = input instanceof URL ? input : new URL(String(input));
    } catch {
      return fetchImpl(input, init);
    }

    if (url.protocol !== "https:" || normalizeHostname(url.hostname) !== target) {
      return fetchImpl(input, init);
    }

    const body = requestBody(init.body);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      let req;
      try {
        req = requestImpl(
          url,
          {
            method: init.method ?? "GET",
            headers: nodeHeaders(init.headers),
            lookup: cachedLookup,
            signal: init.signal,
          },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("error", fail);
            res.on("end", () => {
              if (settled) return;
              settled = true;
              const bytes = chunks.length > 0 ? Buffer.concat(chunks) : null;
              resolve(new Response(bytes, {
                status: res.statusCode ?? 502,
                statusText: res.statusMessage ?? "",
                headers: responseHeaders(res.headers),
              }));
            });
          },
        );
      } catch (error) {
        fail(error);
        return;
      }

      req.on("error", fail);
      req.end(body ?? undefined);
    });
  };
}
