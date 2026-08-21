import { randomBytes, randomUUID } from "node:crypto";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";
import {
  HEARTBEAT_PATH,
  KEEPALIVE_INTERVAL_DAYS,
  MAX_DAILY_PUSHES,
  MS_PER_DAY,
  REVISION_LEDGER_PATH,
  SCHEDULE_DISABLE_DAYS,
  companionDueByNow,
  explainFailure,
  isCommitDue,
  keepaliveOrder,
  nurtureDayKey,
  parseWorkflowState,
  reviewCompanionRepos,
  stationSlug,
  type WorkflowState,
} from "@/lib/validation/githubStations";

/**
 * NUÔI KHO KHÔI LỖI GITHUB — giữ cho lịch `schedule` của các kho khỏi bị GitHub tắt
 * (deploy/github-actions.md §7).
 *
 * BÀI TOÁN: GitHub tắt lịch của một kho công khai sau 60 ngày không có hoạt động commit. Kho
 * khôi lỗi thì không ai đụng vào — nó chỉ chạy — nên mốc ấy chắc chắn tới, và khi tới thì khôi
 * lỗi im lặng ngừng lên ca, không báo ai. Chỗ này ghi vào mỗi kho một dòng mốc thời gian đủ
 * thưa để đếm ngược không bao giờ về 0.
 *
 * BA ĐIỀU QUYẾT ĐỊNH HÌNH DẠNG CỦA TỆP NÀY:
 *
 *   1. KHÔNG cần `git`. `PUT /repos/{owner}/{repo}/contents/{path}` tạo ra một COMMIT THẬT —
 *      không clone, không thư mục tạm, không binary nào. Nhờ vậy cả việc này gọn trong một
 *      Vercel function. Đây là chỗ dễ đi vòng nhất nếu không biết: cả buổi sẽ trôi vào việc tìm
 *      cách chạy `git push` trong serverless.
 *
 *   2. NGÓ mỗi ngày, GHI mỗi ~20 ngày. Lượt ngó chỉ đọc (`GET workflow`) nên rẻ và không để lại
 *      dấu vết; lượt ghi mới là thứ đếm với GitHub. Tách hai nhịp ấy giữ được cả hai điều tốt:
 *      biết kho hỏng NGAY trong ngày, mà vẫn chỉ ~18 commit rác một năm. Xem
 *      `KEEPALIVE_INTERVAL_DAYS` cho lý lẽ đầy đủ.
 *
 *   3. Lượt ngó còn là đường TỰ CHỮA. Nếu lịch ĐÃ bị tắt vì im lặng thì một commit mới không
 *      tự bật nó lại — GitHub đòi một lượt bật tường minh. Nên nhánh `disabled_inactivity` gọi
 *      `PUT .../enable` rồi ghi mốc ngay, không chờ tới hạn. Thiếu nhánh này thì hệ thống nuôi
 *      được kho khoẻ nhưng bó tay trước đúng cái kho đã ngã — tức vô dụng ở ca duy nhất nó
 *      thật sự cần thiết.
 *
 * VÀ MỘT ĐIỀU KHÔNG LÀM: kho bị tắt TAY (`disabled_manually`) thì để nguyên. Đó là quyết định
 * của một con người; bật lại giùm là cãi lại, mà cãi lặng lẽ. Sổ chỉ hiện đỏ và nói ra.
 */

const API_ROOT = "https://api.github.com";

/**
 * `2022-11-28` ghim tường minh chứ không để GitHub chọn giùm: mọi trường tệp này đọc (`state`,
 * `sha`, `commit.sha`) đều thuộc phiên bản ấy, và một API mặc định trôi sang bản sau là hỏng
 * lặng lẽ ở một trường không còn tên cũ.
 */
const API_VERSION = "2022-11-28";

/** GitHub TỪ CHỐI request không có User-Agent — 403 kèm một câu khó đoán nếu quên. */
const USER_AGENT = "auto-hh3d-keepalive";

/**
 * Trần cho MỘT lời gọi. 10 giây: đây là một việc nền chạy trong hàng đợi 8 kho, không phải một
 * phiên tương tác — chờ lâu hơn thế chỉ ăn vào phần ngân sách của những kho còn lại.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Trần cho CẢ VÒNG. 40 giây, và con số ấy suy ra từ hai thứ chứ không phải chọn cho tròn:
 *
 *   • Vòng chạy TUẦN TỰ (xem `runKeepalive`), nên một sổ toàn kho chậm là n × 3 lời gọi × 10 giây
 *     — lớn tuỳ ý theo số kho, tới mức phải có ai đó cắt.
 *   • `maxDuration` của /api/cron là 60 giây, và vòng nuôi KHÔNG được tiêu cả 60: nó chạy SAU ba
 *     việc quét dọn trong cùng một lượt gọi. 40 chừa lại 20 giây cho chúng.
 *
 * Cắt ở đây là cắt có trật tự — mỗi kho đã ghi sổ ngay sau khi xong, và tổng kết nói rõ còn mấy
 * kho chưa tới lượt. Để function bị nền tảng giết ngang thì không ai biết nó đã đi tới đâu. Kho
 * bị bỏ lại vẫn còn 40 ngày dự phòng nên lượt cron ngày mai lo tiếp là dư sức.
 *
 * ĐO THẬT 18/08/2026 (nhật ký `jarvis-cron` lúc 03:00:24→25 UTC): 8 kho khoẻ CỘNG ba việc quét
 * dọn xong trong dưới MỘT giây — tức ~0,12 giây một kho ở đường sung sức, nên 40 giây đủ cho hàng
 * trăm kho. Trần này chỉ có tiếng nói vào ngày GitHub treo, và đó đúng là ngày nên dừng sớm rồi
 * để lượt mai tiếp — nay an toàn vì `keepaliveOrder` bảo đảm cú cắt rơi vào kho CÒN NHIỀU HẠN
 * nhất. Vì thế con số giữ nguyên 40 dù đường gọi thật (`curl -m 300` từ `jarvis-cron.timer` trên
 * VM) cho tới 300 giây: nâng lên chẳng mua được gì, mà lại lệch với `maxDuration` đang khai.
 */
