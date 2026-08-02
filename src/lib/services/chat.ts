import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";

/**
 * Đàm đạo toàn tông môn — quy tắc nghiệp vụ, và là NƠI DUY NHẤT viết truy vấn chat.
 *
 * Nội dung tin là document JSONB, nên Zod đứng gác CẢ HAI CHIỀU y như user_configs: tin
 * ghi bởi một bản deploy cũ vẫn trở về đúng hình thù hôm nay, defaults điền đủ. Không có
 * validate chiều ra thì một document lạ trong bảng — ghi tay, bug cũ — sẽ nổ ngay trong
 * component render thay vì được nắn lại lặng lẽ ở đây.
 */

/** Một tệp đính kèm đã nằm trên blob store — document chỉ giữ địa chỉ, không giữ bytes. */
const attachmentSchema = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().min(1).max(200),
  size: z.number().int().min(0).max(64 * 1024 * 1024),
  type: z.string().max(120).default("application/octet-stream"),
});

export const messageBodySchema = z.object({
  text: z.string().max(4000).default(""),
  /** id của tin được trả lời — feed tự kèm trích đoạn khi đọc ra. */
  replyTo: z.string().uuid().nullish(),
  attachments: z.array(attachmentSchema).max(6).default([]),
  /** Sticker = một emoji phóng lớn; giữ riêng để UI vẽ to mà không phải đoán từ text. */
  sticker: z.string().max(16).nullish(),
});

export type MessageBody = z.infer<typeof messageBodySchema>;
export type Attachment = z.infer<typeof attachmentSchema>;

/** Hình thù một tin như client nhìn thấy — đã ghép tên người gửi, reactions và trích đoạn reply. */
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
/** typingAt còn tươi hơn ngần này thì coi là đang gõ. */
const TYPING_FRESH_MS = 5000;

function parseBody(raw: unknown): MessageBody {
  const parsed = messageBodySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : messageBodySchema.parse({});
}

function excerptOf(body: MessageBody): string {
  if (body.sticker) return body.sticker;
  if (body.text.trim()) return body.text.trim().slice(0, 90);
  if (body.attachments.length > 0) return `📎 ${body.attachments[0].name}`;
  return "";
}

/**
 * Trang tin cho client. Hai chế độ, một hợp đồng:
 *  - `after`  (id-bigger-than theo thời gian): nhịp poll lấy tin MỚI — mảng trả về theo
 *    chiều thời gian tăng để client append thẳng.
 *  - `before`: người dùng cuộn ngược lấy trang CŨ hơn.
 * So bằng createdAt + id để một mốc trùng mili-giây không làm rơi tin.
 */
export async function getFeed(options: {
  viewerId: string;
  after?: { at: string; id: string };
  before?: { at: string; id: string };
}): Promise<{ messages: ChatMessageView[]; typing: string[] }> {
  const m = schema.chatMessages;

  const cursorCondition = options.after
    ? sql`(${m.createdAt}, ${m.id}) > (${new Date(options.after.at)}, ${options.after.id})`
    : options.before
      ? sql`(${m.createdAt}, ${m.id}) < (${new Date(options.before.at)}, ${options.before.id})`
      : undefined;

  const rows = await db()
    .select({
      id: m.id,
      userId: m.userId,
      body: m.body,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      author: schema.users.displayName,
      role: schema.users.role,
    })
    .from(m)
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(cursorCondition)
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(FEED_PAGE);

  // Truy vấn lấy MỚI-nhất-trước cho đúng trang; client luôn nhận CŨ-trước cho dễ vẽ.
  rows.reverse();

  // Reactions + trích đoạn reply gom theo lô — hai truy vấn cho cả trang, không N+1.
  const ids = rows.map((r) => r.id);
  const replyIds = [
    ...new Set(rows.map((r) => parseBody(r.body).replyTo).filter((x): x is string => !!x)),
  ];

  const reactions = ids.length
    ? await db()
        .select()
        .from(schema.chatReactions)
        .where(sql`${schema.chatReactions.messageId} in ${ids}`)
    : [];

  const replyRows = replyIds.length
    ? await db()
        .select({
          id: m.id,
          body: m.body,
          deletedAt: m.deletedAt,
          author: schema.users.displayName,
        })
        .from(m)
        .innerJoin(schema.users, eq(schema.users.id, m.userId))
        .where(sql`${m.id} in ${replyIds}`)
    : [];

  const replyMap = new Map(
    replyRows.map((r) => [
      r.id,
      {
        id: r.id,
        author: r.author,
        excerpt: r.deletedAt ? "(tin đã thu hồi)" : excerptOf(parseBody(r.body)),
      },
    ]),
  );

  const messages = rows.map((r): ChatMessageView => {
    const body = parseBody(r.body);
    const mine = reactions.filter((x) => x.messageId === r.id);
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const x of mine) {
      const cur = byEmoji.get(x.emoji) ?? { count: 0, mine: false };
      cur.count++;
      if (x.userId === options.viewerId) cur.mine = true;
      byEmoji.set(x.emoji, cur);
    }

    const deleted = r.deletedAt !== null;
    return {
      id: r.id,
      userId: r.userId,
      author: r.author,
      isAdmin: r.role === "admin",
      // Tin đã thu hồi chỉ còn cái xác — nội dung, đính kèm, sticker đều không trả về nữa.
      text: deleted ? "" : body.text,
      sticker: deleted ? null : (body.sticker ?? null),
      attachments: deleted ? [] : body.attachments,
      replyTo: body.replyTo ? (replyMap.get(body.replyTo) ?? null) : null,
      reactions: [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deleted,
    };
  });

  // Ai đang gõ — trừ chính người hỏi: tự thấy "bạn đang gõ" chỉ gây bối rối.
  const typingRows = await db()
    .select({ name: schema.users.displayName, userId: schema.chatPresence.userId })
    .from(schema.chatPresence)
    .innerJoin(schema.users, eq(schema.users.id, schema.chatPresence.userId))
    .where(gt(schema.chatPresence.typingAt, new Date(Date.now() - TYPING_FRESH_MS)));

  return {
    messages,
    typing: typingRows.filter((t) => t.userId !== options.viewerId).map((t) => t.name),
  };
}

