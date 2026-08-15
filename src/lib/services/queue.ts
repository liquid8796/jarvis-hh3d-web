import { sql } from "drizzle-orm";
import { normalizeOwnerPref } from "@/lib/validation/queueAssign";
import { db } from "@/lib/db/client";
import { hasPermission } from "@/lib/auth/permissions";
import { getWorkerRoster, ONLINE_WINDOW_MS, type WorkerRosterEntry } from "@/lib/services/workers";
import type { CycleProgress, JobStatus } from "@/lib/realtime/dashboardTypes";

/**
 * Hàng đợi công việc của CẢ TÔNG MÔN — ai cũng xem được, để biết đàn của mình đang đứng thứ
 * mấy và vì sao chưa tới lượt.
 *
 * <b>Ranh giới riêng tư</b>: trang này cố ý cho thấy job của người khác, nên phải nói rõ cái
 * gì được thấy và cái gì không. Của người khác: tên đã che, trạng thái, thời điểm chạy kế,
 * số vòng đã chạy, tiến độ vòng này — CẢ SỐ ĐẾM LẪN TÊN NHIỆM VỤ ĐANG CHẠY — và khôi lỗi nào
 * đang cầm (chỉ TÔNG MÔN hay RIÊNG, không phải id máy). KHÔNG BAO GIỜ: tên tài khoản game,
 * cookie, cấu hình nhiệm vụ đã lưu, id khôi lỗi riêng. Của chính mình thì thấy đủ.
 *
 * <b>ID khôi lỗi, từ 12/08/2026</b> — hai vế, và chỉ hai (xem `visibleWorkerId`):
 *   • Khôi lỗi TÔNG MÔN: chỉ bậc trị sự (`admin.panel`) thấy đích danh tiến trình nào, ở MỌI
 *     dòng kể cả dòng của chính họ. Môn đồ thường chỉ đọc được「khôi lỗi tông môn」.
 *   • Khôi lỗi RIÊNG: chỉ CHỦ nó thấy id, y như trước. Bậc trị sự cũng không — máy ở nhà người
 *     ta không phải hạ tầng của tông môn.
 * Trước bản này, dòng của chính mình luôn kèm id, nên môn đồ thường đọc được tên tiến trình
 * tông môn qua chính đàn của họ. Đó là chi tiết vận hành (máy nào, trạm nào) mà môn đồ không
 * dùng được vào việc gì, còn tông môn thì hở ra hình dạng hạ tầng của mình.
 *
 * <b>Tên nhiệm vụ đã ĐỔI PHÍA, ngày 08/08/2026, theo yêu cầu của tông chủ.</b> Trước đó chỉ
 * con số "3/8" được qua, với lập luận: nó trả lời đúng câu hỏi trang này sinh ra để trả lời
 * — cái ghế khôi lỗi tông môn kia sắp trống chưa — mà không hé lộ ai bật những nhiệm vụ nào.
 * Lập luận ấy vẫn đúng về mặt logic; thứ đổi là điều tông môn MUỐN thấy. Ghi lại để người
 * sau biết đây là một ranh giới được dịch có chủ ý, không phải một chỗ rò rỉ.
 *
 * Cái được lộ hẹp hơn "cấu hình nhiệm vụ" — thứ vẫn nằm bên phía KHÔNG BAO GIỜ: đây là
 * những nhiệm vụ đang chạy NGAY LÚC NÀY của vòng này, không phải danh sách đã bật trong
 * ngọc giản, và nó biến mất ngay khi vòng chạy xong.
 */

/** Tiến độ một vòng, đã cắt theo ranh giới riêng tư ở đầu tệp. */
export type QueueProgress = {
  /**
   * Tên nhiệm vụ đang chạy ngay lúc này, MỌI dòng đều có — xem ghi chú "đổi phía" ở đầu tệp.
   *
   * Rỗng là một trạng thái THẬT, không phải thiếu dữ liệu: đó là quãng khôi lỗi mở trình
   * duyệt, qua cổng Cloudflare và dò hạng tài khoản, trước khi nhiệm vụ đầu tiên bắt đầu.
   */
  running: string[];
  done: number;
  total: number;
};