const LOOP_BUDGET_MS = 40_000;

type Station = AppSettings["githubStations"][number];
type CompanionRepo = Station["companionRepos"][number];

/** Kết quả của một kho, đủ để ghi sổ lẫn để hiện lên tab admin. */
export type StationPing = {
  slug: string;
  ok: boolean;
  note: string;
  /** Lượt này có ghi commit không — quyết định `lastCommitAt` có nhích hay không. */
  committed: boolean;
  workflowState: WorkflowState;
};

/**
 * Lỗi đã có CÂU CHỮ ĐỌC ĐƯỢC dành cho người vận hành, khác lỗi thô của `fetch`.
 *
 * Tồn tại để đường đi chính của `pingStation` viết được thẳng một mạch: mỗi bước cứ ném khi
 * hỏng, và đúng một chỗ ở ngoài cùng bắt rồi biến thành một dòng đỏ trên tab admin. Không có nó
 * thì mỗi lời gọi phải trả về một cặp `{ok, err}` và cả hàm biến thành một cây if lồng nhau.
 */
class StationError extends Error {}

type GithubReply = { status: number; body: unknown };
type GithubCallOptions = { deadlineAt?: number };

async function callGithub(
  pat: string,
  method: "GET" | "PUT",
  path: string,
  payload?: Record<string, unknown>,
  options: GithubCallOptions = {},
): Promise<GithubReply> {
  const remaining = options.deadlineAt === undefined ? REQUEST_TIMEOUT_MS : options.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new StationError(`Hết ngân sách khi chuẩn bị ${method} ${path}.`);
  }
  // Mỗi request chịu CẢ trần riêng 10 giây lẫn deadline chung của route. Không làm thế thì một
  // batch bắt đầu sát giây 45 vẫn có thể giữ ba fetch sống tới giây 55 rồi PUT tiếp ở repo khác.
  const timeoutMs = Math.max(1, Math.floor(Math.min(REQUEST_TIMEOUT_MS, remaining)));
  const deadlineBound = options.deadlineAt !== undefined && remaining <= REQUEST_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": USER_AGENT,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      // Nhịp nuôi kho phải thấy sự thật HÔM NAY. Next.js vá `fetch` để nhớ mặc định, và một
      // trạng thái workflow được nhớ lại là một lượt tự chữa không bao giờ nổ ra.
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // `AbortSignal.timeout` ném `TimeoutError`; đứt mạng ném `TypeError`. Cả hai đều tới đây,
    // và cả hai đều phải nói ra ĐANG GỌI GÌ — một dòng「fetch failed」trần trụi trên tab admin
    // thì không ai lần được ra bước nào hỏng.
    const deadlineExpired = options.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (timedOut && (deadlineExpired || deadlineBound)) {
      throw new StationError(`Hết ngân sách khi ${method} ${path}.`);
    }
    const wait = timeoutMs >= 1_000 ? `${(timeoutMs / 1_000).toFixed(timeoutMs % 1_000 === 0 ? 0 : 1)}s` : `${timeoutMs}ms`;
    const reason = timedOut ? `quá ${wait} không trả lời` : err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ";
    throw new StationError(`${method} ${path} không tới được GitHub (${reason})`);
  }

  // 204 (lượt bật lịch) không có thân; `json()` trên thân rỗng là ném. Đọc chữ rồi tự phân xử.
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

/**
 * Dấu nguồn sự thật nằm ngay trong `src/generated/revision-ledger.ts` của kho phụ.
 *
 * Database chỉ giữ bản sao để trang admin vẽ nhanh. Cron luôn đọc lại hai trường này từ GitHub
 * trước khi ghi: nếu PUT thứ ba đã thành nhưng lượt ghi settings sau đó hỏng, lượt cron kế tiếp
 * sẽ thấy ordinal = 3 và chỉ viết 4, 5 — không tạo tám commit trong cùng một ngày.
 */
export type RevisionLedgerMark = { day: string; ordinal: number };

export function parseRevisionLedger(source: string): RevisionLedgerMark | null {
  const day = /\bday:\s*"([^"]*)"/.exec(source)?.[1];
  const ordinalRaw = /\bordinal:\s*(\d+)/.exec(source)?.[1];
  if (day === undefined || ordinalRaw === undefined) {
    return null;
  }
  const ordinal = Number(ordinalRaw);
  // `day: ""` + ordinal 0 là hình bootstrap mà generator rải vào kho mới.
  if ((day !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(day)) || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    return null;
  }
  return { day, ordinal };
}

/**
 * Mã TypeScript hoàn chỉnh của một revision. Nội dung và câu chú thích đều tiếng Anh vì đây là
 * source công khai của một software repo, không phải một mẩu trạng thái nội bộ của control plane.
 */
export function renderRevisionLedger(day: string, ordinal: number, at: Date, revision: string = randomUUID()): string {
  const noise = randomBytes(6);
  const ratio = (offset: number) => (0.5 + noise.readUInt16BE(offset) / 131_070).toFixed(4);
  return [
    "/**",
    " * Runtime revision metadata generated by the repository maintenance pipeline.",
    " * The application imports this value so every revision remains part of the compiled source.",
    " */",
    "export type RevisionLedger = Readonly<{",
    "  day: string;",
    "  ordinal: number;",
    "  revision: string;",
    "  generatedAt: string;",
    "  signals: Readonly<{ confidence: number; coverage: number; entropy: number }>;",
    "}>;",
    "",
    "export const revisionLedger: RevisionLedger = {",
    `  day: "${day}",`,
    `  ordinal: ${ordinal},`,
    `  revision: "${revision}",`,
    `  generatedAt: "${at.toISOString()}",`,
    "  signals: {",
    `    confidence: ${ratio(0)},`,
    `    coverage: ${ratio(2)},`,
    `    entropy: ${ratio(4)},`,
    "  },",
    "};",
    "",
  ].join("\n");
}

