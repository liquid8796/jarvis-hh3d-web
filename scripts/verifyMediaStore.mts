#!/usr/bin/env node
/**
 * Kiểm chứng tàng khố media — cách đặt tên object, cách dựng URL, ranh giới cấu hình, và
 * phép sửa URL của script chuyển kho (chạy trên một mongod THẬT trong tiến trình).
 *
 * Phần KHÔNG cần mạng chạy ở mọi máy. Phần vòng đời thật (tải lên → tải về bằng HTTPS công
 * khai → xoá) chỉ chạy khi có đủ bộ biến OCI_* — và nó KHÔNG bị bỏ qua trong im lặng: cuối
 * bản kê ghi rõ nó có chạy hay không, vì một phép thử bị bỏ qua mà trông như đã xanh là cách
 * nhanh nhất để tin vào một kho chưa từng được chạm tới.
 *
 * Đặt `MEDIA_TEST_PREFIX` để đổi tiền tố của object thử (mặc định `verify/`); mọi object nó
 * tạo đều bị xoá ở cuối, kể cả khi một phép thử ở giữa ném.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const OCI_KEYS = ["OCI_REGION", "OCI_NAMESPACE", "OCI_BUCKET", "OCI_ACCESS_KEY_ID", "OCI_SECRET_ACCESS_KEY"] as const;

/** Ảnh chụp biến môi trường thật, để mấy phép thử về cấu hình mượn rồi trả lại nguyên trạng. */
const realEnv = Object.fromEntries(OCI_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;
const hasRealConfig = OCI_KEYS.every((k) => (realEnv[k] ?? "").trim().length > 0);

function setEnv(values: Partial<Record<(typeof OCI_KEYS)[number], string | undefined>>) {
  for (const key of OCI_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv() {
  setEnv(realEnv as Partial<Record<(typeof OCI_KEYS)[number], string | undefined>>);
}

const media = await import("../src/lib/services/media.ts");
const { rewriteAttachmentUrl, rewriteMessages } = await import("./migrateBlobToOci.mts");

const FAKE = {
  OCI_REGION: "eu-frankfurt-1",
  OCI_NAMESPACE: "frtestns",
  OCI_BUCKET: "jarvis-media",
  OCI_ACCESS_KEY_ID: "khoa-thu",
  OCI_SECRET_ACCESS_KEY: "bi-mat-thu",
} as const;

let mongod: MongoMemoryServer | null = null;
let mongo: MongoClient | null = null;
const created: string[] = [];

try {
  // ---- Ranh giới cấu hình ----------------------------------------------------------
  setEnv({});
  assert(!media.mediaStoreReady(), "không có biến nào thì kho phải báo chưa khai mở");

  setEnv({ OCI_REGION: FAKE.OCI_REGION, OCI_BUCKET: FAKE.OCI_BUCKET });
  let partialError: unknown = null;
  try {
    media.mediaStoreReady();
  } catch (err) {
    partialError = err;
  }
  assert(partialError instanceof Error, "đặt nửa vời phải ném, không được im lặng coi như chưa mở");
  const partialMessage = (partialError as Error).message;
  assert(partialMessage.includes("OCI_NAMESPACE"), "lời báo lỗi phải gọi tên biến còn thiếu");
  assert(partialMessage.includes("OCI_SECRET_ACCESS_KEY"), "phải gọi tên ĐỦ các biến còn thiếu");
  assert(!partialMessage.includes("OCI_REGION"), "biến đã đặt thì không được kể vào danh sách thiếu");

  setEnv(FAKE);
  assert(media.mediaStoreReady(), "đủ bộ biến thì kho phải báo sẵn sàng");
  console.log("✔ Cấu hình: không có gì = chưa khai mở, nửa vời = ném kèm tên biến thiếu, đủ = sẵn sàng.");

  // ---- Đặt tên object --------------------------------------------------------------
  const key = media.chatObjectKey("u-123", "anh dep.jpg");
  assert(key.startsWith("chat/u-123/"), `key phải nằm dưới chat/{userId}/, đang là ${key}`);
  assert(key.endsWith(".jpg"), `đuôi file phải nằm CUỐI, đang là ${key}`);
  assert(key.includes("anh_dep-"), `tên gốc phải còn nhận ra được, đang là ${key}`);

  assert(
    media.chatObjectKey("u-1", "a.jpg") !== media.chatObjectKey("u-1", "a.jpg"),
    "hai lần gửi cùng tên KHÔNG được ra cùng key — đó là chỗ người sau ghi đè người trước",
  );

  const unicode = media.chatObjectKey("u-1", "ảnh của tông môn.png");
  assert(unicode.includes("ảnh_của_tông_môn-"), `chữ tiếng Việt phải giữ nguyên, đang là ${unicode}`);
  assert(unicode.endsWith(".png"), "đuôi vẫn phải ở cuối khi tên có dấu");

  const noExt = media.chatObjectKey("u-1", "README");
  assert(!noExt.slice(noExt.lastIndexOf("/")).includes("."), `không có đuôi thì đừng bịa ra, đang là ${noExt}`);

  const dotfile = media.chatObjectKey("u-1", ".gitignore");
  assert(dotfile.includes("/.gitignore-"), `".gitignore" là TÊN, không phải đuôi — đang là ${dotfile}`);
  assert(!dotfile.endsWith(".gitignore"), `hậu tố ngẫu nhiên phải nằm sau tên, đang là ${dotfile}`);

  const longExt = media.chatObjectKey("u-1", "tep.dinhkemcuctokhongphaiduoifile");
  assert(!longExt.endsWith("khongphaiduoifile"), `đuôi dài bất thường phải bị coi là tên, đang là ${longExt}`);

  const empty = media.chatObjectKey("u-1", "");
  assert(empty.includes("/tep-"), `tên rỗng phải rơi về "tep", đang là ${empty}`);

  const symbols = media.chatObjectKey("u-1", "???.png");
  assert(symbols.includes("/tep-"), `tên toàn ký tự lạ phải rơi về "tep", đang là ${symbols}`);
  assert(symbols.endsWith(".png"), "vẫn giữ đuôi khi phần tên bị thay");

  // Điều PHẢI giữ là số tầng: một dấu `/` lọt vào userId sẽ đẻ thêm thư mục giữa chat/ và
  // tên file, và từ đó object của người này rơi vào vùng tên của người khác.
  const nastyUser = media.chatObjectKey("../../etc", "a.png");
  assert(nastyUser.split("/").length === 3, `key phải đúng 3 tầng, đang là ${nastyUser}`);
  assert(!nastyUser.includes(".."), `userId phải được rửa sạch, đang là ${nastyUser}`);
  assert(media.chatObjectKey("", "a.png").includes("/an-danh/"), "userId rỗng phải có đường lui");
  console.log("✔ Đặt tên: đuôi ở cuối, tên gốc còn nhận ra, không đụng nhau, tên lạ có đường lui.");

  // ---- URL công khai ---------------------------------------------------------------
  const url = media.publicUrlOf("chat/u-1/ảnh.png");
  assert(
    url.startsWith(`https://objectstorage.${FAKE.OCI_REGION}.oraclecloud.com/n/${FAKE.OCI_NAMESPACE}/b/${FAKE.OCI_BUCKET}/o/`),
    `URL sai hình dạng: ${url}`,
  );
  assert(url.includes("/o/chat/u-1/"), `dấu / phân cấp phải giữ nguyên, không bị mã hoá: ${url}`);
  assert(!url.includes("ảnh"), `chữ có dấu phải được mã hoá phần trăm: ${url}`);
  assert(new URL(url).pathname.endsWith("/o/chat/u-1/" + encodeURIComponent("ảnh.png")), `mã hoá sai: ${url}`);
  console.log("✔ URL công khai: đúng dạng gốc OCI, phân cấp giữ nguyên, chữ có dấu được mã hoá.");

  // ---- Sửa URL: phần thuần ---------------------------------------------------------
  const OLD_HOST = "https://5ymcwsef8dszpta0.public.blob.vercel-storage.com";
  const mapping = new Map<string, string>([
    ["chat/u-1/anh-abc.png", "https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/ns/b/bk/o/chat/u-1/anh-abc.png"],
    ["chat/u-1/ảnh-xyz.png", "https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/ns/b/bk/o/chat/u-1/%E1%BA%A3nh-xyz.png"],
  ]);

  assert(rewriteAttachmentUrl(`${OLD_HOST}/chat/u-1/anh-abc.png`, mapping) !== null, "URL kho cũ phải được sửa");
  assert(
    rewriteAttachmentUrl(`${OLD_HOST}/chat/u-1/anh-abc.png?download=1`, mapping) !== null,
    "downloadUrl (có query) cũng trỏ vào cùng object nên cũng phải sửa",
  );
  assert(
    rewriteAttachmentUrl(`${OLD_HOST}/chat/u-1/${encodeURIComponent("ảnh-xyz.png")}`, mapping) !== null,
    "tên có dấu nằm trong URL ở dạng phần trăm — phải giải mã rồi mới so",
  );
  assert(rewriteAttachmentUrl(`${OLD_HOST}/chat/u-1/khong-co.png`, mapping) === null, "object lạ thì để yên");
  assert(rewriteAttachmentUrl("https://example.com/chat/u-1/anh-abc.png", mapping) === null, "host lạ thì để yên");
  assert(rewriteAttachmentUrl("khong-phai-url", mapping) === null, "chuỗi không phải URL thì để yên");
  assert(
    rewriteAttachmentUrl(mapping.get("chat/u-1/anh-abc.png")!, mapping) === null,
    "URL ĐÃ sửa rồi thì lần chạy sau phải để yên — đó là điều kiện để chạy lại được",
  );
  console.log("✔ Sửa URL (thuần): bắt đúng kho cũ, bỏ qua host lạ, chịu được query và chữ có dấu.");

  // ---- Sửa URL: trên mongod thật ---------------------------------------------------
  mongod = await MongoMemoryServer.create();
  mongo = new MongoClient(mongod.getUri());
  await mongo.connect();
  const messages = mongo.db(`jarvis_media_test_${Date.now()}`).collection("chat_messages");

  await messages.insertMany([
    {
      _id: "m-1",
      attachments: [
        { url: `${OLD_HOST}/chat/u-1/anh-abc.png`, name: "anh.png", size: 10, type: "image/png" },
        { url: "https://example.com/ngoai.png", name: "ngoai.png", size: 10, type: "image/png" },
      ],
    },
    { _id: "m-2", attachments: [{ url: `${OLD_HOST}/chat/u-1/ảnh-xyz.png`, name: "ảnh.png", size: 10, type: "image/png" }] },
    { _id: "m-3", attachments: [] },
  ] as never);

  const dry = await rewriteMessages(messages as never, mapping, true);
  assert(dry.scanned === 2, `chỉ quét tin CÓ đính kèm, phải là 2, đang là ${dry.scanned}`);
  assert(dry.urlsChanged === 2, `phải đếm 2 URL cần sửa, đang là ${dry.urlsChanged}`);
  const untouched = await messages.findOne({ _id: "m-1" } as never);
  assert(
    (untouched as never as { attachments: { url: string }[] }).attachments[0].url.includes("vercel-storage"),
    "THỬ KHÔNG GHI mà đã ghi thì cả cơ chế dry-run là vô nghĩa",
  );

  const applied = await rewriteMessages(messages as never, mapping, false);
  assert(applied.urlsChanged === 2 && applied.rewritten === 2, "chạy thật phải sửa đúng 2 URL trong 2 tin");

  const m1 = (await messages.findOne({ _id: "m-1" } as never)) as never as { attachments: { url: string }[] };
  assert(m1.attachments[0].url === mapping.get("chat/u-1/anh-abc.png"), "đính kèm của kho cũ phải trỏ sang kho mới");
  assert(m1.attachments[1].url === "https://example.com/ngoai.png", "đính kèm ngoài phải còn NGUYÊN VẸN");

  const again = await rewriteMessages(messages as never, mapping, false);
  assert(again.urlsChanged === 0, `chạy lại phải không đổi gì nữa, đang đổi ${again.urlsChanged}`);
  console.log("✔ Sửa URL (mongod thật): dry-run không ghi, link ngoài không bị đụng, chạy lại là bất biến.");

  // ---- Vòng đời thật trên OCI ------------------------------------------------------
  if (!hasRealConfig) {
    console.log("");
    console.log("⚠ BỎ QUA vòng đời thật: chưa có bộ biến OCI_*. Những gì trên đây KHÔNG chứng minh");
    console.log("  rằng kho thật nhận được một byte nào. Đặt OCI_* rồi chạy lại để có phần đó.");
  } else {
    media.closeMediaStore();
    restoreEnv();

    const prefix = process.env.MEDIA_TEST_PREFIX?.trim() || "verify";
    const stamp = `${Date.now()}`;
    const payload = new Uint8Array(Buffer.from(`kiểm chứng tàng khố media ${stamp}`, "utf8"));

    const stored = await media.putChatFile({
      userId: `${prefix}-${stamp}`,
      fileName: "kiểm chứng.txt",
      contentType: "text/plain; charset=utf-8",
      body: payload,
    });
    created.push(stored.key);

    const stat = await media.statObject(stored.key);
    assert(stat !== null, "vừa tải lên xong thì HEAD phải thấy object");
    assert(stat!.size === payload.byteLength, `kích thước phải khớp: khai ${payload.byteLength}, kho báo ${stat!.size}`);

    // Đây mới là phép thử thật sự: một trình duyệt bất kỳ, KHÔNG mang chữ ký nào, phải tải
    // được đúng bytes ấy về. Bucket không công khai thì chính chỗ này sẽ đỏ.
    const fetched = await fetch(stored.url);
    assert(fetched.ok, `tải công khai phải được, đang là HTTP ${fetched.status} ${fetched.statusText}`);
    const back = new Uint8Array(await fetched.arrayBuffer());
    assert(Buffer.compare(Buffer.from(back), Buffer.from(payload)) === 0, "bytes tải về phải khớp từng byte");
    assert(
      (fetched.headers.get("content-type") ?? "").startsWith("text/plain"),
      `kiểu nội dung phải được giữ, đang là ${fetched.headers.get("content-type")}`,
    );
    assert(
      (fetched.headers.get("cache-control") ?? "").includes("max-age=2592000"),
      `cache-control phải được giữ, đang là ${fetched.headers.get("cache-control")}`,
    );

    await media.deleteObject(stored.key);
    created.pop();
    assert((await media.statObject(stored.key)) === null, "xoá rồi thì HEAD phải trả về null, không phải ném");

    console.log(`✔ Vòng đời thật trên OCI (${process.env.OCI_BUCKET}): tải lên → tải công khai đúng byte → xoá sạch.`);
  }

  console.log("");
  console.log(hasRealConfig ? "TẤT CẢ XANH — gồm cả vòng đời thật trên OCI." : "XANH phần không cần mạng.");
} finally {
  // Dọn dấu vết kể cả khi ở giữa có phép thử ném — một object thử sót lại trong kho thật là
  // rác vĩnh viễn, vì không ai biết nó từ đâu ra.
  for (const key of created) {
    await media.deleteObject(key).catch((err) => console.error(`  (không xoá được ${key}: ${err})`));
  }
  media.closeMediaStore();
  await mongo?.close().catch(() => {});
  await mongod?.stop().catch(() => {});
}
