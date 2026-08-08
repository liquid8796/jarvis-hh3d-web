import { MongoClient, type Collection, type Db, type Filter } from "mongodb";
import { z } from "zod";
import { getAppSettings } from "./settings";

/**
 * Đàm đạo toàn tông môn — sống trong MongoDB, KHÔNG trong Postgres.
 *
 * Vì sao tách kho: tin đàm đạo là dòng chảy tần suất cao, tự hết hạn theo ngày, không cần
 * JOIN với ai — trong khi Postgres của hệ thống giữ danh tính và cấu hình, thứ sống lâu và
 * cần giao dịch. Hai loại dữ liệu ấy khác nhau cả về nhịp ghi lẫn vòng đời; nhét chung một
 * database là bắt bản backup của danh tính gánh cả nghìn câu "hôm nay cày chưa".
 *
 * <b>Trước 08/08/2026 kho này là Upstash Redis.</b> Chuyển sang Mongo không phải đổi cho
 * khác: mô hình document xoá được HAI thứ chắp vá mà key-value bắt phải có.
 *   1. Cảm xúc từng phải sống trong một HASH riêng `chat:react:{id}`, field ghép
 *      `emoji + U+0001 + userId` — một dấu phân cách tự chế vì ':' và '-' đều cắt sai (userId
 *      là UUID, emoji thì đủ trò ZWJ). Giờ chúng là một mảng con NGAY TRONG tin, và
 *      `$pull`/`$addToSet` nguyên tử trên đúng document ấy.
 *   2. Mục lục thời gian từng phải là một ZSET song song `chat:index`, tức mỗi lần ghi/xoá
 *      phải nhớ đụng vào HAI chỗ. Giờ chỉ còn một index trên `createdAt`.
 * Kết quả: xoá một tin là xoá một document (cảm xúc chết theo), và một trang tin là MỘT câu
 * find thay vì một pipeline 2N lệnh.
 *
 * Hình dạng dữ liệu:
 *   chat_messages — một document mỗi tin, kèm TÊN người gửi đóng băng lúc gửi (document
 *                   store không JOIN, và tên hiển thị tại thời điểm nói vốn dĩ trung thực
 *                   hơn tên sau này đổi thành) và mảng con `reactions`.
 *   chat_typing   — một document mỗi người đang gõ, `_id` = userId nên collection này KHÔNG
 *                   BAO GIỜ lớn hơn số thành viên, dù có ai dọn hay không.
 *
 * Kho có thể CHƯA TỒN TẠI (tông chủ tạo qua Marketplace sau): mọi hàm khi đó trả lời bằng
 * `storeClosed` thay vì ném — sảnh hiện lời "chưa khai mở" tử tế, phần còn lại của web
 * không việc gì. Ranh giới CỐ Ý ở đây: THIẾU CẤU HÌNH là "chưa khai mở"; còn cấu hình có mà
 * kết nối hỏng thì để lỗi ném lên thành 500 kèm nguyên văn — báo "chưa khai mở" cho một kho
 * đang hỏng là dán nhãn sai lên một sự cố và giấu mất manh mối duy nhất.
 */

const attachmentSchema = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().min(1).max(200),
  size: z.number().int().min(0).max(64 * 1024 * 1024),
  type: z.string().max(120).default("application/octet-stream"),
});

export const messageBodySchema = z.object({
  text: z.string().max(4000).default(""),
  replyTo: z.string().uuid().nullish(),
  attachments: z.array(attachmentSchema).max(6).default([]),
  sticker: z.string().max(16).nullish(),
});

const reactionSchema = z.object({ emoji: z.string(), userId: z.string() });

