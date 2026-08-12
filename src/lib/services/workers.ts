import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hashWorkerToken, type WorkerScope } from "@/lib/auth/worker";
import type { WorkerRow } from "@/lib/db/schema";
import type { WorkerPref } from "./configs";

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
  /** Bản gói của khôi lỗi tông môn điểm danh gần nhất; null = bản trước 0.71.0. */
  sectVersion: string | null;
};

export async function getPresence(userId: string): Promise<WorkerPresence> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);

  const mine = await db()
    .select()
    .from(schema.workers)
    .where(eq(schema.workers.userId, userId))
    .orderBy(desc(schema.workers.lastSeen))
    .limit(10);

  // Lấy version TỪ CHÍNH DÒNG sinh ra sectLastSeen, không phải một dòng khác: hai giá trị
  // phải kể về cùng một tiến trình. Nhiều khôi lỗi tông môn chạy song song thì đây là cái
  // điểm danh gần nhất — cùng luật với sectOnline, và ghi ra đây để người sau không tưởng
  // nó là「bản của mọi khôi lỗi tông môn」.
  const sect = await db()
    .select({ lastSeen: schema.workers.lastSeen, version: schema.workers.version })
    .from(schema.workers)
    .where(isNull(schema.workers.userId))
    .orderBy(desc(schema.workers.lastSeen))
    .limit(1);

  const sectLastSeen = sect[0]?.lastSeen ?? null;
  const sectVersion = sect[0]?.version ?? null;

  return {
    mine,
    mineOnline: mine.some((w) => w.lastSeen > cutoff),
    sectOnline: sectLastSeen != null && sectLastSeen > cutoff,
    sectLastSeen,
    sectVersion,
  };
}

/** Trần số dòng cho MỖI nhóm trong sổ điểm danh của trang Hàng Đợi — xem `getWorkerRoster`. */
const ROSTER_LIMIT = 10;

/**
 * Một dòng trong tab Khôi Lỗi của trang Hàng Đợi.
 *
 * `id` là chỗ ranh giới riêng tư nằm: `null` nghĩa là người xem chỉ được biết LOẠI, không được
 * biết đây đích xác là tiến trình nào. Cắt ở SERVICE chứ không ở giao diện — cùng lẽ với
 * `maskUsername` trong queue.ts: thứ không được phép hiện thì không được phép đi xuống dây.
 */
export type WorkerRosterEntry = {
  id: string | null;
  kind: "sect" | "mine";
  online: boolean;
  /**
   * Điểm danh lần cuối — CHỈ có khi đang vắng, và cái `null` lúc đang trực là chủ ý.
   *
   * Khôi lỗi trực thì gõ cửa mỗi 5 giây, nên trường này sẽ đổi ở mọi lượt đọc. Ảnh chụp hàng
   * đợi lại đi qua SSE với phép so nguyên văn (`next !== signature` trong stream/route.ts) để
   * quyết định có đẩy khung mới hay không — nhét một con số nhấp nháy vào đó là mọi tín hiệu
   * đều thành「có đổi」, tức phép so ấy thôi lọc được gì. Đang vắng thì mốc đứng yên, và đó
   * cũng đúng lúc người ta cần biết「vắng từ bao giờ」.
   */
  lastSeen: string | null;
  /** Bản gói khôi lỗi; `null` = bản trước 0.71.0 hoặc người xem không được biết. */
  version: string | null;
};

/**
 * Sổ khôi lỗi cho tab Khôi Lỗi của trang Hàng Đợi: ai đang trực để nhặt việc.
 *
 * Hai nhóm, và chỉ hai: khôi lỗi TÔNG MÔN (của chung, `user_id is null`) và khôi lỗi RIÊNG của
 * CHÍNH người xem. Khôi lỗi riêng của người khác không bao giờ vào danh sách này — nó là máy ở
 * nhà họ, và trang này vốn đã che cả tên chủ nhân thì không có lý gì kể tên máy.
 *
 * `detailed` (bậc trị sự) quyết định khôi lỗi tông môn được kể thành TỪNG tiến trình hay gộp
 * làm một dòng「có ai đó đang trực」. Gộp không phải để giấu cho đẹp: id của một khôi lỗi tông
 * môn là chi tiết vận hành (máy nào, trạm nào), thứ môn đồ không dùng được vào việc gì mà lại
 * nói ra hạ tầng của tông môn.
 *
 * HAI câu truy vấn chứ không một câu `or` rồi cắt 20: một người nuôi mười khôi lỗi riêng sẽ
 * đẩy khôi lỗi tông môn ra khỏi trần, tức nhóm quan trọng nhất biến mất đúng ở màn hình của
 * người bận rộn nhất. Mỗi nhóm một trần, không nhóm nào ăn phần của nhóm kia.
 */
