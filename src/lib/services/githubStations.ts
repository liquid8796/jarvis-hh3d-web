import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";
import {
  HEARTBEAT_PATH,
  KEEPALIVE_INTERVAL_DAYS,
  MS_PER_DAY,
  SCHEDULE_DISABLE_DAYS,
  isCommitDue,
  parseWorkflowState,
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
 *   • Vòng chạy TUẦN TỰ (xem `runKeepalive`), nên tám kho cùng chậm là 8 × 3 lời gọi × 10 giây =
 *     240 giây — xa trần của function tới mức phải có ai đó cắt.
 *   • `maxDuration` của /api/cron là 60 giây, và vòng nuôi KHÔNG được tiêu cả 60: nó chạy SAU ba
 *     việc quét dọn trong cùng một lượt gọi. 40 chừa lại 20 giây cho chúng.
 *
 * Cắt ở đây là cắt có trật tự — mỗi kho đã ghi sổ ngay sau khi xong, và tổng kết nói rõ còn mấy
 * kho chưa tới lượt. Để function bị nền tảng giết ngang thì không ai biết nó đã đi tới đâu. Kho
 * bị bỏ lại vẫn còn 40 ngày dự phòng nên lượt cron ngày mai lo tiếp là dư sức.
 */
const LOOP_BUDGET_MS = 40_000;

type Station = AppSettings["githubStations"][number];

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

/** Câu `message` mà GitHub trả kèm mọi lỗi — thứ đáng in ra nhất, nên moi cẩn thận. */
function githubMessage(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message.slice(0, 200);
  }
  return "";
}

