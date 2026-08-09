#!/usr/bin/env node
/**
 * Kiểm chứng tàng thư đàm đạo trên MongoDB — trọn vòng đời, trên một mongod THẬT.
 *
 * Mặc định tự bật `mongodb-memory-server` (một mongod thật chạy trong tiến trình), nên phép
 * thử này chạy được ở mọi máy mà không cần Atlas và không đụng vào kho production. Muốn
 * chĩa vào kho thật thì đặt `CHAT_TEST_MONGODB_URI` — hữu ích để soi một Atlas vừa dựng.
 *
 * Vì sao phải có: `chat.ts` là nơi DUY NHẤT của hệ thống nói chuyện với Mongo, và trước bản
 * này nó không có lấy một phép thử nào — mọi thứ chỉ được bảo chứng bằng việc "đọc thấy
 * đúng". Đổi cả kho lưu trữ mà không có một vòng đời chạy thật thì không có gì để tin.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { loadEnv } from "./loadEnv.mjs";

// Hạn lưu đọc từ app_settings (Postgres) như lúc chạy thật, nên cần DATABASE_URL.
loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let mongod: MongoMemoryServer | null = null;
let uri = process.env.CHAT_TEST_MONGODB_URI?.trim() ?? "";

if (!uri) {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
  console.log("• mongod trong tiến trình đã lên.");
} else {
  console.log("• dùng kho thật từ CHAT_TEST_MONGODB_URI.");
}

// Kho riêng cho lần chạy này, và ĐẶT TRƯỚC khi nạp chat.ts: module đọc biến môi trường lúc
// gọi, nhưng đặt sớm thì không có đường nào một phép thử chạm nhầm kho khác.
process.env.MONGODB_URI = uri;
process.env.MONGODB_DB = `jarvis_chat_test_${Date.now()}`;

const chat = await import("../src/lib/services/chat.ts");
const { getAppSettings } = await import("../src/lib/services/settings.ts");

// Hạn lưu KHÔNG bị stub: `purgeExpiredChat` đọc app_settings lúc chạy, nên phép thử đọc
// đúng con số ấy rồi dựng dữ liệu quanh nó. Stub đi thì phép thử sẽ bỏ sót chính đoạn nối
// giữa hai kho — Postgres giữ cấu hình, Mongo giữ tin.
const RETENTION_DAYS = (await getAppSettings()).chat.retentionDays;
console.log(`• hạn lưu đang cấu hình: ${RETENTION_DAYS} ngày.`);

const admin = { id: "u-admin", name: "Trưởng môn", isAdmin: true, tags: [] as string[] };
const member = { id: "u-member", name: "Đạo hữu", isAdmin: false, tags: ["Luyện đan"] };
const client = new MongoClient(uri);

try {
  assert(chat.chatStoreReady(), "có URI thì kho phải báo sẵn sàng");

  // ---- Gửi và đọc ------------------------------------------------------------------
  assert((await chat.sendMessage(member, { text: "xin chào tông môn" })).ok, "gửi tin thường phải được");
  assert(!(await chat.sendMessage(member, { text: "   " })).ok, "tin trắng phải bị từ chối");
  assert(!(await chat.sendMessage(member, { text: "x".repeat(5000) })).ok, "tin quá dài phải bị từ chối");

  let feed = await chat.getFeed({ viewerId: admin.id });
  assert(!feed.storeClosed, "kho đã cấu hình thì không được báo storeClosed");
  if (feed.storeClosed) throw new Error("unreachable");
  assert(feed.messages.length === 1, `phải có đúng 1 tin, có ${feed.messages.length}`);
  const first = feed.messages[0];
  assert(first.text === "xin chào tông môn", "nội dung phải nguyên vẹn");
  assert(first.author === "Đạo hữu", "tên người gửi phải đóng băng trong tin");
  assert(
    first.tags.length === 1 && first.tags[0] === "Luyện đan",
    "tag trang trí phải ĐÓNG BĂNG vào tin lúc gửi, y như tên",
  );
  console.log("✔ Gửi/đọc: tin vào kho nguyên vẹn (kèm tag đóng băng), tin rỗng và tin quá dài bị chặn.");

  // ---- Lược đồ URL của đính kèm (chặn XSS lưu trữ) --------------------------------
  /**
   * `z.string().url()` NHẬN `javascript:` và `data:text/html` — đo được, không phải phòng xa.
   * Mà bong bóng tin vẽ đính kèm thành `<a href>`, nên một URL như thế là mã chạy trên chính
   * tên miền của tông môn, trong trình duyệt của người bấm vào. Cửa ghi phải đóng lại.
   */
  const withUrl = (url: string) => ({
    text: "",
    attachments: [{ url, name: "x", size: 1, type: "image/png" }],
  });

  for (const nasty of [
    "javascript:alert(document.domain)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://khong-ma-hoa.example/anh.png",
    "file:///etc/passwd",
  ]) {
    const sent = await chat.sendMessage(member, withUrl(nasty));
    assert(!sent.ok, `đính kèm「${nasty.slice(0, 32)}」PHẢI bị từ chối lúc ghi`);
  }

  assert(
    (await chat.sendMessage(member, withUrl("https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/a/b/c/o/anh.png"))).ok,
    "đính kèm https thật thì vẫn phải gửi được",
  );
  assert(
    (await chat.sendMessage(member, withUrl("https://media3.giphy.com/media/abc/giphy.gif"))).ok,
    "GIF của GIPHY cũng là https nên phải qua",
  );

  const afterUrls = await chat.getFeed({ viewerId: admin.id });
  if (afterUrls.storeClosed) throw new Error("unreachable");
  assert(
    afterUrls.messages.length === 3,
    `chỉ hai tin https được vào (cộng tin chào), đang có ${afterUrls.messages.length}`,
  );
  console.log("✔ Đính kèm: javascript:/data:/vbscript:/file:/http đều bị chặn lúc ghi; https thì qua.");

  // ---- Cảm xúc: bật, tắt, và đếm theo người --------------------------------------
  assert((await chat.toggleReaction(member.id, first.id, "👍")).ok, "thả cảm xúc phải được");
  assert((await chat.toggleReaction(admin.id, first.id, "👍")).ok, "người thứ hai thả cùng emoji phải được");
  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  let react = feed.messages[0].reactions.find((r) => r.emoji === "👍");
  assert(react?.count === 2, `phải đếm 2 người, đếm ${react?.count}`);
  assert(react?.mine === true, "người xem đã thả thì phải thấy mine=true");

  // Bấm lại = rút. Đây là chỗ bản Redis phải ghép chuỗi bằng ký tự phân cách tự chế.
  assert((await chat.toggleReaction(member.id, first.id, "👍")).ok, "bấm lại phải rút được");
  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  react = feed.messages[0].reactions.find((r) => r.emoji === "👍");
  assert(react?.count === 1 && react.mine === false, `rút xong phải còn 1 và mine=false, có ${JSON.stringify(react)}`);

  // Thả hai lần liên tiếp KHÔNG được đếm thành hai — $addToSet gác chuyện đó.
  await chat.toggleReaction(member.id, first.id, "🔥");
  await chat.toggleReaction(member.id, first.id, "🔥");
  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  assert(
    !feed.messages[0].reactions.some((r) => r.emoji === "🔥"),
    "thả rồi bấm lại lần nữa là rút — không được còn sót",
  );
  console.log("✔ Cảm xúc: đếm theo người, bấm lại là rút, không nhân đôi.");

  // ---- Sửa tin: chỉ chủ nhân -----------------------------------------------------
  assert(!(await chat.editMessage(admin.id, first.id, "cướp tin")).ok, "người khác KHÔNG được sửa tin");
  assert((await chat.editMessage(member.id, first.id, "đã sửa")).ok, "chủ nhân phải sửa được");
  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  assert(feed.messages[0].text === "đã sửa", "nội dung mới phải hiện");
  assert(feed.messages[0].editedAt !== null, "tin đã sửa phải mang dấu editedAt");
  console.log("✔ Sửa tin: chỉ chủ nhân, và có dấu vết đã sửa.");

  // ---- Trả lời: trích đoạn lấy được cả khi tin gốc NGOÀI trang ---------------------
  const replyBody = { text: "trả lời nhé", replyTo: first.id };
  assert((await chat.sendMessage(admin, replyBody)).ok, "gửi tin trả lời phải được");
  feed = await chat.getFeed({ viewerId: admin.id });
  if (feed.storeClosed) throw new Error("unreachable");
  const reply = feed.messages.find((m) => m.text === "trả lời nhé");
  assert(reply?.replyTo?.excerpt === "đã sửa", `trích đoạn phải theo nội dung MỚI, có ${reply?.replyTo?.excerpt}`);
  console.log("✔ Trả lời: trích đoạn đọc từ tin gốc, theo nội dung mới nhất.");

  // ---- Thu hồi: giữ vết, lột nội dung, cuốn theo cảm xúc --------------------------
  await chat.toggleReaction(admin.id, first.id, "😀");
  assert(!(await chat.deleteMessage({ id: "u-la" }, first.id)).ok, "người lạ không được thu hồi");
  assert((await chat.deleteMessage({ id: member.id }, first.id)).ok, "chủ nhân phải thu hồi được");
  feed = await chat.getFeed({ viewerId: admin.id });
  if (feed.storeClosed) throw new Error("unreachable");
  const gone = feed.messages.find((m) => m.id === first.id);
  assert(gone?.deleted === true, "tin phải còn đó với cờ deleted");
  assert(gone?.text === "" && gone.reactions.length === 0, "nội dung và cảm xúc phải bị lột sạch");
  const replyAfter = feed.messages.find((m) => m.text === "trả lời nhé");
  assert(replyAfter?.replyTo?.excerpt === "(tin đã thu hồi)", "trích đoạn phải nói tin đã thu hồi");
  assert(!(await chat.editMessage(member.id, first.id, "hồi sinh")).ok, "tin đã thu hồi thì không sửa được nữa");
  console.log("✔ Thu hồi: giữ vết, lột nội dung + cảm xúc, tin trả lời biết tin gốc đã mất.");

  // ĐẢO CHIỀU 08/08/2026: trước đây admin thu hồi ĐƯỢC tin người khác và có phép thử bảo
  // chứng điều đó như một tính năng. Đó là lỗ hổng: "thu hồi" nghĩa là TÔI rút lời TÔI —
  // để người khác rút được lời của bạn thì lịch sử đàm đạo thành thứ ai cầm quyền nấy viết
  // lại. Giờ phép thử gác chiều ngược: admin KHÔNG thu hồi được tin không phải của mình.
  await chat.sendMessage(member, { text: "tin admin không được đụng" });
  feed = await chat.getFeed({ viewerId: admin.id });
  if (feed.storeClosed) throw new Error("unreachable");
  const victim = feed.messages.find((m) => m.text === "tin admin không được đụng");
  assert(victim, "phải tìm được tin vừa gửi");
  assert(
    !(await chat.deleteMessage({ id: admin.id }, victim!.id)).ok,
    "admin KHÔNG được thu hồi tin người khác — quyền ấy đã bị bãi bỏ, kể cả Gia chủ",
  );
  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  const survivor = feed.messages.find((m) => m.id === victim!.id);
  assert(survivor && !survivor.deleted && survivor.text === "tin admin không được đụng",
    "tin phải còn NGUYÊN VẸN sau cú thu hồi hụt của admin");
  console.log("✔ Thu hồi chỉ dành cho chủ tin — admin bị từ chối và tin còn nguyên.");

  // ---- Đang gõ -------------------------------------------------------------------
  await chat.markTyping({ id: member.id, name: "Đạo hữu" }, true);
  feed = await chat.getFeed({ viewerId: admin.id });
  if (feed.storeClosed) throw new Error("unreachable");
  assert(feed.typing.includes("Đạo hữu"), `người khác đang gõ phải hiện, có ${JSON.stringify(feed.typing)}`);

  feed = await chat.getFeed({ viewerId: member.id });
  if (feed.storeClosed) throw new Error("unreachable");
  assert(!feed.typing.includes("Đạo hữu"), "KHÔNG được kể chính người xem đang gõ");

  await chat.markTyping({ id: member.id, name: "Đạo hữu" }, false);
  feed = await chat.getFeed({ viewerId: admin.id });
  if (feed.storeClosed) throw new Error("unreachable");
  assert(feed.typing.length === 0, "buông phím là biến mất khỏi danh sách");

  // Mỗi người ĐÚNG một dòng dù gõ bao nhiêu nhịp — `_id` = userId chặn phình.
  await client.connect();
  const typingCol = client.db(process.env.MONGODB_DB!).collection("chat_typing");
  for (let i = 0; i < 5; i++) await chat.markTyping({ id: member.id, name: "Đạo hữu" }, true);
  assert((await typingCol.countDocuments({})) === 1, "gõ nhiều nhịp vẫn chỉ một dòng cho mỗi người");
  await chat.markTyping({ id: member.id, name: "Đạo hữu" }, false);
  console.log("✔ Đang gõ: thấy người khác, không thấy chính mình, và mỗi người chỉ một dòng.");

  // ---- Phân trang ----------------------------------------------------------------
  const bulkClient = client.db(process.env.MONGODB_DB!).collection("chat_messages");
  const base = Date.now();
  await bulkClient.insertMany(
    Array.from({ length: 60 }, (_, i) => ({
      _id: `bulk-${i}`,
      userId: member.id,
      author: "Đạo hữu",
      isAdmin: false,
      text: `tin số ${i}`,
      sticker: null,
      attachments: [],
      replyTo: null,
      createdAt: base + i,
      editedAt: null,
      deleted: false,
      reactions: [],
    })) as never,
  );

  const p1 = await chat.getFeed({ viewerId: admin.id });
  if (p1.storeClosed) throw new Error("unreachable");
  assert(p1.messages.length === 50, `trang đầu phải đủ ${50}, có ${p1.messages.length}`);
  assert(p1.messages[0].createdAt <= p1.messages.at(-1)!.createdAt, "trang phải xếp theo chiều thời gian TĂNG");
  assert(p1.messages.at(-1)!.text === "tin số 59", "trang đầu phải là những tin MỚI nhất");

  const p2 = await chat.getFeed({
    viewerId: admin.id,
    before: { at: p1.messages[0].createdAt, id: p1.messages[0].id },
  });
  if (p2.storeClosed) throw new Error("unreachable");
  assert(p2.messages.length > 0, "phải lật được về quá khứ");
  const overlap = p2.messages.filter((m) => p1.messages.some((x) => x.id === m.id));
  assert(overlap.length === 0, `hai trang không được chồng nhau, chồng ${overlap.length}`);
  assert(
    p2.messages.at(-1)!.createdAt < p1.messages[0].createdAt,
    "trang sau phải nằm hoàn toàn trước trang đầu",
  );
  console.log("✔ Phân trang: 50 tin mỗi trang, xếp tăng dần, lật về quá khứ không chồng không hụt.");

  // ---- Quét hạn lưu --------------------------------------------------------------
  await bulkClient.insertOne({
    _id: "qua-han",
    userId: member.id,
    author: "Đạo hữu",
    isAdmin: false,
    text: "tin từ đời trước",
    sticker: null,
    attachments: [],
    replyTo: null,
    createdAt: Date.now() - (RETENTION_DAYS + 1) * 24 * 3600 * 1000,
    editedAt: null,
    deleted: false,
    reactions: [],
  } as never);

  const before = await bulkClient.countDocuments({});
  const purged = await chat.purgeExpiredChat();
  const after = await bulkClient.countDocuments({});
  assert(purged.purged === 1, `phải quét đúng 1 tin quá hạn, quét ${purged.purged}`);
  assert(after === before - 1, "chỉ tin quá hạn bị xoá, tin trong hạn phải còn nguyên");
  assert((await bulkClient.findOne({ _id: "qua-han" as never })) === null, "tin quá hạn phải biến mất thật");
  console.log("✔ Hạn lưu: chỉ tin quá hạn bị xoá, đếm đúng, tin trong hạn còn nguyên.");

  // ---- Index đã dựng -------------------------------------------------------------
  const idx = await bulkClient.indexes();
  assert(idx.some((i) => i.name === "chat_createdAt_desc"), "phải có index createdAt cho phân trang và quét hạn");
  const typingIdx = await typingCol.indexes();
  const ttl = typingIdx.find((i) => i.name === "chat_typing_ttl");
  assert(ttl?.expireAfterSeconds === 60, `index TTL của typing phải đặt 60s, có ${ttl?.expireAfterSeconds}`);
  console.log("✔ Index: createdAt cho tin, TTL cho typing — dựng tự động lúc kết nối.");

  console.log("\n✔ Tàng thư đàm đạo trên MongoDB: trọn vòng đời chạy thật, không một phép nào trượt.");
} finally {
  // Pool của chat.ts phải được đóng bằng tay: nó cố ý sống qua các request trên web, nên
  // trong một script nó sẽ giữ event loop và tiến trình không bao giờ thoát.
  await chat.closeChatStore();
  await client.close().catch(() => {});
  if (mongod) await mongod.stop();
}