export async function sendMessage(userId: string, raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = messageBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Tin nhắn không hợp lệ." };
  }

  const body = parsed.data;
  if (!body.text.trim() && body.attachments.length === 0 && !body.sticker) {
    return { ok: false, error: "Tin trống — viết gì đó, hoặc gửi một tấm hình." };
  }

  await db().insert(schema.chatMessages).values({ userId, body });
  return { ok: true };
}

/** Sửa tin: chỉ CHỦ tin, chỉ phần text — đính kèm và reply giữ nguyên như lúc gửi. */
export async function editMessage(
  userId: string,
  messageId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = text.slice(0, 4000);
  if (!trimmed.trim()) {
    return { ok: false, error: "Nội dung sửa không được để trống." };
  }

  const rows = await db()
    .update(schema.chatMessages)
    .set({
      body: sql`jsonb_set(${schema.chatMessages.body}, '{text}', ${JSON.stringify(trimmed)}::jsonb)`,
      editedAt: new Date(),
    })
    .where(
      and(
        eq(schema.chatMessages.id, messageId),
        eq(schema.chatMessages.userId, userId),
        isNull(schema.chatMessages.deletedAt),
      ),
    )
    .returning({ id: schema.chatMessages.id });

  return rows.length > 0 ? { ok: true } : { ok: false, error: "Không sửa được tin này." };
}

/** Thu hồi: chủ tin, hoặc tông chủ (giữ trật tự sảnh là việc của trưởng môn). */
export async function deleteMessage(
  viewer: { id: string; role: string },
  messageId: string,
): Promise<{ ok: boolean }> {
  const ownership =
    viewer.role === "admin"
      ? eq(schema.chatMessages.id, messageId)
      : and(eq(schema.chatMessages.id, messageId), eq(schema.chatMessages.userId, viewer.id));

  const rows = await db()
    .update(schema.chatMessages)
    .set({ deletedAt: new Date() })
    .where(and(ownership, isNull(schema.chatMessages.deletedAt)))
    .returning({ id: schema.chatMessages.id });

  return { ok: rows.length > 0 };
}

/** Bấm emoji = thêm; bấm lại đúng emoji đó = rút. Một câu lệnh mỗi chiều, không đọc-rồi-ghi. */
export async function toggleReaction(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: boolean }> {
  const clean = emoji.slice(0, 16);
  if (!clean.trim()) return { ok: false };

  const removed = await db()
    .delete(schema.chatReactions)
    .where(
      and(
        eq(schema.chatReactions.messageId, messageId),
        eq(schema.chatReactions.userId, userId),
        eq(schema.chatReactions.emoji, clean),
      ),
    )
    .returning({ emoji: schema.chatReactions.emoji });

  if (removed.length === 0) {
    await db()
      .insert(schema.chatReactions)
      .values({ messageId, userId, emoji: clean })
      .onConflictDoNothing();
  }

  return { ok: true };
}

/** Nhịp "đang gõ" — ghi đè một dòng; cột lastSeenAt tiện thể thành nhịp có mặt. */
export async function markTyping(userId: string, typing: boolean): Promise<void> {
  const now = new Date();
  await db()
    .insert(schema.chatPresence)
    .values({ userId, typingAt: typing ? now : null, lastSeenAt: now })
    .onConflictDoUpdate({
      target: schema.chatPresence.userId,
      set: { typingAt: typing ? now : null, lastSeenAt: now },
    });
}
