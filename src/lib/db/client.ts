import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * node-postgres thay neon-http từ 16/08/2026 — ngày backend rời Vercel về VM OCI.
 *
 * Vì sao đổi, và vì sao đổi là ĐỦ cho cả hai thế giới: `neon-http` nói một giao thức
 * fetch riêng mà chỉ endpoint của Neon hiểu — Postgres thường trên VM không bao giờ trả
 * lời nó được. Chiều ngược lại thì thông: Neon vẫn nói giao thức Postgres chuẩn qua 5432,
 * nên `pg` chạy được với CẢ localhost lẫn mọi chuỗi Neon còn sót (sslmode=require trong
 * URL được pg tôn trọng). Một driver cho mọi nơi — không còn chuyện "migrate bằng đường
 * này, chạy bằng đường khác".
 *
 * Pool thay vì mỗi-query-một-fetch: app nay sống trong MỘT tiến trình `next start` dài
 * hạn, nơi pool là đúng bài — và LISTEN/NOTIFY (realtime) lẫn transaction THẬT (điều
 * neon-http không có) đều cần socket bền. Trần 10 kết nối: Postgres local mặc định cho
 * 100, còn app + 3 stream SSE + NOTIFY dùng không quá một phần tư số ấy.
 *
 * Vẫn lười (lazy) như bản cũ: đọc env lúc gọi đầu tiên, để `next build` không cần
 * database chỉ để biên dịch trang.
 */
let cached: ReturnType<typeof create> | null = null;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }

  return drizzle(new Pool({ connectionString: url, max: 10 }), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}

export { schema };