async function callGithub(
  pat: string,
  method: "GET" | "PUT",
  path: string,
  payload?: Record<string, unknown>,
): Promise<GithubReply> {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // `AbortSignal.timeout` ném `TimeoutError`; đứt mạng ném `TypeError`. Cả hai đều tới đây,
    // và cả hai đều phải nói ra ĐANG GỌI GÌ — một dòng「fetch failed」trần trụi trên tab admin
    // thì không ai lần được ra bước nào hỏng.
    const reason = err instanceof Error && err.name === "TimeoutError" ? `quá ${REQUEST_TIMEOUT_MS / 1000}s không trả lời` : err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ";
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
 * Đổi một mã lỗi HTTP thành câu người vận hành DÙNG ĐƯỢC.
 *
 * Ba mã đầu là ba nguyên nhân khác hẳn nhau mà nhìn thô đều chỉ là「không được」, và đoán nhầm
 * giữa chúng là đi sửa nhầm chỗ hàng giờ: 401 là token, 403 là quyền/hạn mức, 404 là tên kho —
 * hoặc, và đây là chỗ bẫy, cũng vẫn là token: GitHub trả 404 thay vì 403 cho kho mà token không
 * được phép thấy, cố ý, để không lộ ra kho ấy có tồn tại hay không.
 */
function explainFailure(status: number, body: unknown, what: string): string {
  const detail = githubMessage(body);
  const suffix = detail ? ` — ${detail}` : "";
  if (status === 401) {
    return `PAT bị từ chối (401) khi ${what}: token hết hạn hoặc đã bị thu hồi${suffix}`;
  }
  if (status === 403) {
    return `Bị chặn (403) khi ${what}: PAT thiếu scope, hoặc đang bị giới hạn tần suất${suffix}`;
  }
  if (status === 404) {
    return `Không thấy (404) khi ${what}: sai tên kho/tệp workflow, hoặc PAT không có quyền nhìn kho này${suffix}`;
  }
  if (status === 409) {
    return `Xung đột (409) khi ${what}: kho rỗng, hoặc tệp mốc vừa bị đổi bởi một lượt khác${suffix}`;
  }
  return `GitHub trả ${status} khi ${what}${suffix}`;
}

/** Trạng thái lịch của workflow. Đây cũng là phép thử PAT: hỏng ở đây thì khỏi ghi gì cả. */
async function readWorkflowState(station: Station, pat: string): Promise<WorkflowState> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}`;
  const reply = await callGithub(pat, "GET", path);
  if (reply.status !== 200) {
    throw new StationError(explainFailure(reply.status, reply.body, `hỏi trạng thái workflow ${station.workflowFile}`));
  }
  return parseWorkflowState((reply.body as { state?: unknown } | null)?.state);
}

/** Bật lại một lịch GitHub đã tắt. 204 là xong; gọi lên một workflow đang bật cũng vẫn 204. */
async function enableWorkflow(station: Station, pat: string): Promise<void> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/actions/workflows/${encodeURIComponent(station.workflowFile)}/enable`;
  const reply = await callGithub(pat, "PUT", path);
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
async function commitHeartbeat(station: Station, pat: string, now: Date): Promise<string> {
  const path = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}/contents/${HEARTBEAT_PATH}`;

  const current = await callGithub(pat, "GET", path);
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
  });
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
 * Nuôi MỘT kho. Không đụng database — người gọi ghi sổ, nên hàm này kiểm chứng được bằng một
 * `fetch` giả mà không cần dựng Postgres.
 *
 * `force` là nút「Nuôi ngay」trên tab admin: bỏ qua phép tính hạn, nhưng KHÔNG bỏ qua luật về
 * `disabled_manually` — nút của admin là để thúc nhanh một việc vẫn đúng, không phải để phá một
 * hàng rào.
 */
export async function pingStation(station: Station, now: Date, force: boolean): Promise<StationPing> {
  const slug = stationSlug(station);

  if (!isEncrypted(station.pat)) {
    // Phong bì hỏng (sửa tay JSONB, hoặc đổi ENCRYPTION_KEY mà quên nhập lại PAT). Chết ở đây
    // với một câu chỉ đúng việc phải làm, đừng để `decryptSecret` ném một câu về mã hoá.
    return { slug, ok: false, note: "Phong bì PAT hỏng hoặc trống — dán lại PAT ở form Sửa kho.", committed: false, workflowState: "unknown" };
  }

  let pat: string;
  try {
    pat = decryptSecret(station.pat);
  } catch {
    return { slug, ok: false, note: "Không giải mã được PAT — ENCRYPTION_KEY của trạm này khác lúc PAT được ghi. Dán lại PAT.", committed: false, workflowState: "unknown" };
  }

  try {
    const state = await readWorkflowState(station, pat);

    if (state === "disabled_manually") {
      return {
        slug,
        ok: false,
        note: "Lịch đang bị TẮT TAY trên GitHub — sổ cố ý không tự bật lại. Bật ở tab Actions của kho, hoặc tắt dòng này trong sổ nếu đó là chủ ý.",
        committed: false,
        workflowState: state,
      };
    }

    if (state === "disabled_inactivity") {
      // Ngã rồi thì dựng dậy VÀ ghi mốc ngay, bất kể còn hạn hay không: bật lại mà không có
      // hoạt động mới thì kho vẫn đang đứng ở ngày thứ 60, và lượt tắt kế tiếp tới rất nhanh.
      await enableWorkflow(station, pat);
      const sha = await commitHeartbeat(station, pat, now);
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

    const sha = await commitHeartbeat(station, pat, now);
    return {
      slug,
      ok: true,
      note: `Đã ghi mốc nuôi kho (${sha}).${unknownNote}`,
      committed: true,
      workflowState: state,
    };
  } catch (err) {
    if (err instanceof StationError) {
      return { slug, ok: false, note: err.message, committed: false, workflowState: "unknown" };
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
export async function runKeepalive(options: { force?: boolean } = {}): Promise<KeepaliveSummary> {
  const settings = await getAppSettings();
  const due = settings.githubStations.filter((s) => s.enabled);
  const startedAt = Date.now();
  const results: StationPing[] = [];
  let skipped = 0;

  for (const station of due) {
    if (Date.now() - startedAt > LOOP_BUDGET_MS) {
      skipped += 1;
      continue;
    }
    const now = new Date();
    let result: StationPing;
    try {
      result = await pingStation(station, now, options.force === true);
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
