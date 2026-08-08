#!/usr/bin/env node
/**
 * Kiểm chứng nút thanh tẩy sảnh đàm đạo — cả hai kho, chạy thật.
 *
 * Ba tầng, tầng nào chạy được ở đâu thì nói rõ ở đó:
 *   1. Câu xác nhận — thuần, chạy ở mọi máy.
 *   2. Xoá tin trên một mongod THẬT (mongodb-memory-server, trong tiến trình) — chạy ở mọi máy.
 *   3. Quét bytes trên OCI THẬT — chỉ khi có đủ bộ biến OCI_*, và KHÔNG BAO GIỜ chạm vào tiền
 *      tố `chat/` của kho thật: phép thử tự dựng một tiền tố tạm mang dấu thời gian rồi quét
 *      chính nó. Ai muốn soi luôn cả `purgeChatMedia()` (thứ đi thẳng vào `chat/`) thì đặt
 *      `CHAT_PURGE_TEST_BUCKET` trỏ sang một bucket bỏ đi.
 *
 * Vì sao phải có: đây là hành động DUY NHẤT của cả hệ thống không có đường lui. Một phép quét
 * lỡ tay rộng hơn ý định — sai một dấu `/` trong tiền tố — sẽ không báo lỗi gì cả, nó chỉ xoá
 * nhiều hơn mức đáng xoá rồi báo thành công.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const OCI_KEYS = ["OCI_REGION", "OCI_NAMESPACE", "OCI_BUCKET", "OCI_ACCESS_KEY_ID", "OCI_SECRET_ACCESS_KEY"] as const;
const hasRealMedia = OCI_KEYS.every((key) => (process.env[key] ?? "").trim().length > 0);
const testBucket = process.env.CHAT_PURGE_TEST_BUCKET?.trim() ?? "";

// ---- 1. Câu xác nhận ----------------------------------------------------------------
const { CHAT_PURGE_PHRASE, matchesChatPurgePhrase } = await import("../src/lib/validation/chat.ts");

assert(matchesChatPurgePhrase(CHAT_PURGE_PHRASE), "câu chuẩn phải khớp với chính nó");
assert(matchesChatPurgePhrase("xoa het"), "chữ thường phải khớp — hàng rào này chặn tay nhầm, không bắt lỗi chính tả");
assert(matchesChatPurgePhrase("  XOA   HET  "), "khoảng trắng thừa phải được bỏ qua");
assert(!matchesChatPurgePhrase(""), "ô trống KHÔNG được mở khoá — đó là hình dạng của một cú POST trống");
assert(!matchesChatPurgePhrase("XOAHET"), "thiếu dấu cách là một câu khác");
assert(!matchesChatPurgePhrase("XOA HET HET"), "thừa chữ là một câu khác");
assert(!matchesChatPurgePhrase("XOA_HET"), "gạch dưới không phải khoảng trắng");
console.log("✔ Câu xác nhận: rộng tay với hoa/thường và khoảng trắng, chặt với mọi thứ còn lại.");

// ---- 2. Xoá tin trên mongod thật ----------------------------------------------------
const mongod = await MongoMemoryServer.create();
const mongoUri = mongod.getUri();
const mongoDb = `jarvis_purge_test_${Date.now()}`;

// Đặt TRƯỚC khi nạp chat.ts: module đọc biến môi trường lúc gọi, nhưng đặt sớm thì không có
// đường nào một phép thử chạm nhầm kho khác.
process.env.MONGODB_URI = mongoUri;
process.env.MONGODB_DB = mongoDb;

const chat = await import("../src/lib/services/chat.ts");
const media = await import("../src/lib/services/media.ts");

const client = new MongoClient(mongoUri);
/** Object thật đã tạo trong kho thật — dọn bằng tay ở `finally`, kể cả khi giữa chừng có phép ném. */
const created: string[] = [];