export type CompanionNurtureResult = {
  /** Kho khôi lỗi cha — khoá để vá đúng station trong document settings. */
  stationSlug: string;
  /** Kho software được đẩy source. */
  repo: string;
  slug: string;
  day: string;
  /** Quota CẢ NGÀY (`station.dailyPushes`) — thứ giao diện đọc thành「đã push/quota」. */
  target: number;
  /**
   * Cận trên của LƯỢT NÀY: tới giờ chạy thì đáng lẽ đã có ngần này commit (`companionDueByNow`).
   *
   * Tách khỏi `target` là chủ ý: trộn hai con số làm một thì giữa ngày giao diện sẽ khoe「2/2 —
   * đạt quota」trong khi quota thật là 5, và phép đếm `completed` cũng hoá ra nói dối.
   */
  dueNow: number;
  /** Ordinal cuối đọc/ghi được từ GitHub; null = chưa đọc nổi ledger. */
  ordinal: number | null;
  pushed: number;
  ok: boolean;
  note: string;
  /**
   * Lượt này có gì đáng ghi vào sổ không.
   *
   * `false` DUY NHẤT ở nhánh「chưa tới nấc kế」: nhánh ấy không gọi GitHub, không biết thêm điều
   * gì, nên ghi sổ chỉ tổ đạp lên câu chữ hữu ích của lượt trước (「Đã đẩy 3 commit…」) bằng một
   * dòng rỗng nghĩa — và với nhịp mỗi-giờ thì đó là 24 lượt ghi document mỗi ngày cho không.
   */
  worthRecording: boolean;
};

function companionResult(
  station: Station,
  companion: CompanionRepo,
  day: string,
  target: number,
  dueNow: number,
  over: Pick<CompanionNurtureResult, "ordinal" | "pushed" | "ok" | "note"> & { worthRecording?: boolean },
): CompanionNurtureResult {
  const { worthRecording = true, ...rest } = over;
  return {
    stationSlug: stationSlug(station),
    repo: companion.repo,
    slug: `${station.owner}/${companion.repo}`,
    day,
    target,
    dueNow,
    worthRecording,
    ...rest,
  };
}

/**
 * Nuôi MỘT software repo tới đúng phần ĐÃ TỚI GIỜ của quota hôm nay.
 *
 * Một GET đầu vòng lấy cả content lẫn blob sha. Mỗi PUT kế tiếp trả blob sha mới, nên năm commit
 * chỉ tốn sáu request chứ không mười; vẫn tuần tự vì PUT thứ n+1 bắt buộc mang sha của thứ n.
 *
 * TỪ 21/08/2026 cận trên của vòng đẩy là `companionDueByNow`, không phải `dailyPushes` trần: cả
 * năm commit vẫn về đủ trong ngày, nhưng rơi vào năm thời điểm rải trong khung 08:00–22:00 giờ VN
 * thay vì một cụm lúc 03:00 UTC. Ledger vẫn là nguồn sự thật của「đã đẩy mấy cái」, nên đổi nhịp
 * KHÔNG đẻ ra commit thừa: lượt nào đọc ra ordinal đã bằng phần tới giờ thì đứng im.
 */
