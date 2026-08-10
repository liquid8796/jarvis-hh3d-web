import { CONTROL_CACHE_MS, CONTROL_DOC_KEY, parseControlDoc, type ControlDoc } from "./doc";

/**
 * Đọc bảng điều phối từ OCI Object Storage — phía ĐỌC, dùng được trong middleware.
 *
 * Chỉ `fetch` + cache trong bộ nhớ tiến trình, không SDK: middleware chạy trên mọi request
 * nên lượt đọc phải rẻ (thường là 0 request nhờ cache 30s) và không được phép treo (trần
 * 3 giây, hụt thì dùng bản đã biết). Bucket đọc công khai (`ObjectReadWithoutList`) nên
 * không cần khoá — tính xác thực nằm ở chữ ký HMAC, xem doc.ts.
 */

const FETCH_TIMEOUT_MS = 3_000;

type ControlCache = {
  doc: ControlDoc | null;
  fetchedAt: number;
  /** Số revision cao nhất từng thấy — bản thấp hơn bị bỏ, kể cả khi mới tải về. */
  highestRevision: number;
};

/**
 * Cache treo trên globalThis cùng lý do với pool Mongo trong chat.ts và S3Client trong
 * media.ts: `next dev` nạp lại module mỗi lần sửa file, còn trên Vercel thì một instance
 * phục vụ nhiều request liên tiếp — cache cấp module sống đúng bằng đời instance.
 */
const globalForControl = globalThis as unknown as { __jarvisControlCache?: ControlCache };

function cache(): ControlCache {
  return (globalForControl.__jarvisControlCache ??= { doc: null, fetchedAt: 0, highestRevision: 0 });
}

/** URL công khai của bảng — cùng dạng gốc OCI với publicUrl bên media.ts. */
export function controlDocUrl(): string | null {
  const region = (process.env.OCI_REGION ?? "").trim();
  const namespace = (process.env.OCI_NAMESPACE ?? "").trim();
  const bucket = (process.env.OCI_BUCKET ?? "").trim();
  if (!region || !namespace || !bucket) return null;
  const path = CONTROL_DOC_KEY.split("/").map(encodeURIComponent).join("/");
  return `https://objectstorage.${region}.oraclecloud.com/n/${encodeURIComponent(namespace)}/b/${encodeURIComponent(bucket)}/o/${path}`;
}

/**
 * Bảng hiện hành, hoặc null khi chưa từng đọc được bản hợp lệ nào.
 *
 * KHÔNG BAO GIỜ NÉM — mọi đường hỏng (thiếu env, mạng, 404 vì chưa init, chữ ký sai, bản
 * cũ hơn bản đã thấy) đều đổ về "dùng thứ đã biết", và thứ đã biết có thể là null: với
 * middleware, null nghĩa là phục vụ như thường (fail-open, xem decideRequest).
 */
export async function readControlDoc(): Promise<ControlDoc | null> {
  const c = cache();
  const now = Date.now();
  if (now - c.fetchedAt < CONTROL_CACHE_MS) return c.doc;

  // Ghi mốc TRƯỚC khi fetch: lượt đọc hỏng cũng phải đợi hết TTL mới thử lại, không thì một
  // bucket đang nghẽn sẽ hứng thêm một lượt GET trên MỖI request của trạm.
  c.fetchedAt = now;

  const url = controlDocUrl();
  const token = (process.env.WORKER_TOKEN ?? "").trim();
  if (!url || !token) return c.doc;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Bảng là thứ phải TƯƠI trong 30s — đừng để một lớp cache HTTP nào chen thêm tuổi.
      cache: "no-store",
    });
    if (!res.ok) return c.doc; // 404 = chưa init — không phải lỗi, hệ chạy như chưa có bảng.

    const doc = parseControlDoc(await res.json(), token);
    if (!doc) return c.doc;
    if (doc.revision < c.highestRevision) return c.doc;

    c.doc = doc;
    c.highestRevision = doc.revision;
    return doc;
  } catch {
    return c.doc;
  }
}

/** CHỈ cho script kiểm chứng — reset cache để hai kịch bản trong cùng tiến trình không dẫm nhau. */
export function resetControlCacheForVerify(): void {
  delete globalForControl.__jarvisControlCache;
}