/** Document một tin như nó nằm trong kho. Zod gác cả hai chiều — y như mọi document khác. */
const storedMessageSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  author: z.string().default("?"),
  isAdmin: z.boolean().default(false),
  /** Tag trang trí ĐÓNG BĂNG lúc gửi, cùng triết lý với tên: huy hiệu tại thời điểm nói. */
  tags: z.array(z.string()).default([]),
  text: z.string().default(""),
  sticker: z.string().nullish(),
  attachments: z.array(attachmentSchema).default([]),
  replyTo: z.string().nullish(),
  createdAt: z.number(),
  editedAt: z.number().nullish(),
  deleted: z.boolean().default(false),
  reactions: z.array(reactionSchema).default([]),
});

type StoredMessage = z.infer<typeof storedMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;

export type ChatMessageView = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
  tags: string[];
  text: string;
  sticker: string | null;
  attachments: Attachment[];
  replyTo: { id: string; author: string; excerpt: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

const FEED_PAGE = 50;
const TYPING_FRESH_MS = 5000;
/** Lưới dọn cuối cho `chat_typing`. Chỉ là dọn rác — phép lọc lúc đọc mới quyết ai "đang gõ". */
const TYPING_TTL_SECONDS = 60;
const MESSAGES = "chat_messages";
const TYPING = "chat_typing";

export const STORE_CLOSED_MESSAGE =
  "Tàng thư đàm đạo chưa khai mở — tông chủ cần lập kho MongoDB trên Vercel rồi deploy lại.";

type TypingDoc = { _id: string; name: string; at: Date };

/**
 * Kết nối tới kho, dùng chung cho cả tiến trình.
 *
 * MongoClient tự giữ pool, nên tạo mới mỗi request là mỗi request một pool — trên serverless
 * đó là cách bào cạn hạn kết nối của Atlas. Cache ở module là đủ cho production; thêm một
 * bản trên `globalThis` vì `next dev` nạp lại module ở mỗi lần sửa file, và không có nó thì
 * mỗi lần lưu là một pool nữa bị bỏ rơi.
 *
 * Nhận `MONGODB_URI` (tên mà integration MongoDB Atlas trên Vercel phát ra) và chấp nhận
 * `MONGODB_URL` cho ai đặt tay. `null` = chưa cấu hình, KHÔNG phải lỗi.
 */
type ChatStore = {
  client: MongoClient;
  db: Db;
  messages: Collection<StoredMessage>;
  typing: Collection<TypingDoc>;
};

const globalForMongo = globalThis as unknown as { __jarvisChatStore?: Promise<ChatStore> };

function mongoUri(): string | null {
  return process.env.MONGODB_URI?.trim() || process.env.MONGODB_URL?.trim() || null;
}

/** Tên database: biến môi trường thắng, rồi tới đường dẫn trong URI, cuối cùng là mặc định. */
function databaseName(uri: string): string {
  const explicit = process.env.MONGODB_DB?.trim();
  if (explicit) return explicit;
  try {
    // URI mongodb+srv:// có thể mang đường dẫn database, và integration của Vercel thì không.
    const path = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
    if (path) return decodeURIComponent(path);
  } catch {
    // URI lạ thì thôi — dùng mặc định, và lỗi thật (nếu có) sẽ nổ ở lúc connect với nguyên văn.
  }
  return "jarvis";
}

async function connect(uri: string): Promise<ChatStore> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(databaseName(uri));
  const messages = db.collection<StoredMessage>(MESSAGES);
  const typing = db.collection<TypingDoc>(TYPING);

  // Dựng index MỘT lần cho mỗi tiến trình, trong cùng promise đã cache — nên nó không bao
  // giờ chạy trên đường đi nóng của một request thứ hai. `createIndex` là idempotent.
  await Promise.all([
    messages.createIndex({ createdAt: -1 }, { name: "chat_createdAt_desc" }),
    typing.createIndex({ at: 1 }, { name: "chat_typing_ttl", expireAfterSeconds: TYPING_TTL_SECONDS }),
  ]);

  return { client, db, messages, typing };
}