export async function nurtureCompanionRepo(
  station: Station,
  companion: CompanionRepo,
  now: Date,
  options: { deadlineAt?: number } = {},
): Promise<CompanionNurtureResult> {
  const day = nurtureDayKey(now);
  const target = station.dailyPushes;
  const dueNow = companionDueByNow(now, target, companion.repo);
  const nameComplaint = reviewCompanionRepos(station.repo, [companion.repo]);
  if (nameComplaint) {
    return companionResult(station, companion, day, target, dueNow, {
      ordinal: null,
      pushed: 0,
      ok: false,
      note: nameComplaint,
    });
  }

  // 0 là van riêng của kho software. Không gọi GitHub, cũng không bắt PAT phải còn sống chỉ để
  // xác nhận một quyết định "đừng đẩy" đã nằm ngay trong settings.
  if (target === 0) {
    const remembered = companion.lastNurtureDay === day ? companion.pushesToday : 0;
    return companionResult(station, companion, day, target, dueNow, {
      ordinal: remembered,
      pushed: 0,
      ok: true,
      note: "Đang tạm ngừng nuôi kho phụ (0 commit/ngày).",
    });
  }

  /**
   * CHƯA TỚI NẤC NÀO — về thẳng, không chạm GitHub và không ghi sổ.
   *
   * Đứng TRƯỚC mọi phép kiểm PAT là có chủ ý: với nhịp mỗi giờ thì phần lớn lượt chạy rơi vào đây,
   * và một lượt không định đẩy gì thì cũng không có lý do gọi api.github.com. PAT hỏng vẫn lộ ra
   * ở lượt đầu tiên TỚI nấc — chậm nhất là trong cùng ngày, đủ sớm cho một việc có 40 ngày dự phòng.
   */
  if (dueNow === 0) {
    const remembered = companion.lastNurtureDay === day ? companion.pushesToday : 0;
    return companionResult(station, companion, day, target, dueNow, {
      ordinal: remembered,
      pushed: 0,
      ok: true,
      note: "Chưa tới nấc kế trong ngày.",
      worthRecording: false,
    });
  }

  if (!isEncrypted(station.pat)) {
    return companionResult(station, companion, day, target, dueNow, {
      ordinal: null,
      pushed: 0,
      ok: false,
      note: "Phong bì PAT hỏng hoặc trống — dán lại PAT ở form Sửa kho.",
    });
  }

  let pat: string;
  try {
    pat = decryptSecret(station.pat);
  } catch {
    return companionResult(station, companion, day, target, dueNow, {
      ordinal: null,
      pushed: 0,
      ok: false,
      note: "Không giải mã được PAT — kiểm tra ENCRYPTION_KEY rồi dán lại PAT.",
    });
  }

  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(companion.repo)}/contents/${REVISION_LEDGER_PATH}`;
  let ordinal: number | null = null;
  let pushed = 0;

  try {
    if (Date.now() >= (options.deadlineAt ?? Number.POSITIVE_INFINITY)) {
      throw new StationError("Hết ngân sách thời gian trước khi đọc ledger.");
    }
    const current = await callGithub(pat, "GET", path, undefined, options);
    if (current.status !== 200) {
      throw new StationError(explainFailure(current.status, current.body, `đọc ${REVISION_LEDGER_PATH} của kho phụ`));
    }
    if (Array.isArray(current.body)) {
      throw new StationError(`${REVISION_LEDGER_PATH} là một thư mục, không phải tệp source.`);
    }

    const body = current.body as { sha?: unknown; content?: unknown; encoding?: unknown } | null;
    if (typeof body?.sha !== "string" || typeof body.content !== "string" || body.encoding !== "base64") {
      throw new StationError(`GitHub không trả đủ sha/content base64 của ${REVISION_LEDGER_PATH}.`);
    }
    let blobSha = body.sha;
    const source = Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
    const mark = parseRevisionLedger(source);
    if (!mark) {
      throw new StationError(
        `${REVISION_LEDGER_PATH} không đúng contract (thiếu day/ordinal) — khôi phục tệp do generator tạo rồi chạy lại.`,
      );
    }
    if (mark.day > day) {
      throw new StationError(`Ledger đang ở ngày tương lai ${mark.day}; máy chủ hôm nay là ${day}, dừng để không đẩy trùng.`);
    }
    let currentOrdinal = mark.day === day ? mark.ordinal : 0;
    ordinal = currentOrdinal;

    if (currentOrdinal >= dueNow) {
      return companionResult(station, companion, day, target, dueNow, {
        ordinal: currentOrdinal,
        pushed,
        ok: true,
        note: currentOrdinal >= target
          ? `Đã đủ ${currentOrdinal}/${target} commit hôm nay; không đẩy trùng.`
          : `Đã xong phần tới giờ này (${currentOrdinal}/${target}); chờ nấc kế.`,
      });
    }

    while (currentOrdinal < dueNow) {
      if (Date.now() >= (options.deadlineAt ?? Number.POSITIVE_INFINITY)) {
        throw new StationError(
          `Hết ngân sách sau ${currentOrdinal}/${target} revision.`,
        );
      }
      const next: number = currentOrdinal + 1;
      const written = await callGithub(pat, "PUT", path, {
        message: `chore: advance revision ledger ${day} (${next}/${target})`,
        content: Buffer.from(renderRevisionLedger(day, next, now), "utf8").toString("base64"),
        sha: blobSha,
      }, options);
      if (written.status !== 200) {
        throw new StationError(explainFailure(written.status, written.body, `ghi revision ${next}/${target} vào kho phụ`));
      }

      currentOrdinal = next;
      ordinal = currentOrdinal;
      pushed += 1;
      // Hỏi sha kế theo `dueNow`, KHÔNG theo `target`: vòng này dừng ở phần đã tới giờ, nên ở nấc
      // cuối của lượt mà vẫn đòi một blob sha mới là dựng ra một lỗi không có thật giữa ngày.
      if (currentOrdinal < dueNow) {
        const nextSha = (written.body as { content?: { sha?: unknown } } | null)?.content?.sha;
        if (typeof nextSha !== "string") {
          throw new StationError(
            `GitHub đã nhận revision ${currentOrdinal}/${target} nhưng không trả blob sha mới.`,
          );
        }
        blobSha = nextSha;
      }
    }

    return companionResult(station, companion, day, target, dueNow, {
      ordinal: currentOrdinal,
      pushed,
      ok: true,
      note: currentOrdinal >= target
        ? `Đã đẩy ${pushed} commit source; đủ ${currentOrdinal}/${target} hôm nay.`
        : `Đã đẩy ${pushed} commit source; ${currentOrdinal}/${target} hôm nay, còn chờ nấc sau.`,
    });
  } catch (err) {
    const rawNote =
      err instanceof StationError
        ? err.message
        : `Lỗi không lường trước khi nuôi ${station.owner}/${companion.repo} (${err instanceof Error ? `${err.name}: ${err.message.slice(0, 180)}` : "không có câu chữ"})`;
    const retryToday =
      rawNote.startsWith("Hết ngân sách") || (ordinal !== null && ordinal < target)
        ? " Chạy lại vòng nuôi trong cùng ngày để hoàn tất quota hôm nay; ngày sau bắt đầu quota mới, không bù lượt cũ."
        : "";
    return companionResult(station, companion, day, target, dueNow, {
      ordinal,
      pushed,
      ok: false,
      note: `${rawNote}${retryToday}`,
    });
  }
}

/** Trạng thái lịch của workflow. Đây cũng là phép thử PAT: hỏng ở đây thì khỏi ghi gì cả. */
async function readWorkflowState(
  station: Station,
  pat: string,
  options: GithubCallOptions = {},
): Promise<WorkflowState> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}`;
  const reply = await callGithub(pat, "GET", path, undefined, options);
  if (reply.status !== 200) {
    throw new StationError(explainFailure(reply.status, reply.body, `hỏi trạng thái workflow ${station.workflowFile}`));
  }
  return parseWorkflowState((reply.body as { state?: unknown } | null)?.state);
}

