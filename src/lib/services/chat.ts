import { Redis } from "@upstash/redis";
import { z } from "zod";
import { getAppSettings } from "./settings";

/**
 * Đàm đạo toàn tông môn — giờ sống trong kho NoSQL (Upstash Redis), KHÔNG trong Postgres.
 *
 * Vì sao tách kho: tin đàm đạo là dòng chảy tần suất cao, tự hết hạn theo ngày, không cần
 * JOIN với ai — trong khi Postgres của hệ thống giữ danh tính và cấu hình, thứ sống lâu và
 * cần giao dịch. Hai loại dữ liệu ấy khác nhau cả về nhịp ghi lẫn vòng đời; nhét chung một
 * database là bắt bản backup của danh tính gánh cả nghìn câu "hôm nay cày chưa".
 *
 * Hình dạng dữ liệu trong Redis:
 *   chat:msg:{id}   — document JSON của một tin (kèm TÊN người gửi đóng băng lúc gửi:
 *                     NoSQL không JOIN, và tên hiển thị tại thời điểm nói vốn dĩ trung
 *                     thực hơn tên sau này đổi thành)
 *   chat:index      — ZSET member=id, score=createdAt(ms): mục lục thời gian, phục vụ
 *                     phân trang hai chiều và quét hạn lưu bằng một câu lệnh score-range
 *   chat:react:{id} — HASH field="emojiuserId": mỗi cảm xúc một field, thêm/rút là
 *                     HSET/HDEL nguyên tử — không có đọc-rồi-ghi để mà đua
 *   chat:typing     — HASH field=userId value={name,at}: "đang chấp bút", tươi trong 5s
 *
 * Kho có thể CHƯA TỒN TẠI (tông chủ tạo qua Marketplace sau): mọi hàm khi đó trả lời bằng
 * `storeClosed` thay vì ném — sảnh hiện lời "chưa khai mở" tử tế, phần còn lại của web
 * không việc gì.
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

/** Document một tin như nó nằm trong kho. Zod gác cả hai chiều — y như mọi document khác. */
const storedMessageSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  author: z.string().default("?"),
  isAdmin: z.boolean().default(false),
  text: z.string().default(""),
  sticker: z.string().nullish(),
  attachments: z.array(attachmentSchema).default([]),
  replyTo: z.string().nullish(),
  createdAt: z.number(),
  editedAt: z.number().nullish(),
  deleted: z.boolean().default(false),
});

type StoredMessage = z.infer<typeof storedMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;

export type ChatMessageView = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
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
/**
 * Ngăn giữa emoji và userId trong field cảm xúc. Escape tường minh chứ không phải ký tự
 * điều khiển trần (editor/formatter hay lặng lẽ nuốt mất), và là ký tự KHÔNG BAO GIỜ xuất
 * hiện trong cả hai vế — userId là UUID có gạch nối, emoji thì đủ trò ZWJ, nên ':' hay '-'
 * đều cắt sai chỗ.
 */
const SEP = "\u0001";

export const STORE_CLOSED_MESSAGE =
  "Tàng thư đàm đạo chưa khai mở — tông chủ cần lập kho NoSQL (Upstash Redis) trên Vercel rồi deploy lại.";

/**
 * Kết nối kho, hoặc null khi chưa cấu hình. Nhận cả hai bộ tên biến: tab Storage của
 * Vercel phát KV_REST_API_*, còn integration Upstash gốc phát UPSTASH_REDIS_REST_*.
 */
