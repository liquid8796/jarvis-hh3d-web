import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { hashWorkerToken, type WorkerScope } from "@/lib/auth/worker";
import type { WorkerRow } from "@/lib/db/schema";
import { clampMaxJobs, DEFAULT_MAX_JOBS, ONLINE_WINDOW_MS, STALE_AFTER_MS } from "./dispatch";
import type { WorkerPref } from "./configs";

/**
 * Sổ điểm danh khôi lỗi + vòng đời linh phù.
 *
 * Điểm danh trả lời "có ai đang trực không" NGAY LÚC hỏi — trước đây câu này chỉ được trả
 * lời sau sáu phút im lặng, khi reaper kết liễu job. Một khôi lỗi được coi là ĐANG TRỰC nếu
 * nó hỏi việc trong vòng ONLINE_WINDOW_MS gần nhất; nhịp hỏi việc là 5 giây, nên cửa sổ
 * 30 giây đủ rộng để một cú vấp mạng không biến "đang trực" thành "vắng mặt".
 *
 * Cửa sổ ấy nay ĐỊNH NGHĨA ở `dispatch.ts` — nơi luật phát việc sống — và được tái xuất ở đây
 * cho dashboard, sổ điểm danh, bảng Hàng Đợi. Một nguồn duy nhất: hai bản của cùng cửa sổ là
 * hai dịp để dashboard vẽ "đang trực" trong khi cửa phát việc đã gạch tên.
 */