/** Bật lại một lịch GitHub đã tắt. 204 là xong; gọi lên một workflow đang bật cũng vẫn 204. */
async function enableWorkflow(station: Station, pat: string, options: GithubCallOptions = {}): Promise<void> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}/enable`;
  const reply = await callGithub(pat, "PUT", path, undefined, options);
  if (reply.status !== 204) {
    throw new StationError(explainFailure(reply.status, reply.body, "bật lại lịch workflow"));
  }
}

/**
 * Nội dung tệp mốc. Viết bằng tiếng người và nói rõ ĐỪNG XOÁ: kho là công khai, nên người đầu
 * tiên đọc tệp này có thể không phải người dựng nó.
 */
function heartbeatBody(now: Date): string {
  return [
    "Mốc nuôi kho — giữ cho lịch `schedule` của workflow khỏi bị GitHub tắt sau",
    `${SCHEDULE_DISABLE_DAYS} ngày kho không có commit nào. Ghi tự động, ~${KEEPALIVE_INTERVAL_DAYS} ngày một lần.`,
    "",
    "ĐỪNG XOÁ tệp này, và cũng đừng sửa tay: lượt ghi kế tiếp cần `sha` của bản hiện tại.",
    "",
    now.toISOString(),
    "",
  ].join("\n");
}

/**
 * Ghi tệp mốc — một lượt đọc để lấy `sha`, một lượt ghi. Trả về sha ngắn của commit vừa tạo.
 *
 * `sha` là bắt buộc khi tệp ĐÃ có và phải vắng mặt khi tệp CHƯA có; gửi sai chiều nào cũng là
 * 422. Vì thế 404 ở lượt đọc KHÔNG phải lỗi mà là một nhánh hợp lệ — lần nuôi đầu tiên của một
 * kho mới dựng luôn đi qua đó.
 */
async function commitHeartbeat(
  station: Station,
  pat: string,
  now: Date,
  options: GithubCallOptions = {},
): Promise<string> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/contents/${HEARTBEAT_PATH}`;

  const current = await callGithub(pat, "GET", path, undefined, options);
  let sha: string | undefined;
  if (current.status === 200) {
    const body = current.body;
    // Trỏ vào một THƯ MỤC thì GitHub trả về mảng, và mảng ấy không có `sha` của tệp nào cả.
    // Không thể xảy ra với đường dẫn hằng số ở trên, nhưng nếu xảy ra thì phải chết ở đây với
    // một câu đọc được, thay vì gửi đi một PUT thiếu `sha` rồi nhận 422 khó hiểu.
    if (Array.isArray(body)) {
      throw new StationError(`${HEARTBEAT_PATH} trong kho này là một THƯ MỤC, không phải tệp — dọn nó rồi nuôi lại.`);
    }
    const found = (body as { sha?: unknown } | null)?.sha;
    if (typeof found !== "string") {
      throw new StationError(`Đọc được ${HEARTBEAT_PATH} nhưng GitHub không kèm \`sha\` — không ghi đè mù được.`);
    }
    sha = found;
  } else if (current.status !== 404) {
    throw new StationError(explainFailure(current.status, current.body, `đọc ${HEARTBEAT_PATH}`));
  }

  const written = await callGithub(pat, "PUT", path, {
    message: `chore(khoiloi): mốc nuôi kho ${now.toISOString().slice(0, 10)}`,
    content: Buffer.from(heartbeatBody(now), "utf8").toString("base64"),
    // Vắng `branch` = nhánh mặc định của kho. Ghim "main" ở đây là hẹn ngày hỏng với một kho
    // trót đặt tên nhánh khác, mà GitHub thì đã biết sẵn nhánh mặc định là nhánh nào.
    ...(sha ? { sha } : {}),
  }, options);
  // 201 khi tạo mới, 200 khi ghi đè — cả hai đều là một commit thật.
  if (written.status !== 200 && written.status !== 201) {
    throw new StationError(explainFailure(written.status, written.body, `ghi ${HEARTBEAT_PATH}`));
  }

  const commitSha = (written.body as { commit?: { sha?: unknown } } | null)?.commit?.sha;
  return typeof commitSha === "string" ? commitSha.slice(0, 7) : "(không rõ sha)";
}

/** Còn bao nhiêu ngày nữa tới lượt ghi kế — chỉ để nói cho người đọc, làm tròn lên. */
function daysUntilDue(lastCommitAt: string, now: Date): number {
  const elapsed = now.getTime() - Date.parse(lastCommitAt);
  return Math.max(0, Math.ceil((KEEPALIVE_INTERVAL_DAYS * MS_PER_DAY - elapsed) / MS_PER_DAY));
}

/**
 * ĐỘ KHẨN của một lượt nuôi HỎNG — ghép vào cuối mọi lời báo lỗi.
 *
 * Vì sao đáng có: một lượt hỏng chỉ nói được「GitHub trả 401」, mà câu ấy không phân biệt được hai
 * cảnh cách nhau rất xa. PAT chết hôm qua trên một kho vừa ghi mốc tuần trước thì còn 53 ngày để
 * sửa; cùng câu lỗi ấy trên một kho ghi mốc lần cuối 58 ngày trước nghĩa là còn HAI ngày trước khi
 * GitHub tắt lịch, và khi lịch đã tắt thì một commit mới không tự bật lại được — phải có một lượt
 * bật tường minh.
 *
 * Tab admin đã vẽ đếm ngược, nhưng nó vẽ theo `lastCommitAt` của DÒNG SỔ, còn dòng lỗi thì người
 * ta đọc trước tiên và thường là thứ duy nhất họ đọc. Đặt con số ngay trong câu lỗi biến「đọc thêm
 * một cột nữa」thành「không phải đọc gì thêm」.
 */