export async function getWorkerRoster(
  viewerId: string,
  detailed: boolean,
): Promise<WorkerRosterEntry[]> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const columns = {
    id: schema.workers.id,
    lastSeen: schema.workers.lastSeen,
    version: schema.workers.version,
  };

  const [sect, mine] = await Promise.all([
    db()
      .select(columns)
      .from(schema.workers)
      .where(isNull(schema.workers.userId))
      .orderBy(desc(schema.workers.lastSeen))
      .limit(ROSTER_LIMIT),
    db()
      .select(columns)
      .from(schema.workers)
      .where(eq(schema.workers.userId, viewerId))
      .orderBy(desc(schema.workers.lastSeen))
      .limit(ROSTER_LIMIT),
  ]);

  const isOnline = (lastSeen: Date) => lastSeen > cutoff;
  /** Mốc chỉ đi xuống dây khi ĐANG VẮNG — lý do ở `WorkerRosterEntry.lastSeen`. */
  const seenIfAway = (online: boolean, lastSeen: Date) => (online ? null : lastSeen.toISOString());

  const detailedSect: WorkerRosterEntry[] = sect.map((row) => {
    const online = isOnline(row.lastSeen);
    return {
      id: row.id,
      kind: "sect",
      online,
      lastSeen: seenIfAway(online, row.lastSeen),
      version: row.version,
    };
  });

  /**
   * MỘT dòng cho cả nhóm — và LUÔN có dòng ấy, kể cả khi sổ chưa có khôi lỗi tông môn nào:
   * người xem cần đọc được「tông môn đang vắng」, chứ không phải nhìn một danh sách thiếu nó
   * rồi tự đoán. `sect` đã xếp theo lần điểm danh mới nhất nên phần tử đầu là mốc gần nhất.
   */
  const anySectOnline = detailedSect.some((row) => row.online);
  const groupedSect: WorkerRosterEntry = {
    id: null,
    kind: "sect",
    online: anySectOnline,
    lastSeen: anySectOnline ? null : (sect[0]?.lastSeen.toISOString() ?? null),
    version: null,
  };

  // `length > 0` chứ không chỉ `detailed`: sổ chưa có khôi lỗi tông môn nào (trạm vừa dựng, hay
  // vừa chuyển trạm) thì kể từng tiến trình một sẽ ra một danh sách RỖNG — bậc trị sự nhìn tab
  // không thấy dòng nào và không có cách gì biết là「vắng」hay là「trang hỏng」. Dòng gộp nói
  // đúng điều đó bằng một câu.
  const sectRows = detailed && detailedSect.length > 0 ? detailedSect : [groupedSect];

  const mineRows: WorkerRosterEntry[] = mine.map((row) => {
    const online = isOnline(row.lastSeen);
    return {
      id: row.id,
      kind: "mine",
      online,
      lastSeen: seenIfAway(online, row.lastSeen),
      version: row.version,
    };
  });

  // Tông môn đứng trước: đó là khôi lỗi phục vụ mọi người, và với hầu hết đạo hữu thì nó là
  // dòng DUY NHẤT đáng đọc. Trong mỗi nhóm, ai đang trực đứng trên.
  const byPresence = (a: WorkerRosterEntry, b: WorkerRosterEntry) =>
    Number(b.online) - Number(a.online);
  return [...sectRows.sort(byPresence), ...mineRows.sort(byPresence)];
}

/**
 * Có khôi lỗi ĐÚNG LOẠI đạo hữu đã chọn đang trực để nhận đàn của họ không.
 *
 * Luật ở đây phải là bản sao đúng của mệnh đề lọc trong `claimNextJob`: `sect` chỉ tính khôi
 * lỗi tông môn (`user_id is null`), `mine` chỉ tính khôi lỗi của chính chủ, `any` tính cả hai.
 * Lệch nhau một nhánh là Khai Đàn hứa「sẽ tiếp nhận trong giây lát」rồi đàn nằm chờ vô hạn —
 * loại lỗi không ai báo, vì cả hai phía đều tin là mình đúng.
 */
export async function workerOnlineFor(userId: string, pref: WorkerPref): Promise<boolean> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const mine = sql`${schema.workers.userId} = ${userId}`;
  const sect = sql`${schema.workers.userId} is null`;
  const wanted = pref === "sect" ? sect : pref === "mine" ? mine : sql`(${mine} or ${sect})`;

  const rows = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.workers)
    .where(and(gt(schema.workers.lastSeen, cutoff), wanted));
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