export type QueueEntry = {
  id: string;
  /** Dòng này của chính người đang xem. */
  mine: boolean;
  /** Tên chủ nhân — của mình thì nguyên vẹn, của người khác đã che 2/3. */
  owner: string;
  /** Tên tài khoản game: CHỈ dòng của mình mới có. */
  accountLabel: string | null;
  status: JobStatus;
  attempts: number;
  nextRunAt: string;
  /** Khôi lỗi đang cầm job. `null` = người xem chỉ được biết LOẠI — luật ở `visibleWorkerId`. */
  workerId: string | null;
  workerKind: "sect" | "personal" | null;
  /**
   * `workerPref` của CHỦ đàn — hạng máy nào đủ tư cách nhận đàn này khi chưa ai cầm.
   *
   * Đi cùng `workerKind` chứ không thay nó: một bên là SỰ KIỆN (ai đang cầm), một bên là DỰ
   * ĐỊNH (ai sẽ được phép cầm). Luật đọc hai thứ ấy thành một nhãn nằm ở
   * `validation/queueAssign.ts` — thuần, nên client dùng được mà không kéo theo database.
   */
  ownerPref: "sect" | "mine" | "any";
  /**
   * Thứ tự trong hàng chờ, tính từ 1. `null` khi job chưa tới giờ (đang nghỉ theo cooldown)
   * hoặc đang chạy — hai trạng thái ấy không xếp hàng.
   *
   * Số này CHỈ có nghĩa cùng với `queuePool`: xem chú thích ở đó.
   */
  queuePosition: number | null;
  /**
   * `queuePosition` đếm trong hàng chờ NÀO — và đây là chỗ bản trước nói dối.
   *
   * Trước 13/08/2026 chỉ có MỘT bộ đếm chạy suốt mọi dòng đang chờ, nên một đàn mà chủ nó đã
   * chọn「chỉ máy nhà」vẫn được gán số thứ tự trong hàng của khôi lỗi tông môn — một hàng mà
   * `workerPrefFilter` cấm tông môn chạm vào. Người xem đọc「thứ 1」rồi tưởng đàn mình sắp tới
   * lượt, trong khi thứ duy nhất có thể nhận nó là máy ở nhà họ, và máy ấy đang tắt.
   *
   *   `sect` — đàn mà khôi lỗi tông môn được phép nhận (`workerPref` là `sect` hoặc `any`).
   *            Số đếm chung toàn tông môn, đúng thứ tự `claimNextJob` sẽ nhặt.
   *   `own`  — đàn chỉ giao cho máy nhà. Đếm RIÊNG trong hàng của chính chủ nó, vì nó không
   *            xếp hàng với ai khác cả.
   *
   * Đàn `any` nằm ở bộ đếm `sect` dù máy nhà của chủ cũng có thể nhặt trước: con số ấy là ước
   * lượng theo đường CHUNG, tức đường chậm hơn — thà nói dài hơn thực tế còn hơn hứa ngắn.
   */
  queuePool: "sect" | "own" | null;
  /**
   * Có khôi lỗi nào ĐỦ TƯ CÁCH nhận đàn này đang trực không.
   *
   * Không phải「có ai đó đang trực」: một đàn giao riêng cho máy nhà thì hai khôi lỗi tông môn
   * đang trực cũng không giúp được gì. `false` nghĩa là con số thứ tự kia sẽ không nhúc nhích
   * cho tới khi đúng loại máy ấy lên ca — và giao diện phải nói ra điều đó thay vì đếm suông.
   */
  poolHasWorker: boolean;
  /**
   * Vòng này đang làm tới đâu. `null` khi khôi lỗi chưa khai — job đang nghỉ, vòng vừa xong,
   * hoặc khôi lỗi đời cũ chưa biết gửi. Giao diện phải chịu được `null` mà không mất chữ nào.
   */
  progress: QueueProgress | null;
  /**
   * Đã đứng yên ở đúng một tiến độ bao nhiêu MILI GIÂY — `null` nghĩa là không kẹt.
   *
   * Tính ở server chứ không ở trình duyệt, vì phép so cần `cycle_progress_at`, thứ không đi
   * xuống client: gửi một dấu thời gian thô rồi để mỗi màn hình tự kết luận là mời hai cái
   * đồng hồ lệch nhau cãi nhau về việc ai đang kẹt.
   */
  stuckFor: number | null;
  /**
   * Đàn đã dừng và còn khai lại được. Chỉ đúng với dòng đã kết thúc gần đây mà tài khoản của
   * nó vẫn còn sống và đang bật — nút Bắt Đầu chỉ nên hiện ở chỗ bấm vào là có chuyện xảy ra.
   *
   * Đây là cờ VẼ, không phải cờ quyền: luật thật gác trong `forceStartJob`, nơi mọi cánh cửa
   * của `startJob` được đi lại đủ.
   */
  restartable: boolean;
};

