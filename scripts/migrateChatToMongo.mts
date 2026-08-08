#!/usr/bin/env node
/**
 * Chuyển tin đàm đạo từ kho cũ (Upstash Redis) sang kho mới (MongoDB). Chạy MỘT lần, lúc
 * hai kho còn cùng cấu hình.
 *
 * Vì sao đáng có, dù hạn lưu chỉ 7 ngày: 7 ngày ấy là toàn bộ những gì tông môn đang nói
 * với nhau. Đổi kho mà không mang chúng theo là sảnh đàm đạo sáng hôm sau trống trơn, không
 * ai được báo trước.
 *
 * AN TOÀN:
 *   • Chỉ ĐỌC từ Redis — không xoá gì bên đó. Kho cũ ở nguyên đấy làm bản lui.
 *   • Ghi bằng upsert theo `_id`, nên chạy lại nhiều lần cho ra cùng một kết quả.
 *   • Tin đã có bên Mongo thì KHÔNG bị đè: sảnh vẫn đang chạy, và một tin vừa sửa bên kho
 *     mới không được để bản sao cũ từ Redis ghi đè lên.
 *   • `--dry-run` để xem sẽ chuyển bao nhiêu mà không ghi gì.
 *
 * Cần cả hai bộ biến: KV_REST_API_* (hoặc UPSTASH_REDIS_REST_*) và MONGODB_URI.
 */
import { Redis } from "@upstash/redis";
import { MongoClient } from "mongodb";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const DRY_RUN = process.argv.includes("--dry-run");

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const mongoUri = process.env.MONGODB_URI?.trim() || process.env.MONGODB_URL?.trim();

if (!redisUrl || !redisToken) throw new Error("Thiếu KV_REST_API_URL/TOKEN — không đọc được kho cũ.");
if (!mongoUri) throw new Error("Thiếu MONGODB_URI — không biết ghi vào đâu.");

/** Cùng luật đặt tên database với chat.ts — hai nơi lệch nhau là chuyển vào nhầm kho. */
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

/**
 * Ngăn giữa emoji và userId trong field cảm xúc của kho CŨ. Viết dạng escape chứ không
 * phải ký tự điều khiển trần — chú thích trong chat.ts đời Redis đã dặn đúng điều này:
 * editor và formatter hay lặng lẽ nuốt mất một ký tự vô hình, và lúc ấy toàn bộ cảm xúc
 * lặng lẽ không chuyển được mà không ai thấy lỗi.
 */
const SEP = "\u0001";
const redis = new Redis({ url: redisUrl, token: redisToken });
const client = new MongoClient(mongoUri);

try {
  const ids = (await redis.zrange("chat:index", "-inf", "+inf", { byScore: true })) as string[];
  console.log(`• Kho cũ có ${ids.length} tin trong mục lục.`);
  if (ids.length === 0) {
    console.log("Không có gì để chuyển.");
    process.exit(0);
  }

  await client.connect();
  const db = client.db(databaseName(mongoUri));
  const messages = db.collection("chat_messages");
  console.log(`• Ghi vào database「${db.databaseName}」, collection「chat_messages」.`);

  let moved = 0;
  let skipped = 0;
  let broken = 0;

  // Theo lô để không dựng một pipeline khổng lồ, và để tiến độ nhìn thấy được.
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);

    const pipe = redis.pipeline();
    for (const id of slice) pipe.get(`chat:msg:${id}`);
    for (const id of slice) pipe.hgetall(`chat:react:${id}`);
    const flat = (await pipe.exec()) as unknown[];

    const ops = [];
    for (let k = 0; k < slice.length; k++) {
      const raw = flat[k];
      const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!doc || typeof doc !== "object" || typeof (doc as { id?: unknown }).id !== "string") {
        broken++;
        continue;
      }
      const m = doc as Record<string, unknown>;

      // Cảm xúc từ HASH field "emoji + SEP + userId" → mảng con của document mới. Đây chính
      // là cái chắp vá mà mô hình document xoá bỏ được.
      const reactions: Array<{ emoji: string; userId: string }> = [];
      for (const field of Object.keys((flat[slice.length + k] ?? {}) as Record<string, unknown>)) {
        const [emoji, userId] = field.split(SEP);
        if (emoji && userId) reactions.push({ emoji, userId });
      }

      ops.push({
        updateOne: {
          filter: { _id: m.id as string },
          // $setOnInsert: tin đã có bên Mongo KHÔNG bị đè — xem ghi chú an toàn ở đầu tệp.
          update: {
            $setOnInsert: {
              userId: String(m.userId ?? ""),
              author: String(m.author ?? "?"),
              isAdmin: Boolean(m.isAdmin),
              text: String(m.text ?? ""),
              sticker: (m.sticker as string | null) ?? null,
              attachments: Array.isArray(m.attachments) ? m.attachments : [],
              replyTo: (m.replyTo as string | null) ?? null,
              createdAt: Number(m.createdAt ?? Date.now()),
              editedAt: m.editedAt == null ? null : Number(m.editedAt),
              deleted: Boolean(m.deleted),
              reactions,
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) {
      if (DRY_RUN) {
        moved += ops.length;
      } else {
        const res = await messages.bulkWrite(ops as never);
        moved += res.upsertedCount;
        skipped += ops.length - res.upsertedCount;
      }
    }
    process.stdout.write(`\r  …đã xử lý ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
  }

  console.log("");
  if (DRY_RUN) {
    console.log(`• THỬ KHÔNG GHI: sẽ chuyển ${moved} tin (${broken} dòng hỏng bị bỏ qua).`);
  } else {
    const total = await messages.countDocuments({});
    console.log(`✔ Chuyển xong: ${moved} tin mới, ${skipped} tin đã có sẵn nên giữ nguyên, ${broken} dòng hỏng bỏ qua.`);
    console.log(`✔ Kho mới hiện có ${total} tin.`);
  }
  console.log("• Kho Redis KHÔNG bị đụng tới — vẫn nguyên vẹn làm bản lui.");
} finally {
  await client.close().catch(() => {});
}