/**
 * Đóng pool và quên cache. CHỈ dành cho tiến trình có điểm kết thúc — script migrate, script
 * kiểm chứng. Web function thì không bao giờ gọi: pool sống qua các request là cả mục đích
 * của việc cache nó.
 *
 * Tồn tại vì một pool đang mở giữ event loop sống mãi: script gọi xong việc sẽ TREO chứ
 * không thoát, và stdout ghi ra file thì đệm lại nên nhìn như treo từ dòng đầu. Đúng bài học
 * đã trả giá bằng hai lần chạy 600 giây.
 */
export async function closeChatStore(): Promise<void> {
  const opened = globalForMongo.__jarvisChatStore;
  globalForMongo.__jarvisChatStore = undefined;
  if (!opened) return;
  await opened.then(({ client }) => client.close()).catch(() => {});
}

function store(): Promise<ChatStore> | null {
  const uri = mongoUri();
  if (!uri) return null;

  if (!globalForMongo.__jarvisChatStore) {
    // Kết nối hỏng KHÔNG được đóng băng vĩnh viễn trong cache: xoá promise khi nó reject để
    // request sau còn được thử lại, thay vì cả instance ôm mãi một lần lỡ nhịp lúc khởi động.
    globalForMongo.__jarvisChatStore = connect(uri).catch((err) => {
      globalForMongo.__jarvisChatStore = undefined;
      throw err;
    });
  }
  return globalForMongo.__jarvisChatStore;
}

export function chatStoreReady(): boolean {
  return mongoUri() !== null;
}

function parseStored(raw: unknown): StoredMessage | null {
  const parsed = storedMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function excerptOf(m: StoredMessage): string {
  if (m.deleted) return "(tin đã thu hồi)";
  if (m.sticker) return m.sticker;
  if (m.text.trim()) return m.text.trim().slice(0, 90);
  if (m.attachments.length > 0) return `📎 ${m.attachments[0].name}`;
  return "";
}

type FeedResult =
  | { storeClosed: true }
  | { storeClosed?: false; messages: ChatMessageView[]; typing: string[] };

/**
 * Trang tin cho client: mặc định là trang MỚI nhất; `before` lật về quá khứ. Mảng trả về
 * theo chiều thời gian tăng để client vẽ thẳng. Phân trang bằng `createdAt` (ms) với cận
 * dưới loại trừ — hai tin trùng mili-giây nằm cùng trang nên thực tế không rơi tin.
 */
export async function getFeed(options: {
  viewerId: string;
  before?: { at: string; id: string };
}): Promise<FeedResult> {
  const opened = store();
  if (!opened) return { storeClosed: true };
  const { messages: col, typing } = await opened;

  const filter: Filter<StoredMessage> = options.before
    ? { createdAt: { $lt: new Date(options.before.at).getTime() } }
    : {};

  const page = await col.find(filter).sort({ createdAt: -1 }).limit(FEED_PAGE).toArray();
  page.reverse();

  const stored = page.map(parseStored).filter((m): m is StoredMessage => m !== null);
  if (stored.length === 0) {
    return { messages: [], typing: await readTyping(typing, options.viewerId) };
  }

  // Trích đoạn reply: gom id nằm ngoài trang này, đọc thêm đúng một lượt.
  const replyIds = [
    ...new Set(stored.map((m) => m.replyTo).filter((x): x is string => !!x)),
  ].filter((id) => !stored.some((m) => m._id === id));
  const replyDocs = new Map<string, StoredMessage>();
  if (replyIds.length > 0) {
    const extra = await col.find({ _id: { $in: replyIds } }).toArray();
    for (const raw of extra) {
      const m = parseStored(raw);
      if (m) replyDocs.set(m._id, m);
    }
  }
  for (const m of stored) replyDocs.set(m._id, m);

  const view: ChatMessageView[] = stored.map((m) => {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of m.reactions) {
      if (!r.emoji) continue;
      const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      cur.count++;
      if (r.userId === options.viewerId) cur.mine = true;
      byEmoji.set(r.emoji, cur);
    }

    const reply = m.replyTo ? replyDocs.get(m.replyTo) : undefined;
    return {
      id: m._id,
      userId: m.userId,
      author: m.author,
      isAdmin: m.isAdmin,
      tags: m.tags,
      text: m.deleted ? "" : m.text,
      sticker: m.deleted ? null : (m.sticker ?? null),
      attachments: m.deleted ? [] : m.attachments,
      replyTo: reply ? { id: reply._id, author: reply.author, excerpt: excerptOf(reply) } : null,
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
      createdAt: new Date(m.createdAt).toISOString(),
      editedAt: m.editedAt ? new Date(m.editedAt).toISOString() : null,
      deleted: m.deleted,
    };
  });

  return { messages: view, typing: await readTyping(typing, options.viewerId) };
}