export type QueueSnapshot = {
  entries: QueueEntry[];
  /** Đếm nhanh cho phần tóm tắt đầu trang. */
  running: number;
  waiting: number;
  sleeping: number;
  /** Bao nhiêu đàn đang kẹt — số trên huy hiệu của tab Đang Kẹt. */
  stuck: number;
  /**
   * Sổ khôi lỗi cho tab Khôi Lỗi — đi CHUNG ảnh chụp thay vì một endpoint riêng.
   *
   * Cùng một câu hỏi thì cùng một nhịp: tab kia hỏi「đàn nào đang chờ」, tab này hỏi「còn ai
   * nhặt việc không」, và hai câu ấy chỉ có nghĩa khi trả lời cùng một khoảnh khắc — một danh
   * sách khôi lỗi cũ hơn hàng đợi sẽ vẽ ra cảnh「không ai trực」bên cạnh một đàn đang chạy.
   * Ăn theo luôn cả đường SSE lẫn nhịp hỏi lại đã có, không phải nuôi thêm đường nào.
   */
  workers: WorkerRosterEntry[];
};

/** Người đang xem hàng đợi — đủ để trả lời「được thấy gì」, không hơn. */
export type QueueViewer = { id: string; roles: readonly string[] };

/**
 * Che 2/3 tên, giữ lại đầu tên đủ để chủ nhân tự nhận ra mình.
 *
 * Đếm theo CODE POINT chứ không theo `.length`: tên có dấu tiếng Việt hoặc emoji mà cắt theo
 * đơn vị UTF-16 thì sẽ chặt đôi một ký tự và trả về ký tự lỗi.
 *
 * `floor` cho phần lộ ra, nên phần bị che LUÔN từ hai phần ba trở lên. Tên ngắn dưới ba ký
 * tự bị che sạch — lộ một trong hai chữ cái là đã quá nửa, và lời hứa "che 2/3" phải đúng
 * với mọi cái tên chứ không chỉ những cái tên đủ dài để nó tiện đúng.
 */
export function maskUsername(name: string): string {
  const chars = [...(name ?? "").trim()];
  if (chars.length === 0) return "?";

  const revealed = Math.floor(chars.length / 3);
  return chars.slice(0, revealed).join("") + "•".repeat(chars.length - revealed);
}

const ACTIVE_STATUSES = ["queued", "running", "stopping"] as const;

/**
 * Đứng yên bao lâu ở MỘT tiến độ thì gọi là kẹt.
 *
 * 45 phút, và con số ấy phải lớn hơn nhiệm vụ dài nhất chạy đúng luật chứ không phải một số
 * tròn cho đẹp: Mê Cung chờ đủ 5 người rồi đánh có thể ngốn tới ~35 phút mà tiến độ không
 * nhích một nấc nào — hoàn toàn khoẻ mạnh. Lấy 30 phút là mỗi ván Mê Cung tử tế đều bị réo
 * tên, và một danh sách toàn báo động giả thì người ta thôi đọc nó, tức là mất luôn cái tab.
 */
const STUCK_AFTER_MS = 45 * 60_000;

/**
 * Nhịp tim còn được coi là sống. Trùng ngưỡng của `reapStaleJobs` (3 phút) là CỐ Ý: quá mốc
 * ấy job thuộc về reaper, và tab này không nên tranh việc — "khôi lỗi chết" đã có đường xử lý
 * tự động rồi, còn thứ tab này săn là ca ngược lại và nguy hiểm hơn vì không ai dọn hộ: khôi
 * lỗi CÒN SỐNG, vẫn gửi nhịp tim đều, mà việc thì đứng im.
 */
const HEARTBEAT_ALIVE_MS = 3 * 60_000;

/**
 * Đàn đã dừng còn nán lại trên bảng bao lâu để còn bấm Bắt Đầu.
 *
 * 30 phút: đủ dài cho một bậc trị sự dừng đàn, đi soi nhật ký rồi quay lại khai đàn hộ; đủ
 * ngắn để Hàng Đợi không biến thành sổ lịch sử. Ai cần xa hơn thì đọc nhật ký của đàn, đó
 * mới là chỗ giữ lịch sử.
 */
const RESTARTABLE_WINDOW_MS = 30 * 60_000;

/**
 * Đọc một cột boolean về đúng `true`/`false`, không tin driver trả sẵn kiểu gì.
 *
 * Cùng lối với `String(row.status)` và `Number(row.attempts)` ở dưới: đường `execute(sql…)`
 * trả về hàng thô, và một `=== true` đặt thẳng lên giá trị thô sẽ âm thầm ra `false` nếu
 * driver đưa lên `'t'`. Cái giá của lần âm thầm ấy là nút Bắt Đầu không bao giờ hiện, mà
 * không có lỗi nào để lần theo — đúng loại hỏng tệ nhất.
 */
