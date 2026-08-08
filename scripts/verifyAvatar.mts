#!/usr/bin/env node
/**
 * Kiểm chứng ảnh đại diện — nhận diện ảnh bằng bytes, cách đặt tên object, và phép ĐỔI ẢNH
 * nguyên tử trong database (ghi ảnh mới đồng thời trả về tên ảnh cũ để xoá).
 *
 * Ba tầng, và tầng nào bị bỏ qua thì bản kê nói ra:
 *   • Soi bytes + đặt tên  — không cần gì, chạy ở mọi máy.
 *   • Vòng đời trong bảng  — cần DATABASE_URL. Tự dựng một đạo hữu tạm rồi xoá.
 *   • Vòng đời thật ở kho  — cần bộ biến OCI_*. Tải lên → tải công khai → quét sạch.
 *
 * Chạy: npm run verify:avatar
 */
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const media = await import("../src/lib/services/media.ts");
const users = await import("../src/lib/services/users.ts");

const OCI_KEYS = ["OCI_REGION", "OCI_NAMESPACE", "OCI_BUCKET", "OCI_ACCESS_KEY_ID", "OCI_SECRET_ACCESS_KEY"] as const;
const hasOci = OCI_KEYS.every((key) => (process.env[key] ?? "").trim().length > 0);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt — chạy `npm run env:pull` trước.");
const sql = neon(process.env.DATABASE_URL);

/** Ảnh PNG 1×1 thật, để phần vòng đời trên kho gửi đi một tấm ảnh hợp lệ chứ không phải bytes bừa. */
const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const ascii = (text: string, padTo = 0) => {
  const bytes = Buffer.from(text, "ascii");
  return new Uint8Array(padTo > bytes.length ? Buffer.concat([bytes, Buffer.alloc(padTo - bytes.length)]) : bytes);
};

const stamp = Date.now();
const username = `__avatar_${stamp}`;
let userId = "";
const createdKeys: string[] = [];