try {
  await client.connect();
  const db = client.db(mongoDb);
  const messages = db.collection("chat_messages");
  const typing = db.collection("chat_typing");

  const anh = { id: "u-anh", name: "Đạo hữu A", isAdmin: false, tags: [] as string[] };
  const bang = { id: "u-bang", name: "Đạo hữu B", isAdmin: true, tags: [] as string[] };

  assert((await chat.sendMessage(anh, { text: "tin thứ nhất" })).ok, "gửi tin phải được");
  assert((await chat.sendMessage(bang, { text: "tin thứ hai" })).ok, "gửi tin phải được");
  assert(
    (
      await chat.sendMessage(anh, {
        text: "tin có ảnh",
        attachments: [
          { url: "https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/n/b/b/o/chat/u-anh/a-x.png", name: "a.png", size: 12, type: "image/png" },
        ],
      })
    ).ok,
    "gửi tin kèm ảnh phải được",
  );

  // Một tin ĐÃ THU HỒI: nó nằm lại dưới dạng document mang cờ `deleted`, và thanh tẩy phải
  // cuốn nốt nó đi — "toàn bộ" mà chừa lại mấy cái xác thì không phải toàn bộ.
  const feedBefore = await chat.getFeed({ viewerId: anh.id });
  assert(!feedBefore.storeClosed, "kho đã cấu hình thì không được báo storeClosed");
  if (feedBefore.storeClosed) throw new Error("unreachable");
  assert((await chat.deleteMessage(anh, feedBefore.messages[0].id)).ok, "chủ tin phải thu hồi được tin của mình");

  await chat.markTyping(anh, true);
  await chat.markTyping(bang, true);

  const countBefore = await messages.countDocuments({});
  assert(countBefore === 3, `phải có đúng 3 tin trước khi thanh tẩy, đang có ${countBefore}`);
  assert((await typing.countDocuments({})) === 2, "phải có 2 dòng đang-gõ trước khi thanh tẩy");

  const wiped = await chat.purgeAllChat();
  assert(!wiped.storeClosed, "kho đang mở thì thanh tẩy không được báo storeClosed");
  if (wiped.storeClosed) throw new Error("unreachable");
  assert(wiped.messages === 3, `phải báo xoá đúng 3 tin, đang báo ${wiped.messages}`);
  assert((await messages.countDocuments({})) === 0, "tàng thư phải trống thật, không chỉ trống trên lời báo");
  assert((await typing.countDocuments({})) === 0, "dòng đang-gõ phải bị dọn theo");

  const feedAfter = await chat.getFeed({ viewerId: anh.id });
  assert(!feedAfter.storeClosed, "thanh tẩy xong kho vẫn phải mở");
  if (feedAfter.storeClosed) throw new Error("unreachable");
  assert(feedAfter.messages.length === 0, "sảnh phải trắng tinh sau khi thanh tẩy");

  // Sảnh phải DÙNG ĐƯỢC ngay sau đó: thanh tẩy là dọn nhà, không phải đóng cửa.
  assert((await chat.sendMessage(anh, { text: "sảnh mở lại" })).ok, "gửi tin sau khi thanh tẩy phải được");
  const feedReopened = await chat.getFeed({ viewerId: anh.id });
  if (feedReopened.storeClosed) throw new Error("unreachable");
  assert(feedReopened.messages.length === 1, "tin gửi sau khi thanh tẩy phải hiện ra bình thường");

  const again = await chat.purgeAllChat();
  if (again.storeClosed) throw new Error("unreachable");
  assert(again.messages === 1, `chạy lại phải xoá nốt tin mới, đang báo ${again.messages}`);
  const third = await chat.purgeAllChat();
  if (third.storeClosed) throw new Error("unreachable");
  assert(third.messages === 0, "thanh tẩy một sảnh đã trống phải là 0, không phải một lỗi");
  console.log("✔ Tàng thư: xoá sạch cả tin thường, tin có ảnh lẫn tin đã thu hồi; dọn cả dòng đang-gõ; chạy lại vẫn yên.");

  // ---- Kho chưa khai mở -------------------------------------------------------------
  await chat.closeChatStore();
  delete process.env.MONGODB_URI;
  delete process.env.MONGODB_URL;
  const closed = await chat.purgeAllChat();
  assert(closed.storeClosed === true, "chưa cấu hình Mongo thì phải báo storeClosed, không được ném");
  process.env.MONGODB_URI = mongoUri;
  console.log("✔ Kho chưa khai mở: thanh tẩy trả lời tử tế thay vì ném — trang Tông Môn vẫn dùng được.");

  // ---- 3. Quét bytes trên OCI thật --------------------------------------------------
  assert(
    (await media.purgeObjectsUnder("").catch((err: unknown) => err)) instanceof Error,
    "tiền tố rỗng PHẢI ném — nó có nghĩa là quét sạch cả bucket",
  );
  assert(
    (await media.purgeObjectsUnder("   ").catch((err: unknown) => err)) instanceof Error,
    "tiền tố toàn khoảng trắng cũng là tiền tố rỗng",
  );
  assert(
    (await media.purgeObjectsUnder("chat/", 0).catch((err: unknown) => err)) instanceof Error,
    "pageSize=0 PHẢI ném — trang rỗng kèm token đi tiếp là một vòng lặp không lối ra",
  );
  assert(
    (await media.purgeObjectsUnder("chat/", 1.5).catch((err: unknown) => err)) instanceof Error,
    "pageSize không nguyên cũng phải bị chặn",
  );
  console.log("✔ Tiền tố rỗng và pageSize bậy bị chặn ở cửa — không đường nào quét nhầm cả bucket.");

  // ---- Lời báo cho trưởng môn -------------------------------------------------------
  assert(media.humanBytes(0) === "0 B", `0 byte phải đọc là「0 B」, đang là「${media.humanBytes(0)}」`);
  assert(media.humanBytes(512) === "512 B", "dưới 1KB thì giữ nguyên số byte, không có phần lẻ");
  assert(media.humanBytes(1024) === "1.0 KB", `1024 phải nhảy đơn vị, đang là「${media.humanBytes(1024)}」`);
  assert(media.humanBytes(1536) === "1.5 KB", "phần lẻ phải hiện ra, nếu không thì 1.5KB và 1KB đọc như nhau");
  assert(media.humanBytes(5 * 1024 ** 4) === "5.0 TB", "phải dừng ở TB thay vì tràn khỏi bảng đơn vị");

  const shape = { deleted: 3, failed: 0, bytes: 3072, pages: 1, firstError: null } as const;
  assert(media.describeSweep({ storeClosed: true }).includes("chưa khai mở"), "kho đóng phải nói ra là kho đóng");
  assert(
    media.describeSweep({ ...shape, deleted: 0, bytes: 0 }).includes("không còn tệp"),
    "quét xong mà không có gì thì đừng báo con số 0 như một thành tích",
  );
  assert(media.describeSweep(shape).includes("Quét 3 tệp"), "quét trót lọt phải kể đúng số tệp");
  assert(!media.describeSweep(shape).includes("NHƯNG"), "quét trót lọt thì KHÔNG được kèm lời cảnh báo nào");

  const partial = media.describeSweep({ ...shape, failed: 2 });
  assert(partial.includes("2 tệp xoá không được") && partial.includes("Bấm lại"), "xoá trượt phải kể ra và chỉ đường");

  // Đây là ca đã từng viết sai: trần số trang đặt `firstError` mà KHÔNG có tệp nào trượt.
  const truncated = media.describeSweep({ ...shape, firstError: "trần 1000 trang" });
  assert(!truncated.includes("0 tệp xoá không được"), "0 tệp trượt thì đừng bịa ra câu「0 tệp xoá không được」");
  assert(truncated.includes("trần 1000 trang"), "lý do thật phải nằm trong lời báo, không được bị nuốt");
  console.log("✔ Lời báo: đơn vị dung lượng đúng, và ba kiểu trục trặc kể ra ba câu khác nhau.");

  if (!hasRealMedia) {
    console.log("");
    console.log("⚠ BỎ QUA phép quét trên kho thật: chưa có bộ biến OCI_*. Những gì trên đây KHÔNG");
    console.log("  chứng minh rằng OCI xoá thật một object nào, cũng không chứng minh đường phân");
    console.log("  trang chạy được. Đặt OCI_* rồi chạy lại để có phần đó.");
  } else {
    const stamp = Date.now();
    const sweptPrefix = `verify-purge-${stamp}/`;
    const keptPrefix = `verify-keep-${stamp}/`;
    const payload = new Uint8Array(Buffer.from(`kiểm chứng thanh tẩy ${stamp}`, "utf8"));

    const sweptKeys = [0, 1, 2].map((i) => `${sweptPrefix}tep-${i}.txt`);
    const keptKey = `${keptPrefix}dung-dung-vao.txt`;
    for (const key of [...sweptKeys, keptKey]) {
      await media.putObjectAt(key, payload, "text/plain; charset=utf-8");
      created.push(key);
    }

    // `pageSize: 1` ép ĐƯỜNG PHÂN TRANG chạy thật với ba object thay vì phải dựng đủ một
    // nghìn. Nếu OCI làm ngơ `MaxKeys` thì `pages` sẽ về 1 và phép thử dưới đây đỏ — đúng ý,
    // vì khi ấy đường phân trang của web vẫn chưa từng được ai chạy qua.
    const sweep = await media.purgeObjectsUnder(sweptPrefix, 1);
    assert(!sweep.storeClosed, "đủ biến OCI thì không được báo storeClosed");
    if (sweep.storeClosed) throw new Error("unreachable");

    assert(sweep.failed === 0, `không được có lệnh xoá trượt, đang trượt ${sweep.failed}: ${sweep.firstError}`);
    assert(sweep.firstError === null, `không được có lỗi nào, đang có: ${sweep.firstError}`);
    assert(sweep.deleted === sweptKeys.length, `phải xoá đúng ${sweptKeys.length} object, đang là ${sweep.deleted}`);
    assert(
      sweep.bytes === payload.byteLength * sweptKeys.length,
      `dung lượng phải cộng đúng: chờ ${payload.byteLength * sweptKeys.length}, nhận ${sweep.bytes}`,
    );
    assert(sweep.pages >= sweptKeys.length, `MaxKeys=1 phải chia thành ≥${sweptKeys.length} trang, đang là ${sweep.pages}`);

    for (const key of sweptKeys) {
      assert((await media.statObject(key)) === null, `object ${key} phải biến mất thật khỏi kho`);
      created.splice(created.indexOf(key), 1);
    }
    // Đây là phép thử QUAN TRỌNG NHẤT của cả tệp: một phép quét rộng hơn ý định sẽ không báo
    // lỗi gì cả, nó chỉ lặng lẽ xoá nhiều hơn mức đáng xoá rồi báo thành công.
    assert((await media.statObject(keptKey)) !== null, "object NGOÀI tiền tố phải còn nguyên — nếu không thì phép quét đã tràn");

    const emptySweep = await media.purgeObjectsUnder(`${sweptPrefix}khong-co-gi/`);
    if (emptySweep.storeClosed) throw new Error("unreachable");
    assert(emptySweep.deleted === 0 && emptySweep.failed === 0, "quét một tiền tố trống phải là 0/0, không phải một lỗi");
    assert(emptySweep.pages === 1, `tiền tố trống vẫn phải đi đúng 1 lượt liệt kê, đang là ${emptySweep.pages}`);

    console.log(
      `✔ Tàng khố (${process.env.OCI_BUCKET}): xoá đúng ${sweep.deleted} object qua ${sweep.pages} trang, ` +
        "cộng đúng dung lượng, KHÔNG chạm object ngoài tiền tố, tiền tố trống không thành lỗi.",
    );

    // ---- purgeChatMedia() trên một bucket bỏ đi --------------------------------------
    if (!testBucket) {
      console.log("");
      console.log("⚠ BỎ QUA phép thử `purgeChatMedia()`: nó đi thẳng vào tiền tố `chat/` của kho ĐANG");
      console.log("  DÙNG, nên chạy nó ở đây là xoá ảnh thật của tông môn. Phần đã kiểm ở trên là chính");
      console.log("  bộ máy quét mà nó gọi; phần chưa kiểm chỉ còn đúng một dòng — tiền tố nó truyền vào.");
      console.log("  Muốn kiểm nốt: đặt CHAT_PURGE_TEST_BUCKET trỏ sang một bucket bỏ đi rồi chạy lại.");
    } else {
      const realBucket = process.env.OCI_BUCKET;
      media.closeMediaStore();
      process.env.OCI_BUCKET = testBucket;
      try {
        const chatKey = media.chatObjectKey("u-kiem-chung", "anh.png");
        const outsideKey = `${keptPrefix}ngoai-chat.txt`;
        await media.putObjectAt(chatKey, payload, "image/png");
        await media.putObjectAt(outsideKey, payload, "text/plain; charset=utf-8");

        const chatSweep = await media.purgeChatMedia();
        if (chatSweep.storeClosed) throw new Error("unreachable");
        assert(chatSweep.deleted >= 1, `phải xoá ít nhất object vừa đặt dưới chat/, đang là ${chatSweep.deleted}`);
        assert((await media.statObject(chatKey)) === null, "object dưới chat/ phải biến mất");
        assert((await media.statObject(outsideKey)) !== null, "object NGOÀI chat/ phải còn nguyên");

        await media.deleteObject(outsideKey);
        console.log(`✔ purgeChatMedia() trên bucket thử (${testBucket}): quét đúng tiền tố chat/, không lan ra ngoài.`);
      } finally {
        media.closeMediaStore();
        process.env.OCI_BUCKET = realBucket;
      }
    }
  }

  console.log("");
  console.log(hasRealMedia ? "TẤT CẢ XANH — gồm cả phép quét thật trên OCI." : "XANH phần không cần tới OCI.");
} finally {
  // Object thử sót lại trong kho thật là rác vĩnh viễn — không ai biết nó từ đâu ra.
  for (const key of created) {
    await media.deleteObject(key).catch((err: unknown) => console.error(`  (không xoá được ${key}: ${err})`));
  }
  media.closeMediaStore();
  // Pool của chat.ts cố ý sống qua các request trên web, nên trong script nó giữ event loop
  // và tiến trình không bao giờ thoát nếu không đóng bằng tay.
  await chat.closeChatStore();
  await client.close().catch(() => {});
  await mongod.stop().catch(() => {});
}