const isTrue = (value: unknown): boolean => value === true || value === "t" || value === "true";

/** Trần hiển thị cho danh sách tên nhiệm vụ — xem lý do trong `readProgress`. */
const MAX_RUNNING_QUEST_NAMES = 12;
const MAX_QUEST_NAME_LENGTH = 60;

/**
 * Đọc cột `cycle_progress` về đúng hình thù, và trả `null` cho mọi thứ không phải hình thù
 * đó. Zod ở /api/worker đã canh cửa GHI, nên đây không phải lớp canh thứ hai — nó là lời
 * thừa nhận rằng cột jsonb này sống lâu hơn mọi phiên bản code đã ghi vào nó: một dòng do
 * bản cũ để lại, hay một lần sửa tay trên database, không được phép làm trắng cả trang.
 *
 * Trước 08/08/2026 hàm này còn nhận `mine` để cắt tên nhiệm vụ của người khác. Tham số ấy đã
 * bỏ hẳn thay vì để lại và luôn truyền `true`: một tham số riêng tư không còn ai đọc là một
 * cái bẫy mời người sau tin rằng vẫn còn phép cắt ở đâu đó.
 *
 * Export vì cùng lý do với `maskUsername`: phép cắt riêng tư đáng được ghim bằng test trực
 * tiếp, không phải qua ba lớp database mới soi được.
 */
export function readProgress(raw: unknown): QueueProgress | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const value = raw as Partial<CycleProgress>;
  const done = Number(value.done);
  const total = Number(value.total);
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null;

  const running = Array.isArray(value.running)
    ? value.running
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        // Trần ở ĐƯỜNG ĐỌC, dù Zod của /api/worker đã chặn ở đường ghi (≤32 tên, ≤120 ký tự).
        // Không phải lớp canh thứ hai — mà vì từ hôm nay chuỗi này đi thẳng lên màn hình của
        // MỌI đạo hữu, chứ không riêng chủ nó. Cột jsonb sống lâu hơn mọi phiên bản code đã
        // ghi vào nó (một dòng do bản cũ để lại, một lần sửa tay), và một dòng như thế giờ
        // làm hỏng trang của cả tông môn chứ không của một người. Hai con số dưới đây rộng
        // gấp nhiều lần dữ liệu thật — tối đa 8 tab, tên dài nhất trong hồ sơ ~30 ký tự —
        // nên chúng không bao giờ chạm vào một hàng đợi lành lặn.
        .filter((name) => name.length <= MAX_QUEST_NAME_LENGTH)
        .slice(0, MAX_RUNNING_QUEST_NAMES)
    : [];

  return { running, done, total };
}

/**
 * Ai được thấy ID THẬT của khôi lỗi đang cầm một đàn — luật đầy đủ ở đầu tệp.
 *
 * Một hàm thuần đứng riêng thay vì một biểu thức nhét trong `map`: đây là câu quyết định
 * riêng tư của cả trang, và nó phải đọc được (lẫn thử được) mà không cần dựng database.
 */
export function visibleWorkerId(
  workerId: string | null,
  kind: "sect" | "personal" | null,
  mine: boolean,
  canInspectSect: boolean,
): string | null {
  if (workerId == null || kind == null) return null;
  return kind === "sect" ? (canInspectSect ? workerId : null) : mine ? workerId : null;
}

/**
 * `workerPref` của CHỦ đàn → hàng chờ mà đàn ấy thực sự đứng.
 *
 * MỘT bản duy nhất cho cả phép đánh số lẫn phép xếp chỗ trên bảng: hai nơi cùng hỏi「đàn này
 * thuộc hàng nào」mà tự trả lời riêng thì có ngày một dòng được đánh số theo hàng riêng nhưng
 * lại vẽ vào chỗ của hàng chung — đúng loại lệch không kêu lên tiếng nào.
 *
 * Giá trị lạ đọc như `any` (fail-open, cùng lối `mayServe` bên dispatch.ts): sửa tay database ra
 * một chuỗi không ai biết thì đàn vẫn được phục vụ ở hàng chung, thay vì nằm im ở một hàng riêng
 * không máy nào của chủ nó đang trực.
 */
const queuePoolOf = (ownerPref: string): "sect" | "own" => (ownerPref === "mine" ? "own" : "sect");

/** Đàn đã tắt hẳn — dòng chỉ còn nán lại trên bảng để có chỗ bấm Bắt Đầu. */
const isFinishedStatus = (status: string): boolean => status === "stopped" || status === "failed";