/**
 * Ai đang gõ, trừ chính người xem. KHÔNG dọn rác ở đây như bản Redis từng làm: `_id` là
 * userId nên collection này bị chặn trên bởi số thành viên dù không ai dọn, còn index TTL
 * lo phần còn lại. Một lệnh xoá kèm theo MỖI nhịp poll 2,5 giây của MỖI người là cái giá
 * không đáng trả cho việc dọn một collection vốn đã không thể phình.
 */
async function readTyping(col: Collection<TypingDoc>, viewerId: string): Promise<string[]> {
  const fresh = new Date(Date.now() - TYPING_FRESH_MS);
  const rows = await col.find({ at: { $gt: fresh }, _id: { $ne: viewerId } }).toArray();
  return rows.map((r) => r.name).filter((name): name is string => Boolean(name));
}

export async function sendMessage(
  sender: { id: string; name: string; isAdmin: boolean; tags: string[] },
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const opened = store();
  if (!opened) return { ok: false, error: STORE_CLOSED_MESSAGE };

  const parsed = messageBodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Tin nhắn không hợp lệ." };

  const body = parsed.data;
  if (!body.text.trim() && body.attachments.length === 0 && !body.sticker) {
    return { ok: false, error: "Tin trống — viết gì đó, hoặc gửi một tấm hình." };
  }

  const doc: StoredMessage = {
    _id: crypto.randomUUID(),
    userId: sender.id,
    author: sender.name,
    isAdmin: sender.isAdmin,
    tags: sender.tags,
    text: body.text,
    sticker: body.sticker ?? null,
    attachments: body.attachments,
    replyTo: body.replyTo ?? null,
    createdAt: Date.now(),
    editedAt: null,
    deleted: false,
    reactions: [],
  };

  const { messages } = await opened;
  await messages.insertOne(doc);
  return { ok: true };
}

/**
 * Sửa tin. Quyền sở hữu nằm TRONG bộ lọc chứ không phải một phép kiểm trước đó: đọc-rồi-ghi
 * để lại một khe giữa hai lượt đi, còn một câu update thì hoặc trúng đúng tin của mình,
 * hoặc không trúng gì.
 */
export async function editMessage(
  userId: string,
  messageId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const opened = store();
  if (!opened) return { ok: false, error: STORE_CLOSED_MESSAGE };

  const trimmed = text.slice(0, 4000);
  if (!trimmed.trim()) return { ok: false, error: "Nội dung sửa không được để trống." };

  const { messages } = await opened;
  const res = await messages.updateOne(
    { _id: messageId, userId, deleted: false },
    { $set: { text: trimmed, editedAt: Date.now() } },
  );
  return res.matchedCount === 1 ? { ok: true } : { ok: false, error: "Không sửa được tin này." };
}