function urgencyNote(lastCommitAt: string | null, now: Date): string {
  if (!lastCommitAt) {
    return " · CHƯA từng ghi được mốc nào — với kho mới dựng thì đây là lượt thử PAT đầu tiên, còn với kho cũ thì đây là dòng đáng lo nhất trong sổ.";
  }
  const last = Date.parse(lastCommitAt);
  if (Number.isNaN(last)) {
    return " · mốc ghi cuối không đọc được (sửa tay JSONB?) — coi như chưa từng ghi.";
  }
  const days = Math.floor((now.getTime() - last) / MS_PER_DAY);
  const left = SCHEDULE_DISABLE_DAYS - days;
  if (left <= 0) {
    return ` · lượt ghi cuối ${days} ngày trước — ĐÃ QUÁ mốc ${SCHEDULE_DISABLE_DAYS} ngày, lịch có thể đã bị tắt và một commit mới KHÔNG tự bật lại được.`;
  }
  if (left <= KEEPALIVE_INTERVAL_DAYS) {
    return ` · lượt ghi cuối ${days} ngày trước — chỉ còn ${left} ngày trước mốc tắt lịch. SỬA NGAY.`;
  }
  return ` · lượt ghi cuối ${days} ngày trước, còn ${left} ngày trước mốc tắt lịch.`;
}

/**
 * Nuôi MỘT kho. Không đụng database — người gọi ghi sổ, nên hàm này kiểm chứng được bằng một
 * `fetch` giả mà không cần dựng Postgres.
 *
 * `force` là nút「Nuôi ngay」trên tab admin: bỏ qua phép tính hạn, nhưng KHÔNG bỏ qua luật về
 * `disabled_manually` — nút của admin là để thúc nhanh một việc vẫn đúng, không phải để phá một
 * hàng rào.
 */
export async function pingStation(
  station: Station,
  now: Date,
  force: boolean,
  options: GithubCallOptions = {},
): Promise<StationPing> {
  const slug = stationSlug(station);

  if (!isEncrypted(station.pat)) {
    // Phong bì hỏng (sửa tay JSONB, hoặc đổi ENCRYPTION_KEY mà quên nhập lại PAT). Chết ở đây
    // với một câu chỉ đúng việc phải làm, đừng để `decryptSecret` ném một câu về mã hoá.
    return { slug, ok: false, note: `Phong bì PAT hỏng hoặc trống — dán lại PAT ở form Sửa kho.${urgencyNote(station.lastCommitAt, now)}`, committed: false, workflowState: "unknown" };
  }

  let pat: string;
  try {
    pat = decryptSecret(station.pat);
  } catch {
    return { slug, ok: false, note: `Không giải mã được PAT — ENCRYPTION_KEY của trạm này khác lúc PAT được ghi. Dán lại PAT.${urgencyNote(station.lastCommitAt, now)}`, committed: false, workflowState: "unknown" };
  }

  try {
    const state = await readWorkflowState(station, pat, options);

    if (state === "disabled_manually") {
      return {
        slug,
        ok: false,
        note:
          "Lịch đang bị TẮT TAY trên GitHub — sổ cố ý không tự bật lại. Bật ở tab Actions của kho, hoặc tắt dòng này trong sổ nếu đó là chủ ý." +
          urgencyNote(station.lastCommitAt, now),
        committed: false,
        workflowState: state,
      };
    }

    if (state === "disabled_inactivity") {
      // Ngã rồi thì dựng dậy VÀ ghi mốc ngay, bất kể còn hạn hay không: bật lại mà không có
      // hoạt động mới thì kho vẫn đang đứng ở ngày thứ 60, và lượt tắt kế tiếp tới rất nhanh.
      await enableWorkflow(station, pat, options);
      const sha = await commitHeartbeat(station, pat, now, options);
      return {
        slug,
        ok: true,
        note: `Lịch ĐÃ BỊ TẮT vì ${SCHEDULE_DISABLE_DAYS} ngày im lặng — đã bật lại và ghi mốc (${sha}).`,
        committed: true,
        workflowState: "active",
      };
    }

    const unknownNote = state === "unknown" ? " (GitHub khai một trạng thái lạ — ngó lại tab Actions của kho)" : "";

    if (!force && !isCommitDue(station.lastCommitAt, now)) {
      const left = station.lastCommitAt ? daysUntilDue(station.lastCommitAt, now) : 0;
      return {
        slug,
        ok: true,
        note: `Lịch đang chạy, còn hạn — lượt ghi kế trong ~${left} ngày.${unknownNote}`,
        committed: false,
        workflowState: state,
      };
    }

    const sha = await commitHeartbeat(station, pat, now, options);
    return {
      slug,
      ok: true,
      note: `Đã ghi mốc nuôi kho (${sha}).${unknownNote}`,
      committed: true,
      workflowState: state,
    };
  } catch (err) {
    if (err instanceof StationError) {
      return {
        slug,
        ok: false,
        note: `${err.message}${urgencyNote(station.lastCommitAt, now)}`,
        committed: false,
        workflowState: "unknown",
      };
    }
    // Ngả không lường trước cũng thành một dòng đọc được. Hàm này KHÔNG BAO GIỜ ném, và đó là
    // hợp đồng của nó: luật「một kho hỏng không chặn kho còn lại」sẽ mong manh nếu nó phụ thuộc
    // vào việc mọi nơi gọi đều nhớ bọc try/catch. Nhánh này chỉ chạy khi có người sửa hàm trên
    // và làm rò một ngả ném mới — nên nó nói rõ là「không lường trước」, đừng nuốt như lỗi thường.
    const detail = err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "không có câu chữ";
    return { slug, ok: false, note: `Lỗi không lường trước khi nuôi ${slug} (${detail})`, committed: false, workflowState: "unknown" };
  }
}

