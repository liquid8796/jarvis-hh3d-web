/**
 * BỘ CÂN TẢI — ai được nhận đàn kế tiếp.
 *
 * Luật cũ là「ai hỏi trước lấy trước」: `claimNextJob` phát đàn cho khôi lỗi nào gõ cửa sớm
 * nhất, không đếm xem nó đang cầm mấy đàn rồi. Với một khôi lỗi thì đó là luật đúng; với bảy
 * cái (13/08/2026: `tong-mon-khoiloi`, `github-khoiloi`, bốn `khoiloi-tro-*`, một máy nhà) thì
 * nó xếp việc theo NHỊP HỎI chứ không theo SỨC CHỨA — cái nào vừa rảnh xong sẽ vơ liền hai
 * đàn trong hai nhịp 5 giây, trong khi cái vừa lên ca đứng không tới lượt sau.
 *
 * Luật mới: LUÂN PHIÊN (round-robin) theo「lần gần nhất được giao việc」. Khôi lỗi nào lâu chưa
 * được giao nhất thì tới lượt nó; chưa từng được giao (vừa lên ca) thì đứng đầu hàng.
 *
 * <b>Vì sao vẫn là PULL, không phải PUSH.</b> Máy chủ không gọi được vào khôi lỗi — VM nằm sau
 * NAT, runner GitHub thì không có địa chỉ nào bền tới ba tiếng. Nên「cân tải」ở đây là một phép
 * XÉT DUYỆT tại cửa: khôi lỗi vẫn hỏi việc mỗi 5 giây, và câu trả lời bây giờ là「tới lượt
 * ngươi」hoặc「chưa」. Cái giá: một đàn có thể nằm chờ tối đa một nhịp hỏi (5 giây) để đúng
 * khôi lỗi tới lượt cầm nó. Đổi lại là tải trải đều, và 5 giây thì không ai thấy.
 *
 * <b>Đàn đang nghỉ cooldown KHÔNG được gán cho ai.</b> Danh sách ứng viên chỉ gồm đàn đã tới
 * giờ (`next_run_at <= now()`); và `completeWorkerCycle` nhả `worker_id` về `null` khi đàn quay
 * lại hàng chờ. Trước đây dòng job đeo nguyên tên khôi lỗi cũ suốt cả tiếng cooldown, nên bảng
 * Hàng Đợi vẽ ra một sự phân công không có thật — và người đọc kết luận sai rằng đàn ấy đã
 * được đặt chỗ. Việc gán xảy ra ĐÚNG lúc đàn thức dậy và bắt đầu chạy nhiệm vụ, không sớm hơn
 * một giây nào.
 *
 * <b>Hàm THUẦN, không chạm database</b> — cùng lối với `assignQueueSlots` (queue.ts) và vì cùng
 * một lý do: đây là luật PHÂN CÔNG, sai một nhánh thì hoặc đàn nằm chờ vĩnh viễn, hoặc một khôi
 * lỗi ôm hết việc. `verify:dispatch` đóng đinh từng nhánh mà không cần dựng database, không cần
 * giành đàn của người đang dùng.
 */

/**
 * Một khôi lỗi im lặng quá ngần này thì coi như đã rời ca — KHÔNG được chia việc nữa.
 *
 * Hằng số sống ở ĐÂY, module lá không phụ thuộc gì, vì nó là luật PHÁT VIỆC trước đã: câu hỏi
 * "ai đang trực" sinh ra để trả lời "ai được nhận đàn". Sổ điểm danh và dashboard tái xuất nó
 * từ `workers.ts` để cả ba nơi hỏi đúng một nguồn — hai bản của cùng một cửa sổ là hai dịp để
 * dashboard nói "đang trực" trong khi cửa phát việc đã gạch tên.
 *
 * 30 giây = sáu nhịp hỏi việc (5 giây một nhịp), đủ rộng để một cú vấp mạng không biến "đang
 * trực" thành "vắng mặt".
 */