/** Thu hồi giữ VẾT: document ở lại với cờ deleted, nội dung bị lột — sảnh chung mà tin
    biến mất không dấu tích là chỗ để gaslight nhau. Quét hạn lưu mới là người xoá thật.

    CHỈ CHỦ TIN thu hồi được — admin cũng KHÔNG. Trước 08/08/2026 admin có đường riêng, và
    đó là lỗ hổng chứ không phải tính năng: "thu hồi" trong sảnh nghĩa là "TÔI rút lời tôi",
    để người khác rút được lời của bạn thì lịch sử đàm đạo thành thứ ai cầm quyền nấy viết
    lại. Quyền sở hữu nằm NGAY TRONG bộ lọc của câu update — không có nhánh nào để một
    tham số quên kiểm mở lại cửa ấy. */
export async function deleteMessage(
  viewer: { id: string },
  messageId: string,
): Promise<{ ok: boolean }> {
  const opened = store();
  if (!opened) return { ok: false };

  const { messages } = await opened;
  const res = await messages.updateOne(
    { _id: messageId, deleted: false, userId: viewer.id },
    {
      // Cảm xúc chết theo tin vì chúng nằm TRONG tin — bản Redis phải nhớ xoá một key thứ hai.
      $set: { deleted: true, text: "", sticker: null, attachments: [], reactions: [] },
    },
  );
  return { ok: res.matchedCount === 1 };
}

/**
 * Bật/tắt một cảm xúc. Thử rút trước: rút được nghĩa là người này đã thả nó rồi. Cả hai
 * lệnh đều nguyên tử trên đúng một document, nên hai người bấm cùng lúc không giẫm nhau.
 */
export async function toggleReaction(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: boolean }> {
  const opened = store();
  if (!opened) return { ok: false };

  const clean = emoji.slice(0, 16).trim();
  if (!clean) return { ok: false };

  const { messages } = await opened;
  const filter: Filter<StoredMessage> = { _id: messageId, deleted: false };
  const removed = await messages.updateOne(filter, { $pull: { reactions: { emoji: clean, userId } } });
  if (removed.modifiedCount === 1) return { ok: true };

  const added = await messages.updateOne(filter, { $addToSet: { reactions: { emoji: clean, userId } } });
  return { ok: added.matchedCount === 1 };
}

export async function markTyping(
  user: { id: string; name: string },
  typing: boolean,
): Promise<void> {
  const opened = store();
  if (!opened) return;

  const col = (await opened).typing;
  if (typing) {
    // Document thay thế KHÔNG mang `_id` — driver cấm, và lúc upsert Mongo tự lấy `_id` từ
    // phép so bằng trong bộ lọc. Nhờ `_id` = userId, mỗi người chỉ có đúng một dòng.
    await col.replaceOne({ _id: user.id }, { name: user.name, at: new Date() }, { upsert: true });
  } else {
    await col.deleteOne({ _id: user.id });
  }
}

/**
 * Quét tin quá hạn lưu (tông chủ đặt số ngày trong trang Tông Môn). Một câu deleteMany theo
 * khoảng `createdAt` — cảm xúc nằm trong tin nên chết theo, không còn key thứ hai để quên.
 * Gọi từ /api/cron và (tiết chế) từ nhịp đọc feed — nên sảnh tự sạch kể cả khi không ai đặt
 * cron ngoài.
 *
 * CỐ Ý không dùng index TTL của Mongo cho việc này: hạn lưu là con số tông chủ đổi được lúc
 * chạy, mà `expireAfterSeconds` thì nằm trong định nghĩa index — đổi nó phải chạy collMod.
 * Một câu xoá theo khoảng đọc thẳng cấu hình hiện hành, và đổi số là có hiệu lực ngay.
 */
export async function purgeExpiredChat(): Promise<{ purged: number }> {
  const opened = store();
  if (!opened) return { purged: 0 };

  const { chat } = await getAppSettings();
  const cutoff = Date.now() - chat.retentionDays * 24 * 3600 * 1000;

  const { messages } = await opened;
  const res = await messages.deleteMany({ createdAt: { $lt: cutoff } });
  return { purged: res.deletedCount ?? 0 };
}