/**
 * Ghi kết quả của MỘT kho vào sổ — đọc lại sổ ngay trước khi ghi, rồi chỉ vá đúng mấy trường
 * dấu vết của đúng dòng ấy.
 *
 * Vì sao không gom cả vòng rồi ghi một lượt: vòng có thể chạy hàng chục giây, và trong quãng ấy
 * Gia chủ có thể đang sửa PAT hay xoá một kho trên tab admin. Ghi đè bằng bản chụp lấy từ đầu
 * vòng là nuốt mất lượt sửa ấy — đúng loại mất mát không ai phát hiện ra cho tới lượt nuôi sau.
 * Dòng đã bị xoá giữa chừng thì lặng lẽ bỏ qua: nó không còn là việc của ai nữa.
 */
async function recordPing(result: StationPing, now: Date): Promise<void> {
  const settings = await getAppSettings();
  const station = settings.githubStations.find((s) => stationSlug(s) === result.slug);
  if (!station) {
    return;
  }
  station.lastPingAt = now.toISOString();
  station.lastPingOk = result.ok;
  station.lastPingNote = result.note;
  station.workflowState = result.workflowState;
  if (result.committed) {
    station.lastCommitAt = now.toISOString();
  }
  await saveAppSettings(settings);
}

/** Vá mọi trace vào MỘT snapshot settings mới; trả false nếu tất cả repo đã bị xoá giữa vòng. */
export function applyCompanionNurtureResults(
  settings: AppSettings,
  results: readonly CompanionNurtureResult[],
  recordedAt: Date,
): boolean {
  let changed = false;
  for (const result of results) {
    const station = settings.githubStations.find((item) => stationSlug(item) === result.stationSlug);
    const companion = station?.companionRepos.find(
      (item) => item.repo.toLowerCase() === result.repo.toLowerCase(),
    );
    if (!station || !companion) continue;

    if (result.ordinal !== null) {
      companion.lastNurtureDay = result.day;
      companion.pushesToday = Math.min(MAX_DAILY_PUSHES, result.ordinal);
    }
    companion.lastPushOk = result.ok;
    companion.lastPushNote = result.note.slice(0, 500);
    if (result.pushed > 0) companion.lastPushAt = recordedAt.toISOString();
    changed = true;
  }
  return changed;
}

/**
 * Đúng MỘT fresh read + tối đa MỘT save cho cả vòng.
 *
 * Bản trước làm cặp read/save cho TỪNG repo; tám station là mười sáu cửa sổ có thể đè một lượt
 * admin sửa settings. Gộp trace thu cửa sổ ấy về một. Nếu save cuối hỏng, ledger GitHub vẫn là
 * nguồn thật và lần chạy lại cùng ngày đọc đúng ordinal để không push trùng.
 */
async function recordCompanionNurtureResults(results: readonly CompanionNurtureResult[], now: Date): Promise<void> {
  // Lọc TRƯỚC khi đọc settings: với nhịp mỗi giờ, phần lớn lượt chạy là「chưa tới nấc」và không
  // biết thêm điều gì để ghi. Không lọc thì mỗi ngày có 24 lượt đọc-ghi trọn document cấu hình
  // chỉ để chép lại đúng những con số cũ — và mỗi lượt ấy là một cửa sổ đè lên bài admin vừa sửa.
  const worth = results.filter((result) => result.worthRecording);
  if (worth.length === 0) return;
  const settings = await getAppSettings();
  if (applyCompanionNurtureResults(settings, worth, now)) {
    await saveAppSettings(settings);
  }
}

type CompanionJob = { station: Station; companion: CompanionRepo };

/** Tối đa ba repo gọi GitHub đồng thời; bên trong từng repo, chuỗi PUT sha vẫn tuyệt đối tuần tự. */
export const COMPANION_NURTURE_CONCURRENCY = 3;

/** Bộ chạy pool thuần để đóng đinh concurrency/skipped mà không cần dựng database. */
export async function runBoundedCompanionJobs<T, R>(
  jobs: readonly T[],
  options: {
    deadlineAt: number;
    concurrency?: number;
    execute: (job: T) => Promise<R>;
  },
): Promise<{ results: R[]; skipped: number }> {
  const requested = options.concurrency ?? COMPANION_NURTURE_CONCURRENCY;
  const concurrency = Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested)
    : COMPANION_NURTURE_CONCURRENCY;
  const results = new Map<number, R>();
  let cursor = 0;

  // Mỗi worker lấy job kế ngay khi rảnh; một repo chậm không bắt hai lane còn lại ngồi chờ như
  // cách chia batch cứng. Phép lấy index nằm trước `await`, nên event loop không thể phát trùng.
  const worker = async () => {
    while (Date.now() < options.deadlineAt && cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      results.set(index, await options.execute(jobs[index]!));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
  );

  return {
    results: [...results.entries()].sort(([left], [right]) => left - right).map(([, result]) => result),
    // `cursor` chỉ tăng lúc một worker thật sự nhận job; phần đuôi chưa nhận mới là skipped.
    skipped: jobs.length - cursor,
  };
}

/**
 * Kho chưa từng được đẩy/đẩy lâu nhất đi trước để một sổ dài hơn ngân sách vẫn tự luân phiên.
 * Trả mảng mới; thứ tự người dùng nhìn trong settings không đổi.
 */
