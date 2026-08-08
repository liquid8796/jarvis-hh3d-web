#!/usr/bin/env node
/**
 * Chuyển file đính kèm đàm đạo từ kho cũ (Vercel Blob) sang kho mới (OCI Object Storage).
 * Chạy MỘT lần, lúc hai kho còn cùng cấu hình.
 *
 * Hai việc, theo đúng thứ tự này:
 *   1. Chép bytes sang OCI, GIỮ NGUYÊN tên object (`chat/{userId}/{tên}-{hậu tố}`) — nhờ vậy
 *      đối soát hai kho là so tên với tên, không cần bảng ánh xạ nào sống sót sau lần chạy.
 *   2. Sửa URL đang nằm trong `chat_messages.attachments[].url` sang host mới. Bỏ bước này
 *      thì bytes đã sang nhà mới mà mọi tin cũ vẫn trỏ về nhà cũ.
 *
 * AN TOÀN:
 *   • Chỉ ĐỌC từ Vercel Blob — không xoá gì bên đó. Kho cũ ở nguyên đấy làm bản lui.
 *   • Object đã có bên OCI ĐÚNG kích thước thì bỏ qua, nên chạy lại nhiều lần cho cùng kết quả.
 *   • URL chỉ được sửa khi bytes của chính nó đã sang tới nơi — không bao giờ trỏ tin vào một
 *     object chưa tồn tại.
 *   • `--dry-run` để xem sẽ chuyển gì mà không ghi một byte nào.
 *
 * Cần: BLOB_READ_WRITE_TOKEN, đủ bộ OCI_* (xem services/media.ts), và MONGODB_URI.
 */
import { list } from "@vercel/blob";
import { MongoClient, type Collection } from "mongodb";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./loadEnv.mjs";

/** Host của kho cũ. Mọi URL đính kèm mang host này là ứng viên phải sửa. */
const VERCEL_BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

type StoredAttachment = { url: string; name: string; size: number; type: string };
type MessageDoc = { _id: string; attachments?: StoredAttachment[] };

/**
 * URL mới cho một URL cũ, hoặc `null` nếu URL này không phải của kho cũ (đã sửa rồi, hoặc
 * người dùng dán tay một link ngoài — cả hai đều phải để yên).
 *
 * So khớp bằng ĐƯỜNG DẪN đã giải mã chứ không phải so cả chuỗi URL: Vercel phát ra cả
 * `url` lẫn `downloadUrl` (kèm `?download=1`) cho cùng một object, và tên file tiếng Việt
 * thì nằm trong URL ở dạng phần trăm.
 */
export function rewriteAttachmentUrl(url: string, byPathname: Map<string, string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // Không phải URL thì không phải việc của script này.
  }

  if (!parsed.host.endsWith(VERCEL_BLOB_HOST_SUFFIX)) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return null; // Chuỗi phần trăm hỏng — để nguyên còn hơn đoán bừa.
  }

  return byPathname.get(pathname) ?? null;
}

/**
 * Sửa URL đính kèm trong toàn bộ collection. Trả về số tin đã quét và số tin thực sự đổi.
 *
 * Ghi từng tin thay vì một `updateMany`: một tin có thể mang tối đa 6 đính kèm, trong đó chỉ
 * vài cái thuộc kho cũ — muốn sửa đúng phần tử nào cần sửa mà giữ nguyên phần còn lại thì
 * phải dựng lại cả mảng, và như vậy thì đằng nào cũng là một lệnh ghi cho mỗi tin.
 */
export async function rewriteMessages(
  messages: Collection<MessageDoc>,
  byPathname: Map<string, string>,
  dryRun: boolean,
): Promise<{ scanned: number; rewritten: number; urlsChanged: number }> {
  const docs = await messages.find({ "attachments.0": { $exists: true } }).toArray();

  let rewritten = 0;
  let urlsChanged = 0;

  for (const doc of docs) {
    const attachments = doc.attachments ?? [];
    let touched = false;

    const next = attachments.map((a) => {
      const fresh = rewriteAttachmentUrl(a.url, byPathname);
      if (fresh === null) return a;
      touched = true;
      urlsChanged += 1;
      return { ...a, url: fresh };
    });

    if (!touched) continue;
    rewritten += 1;
    if (!dryRun) {
      await messages.updateOne({ _id: doc._id }, { $set: { attachments: next } });
    }
  }

  return { scanned: docs.length, rewritten, urlsChanged };
}