function store(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function chatStoreReady(): boolean {
  return store() !== null;
}

function parseStored(raw: unknown): StoredMessage | null {
  // Upstash tự JSON.parse giá trị khi có thể — nhận cả hai dạng cho chắc.
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = storedMessageSchema.safeParse(value);
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
 * theo chiều thời gian tăng để client vẽ thẳng. Phân trang bằng score(ms) với cận dưới
 * loại trừ — hai tin trùng mili-giây nằm cùng trang nên thực tế không rơi tin.
 */
export async function getFeed(options: {
  viewerId: string;
  before?: { at: string; id: string };
}): Promise<FeedResult> {
  const redis = store();
  if (!redis) return { storeClosed: true };

  const max: "+inf" | `(${number}` = options.before
    ? `(${new Date(options.before.at).getTime()}`
    : "+inf";
  const ids = (await redis.zrange("chat:index", max, "-inf", {
    byScore: true,
    rev: true,
    offset: 0,
    count: FEED_PAGE,
  })) as string[];
  ids.reverse();

  if (ids.length === 0) {
    return { messages: [], typing: await readTyping(redis, options.viewerId) };
  }

  // Tin + cảm xúc của cả trang đi trong MỘT pipeline — một vòng REST cho một lần vẽ.
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(`chat:msg:${id}`);
  for (const id of ids) pipe.hgetall(`chat:react:${id}`);
  const flat = await pipe.exec();

  const stored = ids
    .map((_, i) => parseStored(flat[i]))
    .filter((m): m is StoredMessage => m !== null);
  const reactionMaps = ids.map((_, i) => (flat[ids.length + i] ?? {}) as Record<string, unknown>);

  // Trích đoạn reply: gom id lạ, đọc thêm một lượt.
  const replyIds = [
    ...new Set(stored.map((m) => m.replyTo).filter((x): x is string => !!x)),
  ].filter((id) => !stored.some((m) => m.id === id));
  const replyDocs = new Map<string, StoredMessage>();
  if (replyIds.length > 0) {
    const extra = await redis.mget(...replyIds.map((id) => `chat:msg:${id}`));
    extra.forEach((raw) => {
      const m = parseStored(raw);
      if (m) replyDocs.set(m.id, m);
    });
  }
  for (const m of stored) replyDocs.set(m.id, m);

  const messages: ChatMessageView[] = stored.map((m, i) => {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const field of Object.keys(reactionMaps[i] ?? {})) {
      const [emoji, userId] = field.split(SEP);
      if (!emoji) continue;
      const cur = byEmoji.get(emoji) ?? { count: 0, mine: false };
      cur.count++;
      if (userId === options.viewerId) cur.mine = true;
      byEmoji.set(emoji, cur);
    }

    const reply = m.replyTo ? replyDocs.get(m.replyTo) : undefined;
    return {
      id: m.id,
      userId: m.userId,
      author: m.author,
      isAdmin: m.isAdmin,
      text: m.deleted ? "" : m.text,
      sticker: m.deleted ? null : (m.sticker ?? null),
      attachments: m.deleted ? [] : m.attachments,
      replyTo: reply ? { id: reply.id, author: reply.author, excerpt: excerptOf(reply) } : null,
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
      createdAt: new Date(m.createdAt).toISOString(),
      editedAt: m.editedAt ? new Date(m.editedAt).toISOString() : null,
      deleted: m.deleted,
    };
  });

  return { messages, typing: await readTyping(redis, options.viewerId) };
}

async function readTyping(redis: Redis, viewerId: string): Promise<string[]> {
  const all = ((await redis.hgetall("chat:typing")) ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const names: string[] = [];
  const stale: string[] = [];

  for (const [userId, raw] of Object.entries(all)) {
    const v = typeof raw === "string" ? JSON.parse(raw) : (raw as { name?: string; at?: number });
    if (typeof v?.at === "number" && now - v.at < TYPING_FRESH_MS) {
      if (userId !== viewerId && v.name) names.push(String(v.name));
    } else {
      stale.push(userId);
    }
  }

  // Nhặt rác tiện tay — hash typing không được phép lớn theo lịch sử thành viên.
  if (stale.length > 0) await redis.hdel("chat:typing", ...stale);
  return names;
}

export async function sendMessage(
  sender: { id: string; name: string; isAdmin: boolean },
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const redis = store();
  if (!redis) return { ok: false, error: STORE_CLOSED_MESSAGE };

  const parsed = messageBodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Tin nhắn không hợp lệ." };

  const body = parsed.data;
  if (!body.text.trim() && body.attachments.length === 0 && !body.sticker) {
    return { ok: false, error: "Tin trống — viết gì đó, hoặc gửi một tấm hình." };
  }

  const doc: StoredMessage = {
    id: crypto.randomUUID(),
    userId: sender.id,
    author: sender.name,
    isAdmin: sender.isAdmin,
    text: body.text,
    sticker: body.sticker ?? null,
    attachments: body.attachments,
    replyTo: body.replyTo ?? null,
    createdAt: Date.now(),
    deleted: false,
  };

  const pipe = redis.pipeline();
  pipe.set(`chat:msg:${doc.id}`, JSON.stringify(doc));
  pipe.zadd("chat:index", { score: doc.createdAt, member: doc.id });
  await pipe.exec();
  return { ok: true };
}

export async function editMessage(
  userId: string,
  messageId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const redis = store();
  if (!redis) return { ok: false, error: STORE_CLOSED_MESSAGE };

  const trimmed = text.slice(0, 4000);
  if (!trimmed.trim()) return { ok: false, error: "Nội dung sửa không được để trống." };

  const doc = parseStored(await redis.get(`chat:msg:${messageId}`));
  if (!doc || doc.deleted || doc.userId !== userId) {
    return { ok: false, error: "Không sửa được tin này." };
  }

  doc.text = trimmed;
  doc.editedAt = Date.now();
  await redis.set(`chat:msg:${messageId}`, JSON.stringify(doc));
  return { ok: true };
}

/** Thu hồi giữ VẾT: document ở lại với cờ deleted, nội dung bị lột — sảnh chung mà tin
    biến mất không dấu tích là chỗ để gaslight nhau. Quét hạn lưu mới là người xoá thật. */
export async function deleteMessage(
  viewer: { id: string; role: string },
  messageId: string,
): Promise<{ ok: boolean }> {
  const redis = store();
  if (!redis) return { ok: false };

  const doc = parseStored(await redis.get(`chat:msg:${messageId}`));
  if (!doc || doc.deleted) return { ok: false };
  if (doc.userId !== viewer.id && viewer.role !== "admin") return { ok: false };

  doc.deleted = true;
  doc.text = "";
  doc.sticker = null;
  doc.attachments = [];
  const pipe = redis.pipeline();
  pipe.set(`chat:msg:${messageId}`, JSON.stringify(doc));
  pipe.del(`chat:react:${messageId}`);
  await pipe.exec();
  return { ok: true };
}

export async function toggleReaction(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: boolean }> {
  const redis = store();
  if (!redis) return { ok: false };

  const clean = emoji.slice(0, 16).trim();
  if (!clean) return { ok: false };

  const field = `${clean}${SEP}${userId}`;
  const removed = await redis.hdel(`chat:react:${messageId}`, field);
  if (removed === 0) {
    await redis.hset(`chat:react:${messageId}`, { [field]: 1 });
  }
  return { ok: true };
}

export async function markTyping(
  user: { id: string; name: string },
  typing: boolean,
): Promise<void> {
  const redis = store();
  if (!redis) return;

  if (typing) {
    await redis.hset("chat:typing", { [user.id]: JSON.stringify({ name: user.name, at: Date.now() }) });
  } else {
    await redis.hdel("chat:typing", user.id);
  }
}

/**
 * Quét tin quá hạn lưu (tông chủ đặt số ngày trong trang Tông Môn). Một câu score-range
 * trên mục lục tìm mọi nạn nhân, rồi một pipeline dọn cả tin lẫn cảm xúc. Gọi từ /api/cron
 * và (tiết chế) từ nhịp đọc feed — nên sảnh tự sạch kể cả khi không ai đặt cron ngoài.
 */
export async function purgeExpiredChat(): Promise<{ purged: number }> {
  const redis = store();
  if (!redis) return { purged: 0 };

  const { chat } = await getAppSettings();
  const cutoff = Date.now() - chat.retentionDays * 24 * 3600 * 1000;

  const ids = (await redis.zrange("chat:index", "-inf", cutoff, { byScore: true })) as string[];
  if (ids.length === 0) return { purged: 0 };

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.del(`chat:msg:${id}`);
    pipe.del(`chat:react:${id}`);
  }
  pipe.zremrangebyscore("chat:index", "-inf", cutoff);
  await pipe.exec();
  return { purged: ids.length };
}