export const ONLINE_WINDOW_MS = 30 * 1000;

/**
 * Một đàn im lặng quá ngần này thì coi như đã chết — reaper kết liễu, và phép đếm ghế thôi tính nó.
 *
 * Hằng số sống ở đây cùng lẽ với `ONLINE_WINDOW_MS`: nó là luật ĐẾM GHẾ, và đã có BA nơi phải hỏi
 * đúng một nguồn — reaper (`jobs.ts`), cửa phát việc, và nay cả sổ khôi lỗi ở tab Hàng Đợi. Trước
 * 28/08/2026 nó là `const` riêng trong `jobs.ts`, mà `workers.ts` thì không import ngược được
 * (`jobs.ts` đã import `workers.ts` — nhập vòng). Chép thành bản thứ hai là hẹn ngày giao diện
 * khai「đang rảnh」trong khi cửa phát việc đọc là「đầy ghế」.
 *
 * Vì sao phép đếm ghế BẮT BUỘC lọc theo nhịp tim, không đếm mọi dòng `running` mang tên một khôi
 * lỗi: một tiến trình vừa khởi động lại bỏ rơi các dòng của kiếp trước, và chúng còn đeo tên nó
 * cho tới khi reaper ra tay. Đếm cả chúng thì khôi lỗi vừa sống lại bị đọc thành bận suốt ba phút
 * đúng vào lúc nó rảnh nhất.
 */
export const STALE_AFTER_MS = 3 * 60 * 1000;

/** Trần ghế của một khôi lỗi khi nó chưa tự khai (bản trước 1.1.0) — cũng là mặc định mới. */
export const DEFAULT_MAX_JOBS = 2;

/** Kẹp lời tự khai của khôi lỗi. Giống hệt khoảng `worker.mjs` tự kẹp — một dấu phẩy gõ nhầm
 *  ở drop-in systemd không được phép mở tám mươi ghế. */
export const MAX_JOBS_CEILING = 8;

/** Lời khai của khôi lỗi về trần ghế, đưa về khoảng dùng được. Vắng/rác → trần chuẩn. */
export function clampMaxJobs(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_MAX_JOBS;
  return Math.max(1, Math.min(MAX_JOBS_CEILING, Math.trunc(value)));
}

/**
 * VAN CHỐNG ĐÓI: đàn đã tới giờ mà nằm quá ngần này thì THÔI chờ lượt — khôi lỗi nào đủ tư
 * cách cũng nhận được.
 *
 * Vì sao cần: luân phiên đặt cược vào việc khôi lỗi tới lượt SẼ hỏi việc trong vài giây tới.
 * Cược ấy sai ở hai ca thật. (1) Tiến trình còn thở — nhịp tim của các đàn nó đang chạy vẫn
 * điểm danh đều — nhưng vòng hỏi việc kẹt; sổ điểm danh không phân biệt được hai thứ đó.
 * (2) Trần ghế nó tự khai cao hơn trần nó thực sự áp (bản cũ khai mặc định 2 trong khi
 * drop-in đặt 3, hoặc ngược lại), nên máy chủ tưởng nó còn chỗ mà nó thì không hỏi nữa.
 *
 * 20 giây = bốn nhịp hỏi liên tiếp bị lỡ. Ngắn hơn cửa sổ điểm danh 30 giây có chủ ý: khôi lỗi
 * CHẾT hẳn thì 30 giây nữa nó tự rụng khỏi sổ và luân phiên tự chọn lại; van này là để cứu ca
 * còn-thở-mà-không-nhận, thứ sổ điểm danh không bao giờ phát hiện ra.
 *
 * Van chỉ mở khi luân phiên đã THẤT BẠI thật: lúc bình thường một đàn được nhặt trong vòng một
 * nhịp hỏi, tức quá hạn chưa tới 5 giây, còn xa mốc này.
 */
export const TURN_GRACE_MS = 20 * 1000;