/** Cùng luật đặt tên database với chat.ts — hai nơi lệch nhau là sửa nhầm kho. */
function databaseName(uri: string): string {
  const explicit = process.env.MONGODB_DB?.trim();
  if (explicit) return explicit;
  try {
    const path = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
    if (path) return decodeURIComponent(path);
  } catch {
    /* URI lạ — dùng mặc định */
  }
  return "jarvis";
}

async function main(): Promise<void> {
  loadEnv();

  const dryRun = process.argv.includes("--dry-run");

  const mongoUri = process.env.MONGODB_URI?.trim() || process.env.MONGODB_URL?.trim();
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Thiếu BLOB_READ_WRITE_TOKEN — không đọc được kho cũ.");
  if (!mongoUri) throw new Error("Thiếu MONGODB_URI — không sửa được URL trong tin nhắn.");

  // Nạp SAU khi loadEnv: module đọc biến môi trường lúc gọi, và cấu hình thiếu thì nó ném
  // kèm tên biến còn thiếu — đúng thứ ta muốn thấy ở dòng đầu tiên của một lần chuyển kho.
  const media = await import("../src/lib/services/media.ts");
  if (!media.mediaStoreReady()) throw new Error("Thiếu bộ biến OCI_* — chưa biết ghi vào đâu.");

  if (dryRun) console.log("• THỬ KHÔNG GHI (--dry-run): không một byte nào được ghi.");

  // ---- 1. Chép bytes ---------------------------------------------------------------
  const byPathname = new Map<string, string>();
  let copied = 0;
  let already = 0;
  let bytes = 0;
  let cursor: string | undefined;
  let total = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      total += 1;

      const existing = await media.statObject(blob.pathname);
      if (existing && existing.size === blob.size) {
        already += 1;
        byPathname.set(blob.pathname, media.publicUrlOf(blob.pathname));
        continue;
      }

      if (dryRun) {
        copied += 1;
        bytes += blob.size;
        byPathname.set(blob.pathname, media.publicUrlOf(blob.pathname));
        continue;
      }

      const res = await fetch(blob.url);
      if (!res.ok) {
        throw new Error(`Không tải được ${blob.pathname} từ kho cũ: HTTP ${res.status} ${res.statusText}`);
      }
      const body = new Uint8Array(await res.arrayBuffer());

      // Kích thước phải khớp với thứ kho cũ khai. Lệch nghĩa là tải thiếu — ghi tiếp là âm
      // thầm thay một file lành bằng một file cụt.
      if (body.byteLength !== blob.size) {
        throw new Error(`${blob.pathname}: kho cũ khai ${blob.size} byte, tải về được ${body.byteLength}.`);
      }

      // Kiểu nội dung lấy từ chính response của kho cũ — đó là thứ trình duyệt đang nhận
      // hôm nay, nên giữ nguyên nó là giữ nguyên hành vi hiển thị.
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const stored = await media.putObjectAt(blob.pathname, body, contentType);

      byPathname.set(blob.pathname, stored.url);
      copied += 1;
      bytes += body.byteLength;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(
    `• Kho cũ có ${total} object. Chép mới ${copied} (${(bytes / 1024 / 1024).toFixed(3)}MB), ${already} đã có sẵn bên OCI nên bỏ qua.`,
  );

  // ---- 2. Sửa URL trong tin nhắn ---------------------------------------------------
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(databaseName(mongoUri));
    console.log(`• Soi database「${db.databaseName}」, collection「chat_messages」.`);

    const result = await rewriteMessages(db.collection<MessageDoc>("chat_messages"), byPathname, dryRun);
    console.log(
      dryRun
        ? `• THỬ KHÔNG GHI: ${result.scanned} tin có đính kèm, sẽ sửa ${result.urlsChanged} URL trong ${result.rewritten} tin.`
        : `✔ Đã sửa ${result.urlsChanged} URL trong ${result.rewritten}/${result.scanned} tin có đính kèm.`,
    );
  } finally {
    await client.close().catch(() => {});
  }

  media.closeMediaStore();
  console.log("• Kho Vercel Blob KHÔNG bị đụng tới — vẫn nguyên vẹn làm bản lui.");
}

// Chạy trực tiếp thì làm việc; được `import` (phép kiểm chứng nạp hai hàm ở trên) thì im lặng.
const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