/**
 * Chỗ đứng trên BẢNG, ba bậc — số nhỏ đứng trên. Đây là thứ tự HIỂN THỊ, không phải thứ tự
 * nhặt việc (thứ tự ấy do câu SQL giữ, xem `getQueueSnapshot`).
 *
 *   `sect`     — đàn ở hàng CHUNG: hàng mà khôi lỗi tông môn sẽ nhặt, tức đúng câu hỏi trang
 *                này sinh ra để trả lời.
 *   `own`      — đàn giao riêng cho máy nhà. Nó KHÔNG đứng chung hàng với ai, nên nó không
 *                được phép chiếm chỗ trong hàng chung dù tới giờ sớm hơn.
 *   `finished` — đàn đã tắt, chỉ nán lại 30 phút để còn chỗ bấm Bắt Đầu.
 */
const DISPLAY_RANK = { sect: 0, own: 1, finished: 2 } as const;

/** Một dòng cần khai gì để xếp chỗ trên bảng — ít hơn hẳn thứ phép đánh số cần. */
export type QueueDisplayKey = {
  finished: boolean;
  /** `workerPref` của CHỦ đàn — cùng giá trị `assignQueueSlots` đọc. */
  ownerPref: string;
};

/**
 * XẾP CHỖ TRÊN BẢNG — đàn giao riêng cho máy nhà luôn nằm DƯỚI hàng chung.
 *
 * Vì sao cần: đàn `workerPref = mine` không đứng trong hàng của khôi lỗi tông môn — `mayServe`
 * cấm tông môn chạm vào nó — nhưng nó vẫn có `next_run_at`, nên thứ tự nhặt việc đẩy nó lên
 * ĐỈNH bảng khi nó tới giờ sớm. Đo 14/08/2026: hai dòng「Chờ máy nhà — chưa máy nào trực」ngồi
 * hai chỗ đầu tiên, trong khi cả hàng chung — thứ mà bảng này sinh ra để kể — nằm phía dưới,
 * và hai dòng ấy sẽ không nhúc nhích cho tới khi máy ở nhà chủ nó lên ca. Một cái đỉnh bảng
 * dành cho những dòng không đi đâu cả.
 *
 * Chỉ ĐỔI CHỖ, không đánh số: `assignQueueSlots` vẫn là nơi duy nhất sinh ra số thứ tự, và
 * phép xếp này giữ nguyên thứ tự tương đối TRONG mỗi bậc — nên hai bộ đếm (hàng chung, và hàng
 * riêng của từng chủ) đọc được y hệt một dãy như trước, chỉ là dãy ấy nay nằm rời làm hai khúc.
 *
 * Hàm THUẦN, nhận một phép đọc khoá thay vì hình dạng cứng: nhờ vậy `verify:queue-pools` đóng
 * đinh được luật này bằng vài object trần, không cần dựng database.
 */
export function orderQueueRows<T>(rows: readonly T[], key: (row: T) => QueueDisplayKey): T[] {
  return rows
    .map((row, index) => {
      const { finished, ownerPref } = key(row);
      const rank = finished
        ? DISPLAY_RANK.finished
        : queuePoolOf(ownerPref) === "own"
          ? DISPLAY_RANK.own
          : DISPLAY_RANK.sect;
      return { row, index, rank };
    })
    // Phá hoà bằng chỉ số CŨ, không nhờ vào tính ổn định của `Array#sort`: thứ tự trong mỗi bậc
    // chính là thứ nuôi hai bộ đếm ở `assignQueueSlots`, nên nó phải đúng theo hợp đồng viết ra
    // ở đây chứ không theo một chi tiết của máy chạy.
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.row);
}

/** Một dòng đang chờ, rút gọn còn đúng thứ mà phép xếp chỗ cần biết. */
export type QueueCandidate = {
  userId: string;
  /** `workerPref` của CHỦ đàn: `sect` | `mine` | `any`. Giá trị lạ được đọc như `any`. */
  ownerPref: string;
  ownerWorkerOnline: boolean;
  /** Đã tới giờ mà chưa ai nhặt. Dòng đang chạy/đang nghỉ không xếp hàng. */
  queued: boolean;
};

export type QueueSlot = {
  pool: "sect" | "own" | null;
  position: number | null;
  poolHasWorker: boolean;
};