/** Trần số đàn đem ra xét mỗi lượt hỏi — hàng chờ dài hơn thì phần đuôi đợi nhịp sau. */
export const DISPATCH_CANDIDATES = 50;

/** Một khôi lỗi trong sổ điểm danh, rút gọn còn đúng thứ phép xét duyệt cần biết. */
export type DispatchRunner = {
  id: string;
  /** `null` = khôi lỗi TÔNG MÔN (token vận hành). Có giá trị = khôi lỗi riêng của đạo hữu ấy. */
  userId: string | null;
  /** Điểm danh lần cuối, tính bằng mili giây epoch. */
  lastSeen: number;
  /** Lần gần nhất cửa phát việc trao cho nó một đàn; `null` = chưa bao giờ (vừa lên ca). */
  lastAssignedAt: number | null;
  /** Trần ghế nó tự khai (đã kẹp). */
  maxJobs: number;
  /** Số đàn nó đang cầm ngay lúc này. */
  running: number;
};

/** Một đàn đã tới giờ chạy. */
export type DispatchJob = {
  id: string;
  /** Chủ đàn — quyết định khôi lỗi riêng nào được phép cầm. */
  userId: string;
  /**
   * `workerPref` của CHỦ đàn: `sect` | `mine` | `any`.
   *
   * Kiểu `string` chứ không phải union, và giá trị lạ được đọc như `any` — y hệt mệnh đề SQL
   * đời trước (`<>` thay vì `in`). Một giá trị rác lọt vào JSONB (chỉ có thể do sửa tay
   * database) thì đàn vẫn chạy được bằng CẢ HAI loại khôi lỗi, thay vì nằm im mà không dòng
   * nhật ký nào giải thích. Hỏng theo hướng vẫn phục vụ.
   */
  ownerPref: string;
  /** `next_run_at` tính bằng mili giây epoch — đầu vào của van chống đói. */
  dueAt: number;
  /**
   * Khôi lỗi đã chạy vòng GẦN NHẤT của đàn này (`automation_jobs.last_worker_id`), hoặc `null`
   * khi đàn chưa từng chạy. Đầu vào của phép DÍNH CHÂN — xem `preferredRunner`.
   */
  lastRunner: string | null;
};

export type DispatchInput = {
  /** Khôi lỗi đang gõ cửa. */
  askedBy: string;
  /** Sổ điểm danh — nên đã lọc còn khôi lỗi ĐANG TRỰC, nhưng hàm vẫn tự soát lại. */
  runners: readonly DispatchRunner[];
  /** Đàn đã tới giờ, ĐÃ SẮP theo đúng thứ tự phát việc (`next_run_at`, rồi `created_at`). */
  jobs: readonly DispatchJob[];
  now: number;
};

/**
 * Vì sao câu trả lời là như vậy — chỉ để ghi nhật ký debug và cho `verify:dispatch` đóng đinh
 * từng nhánh. Không nơi nào rẽ nhánh theo mã này.
 */
export type DispatchReason =
  /** Tới lượt, nhận đàn. */
  | "granted"
  /** Nhận đàn qua van chống đói: đàn đã quá hạn chờ lượt. */
  | "granted-overdue"
  /** Không có đàn nào tới giờ. */
  | "no-due-job"
  /** Khôi lỗi này hết ghế. */
  | "no-seat"
  /** Có đàn đang chờ nhưng không đàn nào khôi lỗi này được phép cầm. */
  | "not-eligible"
  /** Có đàn mình cầm được, nhưng đang là lượt của khôi lỗi khác. */
  | "waiting-turn"
  /** Có đàn mình cầm được, nhưng nó đang dính chân với một khôi lỗi khác còn trực và còn ghế. */
  | "waiting-affinity";

export type DispatchDecision = {
  /** Đàn được trao — `null` là "chưa tới lượt ngươi", khôi lỗi hỏi lại sau một nhịp. */
  jobId: string | null;
  reason: DispatchReason;
};

