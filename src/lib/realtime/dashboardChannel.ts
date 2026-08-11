import { Client, neon } from "@neondatabase/serverless";

export const DASHBOARD_CHANNEL = "jarvis_dashboard";

export type DashboardSignal = {
  userId: string;
  topic: "job" | "event" | "presence" | "events-cleared" | "config";
};

/**
 * LISTEN cần một session THẬT nên không đi qua host `-pooler` vốn dành cho query một-phát.
 *
 * Dựng lại URL từ `DATABASE_URL` thay vì dùng `DATABASE_URL_UNPOOLED` mà integration sinh sẵn.
 * Lý do vẫn đứng vững dù con số cụ thể đã đổi: `DATABASE_URL` là biến đặt TAY, tức câu trả lời
 * có thẩm quyền cho「trạm này đọc database nào」— còn đám biến integration tự tiêm là một nguồn
 * sự thật THỨ HAI, và nó trỏ sang Neon project khác ngay khi kho nối vào project Vercel không
 * phải kho mà `DATABASE_URL` trỏ tới. Lệch kiểu ấy thì CHỈ kênh realtime sai, mọi thứ khác vẫn
 * đúng: hỏng đúng một tính năng, và hỏng im lặng.
 *
 * `PGHOST_UNPOOLED` vì thế chỉ là đường tắt TUỲ CHỌN, và nó có mặt hay không phụ thuộc tiền tố
 * chọn lúc nối kho. Đo 11/08/2026 trên hai trạm sống: trạm chính nối kho CÓ tiền tố (`hh3d_`)
 * nên biến này vắng mặt và host suy ra bằng cách bỏ `-pooler.`; trạm gương nối kho KHÔNG tiền
 * tố nên biến có sẵn — hai đường cho ra chuỗi trùng khít từng ký tự. Cả hai trạm dùng database
 * `neondb`; câu「dự án này dùng DB jarvis」ở bản bình chú cũ đã hết đúng từ lần dời database.
 *
 * `REALTIME_DATABASE_URL` là cửa ép tay thắng tất cả — để dành cho ngày Neon đổi quy ước
 * hostname và phép suy `-pooler.` hết đúng.
 */
export function realtimeDatabaseUrl(): string {
  const explicit = process.env.REALTIME_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  const url = new URL(raw);
  const unpooledHost = process.env.PGHOST_UNPOOLED?.trim();
  url.hostname = unpooledHost || url.hostname.replace("-pooler.", ".");
  return url.toString();
}

export function createDashboardListener(): Client {
  return new Client({ connectionString: realtimeDatabaseUrl() });
}

export function parseDashboardSignal(payload: string | undefined): DashboardSignal | null {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as Partial<DashboardSignal>;
    if (
      typeof value.userId !== "string" ||
      !["job", "event", "presence", "events-cleared", "config"].includes(String(value.topic))
    ) {
      return null;
    }
    return value as DashboardSignal;
  } catch {
    return null;
  }
}

/** Tín hiệu hiếm do app tự phát; thay đổi thường ngày được trigger DB phát trong cùng transaction. */
export async function notifyDashboard(signal: DashboardSignal): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;
  const sql = neon(raw);
  await sql.query("select pg_notify($1, $2)", [DASHBOARD_CHANNEL, JSON.stringify(signal)]);
}
