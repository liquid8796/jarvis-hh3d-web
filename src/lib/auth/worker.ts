import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

/**
 * Cửa vào của khôi lỗi (worker) — giờ có HAI loại chìa.
 *
 * Worker không phải là một người dùng: nó không có session, không có cookie trình duyệt,
 * và nó gọi từ một máy khác — nên nó tự xưng bằng bí mật trong header
 * `Authorization: Bearer <token>`. Điều đổi khác từ khi có trang cài khôi lỗi: token không
 * thể là MỘT bí mật dùng chung nữa, vì ai cầm bí mật chung là claim được job của tất cả —
 * tức đọc được cookie game của tất cả. Nên:
 *
 *   • WORKER_TOKEN (env) — chìa của KHÔI LỖI TÔNG MÔN, do người vận hành giữ, cắm vào VM
 *     luôn trực. Scope `operator`: nhận job của mọi thành viên.
 *   • Linh phù — token riêng từng đạo hữu, phát ở mục Khôi Lỗi, lưu trong users dưới dạng
 *     SHA-256. Scope `user`: chỉ nhận job của chính chủ, và chỉ được chạm vào job của
 *     chính chủ ở mọi op còn lại.
 *
 * So sánh token tông môn bằng `timingSafeEqual`. Linh phù thì tra theo hash: SHA-256 là
 * hàm một chiều trải đều, kẻ dò không điều khiển được phân bố hash để đo thời gian so sánh
 * index, nên phép tra bằng đẳng thức là đủ — và sau khi tra vẫn đối chiếu lại hash lần nữa
 * bằng timingSafeEqual cho chắc.
 *
 * Đổi WORKER_TOKEN trên Vercel cắt khôi lỗi tông môn bị lộ; bấm "thu hồi linh phù" cắt một
 * khôi lỗi riêng — cả hai có hiệu lực ngay ở request kế tiếp.
 */

export type WorkerScope =
  | { kind: "operator" }
  | { kind: "user"; userId: string };

/** Băm linh phù về dạng lưu trữ. Một chỗ duy nhất, để chỗ phát và chỗ soát không lệch nhau. */
export function hashWorkerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Trả về scope của khôi lỗi đang gõ cửa, hoặc null nếu chìa không mở được gì. */
export async function authorizeWorker(request: Request): Promise<WorkerScope | null> {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length === 0) {
    return null;
  }

  // Chìa tông môn trước — không tốn một câu query nào.
  const operator = process.env.WORKER_TOKEN;
  // Chưa cấu hình thì cửa tông môn đóng hoàn toàn, thay vì mở toang bằng giá trị mặc định.
  if (operator && operator !== "change-me" && safeEqual(presented, operator)) {
    return { kind: "operator" };
  }

  // Linh phù: tra hash. Chỉ tài khoản `active` mới dùng được — đạo hữu bị khoá thì khôi lỗi
  // của họ cũng mất quyền theo, không cần ai nhớ đi thu hồi token.
  const hash = hashWorkerToken(presented);
  const rows = await db()
    .select({ id: schema.users.id, status: schema.users.status, stored: schema.users.workerTokenHash })
    .from(schema.users)
    .where(eq(schema.users.workerTokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row || row.status !== "active" || !row.stored || !safeEqual(hash, row.stored)) {
    return null;
  }

  return { kind: "user", userId: row.id };
}