/** Đang trực = có điểm danh trong cửa sổ 30 giây (cùng mốc với sổ khôi lỗi của dashboard). */
function isOnline(runner: DispatchRunner, now: number): boolean {
  return now - runner.lastSeen <= ONLINE_WINDOW_MS;
}

function hasSeat(runner: DispatchRunner): boolean {
  return runner.running < runner.maxJobs;
}

/**
 * Khôi lỗi này có được phép cầm đàn kia không — HỢP NHẤT của hai luật từng nằm ở hai nơi.
 *
 *   • Scope (`WorkerScope`): khôi lỗi riêng chỉ đụng được đàn của CHÍNH CHỦ. Vế này vẫn được
 *     kẹp thêm một lần nữa trong câu SQL của `claimNextJob`, và đó là chủ ý — nó là hàng rào
 *     PHÂN QUYỀN (đàn của người khác mang theo cookie game của người khác), thứ không được
 *     phép chỉ dựa vào một hàm thuần ở tầng trên.
 *   • `workerPref` — lựa chọn「Giao đàn cho」của chủ đàn ở Tế đàn auto. Vế này TỪNG là mệnh đề
 *     SQL `workerPrefFilter`; nay về đây, một bản duy nhất, có lưới kiểm chứng đọc thẳng.
 */
function mayServe(runner: DispatchRunner, job: DispatchJob): boolean {
  const pref = job.ownerPref === "sect" || job.ownerPref === "mine" ? job.ownerPref : "any";
  if (runner.userId === null) return pref !== "mine";
  return runner.userId === job.userId && pref !== "sect";
}

/**
 * ── DÍNH CHÂN: đàn ở lại với khôi lỗi đã chạy nó, chừng nào còn ở lại được ──────────────────
 *
 * Luân phiên trải việc đều — đúng điều nó sinh ra để làm — nhưng nó trải theo TỪNG VÒNG, mà mỗi
 * khôi lỗi lại là một địa chỉ IP khác. Đo 19/08/2026 trên sổ thật: `fptshop` chạy 39 vòng trong
 * sáu giờ trên MƯỜI khôi lỗi, `long01` 41 vòng cũng trên mười. Với Cloudflare thì đó không phải
 * mười lượt khách; đó là MỘT phiên đăng nhập nhảy qua mười địa chỉ trong một buổi sáng.
 * `cf_clearance` gắn chặt với IP đã giải nó, nên mỗi cú nhảy là một lần trình diện từ một địa chỉ
 * chưa từng qua cửa — tức một màn Turnstile mới, và tông chủ thấy nó dưới dạng ảnh chụp「Xác minh
 * bạn là con người」.
 *
 * Nên luật thêm một nấc TRƯỚC luân phiên: đàn nào đã có khôi lỗi chạy nó thì trả về đúng khôi lỗi
 * ấy — miễn là nó còn trực, còn ghế, và vẫn đủ tư cách. Ba điều kiện ấy là toàn bộ cái van an
 * toàn: khôi lỗi chết, hết ghế, hay đổi hạng thì đàn đi tiếp ngay, không chờ ai.
 *
 * Không có nấc「chờ mãi」: nếu khôi lỗi cũ còn sống nhưng đang bận, van chống đói (`TURN_GRACE_MS`)
 * vẫn mở đúng như trước và đàn sang tay người khác sau 20 giây. Dính chân là một ƯU TIÊN, không
 * phải một sợi xích — đổi một chút thông lượng lấy việc thôi nhảy IP, và chỉ trong 20 giây.
 *
 * Trả `null` nghĩa là「đàn này không dính chân ai cả」, không phải「không ai được cầm」.
 */
function preferredRunner(
  job: DispatchJob,
  runners: readonly DispatchRunner[],
  now: number,
): DispatchRunner | null {
  if (job.lastRunner === null) return null;
  const runner = runners.find((candidate) => candidate.id === job.lastRunner);
  if (!runner) return null;
  if (!isOnline(runner, now) || !hasSeat(runner) || !mayServe(runner, job)) return null;
  return runner;
}

