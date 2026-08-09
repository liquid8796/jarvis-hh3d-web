import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
 * Tiền tố các KHUNG TAG — bài vị hoa văn hiện cạnh tên trong Phòng Chat. Tách tiền tố riêng
 * vì vòng đời khác hẳn `chat/`: khung là tài sản cấu hình do admin quản, KHÔNG bị cuốn theo
 * nút thanh tẩy sảnh (thứ quét đúng tiền tố `chat/`).
 */
export const TAG_FRAME_PREFIX = "tag-frames";

/**
 * Tiền tố ảnh đại diện. Nằm RIÊNG khỏi `chat/` vì hai vòng đời khác nhau hẳn: nút thanh tẩy
 * sảnh quét sạch `chat/`, và nó không có quyền gì với mặt của người ta.
 */
export const AVATAR_PREFIX = "avatar";

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
  body: Uint8Array;
};

export type StoredFile = { key: string; url: string; contentType: string };

/**
 * Nhãn dành cho MỌI thứ không phải bốn định dạng ảnh đã soi được. Trình duyệt không dựng trang
 * từ một octet-stream, nên đây là chỗ HTML/SVG/XML mất hết răng.
 */
const OPAQUE_CONTENT_TYPE = "application/octet-stream";

/**
 * Tải một file đàm đạo lên kho, và KHÔNG tin một chữ nào trong `file.type` mà client khai.
 *
 * Lý do là một lỗ hổng có thật: bucket này công khai đọc, nên nhãn ta ghi lên object CHÍNH LÀ
 * nhãn cả thế giới nhận được khi tải nó về. Trước bản này route đính kèm chép thẳng `file.type`
 * xuống, tức một môn đồ tải lên một tệp HTML tự khai `text/html` (hoặc một SVG có `<script>`)
 * là có ngay một trang web của họ chạy trên `objectstorage.…oraclecloud.com` — một tên miền
 * nghe rất chính danh để dựng trang lừa hoặc phát tán mã.
 *
 * Luật thay thế, đúng hai nhánh:
 *   • Bytes soi ra một trong bốn định dạng ảnh → giữ nhãn ảnh THẬT ấy. Bong bóng tin vẫn vẽ
 *     được `<img>` như cũ, và bốn định dạng đó không chạy được mã.
 *   • Còn lại → `application/octet-stream` KÈM `Content-Disposition: attachment`. Trình duyệt
 *     tải xuống thay vì dựng trang; PDF, zip, tài liệu vẫn gửi được như thường, chỉ là không
 *     còn cửa nào để một tệp tự nhận mình là HTML.
 *
 * Tên trong `Content-Disposition` đi qua `encodeURIComponent` theo RFC 5987 — dạng mã hoá ấy
 * không đẻ ra dấu nháy hay ký tự xuống dòng, nên không có đường chèn thêm header.
 */