/**
 * XẾP CHỖ — phần quyết định của ảnh chụp hàng đợi, tách ra làm hàm THUẦN.
 *
 * Tách vì đây đúng là chỗ đã nói dối suốt: bản trước chạy MỘT bộ đếm cho mọi dòng, nên một đàn
 * mà chủ đã chọn「chỉ máy nhà」vẫn nhận số thứ tự trong hàng của khôi lỗi tông môn — hàng mà
 * `workerPrefFilter` cấm tông môn chạm tới. Lỗi ấy không có cách nào lộ ra bằng mắt: con số vẫn
 * tăng đều, vẫn đẹp, chỉ là nó đếm một cuộc đua mà đàn ấy không tham gia. Thuần thì
 * `verify:queue-pools` đóng đinh được từng luật mà không cần dựng database.
 *
 * Hàm này chỉ ĐÁNH SỐ, không sắp xếp lại gì cả — nên đầu vào phải mang sẵn thứ tự `claimNextJob`
 * nhặt việc (`next_run_at`, rồi `created_at`). Chính xác thì đòi hỏi ấy chỉ tính TRONG mỗi hàng:
 * dãy con của hàng chung, và dãy con của từng chủ máy nhà. Hai bộ đếm dưới đây không bao giờ
 * nhìn sang nhau, nên `orderQueueRows` gom các dòng máy nhà xuống cuối mảng không đổi một con số
 * nào; đổi thứ tự BÊN TRONG một hàng thì có.
 */
export function assignQueueSlots(
  rows: readonly QueueCandidate[],
  sectOnline: boolean,
): QueueSlot[] {
  let sectPosition = 0;
  const ownPositions = new Map<string, number>();

  return rows.map((row) => {
    // `any` là ca dễ sai nhất: nó đứng ở hàng CHUNG, nhưng máy nhà của chủ cũng nhặt được —
    // nên câu「có ai trực không」phải hỏi CẢ HAI, bằng không một đàn `any` bị báo là vô vọng
    // vào đúng lúc máy nhà của chủ nó đang chạy ngon lành.
    const pool = queuePoolOf(row.ownerPref);
    const poolHasWorker =
      row.ownerPref === "mine"
        ? row.ownerWorkerOnline
        : row.ownerPref === "sect"
          ? sectOnline
          : sectOnline || row.ownerWorkerOnline;

    if (!row.queued) {
      return { pool: null, position: null, poolHasWorker };
    }
    if (pool === "own") {
      const next = (ownPositions.get(row.userId) ?? 0) + 1;
      ownPositions.set(row.userId, next);
      return { pool, position: next, poolHasWorker };
    }
    return { pool, position: ++sectPosition, poolHasWorker };
  });
}

/**
 * Ảnh chụp hàng đợi tại thời điểm gọi.
 *
 * HAI tầng thứ tự, và chúng khác nhau có chủ ý:
 *   • Câu SQL trả về đúng thứ tự `claimNextJob` nhặt việc (`next_run_at`, rồi `created_at`), nên
 *     con số thứ tự do `assignQueueSlots` đánh chính là thứ tự khôi lỗi sẽ nhặt — không phải
 *     một cách sắp xếp riêng của giao diện rồi người dùng đoán nhầm là hàng chờ thật.
 *   • `orderQueueRows` rồi mới bày mảng ấy ra bảng: đàn máy nhà xuống dưới hàng chung, đàn đã
 *     tắt xuống cuối. Nó chỉ đổi CHỖ NGỒI, không đổi con số — xem lý do ở chính hàm đó.
 *
 * Nhận cả NGƯỜI XEM chứ không riêng id của họ: phép cắt riêng tư nay hỏi tới vai (id khôi lỗi
 * tông môn chỉ dành cho bậc trị sự), và câu hỏi ấy phải được trả lời TRONG service. Truyền
 * xuống một cờ `canSee…` do nơi gọi tự tính thì ba nơi gọi là ba dịp tính lệch nhau, mà lệch ở
 * đây nghĩa là một trang rò thứ trang khác giấu.
 */