/**
 * Tới lượt AI trong đám đủ tư cách.
 *
 * `?? 0` cho khôi lỗi chưa từng được giao việc: mốc 0 là quá khứ xa nhất, nên nó đứng đầu hàng
 * — đúng điều ta muốn với một khôi lỗi vừa lên ca. Phá hoà bằng `id` để hai khôi lỗi hỏi việc
 * trong cùng một mili giây vẫn ra CÙNG một người thắng ở cả hai lượt tính: phép xét này chạy
 * độc lập trên mỗi request, nên nó phải tất định, bằng không hai khôi lỗi cùng tưởng mình tới
 * lượt và cùng lao vào một đàn (câu UPDATE có điều kiện sẽ chặn được, nhưng một trong hai mất
 * trắng một nhịp).
 */
function turnHolder(eligible: readonly DispatchRunner[]): DispatchRunner | null {
  let best: DispatchRunner | null = null;
  for (const runner of eligible) {
    if (best === null) {
      best = runner;
      continue;
    }
    const a = runner.lastAssignedAt ?? 0;
    const b = best.lastAssignedAt ?? 0;
    if (a < b || (a === b && runner.id < best.id)) best = runner;
  }
  return best;
}

/**
 * Khôi lỗi `askedBy` được nhận đàn nào — hoặc không đàn nào.
 *
 * Duyệt đàn theo ĐÚNG thứ tự phát việc và trả về cái ĐẦU TIÊN thuộc về mình. Duyệt tiếp thay
 * vì dừng ở đàn đầu tiên là điều bắt buộc: đàn đứng đầu có thể đang là lượt của khôi lỗi khác,
 * hoặc chẳng khôi lỗi nào đang trực cầm được nó (chủ nó chọn「chỉ máy nhà」mà máy ấy đang tắt).
 * Dừng lại ở đó là để một đàn không ai phục vụ được chặn đứng cả hàng — đúng thứ bệnh mà bản
 * SQL đời trước tránh được nhờ lọc ngay trong câu truy vấn.
 */
export function pickDispatch(input: DispatchInput): DispatchDecision {
  const { askedBy, runners, jobs, now } = input;

  const me = runners.find((runner) => runner.id === askedBy);
  // Không có trong sổ nghĩa là vừa bị gỡ (hoặc chưa kịp điểm danh) — nhịp sau sẽ có.
  if (!me || !isOnline(me, now)) return { jobId: null, reason: "not-eligible" };
  if (!hasSeat(me)) return { jobId: null, reason: "no-seat" };
  if (jobs.length === 0) return { jobId: null, reason: "no-due-job" };

  let sawMine = false;
  let heldByOther = false;

  for (const job of jobs) {
    if (!mayServe(me, job)) continue;
    sawMine = true;

    // Van chống đói đứng TRƯỚC mọi phép ưu tiên: khi nó mở thì cả lượt lẫn dính chân đều không
    // còn quan trọng, và ai hỏi trước thì người ấy được — miễn là đủ tư cách. Đây cũng là cái
    // van giữ cho dính chân không bao giờ thành một sợi xích.
    if (now - job.dueAt >= TURN_GRACE_MS) return { jobId: job.id, reason: "granted-overdue" };

    // Dính chân đứng TRƯỚC luân phiên: đàn đã có chủ cũ còn trực thì không đem ra chia lại.
    const preferred = preferredRunner(job, runners, now);
    if (preferred !== null) {
      if (preferred.id === askedBy) return { jobId: job.id, reason: "granted" };
      heldByOther = true;
      continue;
    }

    const eligible = runners.filter(
      (runner) => isOnline(runner, now) && hasSeat(runner) && mayServe(runner, job),
    );
    if (turnHolder(eligible)?.id === askedBy) return { jobId: job.id, reason: "granted" };
  }

  if (sawMine) return { jobId: null, reason: heldByOther ? "waiting-affinity" : "waiting-turn" };
  return { jobId: null, reason: "not-eligible" };
}
