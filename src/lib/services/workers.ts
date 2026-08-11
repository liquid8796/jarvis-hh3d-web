import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hashWorkerToken, type WorkerScope } from "@/lib/auth/worker";
import type { WorkerRow } from "@/lib/db/schema";

/**
 * Sổ điểm danh khôi lỗi + vòng đời linh phù.
 *
 * Điểm danh trả lời "có ai đang trực không" NGAY LÚC hỏi — trước đây câu này chỉ được trả
 * lời sau sáu phút im lặng, khi reaper kết liễu job. Một khôi lỗi được coi là ĐANG TRỰC nếu
 * nó hỏi việc trong vòng ONLINE_WINDOW_MS gần nhất; nhịp hỏi việc là 5 giây, nên cửa sổ
 * 30 giây đủ rộng để một cú vấp mạng không biến "đang trực" thành "vắng mặt".
 */
export const ONLINE_WINDOW_MS = 30 * 1000;

/**
 * Ghi nhận một lần gõ cửa. Gọi ở op `claim` — op dày nhịp nhất và là op duy nhất một worker
 * nhàn rỗi vẫn gọi đều đặn, nên `lastSeen` phản ánh đúng sự sống của tiến trình chứ không
 * phải sự bận rộn của nó.
 *
 * `userId` đóng băng theo scope của TOKEN, không theo lời tự xưng của worker: một linh phù
 * bị đem cắm vào máy khác vẫn chỉ điểm danh được cho chủ linh phù.
 */
export async function recordWorkerSeen(
  workerId: string,
  scope: WorkerScope,
  /**
   * Bản của gói khôi lỗi, hoặc `null` khi nó không khai (bản trước 0.71.0).
   *
   * Ghi ĐÈ kể cả khi `null`, và đó là chủ ý: một tiến trình bị hạ về bản cũ phải quay lại
   * trạng thái「không rõ」chứ không được đội con số của lần cài trước làm bằng chứng giả.
   */
  version: string | null = null,
): Promise<void> {
  const userId = scope.kind === "user" ? scope.userId : null;
  await db()
    .insert(schema.workers)
    .values({ id: workerId, userId, version })
    .onConflictDoUpdate({
      target: schema.workers.id,
      set: { userId, version, lastSeen: sql`now()` },
    });
}

export type WorkerPresence = {
  /** Khôi lỗi riêng của đạo hữu này (nếu đã từng điểm danh). */
  mine: WorkerRow[];
  /** Có khôi lỗi nào của đạo hữu đang trực không. */
  mineOnline: boolean;
  /** Khôi lỗi tông môn (userId null) có đang trực không. */
  sectOnline: boolean;
  /** Lần điểm danh mới nhất của tông môn, để SSE tự hẹn đúng lúc trạng thái hết hạn. */
  sectLastSeen: Date | null;
};

export async function getPresence(userId: string): Promise<WorkerPresence> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);

  const mine = await db()
    .select()
    .from(schema.workers)
    .where(eq(schema.workers.userId, userId))
    .orderBy(desc(schema.workers.lastSeen))
    .limit(10);

  const sect = await db()
    .select({ lastSeen: schema.workers.lastSeen })
    .from(schema.workers)
    .where(isNull(schema.workers.userId))
    .orderBy(desc(schema.workers.lastSeen))
    .limit(1);

  const sectLastSeen = sect[0]?.lastSeen ?? null;

  return {
    mine,
    mineOnline: mine.some((w) => w.lastSeen > cutoff),
    sectOnline: sectLastSeen != null && sectLastSeen > cutoff,
    sectLastSeen,
  };
}

/** Có BẤT KỲ khôi lỗi nào đang trực nhận được job của user này không (riêng hoặc tông môn). */
export async function anyWorkerOnlineFor(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.workers)
    .where(
      and(
        gt(schema.workers.lastSeen, cutoff),
        sql`(${schema.workers.userId} = ${userId} or ${schema.workers.userId} is null)`,
      ),
    );
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Gỡ một khôi lỗi khỏi sổ điểm danh.
 *
 * Sổ là sổ ĐĂNG KÝ chứ không phải danh sách tiến trình: `recordWorkerSeen` chỉ biết thêm và
 * cập nhật, nên một dòng vào rồi ở lại vĩnh viễn. Máy đã bán, bản cài đã gỡ, hay một ID sinh
 * ra trước khi hậu tố trở thành xác định — tất cả nằm lại đó, và người dùng đọc màn hình ấy
 * như "tôi đang nuôi mấy khôi lỗi", không như "đây là những cái tên từng ghé qua".
 *
 * CHỈ gỡ được khôi lỗi ĐANG VẮNG. Một khôi lỗi còn sống ghi lại dòng của nó ở lần gõ cửa kế
 * tiếp — nhiều nhất 5 giây sau — nên cho gỡ nó chỉ tạo ra một cái nút thỉnh thoảng mới có
 * tác dụng, thứ khó chịu hơn là không có nút. Mệnh đề `userId` là lớp chặn thứ hai: không ai
 * gỡ được khôi lỗi của người khác dù có gọi thẳng action với ID lạ.
 *
 * Trả về false khi không xoá được — nơi gọi phân biệt "vừa sống lại" với "đã xong".
 */
export async function forgetWorker(userId: string, workerId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const removed = await db()
    .delete(schema.workers)
    .where(
      and(
        eq(schema.workers.id, workerId),
        eq(schema.workers.userId, userId),
        lt(schema.workers.lastSeen, cutoff),
      ),
    )
    .returning({ id: schema.workers.id });
  return removed.length > 0;
}

/**
 * Phát linh phù mới. Bản rõ chỉ tồn tại trong giá trị trả về của hàm này — nơi gọi hiển
 * thị đúng một lần rồi thôi; database chỉ giữ hash. Phát lại là THAY: linh phù cũ hết
 * hiệu lực ngay ở request kế tiếp của bất kỳ khôi lỗi nào còn cầm nó.
 */
export async function issueWorkerToken(userId: string): Promise<string> {
  // 32 byte ngẫu nhiên, base64url — 43 ký tự, không cần escape ở shell lẫn URL.
  const token = `lp_${randomBytes(32).toString("base64url")}`;
  await db()
    .update(schema.users)
    .set({ workerTokenHash: hashWorkerToken(token), workerTokenCreatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  return token;
}

/** Đạo hữu này đã phát linh phù chưa — cho panel biết nên mời "cài" hay mời "phát lại". */
export async function hasWorkerToken(userId: string): Promise<boolean> {
  const rows = await db()
    .select({ hash: schema.users.workerTokenHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.hash != null;
}

/** Thu hồi linh phù — khôi lỗi nào còn cầm nó sẽ bị từ chối từ request kế tiếp. */
export async function revokeWorkerToken(userId: string): Promise<void> {
  await db()
    .update(schema.users)
    .set({ workerTokenHash: null, workerTokenCreatedAt: null })
    .where(eq(schema.users.id, userId));
}
