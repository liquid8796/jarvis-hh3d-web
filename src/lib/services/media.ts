import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";

/**
 * Tàng khố media — bytes của file đính kèm trong đàm đạo, sống ở OCI Object Storage.
 *
 * <b>Trước 08/08/2026 kho này là Vercel Blob.</b> Đổi kho vì một lý do rất trần tục: tông môn
 * đã có sẵn một tài khoản OCI đang nuôi khôi lỗi tông môn, và dung lượng ở đó là thứ đã trả
 * tiền (hoặc nằm trong hạn Always Free) — trong khi Vercel Blob tính tiền riêng theo GB lưu
 * và GB tải. Gộp về một nhà cũng bớt được một nhà cung cấp phải canh hạn mức.
 *
 * Nói qua API S3 chứ KHÔNG qua SDK riêng của OCI. Object Storage của OCI có sẵn lớp tương
 * thích S3, nên `@aws-sdk/client-s3` — thứ đã được cả thế giới soi từng đường ký request —
 * dùng được nguyên vẹn. Đổi lại là một biến môi trường endpoint; cái giá ấy rẻ hơn nhiều so
 * với việc tự ký request theo chuẩn riêng của OCI (RSA-SHA256 trên chuỗi header) chỉ để tải
 * lên một tấm ảnh.
 *
 * GHI qua endpoint S3 (`{namespace}.compat.objectstorage.{region}...`), còn ĐỌC thì bằng URL
 * gốc của OCI (`objectstorage.{region}.../n/.../b/.../o/...`) — bucket để chế độ công khai
 * đọc, y như Vercel Blob trước đây, nên URL lưu trong tin nhắn sống mãi và không phải ký lại.
 * Đó cũng là lý do KHÔNG dùng Pre-Authenticated Request: PAR có hạn, mà URL thì nằm trong
 * database vĩnh viễn — một hạn dùng âm thầm hết là cả album ảnh cũ chết theo.
 *
 * Kho có thể CHƯA MỞ (chưa tạo bucket / chưa đặt biến): `mediaStoreReady()` trả false và
 * route trả lời tử tế. Nhưng đặt THIẾU MỘT NỬA thì ném ngay kèm tên biến còn thiếu — nửa
 * vời là lỗi cấu hình, không phải một trạng thái hợp lệ để im lặng đi qua.
 */

const ENV_REGION = "OCI_REGION";
const ENV_NAMESPACE = "OCI_NAMESPACE";
const ENV_BUCKET = "OCI_BUCKET";
const ENV_ACCESS_KEY = "OCI_ACCESS_KEY_ID";
const ENV_SECRET_KEY = "OCI_SECRET_ACCESS_KEY";

const ENV_KEYS = [ENV_REGION, ENV_NAMESPACE, ENV_BUCKET, ENV_ACCESS_KEY, ENV_SECRET_KEY] as const;

/** Tiền tố mọi file đàm đạo. Đặt tên có tiền tố để sau này thêm loại media khác không đụng nhau. */
export const CHAT_PREFIX = "chat";

/**
 * Cache một tháng — đúng bằng mặc định cũ của Vercel Blob, nên hành vi trình duyệt không đổi.
 * Thêm `immutable` là an toàn TUYỆT ĐỐI ở đây, không phải liều: mỗi lần tải lên sinh một hậu
 * tố ngẫu nhiên mới, nên một key đã tồn tại thì nội dung của nó không bao giờ đổi nữa.
 */
const CACHE_CONTROL = "public, max-age=2592000, immutable";

/** Phần mở rộng dài hơn ngần này thì không phải phần mở rộng, chỉ là dấu chấm trong tên. */
const MAX_EXTENSION_LENGTH = 16;

/** Đủ dài để hai người cùng gửi "anh.jpg" trong cùng một giây không bao giờ đụng nhau. */
const SUFFIX_BYTES = 12;