try {
  // ---- Soi bytes -------------------------------------------------------------------
  assert(media.sniffImageKind(PNG_1X1)?.contentType === "image/png", "PNG thật phải được nhận là image/png");
  assert(media.sniffImageKind(PNG_1X1)?.extension === ".png", "PNG phải mang đuôi .png");

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert(media.sniffImageKind(jpeg)?.contentType === "image/jpeg", "ba byte đầu FFD8FF phải là JPEG");
  assert(media.sniffImageKind(jpeg)?.extension === ".jpg", "JPEG phải mang đuôi .jpg");

  const webp = new Uint8Array(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]));
  assert(media.sniffImageKind(webp)?.contentType === "image/webp", "RIFF….WEBP phải là WebP");

  // RIFF nhưng KHÔNG phải WEBP (đây là header của WAV) — đọc thiếu 4 byte ở offset 8 là nhận
  // một tệp âm thanh làm ảnh rồi ghi nó lên kho dưới nhãn image/webp.
  const wav = new Uint8Array(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]));
  assert(media.sniffImageKind(wav) === null, "RIFF mà không phải WEBP thì phải bị từ chối");

  assert(media.sniffImageKind(ascii("GIF89a", 12))?.contentType === "image/gif", "GIF89a phải là GIF");
  assert(media.sniffImageKind(ascii("GIF87a", 12))?.contentType === "image/gif", "GIF87a cũng là GIF");

  // Đây là lý do tồn tại của phép soi: một tệp HTML tự khai `image/png` KHÔNG được lọt vào một
  // bucket công khai dưới nhãn ảnh.
  assert(media.sniffImageKind(ascii("<!doctype html><h1>hi</h1>")) === null, "HTML phải bị từ chối");
  assert(media.sniffImageKind(ascii("BM", 12)) === null, "BMP không nằm trong danh sách nhận");
  assert(media.sniffImageKind(ascii("%PDF-1.7", 12)) === null, "PDF phải bị từ chối");
  assert(media.sniffImageKind(new Uint8Array(0)) === null, "bytes rỗng phải bị từ chối, không được ném");
  assert(media.sniffImageKind(PNG_1X1.slice(0, 5)) === null, "quá ngắn để soi thì phải là null");
  console.log("✔ Soi bytes: nhận đúng 4 định dạng, từ chối HTML/PDF/BMP/WAV/rỗng/quá ngắn.");

  // ---- Đặt tên object --------------------------------------------------------------
  const kind = media.sniffImageKind(PNG_1X1)!;
  const key = media.avatarObjectKey("u-123", kind);
  assert(key.startsWith("avatar/u-123/"), `key phải nằm dưới avatar/{userId}/, đang là ${key}`);
  assert(key.endsWith(".png"), `đuôi suy từ bytes phải nằm cuối, đang là ${key}`);
  assert(key.split("/").length === 3, `key phải đúng 3 tầng, đang là ${key}`);
  assert(
    media.avatarObjectKey("u-1", kind) !== media.avatarObjectKey("u-1", kind),
    "hai lần đặt ảnh KHÔNG được ra cùng key — `immutable` trong cache-control dựa vào đúng điều này",
  );

  // Một dấu `/` lọt vào userId là đẻ thêm tầng thư mục, và từ đó ảnh của người này rơi vào
  // vùng tên của người khác — cũng chính là vùng mà `purgeUserAvatars` quét sạch.
  const nasty = media.avatarObjectKey("../../etc", kind);
  assert(nasty.split("/").length === 3 && !nasty.includes(".."), `userId phải được rửa sạch, đang là ${nasty}`);
  assert(media.avatarObjectKey("", kind).includes("/an-danh/"), "userId rỗng phải có đường lui");

  let purgeGuard: unknown = null;
  try {
    await media.purgeUserAvatars("///");
  } catch (err) {
    purgeGuard = err;
  }
  assert(purgeGuard instanceof Error, "purgeUserAvatars phải ném khi userId rửa xong còn rỗng — nếu không nó quét cả avatar/");
  console.log("✔ Đặt tên: đúng 3 tầng, đuôi theo bytes, không đụng nhau, userId lạ không thoát khỏi tầng của mình.");

  // ---- Vòng đời trong bảng ---------------------------------------------------------
  const rows = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Avatar verifier', 'not-a-login-hash', 'active')
    returning id
  `;
  userId = String(rows[0].id);

  const fresh = await users.findById(userId);
  assert(fresh?.avatarUrl === null, "đạo hữu mới phải chưa có ảnh (null, không phải chuỗi rỗng)");
  assert(
    (await users.avatarsByUserId([userId]))[userId] === undefined,
    "người chưa đặt ảnh phải VẮNG MẶT trong bản đồ, không phải có mặt với giá trị null",
  );

  const first = await users.setAvatar(userId, { url: "https://kho/a1.png", key: "avatar/u/a1.png" });
  assert(first.matched, "setAvatar phải khớp đúng một dòng");
  assert(first.previousKey === null, "lần đặt đầu tiên không có ảnh cũ nào để xoá");
  assert((await users.findById(userId))?.avatarUrl === "https://kho/a1.png", "URL phải được ghi vào bảng");

  const second = await users.setAvatar(userId, { url: "https://kho/a2.png", key: "avatar/u/a2.png" });
  assert(
    second.previousKey === "avatar/u/a1.png",
    `đổi ảnh phải trả về tên object CŨ trong cùng câu lệnh, đang là ${second.previousKey}`,
  );
  assert((await users.findById(userId))?.avatarUrl === "https://kho/a2.png", "URL mới phải thắng URL cũ");
  assert(
    (await users.avatarsByUserId([userId]))[userId] === "https://kho/a2.png",
    "bản đồ ảnh phải trả về URL đang dùng",
  );

  const cleared = await users.clearAvatar(userId);
  assert(cleared.previousKey === "avatar/u/a2.png", "bỏ ảnh phải trả về tên object vừa thôi dùng");
  const bare = await users.findById(userId);
  assert(bare?.avatarUrl === null, "bỏ ảnh phải trả cột về null");
  assert(bare?.status === "active" && bare.roles.length === 0, "đụng vào ảnh KHÔNG được chạm quyền hay trạng thái");
  assert(
    (await users.clearAvatar(userId)).previousKey === null,
    "bỏ ảnh lần thứ hai không còn gì để xoá — và không được ném",
  );

  const ghost = await users.setAvatar("00000000-0000-0000-0000-000000000000", {
    url: "https://kho/x.png",
    key: "avatar/x/x.png",
  });
  assert(!ghost.matched, "id không tồn tại phải cho matched=false, không phải im lặng coi như xong");

  assert(Object.keys(await users.avatarsByUserId([])).length === 0, "danh sách id rỗng phải trả map rỗng, không đi mạng");
  console.log("✔ Trong bảng: đặt → đổi (trả về key cũ) → bỏ → bỏ lại; id lạ bị từ chối; quyền không bị chạm.");

  // ---- Vòng đời thật trên kho ------------------------------------------------------
  if (!hasOci) {
    console.log("");
    console.log("⚠ BỎ QUA vòng đời thật: chưa có bộ biến OCI_*. Những gì trên đây KHÔNG chứng minh");
    console.log("  rằng một tấm ảnh nào đã thật sự vào kho. Đặt OCI_* rồi chạy lại để có phần đó.");
  } else {
    const owner = `verify-avatar-${stamp}`;
    const stored = await media.putAvatarFile({ userId: owner, kind, body: PNG_1X1 });
    createdKeys.push(stored.key);

    const stat = await media.statObject(stored.key);
    assert(stat?.size === PNG_1X1.byteLength, `kích thước phải khớp: gửi ${PNG_1X1.byteLength}, kho báo ${stat?.size}`);

    // Trình duyệt nào cũng phải tải được ảnh này mà không mang chữ ký — vòng tròn avatar là
    // một thẻ <img> trỏ thẳng vào URL ấy, nên bucket không công khai thì chính chỗ này đỏ.
    const fetched = await fetch(stored.url);
    assert(fetched.ok, `tải công khai phải được, đang là HTTP ${fetched.status} ${fetched.statusText}`);
    assert(
      fetched.headers.get("content-type") === "image/png",
      `kiểu nội dung phải là image/png (suy từ bytes), đang là ${fetched.headers.get("content-type")}`,
    );
    assert(
      (fetched.headers.get("cache-control") ?? "").includes("immutable"),
      `ảnh đại diện phải được cache immutable, đang là ${fetched.headers.get("cache-control")}`,
    );
    const back = new Uint8Array(await fetched.arrayBuffer());
    assert(Buffer.compare(Buffer.from(back), Buffer.from(PNG_1X1)) === 0, "bytes tải về phải khớp từng byte");

    // Đặt thêm một ảnh nữa cho cùng người, rồi quét theo tiền tố: phải dọn CẢ HAI, kể cả tấm
    // mà bảng không còn trỏ tới — đó chính là ca lúc trục xuất một đạo hữu.
    const orphan = await media.putAvatarFile({ userId: owner, kind, body: PNG_1X1 });
    createdKeys.push(orphan.key);

    const sweep = await media.purgeUserAvatars(owner);
    assert(!sweep.storeClosed, "kho đang mở thì phép quét không được báo storeClosed");
    assert(!sweep.storeClosed && sweep.deleted === 2, `phải quét đúng 2 object, đang là ${!sweep.storeClosed && sweep.deleted}`);
    assert(!sweep.storeClosed && sweep.failed === 0, "không được có lệnh xoá nào trượt");
    createdKeys.length = 0;

    assert((await media.statObject(stored.key)) === null, "quét rồi thì object phải biến mất");
    assert((await media.statObject(orphan.key)) === null, "kể cả tấm không còn ai trỏ tới");

    console.log(`✔ Trên kho thật (${process.env.OCI_BUCKET}): tải lên → tải công khai đúng byte + đúng nhãn → quét sạch cả ảnh mồ côi.`);
  }

  console.log("");
  console.log(hasOci ? "TẤT CẢ XANH — gồm cả vòng đời thật trên OCI." : "XANH phần không cần kho OCI.");
} finally {
  for (const key of createdKeys) {
    await media.deleteObject(key).catch((err) => console.error(`  (không xoá được ${key}: ${err})`));
  }
  media.closeMediaStore();
  if (userId) {
    await sql`delete from users where username = ${username}`.catch(() => {});
  }
}