export async function putChatFile(input: PutChatFileInput): Promise<StoredFile> {
  const { client, config } = requireStore();
  const key = chatObjectKey(input.userId, input.fileName);

  const image = sniffImageKind(input.body);
  const contentType = image?.contentType ?? OPAQUE_CONTENT_TYPE;
  const downloadName = sanitizeFileName(input.fileName) || "tep";

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      // Khai độ dài tường minh để SDK không chuyển sang chunked encoding — lớp tương thích
      // của OCI không nhận dạng đó.
      ContentLength: input.body.byteLength,
      ContentType: contentType,
      ...(image
        ? {}
        : { ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` }),
      CacheControl: CACHE_CONTROL,
    }),
  );

  return { key, url: publicUrl(key, config), contentType };
}

/**
 * Bốn định dạng ảnh mà MỌI trình duyệt vẽ được. Danh sách này vừa là luật nhận ảnh đại diện,
 * vừa là bảng tra đuôi file — nên không có đường nào ghi vào kho một kiểu nội dung mà bảng
 * này chưa biết đặt tên cho.
 */
const IMAGE_KINDS = [
  { contentType: "image/png", extension: ".png" },
  { contentType: "image/jpeg", extension: ".jpg" },
  { contentType: "image/webp", extension: ".webp" },
  { contentType: "image/gif", extension: ".gif" },
] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

/** Byte đầu tiên cần soi. WebP phải đọc tới cả chữ "WEBP" ở offset 8. */
const SNIFF_BYTES = 12;

function startsWithAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Nhận diện ảnh bằng CHÍNH BYTES, không tin `file.type` mà client khai.
 *
 * Vì sao không tin: bucket này công khai đọc, nên kiểu nội dung ta ghi lên object là kiểu mà
 * cả thế giới nhận được khi tải nó về. Client khai `image/png` cho một tệp HTML thì ta lưu
 * một trang HTML dưới nhãn ảnh, trên một tên miền không phải của mình — và cái nhãn ấy là
 * thứ DUY NHẤT ngăn trình duyệt hiển thị nó như trang web. Bytes thì không khai gian được:
 * `\x89PNG` là PNG, không cần hỏi ai.
 *
 * `null` = không phải bốn định dạng trên. Ảnh đại diện là chỗ HẸP có thể siết chặt như vậy;
 * đính kèm đàm đạo thì không, vì nó cố tình nhận mọi loại tệp.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < SNIFF_BYTES) return null;

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return IMAGE_KINDS[0];

  // JPEG có nhiều biến thể ở byte thứ tư (JFIF/Exif/…), nên chỉ ba byte đầu là phần bất biến.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return IMAGE_KINDS[1];

  if (startsWithAscii(bytes, 0, "RIFF") && startsWithAscii(bytes, 8, "WEBP")) return IMAGE_KINDS[2];

  if (startsWithAscii(bytes, 0, "GIF87a") || startsWithAscii(bytes, 0, "GIF89a")) return IMAGE_KINDS[3];

  return null;
}

/**
 * Tên object cho một ảnh đại diện: `avatar/{userId}/{ngẫu nhiên}{đuôi}`.
 *
 * KHÔNG mang tên tệp gốc, khác với `chatObjectKey`. Hai lẽ: tên ấy chẳng để làm gì (không ai
 * tải ảnh đại diện xuống theo tên), còn URL thì công khai — nên「IMG_4821_me_va_ban_gai.jpg」
 * sẽ nằm vĩnh viễn trên một địa chỉ ai cũng đọc được. Đuôi file suy từ BYTES đã soi, không
 * từ tên client gửi.
 *
 * Hậu tố ngẫu nhiên là điều kiện để `immutable` trong `CACHE_CONTROL` không nói dối — xem
 * ghi chú tại cột `avatarKey` trong schema.
 */
export function avatarObjectKey(userId: string, kind: ImageKind): string {
  const safeUser = sanitizeUserId(userId);
  return [
    AVATAR_PREFIX,
    hasWordCharacter(safeUser) ? safeUser : "an-danh",
    `${randomBytes(SUFFIX_BYTES).toString("base64url")}${kind.extension}`,
  ].join("/");
}

/** Tải một ảnh đại diện lên kho. `kind` phải là kết quả của `sniffImageKind` trên chính bytes ấy. */
export async function putAvatarFile(input: {
  userId: string;
  kind: ImageKind;
  body: Uint8Array;
}): Promise<StoredFile> {
  const { client, config } = requireStore();
  const key = avatarObjectKey(input.userId, input.kind);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.kind.contentType,
      CacheControl: CACHE_CONTROL,
    }),
  );

  return { key, url: publicUrl(key, config), contentType: input.kind.contentType };
}

/**
 * Tên object cho một khung tag: `tag-frames/{nhãn}-{ngẫu nhiên}{đuôi}`. Nhãn giữ lại trong
 * tên để người vào OCI console còn biết object nào là khung nào; đuôi suy từ BYTES đã soi
 * như avatar, không từ tên tệp client khai. Hậu tố ngẫu nhiên cùng lý do muôn thuở: hai lần
 * upload cùng nhãn không được ghi đè nhau — bản cũ còn trong sổ (và trong cache trình duyệt
 * với `immutable`) cho tới khi chính nó bị xoá khỏi sổ.
 */
export function tagFrameObjectKey(label: string, kind: ImageKind): string {
  const stem = sanitizeFileName(label);
  return [
    TAG_FRAME_PREFIX,
    `${hasWordCharacter(stem) ? stem : "khung"}-${randomBytes(SUFFIX_BYTES).toString("base64url")}${kind.extension}`,
  ].join("/");
}

/** Tải một khung tag lên kho. Cùng đường ống với avatar — chỉ khác cách đặt tên. */
export async function putTagFrameFile(input: { label: string; kind: ImageKind; body: Uint8Array }): Promise<StoredFile> {
  const { client, config } = requireStore();
  const key = tagFrameObjectKey(input.label, input.kind);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.kind.contentType,
      CacheControl: CACHE_CONTROL,
    }),
  );

  return { key, url: publicUrl(key, config), contentType: input.kind.contentType };
}

/**
 * Quét sạch mọi ảnh đại diện của một người — dùng khi trục xuất họ khỏi tông môn.
 *
 * Đi theo TIỀN TỐ chứ không theo `avatarKey` trong bảng, vì bảng chỉ nhớ ảnh ĐANG dùng: một
 * lần đổi ảnh mà lệnh xoá ảnh cũ trượt sẽ để lại object không còn ai trỏ tới, và lúc trục
 * xuất thì đó là dịp cuối cùng dọn được nó. Xoá dòng users rồi thì không còn gì để tra.
 */
export async function purgeUserAvatars(userId: string): Promise<MediaSweepResult> {
  const safeUser = sanitizeUserId(userId);
  // Tiền tố rỗng sẽ quét CẢ BUCKET (purgeObjectsUnder ném, nhưng chặn ở đây thì lời báo lỗi
  // nói đúng chuyện gì đã xảy ra): một userId rửa xong còn rỗng là lỗi của người gọi.
  if (!hasWordCharacter(safeUser)) {
    throw new Error("purgeUserAvatars cần một userId thật — chuỗi rỗng không trỏ vào ai cả.");
  }
  return purgeObjectsUnder(`${AVATAR_PREFIX}/${safeUser}/`);
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

  return { key, url: publicUrl(key, config), contentType: contentType };
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

/** Xoá một object. Dùng trong kiểm chứng để dọn dấu vết, và bởi phép quét sạch bên dưới. */
export async function deleteObject(key: string): Promise<void> {
  const { client, config } = requireStore();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/**
 * Số lệnh xoá chạy chồng nhau khi quét. Xoá tuần tự thì một sảnh nghìn tệp mất vài phút chỉ
 * để ngồi đợi độ trễ mạng; mở quá rộng thì OCI bắt đầu trả 429. Tám là chỗ đứng giữa.
 */
const SWEEP_CONCURRENCY = 8;

/** Trần của ListObjectsV2 — vừa là mặc định của API, vừa là số object mỗi lượt đi mạng. */
const SWEEP_PAGE_SIZE = 1000;

/**
 * Trần số trang. Một triệu object thì đây không còn là tàng khố đàm đạo nữa mà là một sự cố;
 * dừng lại và NÓI RA còn hơn quay vòng cho tới lúc function bị giết vì hết giờ.
 */
const SWEEP_MAX_PAGES = 1000;

export type MediaSweepResult =
  | { storeClosed: true }
  | {
      storeClosed?: false;
      /** Số object đã xoá được. */
      deleted: number;
      /** Số object lệnh xoá trượt — chúng CÒN nằm trong kho. */
      failed: number;
      /** Tổng dung lượng của phần đã xoá, tính bằng byte. */
      bytes: number;
      /** Số trang đã duyệt. Có mặt để phép kiểm chứng soi được đường phân trang. */
      pages: number;
      /** Nguyên văn lỗi ĐẦU TIÊN, hoặc `null`. Đếm mà không kèm lý do thì không lần ra được. */
      firstError: string | null;
    };

/**
 * Đọc cho người, không cho máy: một sảnh vừa dọn nên nói「48.3 MB」chứ không phải dãy số byte.
 */
export function humanBytes(bytes: number): string {
  const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // Byte thì không có phần lẻ để mà làm tròn; từ KB trở lên mới cần một chữ số sau dấu chấm.
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * Một câu kể lại chuyện vừa xảy ra với tàng khố, để action ghép vào lời báo cho trưởng môn.
 *
 * Ở CẠNH cái type nó mô tả, cùng chỗ với `STORE_CLOSED_MESSAGE` bên chat.ts và cùng một lý
 * do: lời báo phải đổi theo hình dạng dữ liệu, nên để chúng xa nhau là để chúng lệch nhau.
 * Thêm một lý do rất thực tế nữa — tệp `"use server"` chỉ được xuất ra hàm async, nên một
 * hàm thuần nằm trong đó là một hàm KHÔNG phép thử nào với tới được.
 *
 * Hai chuyện trục trặc được kể RỜI nhau, vì chúng rời nhau thật: `failed` là số lệnh xoá bị
 * từ chối, còn `firstError` xuất hiện MỘT MÌNH khi phép quét dừng ở trần số trang. Gộp lại
 * là cách sinh ra dòng「NHƯNG 0 tệp xoá không được」— vô nghĩa, và tệ hơn: nó giấu lý do thật.
 */
export function describeSweep(sweep: MediaSweepResult): string {
  if (sweep.storeClosed) {
    return "Tàng khố media chưa khai mở nên không có tệp nào để quét.";
  }

  const trouble: string[] = [];
  if (sweep.failed > 0) trouble.push(`${sweep.failed} tệp xoá không được`);
  if (sweep.firstError) trouble.push(`lỗi đầu tiên: ${sweep.firstError}`);

  if (trouble.length === 0) {
    return sweep.deleted === 0
      ? "Tàng khố media không còn tệp đính kèm nào."
      : `Quét ${sweep.deleted} tệp đính kèm (${humanBytes(sweep.bytes)}) khỏi tàng khố.`;
  }

  return (
    `Quét được ${sweep.deleted} tệp đính kèm (${humanBytes(sweep.bytes)}) khỏi tàng khố, ` +
    `NHƯNG ${trouble.join(" — ")}. Bấm lại để quét nốt.`
  );
}

/**
 * Chạy `run` trên từng phần tử với trần số lượt chồng nhau. Không dùng `Promise.all` trên cả
 * mảng: một sảnh nghìn tệp sẽ mở nghìn kết nối cùng lúc và kho trả lời bằng 429.
 *
 * `next++` an toàn không cần khoá — JavaScript chỉ nhường quyền ở `await`, mà phép tăng thì
 * nằm gọn giữa hai lần nhường.
 */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await run(items[next++]);
    }
  });
  await Promise.all(workers);
}

/**
 * Quét sạch mọi object nằm dưới một tiền tố.
 *
 * Một lệnh xoá cho mỗi object, KHÔNG dùng DeleteObjects (xoá gộp 1000 key một lượt): lớp
 * tương thích S3 của OCI không kể lệnh ấy trong danh sách hỗ trợ, còn `DeleteObject` thì đã
 * được `verify:media` chạy thật trên kho thật. Chậm hơn một chút, đổi lấy việc chắc chắn chạy
 * — và `SWEEP_CONCURRENCY` lấy lại phần lớn khoảng chênh ấy.
 *
 * Lệnh xoá trượt được ĐẾM chứ không ném: một object bị khoá quyền không có lý do gì kéo theo
 * cả cuộc quét. Người gọi đọc `failed` và `firstError` rồi quyết định — và vì phép quét đi
 * theo tiền tố chứ không theo danh sách nào cả, chạy lại lần nữa là dọn nốt.
 *
 * `pageSize` chỉ để phép kiểm chứng ép đường phân trang chạy thật với vài object thay vì phải
 * dựng đủ một nghìn. Web luôn dùng mặc định.
 */
export async function purgeObjectsUnder(
  prefix: string,
  pageSize: number = SWEEP_PAGE_SIZE,
): Promise<MediaSweepResult> {
  // Tiền tố rỗng nghĩa là "cả bucket" — với một hàm mang tên xoá sạch thì đó không phải một
  // tham số hợp lệ mà là một lỗi lập trình, nên nó ném chứ không âm thầm quét tất.
  if (!prefix.trim()) {
    throw new Error("purgeObjectsUnder cần một tiền tố — chuỗi rỗng sẽ quét sạch cả bucket.");
  }
  // `MaxKeys` không hợp lệ thì kho trả về trang RỖNG mà vẫn kèm token đi tiếp — tức vòng lặp
  // dưới đây quay mãi không xoá được gì. Chặn ở cửa, vì đây là một hàm xuất ra ngoài.
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > SWEEP_PAGE_SIZE) {
    throw new Error(`pageSize phải là số nguyên trong khoảng 1–${SWEEP_PAGE_SIZE}, nhận ${pageSize}.`);
  }

  const opened = store();
  if (!opened) return { storeClosed: true };
  const { client, config } = opened;

  let deleted = 0;
  let failed = 0;
  let bytes = 0;
  let pages = 0;
  let firstError: string | null = null;
  let cursor: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: pageSize,
        ContinuationToken: cursor,
      }),
    );
    pages++;

    const batch = (page.Contents ?? [])
      .map((object) => ({ key: object.Key, size: object.Size ?? 0 }))
      .filter((object): object is { key: string; size: number } => Boolean(object.key));

    await forEachLimited(batch, SWEEP_CONCURRENCY, async ({ key, size }) => {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
        deleted++;
        bytes += size;
      } catch (err) {
        failed++;
        firstError ??= `${key}: ${err instanceof Error ? err.message : String(err)}`;
      }
    });

    // Token của lượt sau tính từ key CUỐI đã liệt kê, nên việc vừa xoá cả trang không làm nó
    // hỏng. `IsTruncated` mà không kèm token thì coi như hết — không có gì để hỏi tiếp.
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;

    if (cursor && pages >= SWEEP_MAX_PAGES) {
      firstError ??= `Quét dừng ở trần ${SWEEP_MAX_PAGES} trang — kho còn object dưới「${prefix}」, chạy lại để quét tiếp.`;
      break;
    }
  } while (cursor);

  return { deleted, failed, bytes, pages, firstError };
}

/**
 * Quét sạch bytes của mọi file đính kèm đàm đạo. Đi theo TIỀN TỐ `chat/` chứ không theo URL
 * đọc từ tin nhắn, và đó là chủ ý kép:
 *
 *   1. File đã tải lên nhưng người gửi đổi ý không bấm gửi thì không tin nào nhắc tới — đi
 *      theo tin nhắn là bỏ chúng nằm lại trả tiền lưu trữ mãi mãi.
 *   2. Người gọi xoá tin TRƯỚC rồi mới quét bytes (xem ghi chú ở action): sau bước một thì
 *      URL không còn tồn tại để mà đi theo. Tiền tố thì vẫn còn đó, nên một lần quét trượt
 *      giữa chừng chỉ cần bấm lại là xong.
 *
 * GIF không nằm trong đây và không cần: chúng là URL của GIPHY, tông môn chưa từng giữ bytes.
 */
export async function purgeChatMedia(): Promise<MediaSweepResult> {
  return purgeObjectsUnder(`${CHAT_PREFIX}/`);
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