export function companionNurtureOrder(jobs: readonly CompanionJob[]): CompanionJob[] {
  const stamp = (raw: string | null): number => {
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return [...jobs].sort((a, b) => {
    const byPush = stamp(a.companion.lastPushAt) - stamp(b.companion.lastPushAt);
    if (byPush !== 0) return byPush;
    const left = `${stationSlug(a.station)}/${a.companion.repo}`;
    const right = `${stationSlug(b.station)}/${b.companion.repo}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export type CompanionNurtureSummary = {
  /** Số kho phụ đã đọc ledger xong (0/day cũng tính là đã xét). */
  checked: number;
  /** Tổng commit source thật sự được GitHub nhận trong vòng này. */
  pushed: number;
  /** Số repo đã đạt quota hiện tại; target 0 được xem là hoàn tất. */
  completed: number;
  failed: number;
  /** Repo chưa bắt đầu vì ngân sách route đã hết. */
  skipped: number;
  results: CompanionNurtureResult[];
};

/**
 * Vòng nuôi HAI software repo của mỗi station.
 *
 * Tách khỏi `runKeepalive`: kho chính có luật workflow/60 ngày, kho phụ có quota source theo
 * ngày. Route cron gọi cả hai nhưng báo cáo riêng, để một lỗi source ledger không nhuộm đỏ trạng
 * thái khôi lỗi chính và ngược lại.
 */
export async function runCompanionNurture(options: { deadlineAt?: number } = {}): Promise<CompanionNurtureSummary> {
  const settings = await getAppSettings();
  const jobs = companionNurtureOrder(
    settings.githubStations
      .filter((station) => station.enabled)
      .flatMap((station) => station.companionRepos.map((companion) => ({ station, companion }))),
  );
  const cutoff = Math.min(Date.now() + LOOP_BUDGET_MS, options.deadlineAt ?? Number.POSITIVE_INFINITY);
  const { results, skipped } = await runBoundedCompanionJobs(jobs, {
    deadlineAt: cutoff,
    execute: ({ station, companion }) =>
      nurtureCompanionRepo(station, companion, new Date(), { deadlineAt: cutoff }),
  });
  // Mọi network promise đã xong trước khi chạm settings; một lượt save duy nhất nên không có hai
  // recorder của chính vòng này ghi đè nhau dù ba repo vừa chạy song song.
  await recordCompanionNurtureResults(results, new Date());

  return {
    checked: results.length,
    pushed: results.reduce((sum, result) => sum + result.pushed, 0),
    completed: results.filter(
      (result) => result.ok && result.ordinal !== null && result.ordinal >= result.target,
    ).length,
    failed: results.filter((result) => !result.ok).length,
    skipped,
    results,
  };
}

export type KeepaliveSummary = {
  /** Số kho đã ngó xong trong lượt này. */
  checked: number;
  /** Trong số ấy, bao nhiêu kho được ghi commit. */
  committed: number;
  failed: number;
  /** Kho chưa tới lượt vì hết ngân sách thời gian — lượt cron ngày mai lo tiếp. */
  skipped: number;
  results: StationPing[];
};

/**
 * Vòng nuôi kho — thứ /api/cron gọi mỗi ngày, và cũng là thứ nút「Nuôi tất」gọi.
 *
 * TUẦN TỰ chứ không `Promise.all`, ba lẽ: mỗi kho ghi sổ riêng nên chạy song song là bốn lượt
 * đọc-sửa-ghi cùng một document JSONB đè nhau; GitHub xin đừng bắn nhiều request GHI cùng lúc;
 * và tám kho × ba lời gọi vốn đã là một việc vài giây, không đáng đổi lấy ba cái rắc rối kia.
 *
 * Kho `enabled: false` đứng ngoài hoàn toàn — không ngó, không ghi, không tính vào tổng kết.
 */
export async function runKeepalive(options: { force?: boolean; deadlineAt?: number } = {}): Promise<KeepaliveSummary> {
  const settings = await getAppSettings();
  // Thứ tự lặp là thứ tự ƯU TIÊN, không phải thứ tự sổ — xem `keepaliveOrder`. Từ lượt gỡ trần
  // số kho (18/08/2026) đây là thứ giữ cho một sổ dài hơn ngân sách không bỏ rơi mãi mãi đúng
  // mấy kho cuối danh sách.
  const due = keepaliveOrder(settings.githubStations.filter((s) => s.enabled));
  const startedAt = Date.now();
  const cutoff = Math.min(startedAt + LOOP_BUDGET_MS, options.deadlineAt ?? Number.POSITIVE_INFINITY);
  const results: StationPing[] = [];
  let skipped = 0;

  for (const station of due) {
    if (Date.now() >= cutoff) {
      skipped += 1;
      continue;
    }
    const now = new Date();
    let result: StationPing;
    try {
      result = await pingStation(station, now, options.force === true, { deadlineAt: cutoff });
    } catch (err) {
      // `pingStation` chỉ ném `StationError` (nó tự bọc mọi thứ khác), nhưng bắt ở đây vẫn là
      // hàng rào cuối: luật「một kho hỏng không chặn kho còn lại」phải đứng vững kể cả khi ai đó
      // sửa hàm trên và làm rò một ngả ném mới.
      result = {
        slug: stationSlug(station),
        ok: false,
        note: err instanceof Error ? err.message.slice(0, 300) : "Lỗi lạ, không có câu chữ.",
        committed: false,
        workflowState: "unknown",
      };
    }
    results.push(result);
    await recordPing(result, now);
  }

  return {
    checked: results.length,
    committed: results.filter((r) => r.committed).length,
    failed: results.filter((r) => !r.ok).length,
    skipped,
    results,
  };
}

/**
 * Nuôi ĐÚNG một kho, kể cả kho đang tắt — nút「Nuôi ngay」của tab admin.
 *
 * Cho phép chạm vào dòng đã tắt là có chủ ý: người ta tắt một kho rồi muốn thử lại PAT trước khi
 * bật, và bắt họ bật lên mới thử được là bắt mở van trước khi biết đường ống có thủng không.
 */
export async function pingStationBySlug(slug: string, force: boolean): Promise<StationPing> {
  const settings = await getAppSettings();
  const station = settings.githubStations.find((s) => stationSlug(s) === slug);
  if (!station) {
    return { slug, ok: false, note: `Không có kho「${slug}」trong sổ.`, committed: false, workflowState: "unknown" };
  }
  const now = new Date();
  const result = await pingStation(station, now, force);
  await recordPing(result, now);
  return result;
}