export type MediaConfig = {
  region: string;
  namespace: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Đọc cấu hình. `null` = chưa khai mở (không có biến nào). Có một phần thì ném — xem ghi chú
 * đầu tệp về ranh giới giữa "chưa mở" và "đặt sai".
 */
function readConfig(): MediaConfig | null {
  const present = ENV_KEYS.filter((key) => (process.env[key] ?? "").trim().length > 0);
  if (present.length === 0) return null;

  if (present.length < ENV_KEYS.length) {
    const missing = ENV_KEYS.filter((key) => !present.includes(key));
    throw new Error(
      `Tàng khố media đặt thiếu biến: ${missing.join(", ")}. Đặt đủ cả ${ENV_KEYS.length} biến hoặc bỏ hết — đặt nửa vời thì không đoán được ý.`,
    );
  }

  return {
    region: process.env[ENV_REGION]!.trim(),
    namespace: process.env[ENV_NAMESPACE]!.trim(),
    bucket: process.env[ENV_BUCKET]!.trim(),
    accessKeyId: process.env[ENV_ACCESS_KEY]!.trim(),
    secretAccessKey: process.env[ENV_SECRET_KEY]!.trim(),
  };
}

export function mediaStoreReady(): boolean {
  return readConfig() !== null;
}

type MediaStore = { client: S3Client; config: MediaConfig };

function sameConfig(a: MediaConfig, b: MediaConfig): boolean {
  return (
    a.region === b.region &&
    a.namespace === b.namespace &&
    a.bucket === b.bucket &&
    a.accessKeyId === b.accessKeyId &&
    a.secretAccessKey === b.secretAccessKey
  );
}

const globalForMedia = globalThis as unknown as { __jarvisMediaStore?: MediaStore };

/**
 * S3Client dùng chung cả tiến trình để giữ keep-alive giữa các request — dựng mới mỗi lần
 * tải lên là mỗi lần một bắt tay TLS với Frankfurt. Thêm bản trên `globalThis` vì `next dev`
 * nạp lại module mỗi lần sửa file (cùng lý do với pool Mongo trong chat.ts).
 */
function store(): MediaStore | null {
  const config = readConfig();
  if (!config) return null;

  // So khớp TOÀN BỘ cấu hình, không chỉ tên bucket: xoay khoá bí mật mà vẫn giữ nguyên
  // bucket là trường hợp có thật, và một client đang ôm khoá cũ thì vẫn trông "đúng kho".
  const opened = globalForMedia.__jarvisMediaStore;
  if (opened) {
    if (sameConfig(opened.config, config)) return opened;
    opened.client.destroy(); // Cấu hình đã đổi — thả client cũ thay vì bỏ rơi socket của nó.
  }

  const client = new S3Client({
    region: config.region,
    endpoint: `https://${config.namespace}.compat.objectstorage.${config.region}.oraclecloud.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },

    // OCI chỉ hiểu địa chỉ dạng path (`/bucket/key`), không hiểu dạng virtual-host
    // (`bucket.endpoint`) mà SDK mặc định dùng.
    forcePathStyle: true,

    // BẮT BUỘC, không phải tinh chỉnh: từ v3.729 SDK tự gắn `x-amz-checksum-crc32` vào mọi
    // PutObject, mà lớp tương thích S3 của OCI từ chối header ấy — để mặc định thì mọi lần
    // tải lên chết bằng một lỗi chữ ký khó lần ra.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  const next: MediaStore = { client, config };
  globalForMedia.__jarvisMediaStore = next;
  return next;
}

/**
 * Đóng kết nối và quên cache. CHỈ dành cho tiến trình có điểm kết thúc — script chuyển kho,
 * script kiểm chứng. Web function không bao giờ gọi.
 *
 * Cùng bài học với `closeChatStore()`: một agent HTTP còn mở giữ event loop sống, script
 * chạy xong sẽ treo thay vì thoát.
 */
export function closeMediaStore(): void {
  const opened = globalForMedia.__jarvisMediaStore;
  globalForMedia.__jarvisMediaStore = undefined;
  opened?.client.destroy();
}

function requireStore(): MediaStore {
  const opened = store();
  if (!opened) {
    throw new Error(`Tàng khố media chưa khai mở — thiếu ${ENV_KEYS.join(", ")}.`);
  }
  return opened;
}

/**
 * Giữ lại chữ và số của MỌI ngôn ngữ (tên file tiếng Việt là chuyện thường ngày ở đây), còn
 * lại quy về gạch dưới. Cùng luật với bản Vercel Blob trước đây, nên tên file không đổi hình
 * dạng sau khi chuyển kho.
 */
function sanitizeFileName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
}

/**
 * userId thì siết chặt hơn tên file: nó là định danh mờ (UUID) chứ không phải chữ để đọc,
 * nên không có lý do gì cho phép ký tự ngoài ASCII an toàn — và cái cần chặn là dấu `/`, thứ
 * đẻ thêm một tầng thư mục không ai chờ đợi giữa `chat/` và tên file.
 */
function sanitizeUserId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

/** Có chữ hoặc số nào không. Một "tên" toàn dấu chấm với gạch dưới thì không phải là tên. */
function hasWordCharacter(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/**
 * Tách phần mở rộng để hậu tố ngẫu nhiên chen vào TRƯỚC nó — `anh-x7k2.jpg` chứ không phải
 * `anh.jpg-x7k2`. Đuôi file phải nằm cuối thì trình duyệt và hệ điều hành mới đoán đúng.
 *
 * Dấu chấm ở vị trí 0 không phải phần mở rộng (`.gitignore` là tên, không phải đuôi).
 */
function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };

  const extension = name.slice(dot);
  if (extension.length > MAX_EXTENSION_LENGTH) return { stem: name, extension: "" };

  return { stem: name.slice(0, dot), extension };
}

/**
 * Tên object cho một file đàm đạo: `chat/{userId}/{tên}-{ngẫu nhiên}{đuôi}`.
 *
 * Hậu tố ngẫu nhiên là YÊU CẦU AN TOÀN, không phải cho đẹp: tên file do người dùng đặt, hai
 * người cùng gửi "anh.jpg" mà không có hậu tố thì người sau ghi đè ảnh người trước.
 * base64url chỉ sinh ra ký tự đã nằm trong bộ an toàn ở trên nên không phá luật đặt tên.
 */
export function chatObjectKey(userId: string, fileName: string): string {
  const safeUser = sanitizeUserId(userId);
  const { stem, extension } = splitExtension(sanitizeFileName(fileName));

  // Đường lui phải áp lên PHẦN TÊN sau khi đã tách đuôi, không phải lên cả chuỗi: "???.png"
  // rửa xong là "_.png" — chuỗi ấy có chữ (trong đuôi "png") nên nhìn thì "có tên", mà phần
  // tên thật lại rỗng nghĩa. Bắt được đúng ca này nhờ phép thử, không phải nhờ đọc lại.
  return [
    CHAT_PREFIX,
    hasWordCharacter(safeUser) ? safeUser : "an-danh",
    `${hasWordCharacter(stem) ? stem : "tep"}-${randomBytes(SUFFIX_BYTES).toString("base64url")}${extension}`,
  ].join("/");
}

/**
 * URL công khai theo dạng gốc của OCI. Từng đoạn được mã hoá riêng nên tên file tiếng Việt
 * vẫn ra URL hợp lệ, còn dấu `/` giữa các đoạn thì giữ nguyên làm dấu phân cấp.
 */
export function publicUrl(key: string, config: MediaConfig): string {
  const host = `objectstorage.${config.region}.oraclecloud.com`;
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${host}/n/${encodeURIComponent(config.namespace)}/b/${encodeURIComponent(config.bucket)}/o/${path}`;
}

/** URL công khai của một key, đọc cấu hình từ môi trường. Ném nếu kho chưa khai mở. */
export function publicUrlOf(key: string): string {
  return publicUrl(key, requireStore().config);
}

export type PutChatFileInput = {
  userId: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
};

export type StoredFile = { key: string; url: string };

/** Tải một file đàm đạo lên kho. Trả về key (để lưu/đối soát) và URL công khai (để hiển thị). */
export async function putChatFile(input: PutChatFileInput): Promise<StoredFile> {
  const { client, config } = requireStore();
  const key = chatObjectKey(input.userId, input.fileName);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      // Khai độ dài tường minh để SDK không chuyển sang chunked encoding — lớp tương thích
      // của OCI không nhận dạng đó.
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      CacheControl: CACHE_CONTROL,
    }),
  );

  return { key, url: publicUrl(key, config) };
}

/** Tải lên tại một key CHO SẴN — dành cho script chuyển kho, nơi key phải giữ nguyên từ kho cũ. */
export async function putObjectAt(key: string, body: Uint8Array, contentType: string): Promise<StoredFile> {
  const { client, config } = requireStore();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL,
    }),
  );

  return { key, url: publicUrl(key, config) };
}

/** Kích thước object, hoặc `null` nếu chưa có. Dùng để script chuyển kho chạy lại được nhiều lần. */
export async function statObject(key: string): Promise<{ size: number } | null> {
  const { client, config } = requireStore();

  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return { size: head.ContentLength ?? 0 };
  } catch (err) {
    // Chỉ "không tồn tại" mới là `null`. Lỗi quyền hay lỗi mạng phải ném lên — nuốt chúng ở
    // đây là biến một kho hỏng thành một kho "rỗng", và script chuyển kho sẽ chép lại tất cả.
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Xoá một object. Dùng trong kiểm chứng để dọn dấu vết; web không xoá file đính kèm. */
export async function deleteObject(key: string): Promise<void> {
  const { client, config } = requireStore();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