export { ONLINE_WINDOW_MS };

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
  /**
   * Trần ghế (`WORKER_MAX_JOBS`) do chính tiến trình khai — bộ cân tải cần nó để biết khôi lỗi
   * nào còn chỗ mà chia việc tới.
   *
   * `null` ở đây KHÔNG có nghĩa "trần bằng mặc định", mà là "lượt gõ cửa này không khai gì" —
   * và khi ấy cột giữ NGUYÊN giá trị cũ. Đây là chỗ nó khác `version` một cách có chủ ý: nhịp
   * tim cũng gọi vào hàm này (op `heartbeat`) mà thân nhịp tim không mang trần ghế, nên ghi đè
   * bằng mặc định sẽ hạ một khôi lỗi 3 ghế xuống 2 ngay sau lượt claim đầu tiên — lặng lẽ, và
   * chỉ lộ ra dưới dạng một cái máy tự dưng chạy ít việc hơn nó có thể.
   *
   * Hai hướng đoán sai không cân nhau, nên chọn hướng tự lành: giữ số CŨ mà số ấy cao hơn thực
   * tế thì bộ cân tải chờ hụt nhiều nhất `TURN_GRACE_MS` rồi van chống đói mở; giữ số THẤP hơn
   * thực tế thì một cái ghế bỏ không vĩnh viễn, không gì cứu.
   *
   * KẸP dù có khai: linh phù là token của người dùng nên một khôi lỗi riêng có thể khai bừa.
   * Khai thừa chỉ hại chính chủ nó (khôi lỗi riêng chỉ nhận đàn của chủ mình), nhưng một con số
   * vô lý vẫn không được phép chảy vào phép tính ghế của cả tông môn.
   */
  maxJobs: number | null = null,
): Promise<void> {
  const userId = scope.kind === "user" ? scope.userId : null;
  const declared = maxJobs == null ? null : clampMaxJobs(maxJobs);
  await db()
    .insert(schema.workers)
    .values({ id: workerId, userId, version, maxJobs: declared ?? DEFAULT_MAX_JOBS })
    .onConflictDoUpdate({
      target: schema.workers.id,
      set: {
        userId,
        version,
        lastSeen: sql`now()`,
        ...(declared == null ? {} : { maxJobs: declared }),
      },
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
 * Ba trạng thái của một khôi lỗi, và chỉ ba.
 *
 * MỘT trường ba giá trị chứ không phải hai cờ `online` + `busy`: hai cờ dựng ra được một tổ hợp
 * KHÔNG TỒN TẠI ngoài đời —「đã chết mà vẫn đang bận」— và đúng tổ hợp ấy là thứ dễ lọt nhất, vì
 * một khôi lỗi vừa tắt vẫn còn dòng `running` đeo tên nó cho tới khi reaper ra tay. Gộp thành một
 * trường thì cái tổ hợp ấy không viết ra được.
 *
 *   `busy`    đang trực VÀ đang giữ ít nhất một đàn còn nhịp tim
 *   `idle`    đang trực, chưa cầm đàn nào — sẵn sàng nhận việc
 *   `offline` im quá `ONLINE_WINDOW_MS`; cửa phát việc đã gạch tên
 */
export type WorkerState = "busy" | "idle" | "offline";

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
  state: WorkerState;
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
  /**
   * Bản gói khôi lỗi; `null` = khôi lỗi chạy bản trước 0.71.0 (chưa biết khai số), hoặc đây là
   * DÒNG GỘP của một sổ tông môn rỗng — dòng ấy không đại diện cho tiến trình nào nên không có
   * số bản nào để kể. Từ 19/08/2026 không còn nghĩa「người xem không được biết」.
   */
  version: string | null;
};

/**
 * Sổ khôi lỗi cho tab Khôi Lỗi của trang Hàng Đợi: ai đang trực để nhặt việc.
 *
 * Hai nhóm, và chỉ hai: khôi lỗi TÔNG MÔN (của chung, `user_id is null`) và khôi lỗi RIÊNG của
 * CHÍNH người xem. Khôi lỗi riêng của người khác không bao giờ vào danh sách này — nó là máy ở
 * nhà họ, và trang này vốn đã che cả tên chủ nhân thì không có lý gì kể tên máy.
 *
 * <b>Từ 19/08/2026, MỌI đạo hữu đọc được từng tiến trình tông môn một</b> — id, đang trực hay
 * vắng, và số bản. Trước đó chỉ bậc trị sự (`admin.panel`) thấy, còn môn đồ thường nhận MỘT dòng
 * gộp「có ai đó đang trực」, với lập luận: id của một khôi lỗi tông môn là chi tiết vận hành (máy
 * nào, trạm nào) mà môn đồ không dùng được vào việc gì, còn tông môn thì hở ra hình dạng hạ tầng
 * của mình. Tông chủ bác lập luận ấy: đây là hạ tầng CỦA CHUNG, ai cũng đang trông vào nó, nên
 * ai cũng được thấy nó gồm những gì. Ghi lại để người sau biết đây là một ranh giới được DỊCH có
 * chủ ý, không phải một chỗ rò rỉ — cùng lối với cú đổi phía của tên nhiệm vụ ngày 08/08.
 *
 * Cái KHÔNG dịch: khôi lỗi RIÊNG của người khác vẫn không bao giờ vào danh sách này (máy ở nhà
 * họ không phải hạ tầng của tông môn), và nút Dừng vẫn nằm sau `job.force_stop`. Thấy không phải
 * là được chạm.
 *
 * HAI câu truy vấn chứ không một câu `or` rồi cắt 20: một người nuôi mười khôi lỗi riêng sẽ
 * đẩy khôi lỗi tông môn ra khỏi trần, tức nhóm quan trọng nhất biến mất đúng ở màn hình của
 * người bận rộn nhất. Mỗi nhóm một trần, không nhóm nào ăn phần của nhóm kia.
 */
export async function getWorkerRoster(viewerId: string): Promise<WorkerRosterEntry[]> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const columns = {
    id: schema.workers.id,
    lastSeen: schema.workers.lastSeen,
    version: schema.workers.version,
  };

  /**
   * Khôi lỗi nào đang giữ đàn — MỘT câu gộp cho cả sổ, không phải một câu cho mỗi dòng.
   *
   * Mệnh đề lọc là BẢN SAO ĐÚNG của phép đếm ghế trong `claimNextJob` (jobs.ts): cùng hai trạng
   * thái đàn, cùng cửa sổ nhịp tim `STALE_AFTER_MS`. Lệch một chi tiết là tab này khai「đang rảnh」
   * trong khi cửa phát việc đọc「đầy ghế」, và người đọc sẽ đi tìm một cái hỏng không tồn tại.
   *
   * Lọc nhịp tim là phần KHÔNG được bỏ: một tiến trình vừa khởi động lại bỏ rơi các dòng của kiếp
   * trước, và chúng còn đeo tên nó tới ba phút. Đếm cả chúng thì khôi lỗi vừa sống lại hiện「đang
   * bận」suốt ba phút đúng lúc nó rảnh nhất.
   */
  const busyRows = await db().execute(sql`
    select worker_id
    from automation_jobs
    where worker_id is not null
      and status in ('running', 'stopping')
      and last_heartbeat > now() - ${`${STALE_AFTER_MS} milliseconds`}::interval
    group by worker_id
  `);
  const busy = new Set(
    ((busyRows.rows ?? []) as Array<{ worker_id: unknown }>).map((row) => String(row.worker_id)),
  );

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
  /**
   * Vắng mặt THẮNG mọi thứ khác, và thứ tự hai nhánh này chính là chỗ luật ấy được thi hành.
   *
   * Một khôi lỗi vừa tắt còn để lại dòng `running` mang tên nó, nên nó vẫn nằm trong `busy`. Hỏi
   * `online` trước là điều DUY NHẤT ngăn tab khai「đang bận」về một tiến trình đã chết.
   */
  const stateOf = (id: string, lastSeen: Date): WorkerState =>
    !isOnline(lastSeen) ? "offline" : busy.has(id) ? "busy" : "idle";
  /** Mốc chỉ đi xuống dây khi ĐANG VẮNG — lý do ở `WorkerRosterEntry.lastSeen`. */
  const seenIfAway = (online: boolean, lastSeen: Date) => (online ? null : lastSeen.toISOString());

  const detailedSect: WorkerRosterEntry[] = sect.map((row) => {
    const online = isOnline(row.lastSeen);
    return {
      id: row.id,
      kind: "sect",
      state: stateOf(row.id, row.lastSeen),
      lastSeen: seenIfAway(online, row.lastSeen),
      version: row.version,
    };
  });

  /**
   * DÒNG GỘP — nay chỉ còn MỘT việc: nói「tông môn đang vắng」khi sổ chưa có khôi lỗi tông môn
   * nào (trạm vừa dựng, hay vừa chuyển trạm). Người xem cần đọc được điều đó thành một câu chứ
   * không phải nhìn một danh sách rỗng rồi tự đoán「vắng」hay「trang hỏng」.
   *
   * Trước 19/08/2026 nó còn là bản gộp dành cho môn đồ thường; nay mọi người đọc từng tiến
   * trình một nên nhánh ấy đã đi. `sect` xếp theo lần điểm danh mới nhất nên phần tử đầu là mốc
   * gần nhất.
   */
  const anySectOnline = detailedSect.some((row) => row.state !== "offline");
  /**
   * Dòng gộp KHÔNG BAO GIỜ khai `busy`, kể cả khi nó khai đang trực: nó không đại diện cho một
   * tiến trình nào nên không có ghế nào để mà bận. Nó chỉ trả lời đúng một câu —「tông môn có ai
   * trực không」— và `idle`/`offline` là hai vế của đúng câu ấy.
   */
  const groupedSect: WorkerRosterEntry = {
    id: null,
    kind: "sect",
    state: anySectOnline ? "idle" : "offline",
    lastSeen: anySectOnline ? null : (sect[0]?.lastSeen.toISOString() ?? null),
    version: null,
  };

  // Sổ rỗng thì kể từng tiến trình một sẽ ra một danh sách RỖNG — người xem nhìn tab không thấy
  // dòng nào và không có cách gì biết là「vắng」hay là「trang hỏng」. Dòng gộp nói đúng điều ấy
  // bằng một câu, và đó là ca DUY NHẤT nó còn xuất hiện.
  const sectRows = detailedSect.length > 0 ? detailedSect : [groupedSect];

  const mineRows: WorkerRosterEntry[] = mine.map((row) => {
    const online = isOnline(row.lastSeen);
    return {
      id: row.id,
      kind: "mine",
      state: stateOf(row.id, row.lastSeen),
      lastSeen: seenIfAway(online, row.lastSeen),
      version: row.version,
    };
  });

  // Tông môn đứng trước: đó là khôi lỗi phục vụ mọi người, và với hầu hết đạo hữu thì nó là
  // dòng DUY NHẤT đáng đọc. Trong mỗi nhóm, ai đang trực đứng trên — `busy` và `idle` NGANG NHAU
  // ở phép xếp này, vì cả hai đều là「máy còn sống」, và xáo thứ tự mỗi lần một đàn bắt đầu hay
  // kết thúc sẽ làm cả danh sách nhảy dưới mắt người đang đọc.
  const byPresence = (a: WorkerRosterEntry, b: WorkerRosterEntry) =>
    Number(b.state !== "offline") - Number(a.state !== "offline");
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