export async function getQueueSnapshot(viewer: QueueViewer): Promise<QueueSnapshot> {
  const viewerId = viewer.id;
  const canInspectSect = hasPermission(viewer, "admin.panel");

  // Hỏi song song: sổ khôi lỗi không phụ thuộc gì vào bảng đàn, mà đường này chạy ở mỗi lượt
  // SSE lẫn mỗi nhịp hỏi lại — nối tiếp là cộng thêm một vòng đi-về vào đúng chỗ đông nhịp nhất.
  const [result, workers] = await Promise.all([
    db().execute(sql`
    select
      job.id, job.user_id, job.status, job.attempts, job.next_run_at, job.worker_id,
      job.cycle_progress, job.cycle_progress_at, job.last_heartbeat, job.finished_at,
      usr.username,
      acc.label as account_label,
      acc.enabled as account_enabled,
      case when job.worker_id is null then null
           when w.id is null then 'personal'
           when w.user_id is null then 'sect'
           else 'personal' end as worker_kind,
      -- Lựa chọn「Giao đàn cho」của CHỦ đàn, không phải của người đang xem. Đọc thẳng
      -- user_configs cùng lối với workerPrefFilter — hai nơi phải cùng đọc một sự thật, bằng
      -- không bảng sẽ vẽ một hàng chờ khác với hàng mà cửa phát việc thực sự dùng.
      -- (Không dùng dấu huyền trong bình chú SQL: cả câu này nằm trong một template literal.)
      coalesce(
        (select uc.config->>'workerPref' from user_configs as uc where uc.user_id = job.user_id),
        'any'
      ) as owner_pref,
      -- Chủ đàn có máy nhà nào đang trực không. Cùng cửa sổ 30 giây với sổ điểm danh.
      exists (
        select 1 from workers as ow
        where ow.user_id = job.user_id
          and ow.last_seen > now() - ${`${ONLINE_WINDOW_MS} milliseconds`}::interval
      ) as owner_worker_online
    from automation_jobs as job
    join users as usr on usr.id = job.user_id
    left join game_accounts as acc on acc.id = job.account_id
    left join workers as w on w.id = job.worker_id
    where job.status in ('queued', 'running', 'stopping')
       or (
         job.status in ('stopped', 'failed')
         and job.finished_at > now() - ${`${RESTARTABLE_WINDOW_MS} milliseconds`}::interval
         -- Tài khoản đã có đàn sống thì dòng đã tắt của nó KHÔNG còn việc gì trên bảng nữa.
         -- Thiếu điều kiện này thì sau một lượt khai hộ, cùng một tài khoản hiện HAI lần —
         -- một dòng đang chạy và một dòng đã tắt vẫn đeo nút Bắt Đầu, mà bấm vào chỉ nhận
         -- "đàn này đang chạy rồi". Một cái nút chỉ để bị từ chối thì thà đừng có.
         and not exists (
           select 1 from automation_jobs as live
           where live.account_id = job.account_id
             and live.status in ('queued', 'running', 'stopping')
         )
         -- Và chỉ giữ LẦN TẮT GẦN NHẤT của mỗi tài khoản. Dừng → khai lại → dừng tiếp trong
         -- vòng 30 phút sẽ đẻ ra nhiều dòng đã tắt cho cùng một tài khoản, mỗi dòng một nút
         -- làm đúng một việc giống nhau. Nhánh account_id IS NULL (tài khoản đã bị xoá) đi
         -- lối riêng vì phép so với NULL không bao giờ đúng, và im lặng vứt mất dòng ấy thì
         -- lịch sử vừa xảy ra biến khỏi bảng mà không ai hiểu vì sao.
         and (
           job.account_id is null
           or job.finished_at = (
             select max(prev.finished_at) from automation_jobs as prev
             where prev.account_id = job.account_id
               and prev.status in ('stopped', 'failed')
           )
         )
       )
    -- CHỈ thứ tự nhặt việc, đúng như claimNextJob (next_run_at, rồi created_at) — và chỉ nó.
    -- Cách bày ra màn hình (dòng đã tắt xuống cuối, đàn máy nhà xuống dưới hàng chung) do
    -- orderQueueRows lo, một chỗ duy nhất, thuần và kiểm chứng được không cần database.
    -- Trước 14/08/2026 câu này còn mang một mệnh đề「còn sống trước, đã tắt sau」; nó nằm lại đây
    -- thì luật bày bàn sống ở hai nơi, mà hai nơi ấy đọc pref theo hai lối khác nhau.
    -- (Vẫn không dấu huyền trong bình chú SQL — xem lời dặn ở mệnh đề owner_pref bên trên.)
    order by job.next_run_at, job.created_at
  `),
    getWorkerRoster(viewerId, canInspectSect),
  ]);

  /**
   * Bày lên bảng theo thứ tự NGƯỜI ĐỌC cần, ngay tại đây — trước mọi phép tính khác.
   *
   * Sắp một lần ở đầu nguồn thì `dueQueued`, `slots` và mảng `entries` bên dưới đều đi theo
   * cùng một chỉ số; sắp ở cuối là phải khiêng theo ba mảng song song và hẹn ngày một trong ba
   * quên đổi chỗ. Mọi đường ra đều ăn ảnh chụp này (trang, /api/queue, kênh SSE), nên bảng chỉ
   * cần vẽ đúng thứ nhận được — không có nhánh xếp lại nào ở phía trình duyệt.
   */
  const rows = orderQueueRows(
    (result.rows ?? []) as Array<Record<string, unknown>>,
    (row) => ({
      finished: isFinishedStatus(String(row.status)),
      ownerPref: String(row.owner_pref ?? "any"),
    }),
  );
  const now = Date.now();
  /** Khôi lỗi tông môn có đang trực không — hỏi một lần, dùng cho mọi dòng thuộc hàng chung. */
  const sectOnline = workers.some((worker) => worker.kind === "sect" && worker.online);

  /**
   * "Đang xếp hàng" = đã tới giờ mà chưa ai nhặt. Tính MỘT LẦN ở đây rồi dùng chung cho cả phép
   * xếp chỗ lẫn vòng vẽ bên dưới: hai bản của cùng một luật là hai dịp để chúng trôi khỏi nhau,
   * và nếu trôi thì con số thứ tự sẽ đếm một tập dòng khác với tập được vẽ ra.
   */
  const dueQueued = rows.map(
    (row) => String(row.status) === "queued" && new Date(String(row.next_run_at)).getTime() <= now,
  );
  const slots = assignQueueSlots(
    rows.map((row, index) => ({
      userId: String(row.user_id),
      ownerPref: String(row.owner_pref ?? "any"),
      ownerWorkerOnline: isTrue(row.owner_worker_online),
      queued: dueQueued[index],
    })),
    sectOnline,
  );
  let running = 0;
  let waiting = 0;
  let sleeping = 0;
  let stuck = 0;

  const entries = rows.map((row, index) => {
    const status = String(row.status) as JobStatus;
    const nextRunAt = new Date(String(row.next_run_at));
    const mine = String(row.user_id) === viewerId;
    const finished = isFinishedStatus(status);

    // Job chưa tới giờ đang NGHỈ, job đang chạy thì đã ra khỏi hàng — gộp cả ba làm một con số
    // sẽ nói dối về độ dài hàng chờ. Dòng đã tắt KHÔNG được đếm vào bất cứ ô nào: nó không còn
    // trong hàng đợi nữa, nó chỉ đang nán lại trên màn hình.
    const queued = dueQueued[index];
    const slot = slots[index];
    if (finished) {
      // không đếm
    } else if (queued) waiting++;
    else if (status === "queued") sleeping++;
    else running++;

    /**
     * Kẹt = khôi lỗi CÒN SỐNG mà tiến độ đứng yên quá lâu.
     *
     * Ba điều kiện, thiếu một là sai hẳn nghĩa: phải đang `running` (đàn đã xin dừng thì đang
     * trên đường thu, réo nó lên là nhiễu), nhịp tim phải còn tươi (mất nhịp là việc của
     * reaper, không phải của người), và phải BIẾT tiến độ đổi lúc nào — `cycle_progress_at`
     * NULL nghĩa là chưa từng khai tiến độ nào, mà "không biết" thì không được phép kết luận.
     */
    const progressAt = row.cycle_progress_at == null ? null : new Date(String(row.cycle_progress_at));
    const beatAt = row.last_heartbeat == null ? null : new Date(String(row.last_heartbeat));
    const idleFor = progressAt == null ? null : now - progressAt.getTime();
    const stuckFor =
      status === "running" &&
      idleFor != null &&
      idleFor >= STUCK_AFTER_MS &&
      beatAt != null &&
      now - beatAt.getTime() <= HEARTBEAT_ALIVE_MS
        ? idleFor
        : null;
    if (stuckFor != null) stuck++;

    const workerKind = row.worker_kind == null ? null : (String(row.worker_kind) as "sect" | "personal");

    return {
      id: String(row.id),
      mine,
      owner: mine ? String(row.username) : maskUsername(String(row.username)),
      accountLabel: mine && row.account_label != null ? String(row.account_label) : null,
      status,
      attempts: Number(row.attempts ?? 0),
      nextRunAt: nextRunAt.toISOString(),
      workerId: visibleWorkerId(
        row.worker_id == null ? null : String(row.worker_id),
        workerKind,
        mine,
        canInspectSect,
      ),
      workerKind,
      ownerPref: normalizeOwnerPref(row.owner_pref == null ? null : String(row.owner_pref)),
      queuePosition: slot.position,
      queuePool: slot.pool,
      poolHasWorker: slot.poolHasWorker,
      progress: readProgress(row.cycle_progress),
      stuckFor,
      // `account_enabled` là NULL khi tài khoản đã bị xoá (left join không khớp) — phép đọc
      // này gộp cả "đã xoá" lẫn "đang tắt" về cùng một câu trả lời: không khai lại được.
      restartable: finished && isTrue(row.account_enabled),
    } satisfies QueueEntry;
  });

  return { entries, running, waiting, sleeping, stuck, workers };
}

export { ACTIVE_STATUSES };
