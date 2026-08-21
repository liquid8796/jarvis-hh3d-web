/**
 * Luật của SỔ KHO GITHUB — hằng số và phép kiểm hình dạng, thuần, không đụng mạng lẫn database.
 *
 * Tách khỏi `services/githubStations.ts` vì `services/settings.ts` cần mấy hằng số này cho Zod,
 * mà service thì lại đọc/ghi qua chính settings — nhập thẳng vào nhau là một vòng tròn. Ở đây
 * cũng là chỗ script kiểm chứng hỏi luật mà không phải dựng gì (cùng lẽ với `validation/retention.ts`).
 */

/**
 * KHÔNG CÒN TRẦN SỐ KHO — gỡ ngày 18/08/2026 theo yêu cầu của tông chủ, và đây là chỗ ghi lại
 * cái giá đã trả để gỡ được nó cho an toàn.
 *
 * Trần cũ là 8, đứng trên hai lý lẽ. Lý lẽ thứ nhất ("danh sách do người gõ tay, quá tám dòng thì
 * thứ cần sửa là cách làm việc") là một lời khuyên, không phải một hàng rào kỹ thuật — và nó là
 * lựa chọn của người vận hành, không phải của mã. Lý lẽ thứ hai thì THẬT: vòng nuôi chạy tuần tự
 * và tự cắt khi hết ngân sách, nên một sổ dài hơn ngân sách sẽ bỏ lại phần đuôi.
 *
 * Cái thay thế nó là `keepaliveOrder` bên dưới: cú cắt nay luôn rơi vào những kho CÒN NHIỀU HẠN
 * NHẤT, và mọi kho đều tới lượt đứng đầu. Gỡ trần mà không có nó là đổi một câu chối từ ồn ào
 * ("Sổ đầy") lấy một cái chết lặng lẽ sáu mươi ngày sau.
 *
 * `appSettingsSchema` KHÔNG có `.max()` trên mảng này (soát 18/08/2026), nên một dòng thứ chín
 * không bao giờ làm hỏng phép gán settings — đó là lý do gỡ trần không cần một lượt migrate nào.
 */

/** Tệp mốc nuôi kho. Trong `.github/` nhưng KHÔNG trong `.github/workflows/` — xem `PAT_SCOPES_NOTE`. */
export const HEARTBEAT_PATH = ".github/heartbeat.txt";

/**
 * Tệp MÃ NGUỒN mà hai kho phần mềm đi kèm cập nhật ở mỗi lượt nuôi.
 *
 * Không dùng một activity log giấu trong `.github/`: yêu cầu của tính năng là các lượt đẩy
 * tiếp tục tiến hoá chính phần mềm đã sinh, nên generator tạo tệp TypeScript này, ứng dụng import
 * nó, và vòng nuôi chỉ ghi đúng contract ấy. Đường dẫn là hằng số chung để generator, service và
 * phép thử không âm thầm trôi thành ba tên khác nhau.
 */
export const REVISION_LEDGER_PATH = "src/generated/revision-ledger.ts";

/** Mặc định năm commit/ngày/repo; 0 là tạm ngừng riêng hai kho phụ. */
export const DEFAULT_DAILY_PUSHES = 5;
export const MIN_DAILY_PUSHES = 0;
export const MAX_DAILY_PUSHES = 24;

/** Workflow mà `scripts/newGithubKhoiloi.mjs` rải ra ở mọi kho nó dựng. */
export const DEFAULT_WORKFLOW_FILE = "linh-su.yml";

/**
 * GitHub tắt lịch `schedule` sau ngần này ngày không có hoạt động commit. Con số của GitHub,
 * không phải của ta — để ở đây vì cả lời cảnh báo trên giao diện lẫn phép tính hạn đều đọc nó.
 */
export const SCHEDULE_DISABLE_DAYS = 60;

/**
 * Bao nhiêu ngày thì ghi một commit nuôi kho.
 *
 * Vòng nuôi CHẠY mỗi ngày (theo lịch sẵn có trong vercel.json), nhưng chỉ GHI khi quá hạn này —
 * hai chuyện khác nhau, và chỗ tách ấy là toàn bộ giá trị của con số:
 *
 *   • 20 ngày để lại 40 ngày dự phòng trước mốc 60. Nghĩa là phải hỏng LIÊN TIẾP hai lượt tới
 *     hạn (cộng ~40 lượt chạy hằng ngày ở giữa) thì lịch mới thật sự bị tắt — mà mỗi lượt hỏng
 *     đều đã hiện đỏ trên tab admin từ lâu trước đó.
 *   • Đổi lại là ~18 commit rác mỗi năm mỗi kho thay vì 365. Điều này KHÔNG chỉ là thẩm mỹ:
 *     GitHub đã gỡ `gautamkrishnar/keepalive-workflow` — action nuôi kho phổ biến nhất — vì vi
 *     phạm điều khoản, và thứ nó làm chính là commit rác đều đặn. Ít dấu chân hơn thì tốt hơn.
 *
 * Nới lên sát 60 là bỏ hết dự phòng; hạ về 1 là đổi một rủi ro đã biết lấy một rủi ro tệ hơn.
 */
export const KEEPALIVE_INTERVAL_DAYS = 20;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Trạng thái workflow do GitHub khai (`GET /repos/{owner}/{repo}/actions/workflows/{file}`).
 *
 * `disabled_inactivity` và `disabled_manually` phải TÁCH nhau, và đây là chỗ quan trọng nhất
 * của cả tính năng: cái đầu là thứ ta sinh ra để chữa, cái sau là một QUYẾT ĐỊNH của con người —
 * bật lại giùm là cãi lại người đã tắt, và cãi lại lặng lẽ. `unknown` cho giá trị lạ mai này
 * GitHub thêm: chưa hiểu thì đừng ra tay.
 */
export type WorkflowState = "active" | "disabled_inactivity" | "disabled_manually" | "unknown";

export function parseWorkflowState(raw: unknown): WorkflowState {
  return raw === "active" || raw === "disabled_inactivity" || raw === "disabled_manually"
    ? raw
    : "unknown";
}

/**
 * Tên tài khoản/tổ chức GitHub: 1–39 ký tự, chữ-số hoặc gạch nối, KHÔNG mở đầu/kết thúc bằng
 * gạch nối và không có hai gạch liền. Luật của GitHub, chép đúng — vì một `owner` lọt qua đây
 * sẽ đi thẳng vào đường dẫn URL của lời gọi API.
 */
const OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;
const REPO_RE = /^[A-Za-z0-9._-]+$/;
const WORKFLOW_FILE_RE = /^[A-Za-z0-9._-]+\.(ya?ml)$/;

/** Trả về lời từ chối, hoặc `null` nếu hợp lệ — cùng hình dạng với `reviewRoleChange`. */
export function reviewStationIdentity(owner: string, repo: string, workflowFile: string): string | null {
  if (owner.length === 0 || owner.length > 39 || !OWNER_RE.test(owner)) {
    return "Tên tài khoản GitHub: 1–39 ký tự chữ/số/gạch nối, không mở đầu hay kết thúc bằng gạch nối.";
  }
  if (repo.length === 0 || repo.length > 100 || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    return "Tên kho: 1–100 ký tự chữ/số/dấu chấm/gạch ngang/gạch dưới.";
  }
  if (workflowFile.length > 100 || !WORKFLOW_FILE_RE.test(workflowFile)) {
    return `Tên tệp workflow phải kết thúc bằng .yml hoặc .yaml (mặc định ${DEFAULT_WORKFLOW_FILE}).`;
  }
  return null;
}

/**
 * Soát phần cấu hình hai kho phần mềm đi kèm một station.
 *
 * Station cũ được phép chưa có kho nào; station mới do script tạo luôn ghi đúng hai kho. Tầng
 * schema vì thế nhận 0..2 để deploy mới đọc được document cũ, còn script chịu trách nhiệm luật
 * "đúng hai" của lượt tạo mới. Không cho trùng kho chính hoặc trùng nhau vì cả hai trường hợp sẽ
 * khiến một cron đẩy hai lần vào cùng một ledger rồi tự vượt quota ngày.
 */
export function reviewCompanionRepos(primaryRepo: string, repos: readonly string[]): string | null {
  if (repos.length > 2) {
    return "Mỗi khôi lỗi chỉ có tối đa hai kho phần mềm đi kèm.";
  }

  const seen = new Set<string>();
  for (const repo of repos) {
    if (repo.length === 0 || repo.length > 100 || !REPO_RE.test(repo) || repo === "." || repo === "..") {
      return "Tên kho phụ: 1–100 ký tự chữ/số/dấu chấm/gạch ngang/gạch dưới.";
    }
    const normalized = repo.toLowerCase();
    if (normalized === primaryRepo.toLowerCase()) {
      return "Kho phụ không được trùng kho khôi lỗi chính.";
    }
    if (seen.has(normalized)) {
      return "Hai kho phụ phải có tên khác nhau.";
    }
    seen.add(normalized);
  }
  return null;
}

/** Ngày vận hành theo giờ Việt Nam/Asia-Bangkok (UTC+7, không có DST). */
export function nurtureDayKey(at: Date): string {
  return new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * PHẠM VI của một lượt `/api/cron` — đọc từ `?only=`.
 *
 * Sinh ra vì hai việc trong route ấy nay chạy theo HAI nhịp khác nhau: quét dọn và ngó kho chính
 * vẫn mỗi ngày một lần, còn nuôi kho phụ phải mỗi giờ mới rải được commit ra cả ngày. Thay vì kéo
 * cả route lên nhịp giờ (24 lượt ngó kho chính, 24 lượt quét dọn — đổi hành vi của những thứ không
 * ai yêu cầu đổi), lượt mỗi giờ tự khai mình chỉ tới vì kho phụ.
 *
 * Vắng `?only=` là TRỌN GÓI, đúng như trước — lịch cũ gọi y nguyên đường cũ và không đổi gì.
 * Giá trị lạ thì từ chối thẳng chứ không lặng lẽ hiểu thành trọn gói: một lượt gõ sai chính tả
 * mà vẫn chạy đủ ba việc là thứ chỉ lộ ra sau nhiều tuần.
 */
export type CronScope = { housekeeping: boolean; keepalive: boolean; companions: boolean };

export function reviewCronScope(raw: string | null): { ok: true; scope: CronScope } | { ok: false; why: string } {
  const wanted = (raw ?? "").trim().toLowerCase();
  if (wanted === "") return { ok: true, scope: { housekeeping: true, keepalive: true, companions: true } };
  if (wanted === "companions") return { ok: true, scope: { housekeeping: false, keepalive: false, companions: true } };
  return { ok: false, why: `Không hiểu ?only=${wanted} — chỉ nhận "companions", hoặc bỏ trống để chạy trọn gói.` };
}

/** Phút-trong-ngày theo giờ Việt Nam — cùng gốc UTC+7 với `nurtureDayKey`. */
export function nurtureMinuteOfDay(at: Date): number {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  return vn.getUTCHours() * 60 + vn.getUTCMinutes();
}

/**
 * CỬA SỔ GIỜ mà kho phụ được phép commit — 08:00 tới 22:00 giờ Việt Nam.
 *
 * Vì sao không phải cả ngày: nửa còn lại của việc này là TRÔNG GIỐNG một tài khoản dev bình
 * thường. Một kho mà lịch sử commit rải đều suốt 24 giờ, đêm nào cũng có, là một dấu chân còn
 * to hơn cả cụm năm commit lúc 3 giờ sáng — không người nào gõ mã theo nhịp ấy.
 *
 * 22:00 là mốc CHỐT chứ không phải mốc mềm: từ giây ấy trở đi `companionDueByNow` trả trọn quota
 * ngày. Nhờ vậy chỉ cần MỘT lượt cron bất kỳ rơi vào khoảng 22:00–23:59 là hôm ấy đủ số, kể cả
 * khi máy nằm im cả buổi chiều.
 */
export const NURTURE_WINDOW_START_MIN = 8 * 60;
export const NURTURE_WINDOW_END_MIN = 22 * 60;

/**
 * Phần khoảng cách giữa hai nấc mà một nấc được phép xê dịch: ±0,4 nhịp.
 *
 * Trần 0,4 (chứ không 0,5) là thứ giữ cho hai nấc KHÔNG BAO GIỜ đổi chỗ cho nhau: hai tâm cách
 * nhau đúng một nhịp, mỗi cái lệch tối đa 0,4 nhịp, nên khoảng hở nhỏ nhất còn 0,2 nhịp. Thứ tự
 * nấc phải bất biến vì `companionDueByNow` đếm「bao nhiêu nấc đã qua」— đảo chỗ là số đếm nhảy lùi
 * giữa hai lượt cron, và một số đếm nhảy lùi thì không bao giờ đẩy bù được.
 */
const NURTURE_JITTER_RATIO = 0.8;

/**
 * FNV-1a 32-bit — bộ băm tất định, không mật mã, đủ cho việc rải giờ.
 *
 * Cần TẤT ĐỊNH chứ không cần ngẫu nhiên thật: hai lượt cron trong cùng một giờ phải tính ra cùng
 * một bộ nấc, bằng không lượt sau đọc ra một số đếm khác lượt trước và đẩy trùng. Đó cũng là lý do
 * hạt giống chỉ gồm (ngày, tên kho, số thứ tự nấc) — không có `Math.random`, không có mốc giờ chạy.
 */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Phút-trong-ngày (giờ VN) của commit thứ `index` (đếm từ 1) trong ngày `day` của kho `repo`.
 *
 * Chia đều cửa sổ thành `dailyPushes` nhịp, lấy TÂM mỗi nhịp rồi xê dịch tất định trong ±0,4 nhịp.
 * Lấy tâm chứ không lấy mép để nấc đầu không dính đúng 08:00 và nấc cuối không dính đúng 22:00 —
 * hai con số tròn trịa cạnh nhau ở mọi kho là đúng thứ dấu vết đang muốn tránh.
 */
export function companionSlotMinute(day: string, repo: string, dailyPushes: number, index: number): number {
  const span = NURTURE_WINDOW_END_MIN - NURTURE_WINDOW_START_MIN;
  const spacing = span / dailyPushes;
  const center = NURTURE_WINDOW_START_MIN + spacing * (index - 0.5);
  // `/ 2**32` đưa băm về [0,1); trừ 0,5 để lệch được cả hai phía.
  const drift = (fnv1a32(`${day}|${repo.toLowerCase()}|${index}`) / 2 ** 32 - 0.5) * spacing * NURTURE_JITTER_RATIO;
  return Math.round(center + drift);
}

/**
 * TỚI GIỜ NÀY thì kho phụ ấy đáng lẽ đã có bao nhiêu commit trong ngày — 0..dailyPushes.
 *
 * Đây là cận trên của vòng đẩy, thay cho `dailyPushes` trần. Nhờ nó, năm commit của một ngày rơi
 * vào năm thời điểm rải trong cửa sổ thay vì một cụm; và vì hàm chỉ phụ thuộc (ngày, tên kho, giờ),
 * hai lượt cron cùng giờ luôn đồng ý với nhau, còn ledger trên GitHub vẫn là thứ chốt số đã đẩy.
 *
 * BÙ DỒN LÀ CÓ CHỦ Ý: máy nằm im từ trưa tới tối thì lượt chạy đầu tiên sau đó thấy「đáng lẽ đã có
 * 4」và đẩy một mạch cho đủ 4. Thà một cụm bù còn hơn mất commit — vì mất là mất luôn, ngày mai mở
 * quota mới chứ không cộng dồn (xem `runKeepaliveAction`).
 */
export function companionDueByNow(now: Date, dailyPushes: number, repo: string): number {
  if (!Number.isFinite(dailyPushes) || dailyPushes <= 0) return 0;
  const quota = Math.min(MAX_DAILY_PUSHES, Math.floor(dailyPushes));
  const minute = nurtureMinuteOfDay(now);
  if (minute < NURTURE_WINDOW_START_MIN) return 0;
  // Qua mốc chốt thì trả trọn quota — không cần dò từng nấc, và đây là điều bảo đảm hôm nào cũng
  // đủ số miễn có một lượt cron sau 22:00.
  if (minute >= NURTURE_WINDOW_END_MIN) return quota;

  const day = nurtureDayKey(now);
  let due = 0;
  // Nấc đã được chứng minh là không đổi chỗ (xem NURTURE_JITTER_RATIO), nên gặp nấc đầu tiên còn ở
  // tương lai là dừng được ngay.
  for (let index = 1; index <= quota; index += 1) {
    if (companionSlotMinute(day, repo, quota, index) > minute) break;
    due += 1;
  }
  return due;
}

/**
 * PAT cần scope nào — hiện trên form, vì đây là chỗ hỏng nhiều nhất của cả lối này.
 *
 * `repo` cho lượt ghi `.github/heartbeat.txt`; `workflow` cho lượt bật lại lịch đã bị tắt. Tệp
 * mốc nằm trong `.github/` nhưng NGOÀI `.github/workflows/`, nên bản thân nó không đòi
 * `workflow` — nhưng cùng cái PAT ấy còn được `scripts/newGithubKhoiloi.mjs` dùng để đẩy chính
 * workflow lên, và thiếu scope ấy thì lượt push bị GitHub từ chối ở đúng bước cuối.
 */
export const PAT_SCOPES_NOTE = "Cần scope repo + workflow (classic), hoặc Contents: read/write + Actions: read/write (fine-grained).";

/** Chuỗi định danh một kho trong sổ — cũng là khoá tra và là thứ hiện trên giao diện. */
export function stationSlug(station: { owner: string; repo: string }): string {
  return `${station.owner}/${station.repo}`;
}

/** Câu `message` mà GitHub trả kèm mọi lỗi — thứ đáng in ra nhất, nên moi cẩn thận. */
export function githubMessage(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message.slice(0, 200);
  }
  return "";
}

/**
 * Đổi một mã lỗi HTTP thành câu người vận hành DÙNG ĐƯỢC.
 *
 * Ba mã đầu là ba nguyên nhân khác hẳn nhau mà nhìn thô đều chỉ là「không được」, và đoán nhầm
 * giữa chúng là đi sửa nhầm chỗ hàng giờ: 401 là token, 403 là quyền/hạn mức, 404 là tên kho —
 * hoặc, và đây là chỗ bẫy, cũng vẫn là token: GitHub trả 404 thay vì 403 cho kho mà token không
 * được phép thấy, cố ý, để không lộ ra kho ấy có tồn tại hay không.
 *
 * Ở ĐÂY (thuần) chứ không ở `services/githubStations.ts` vì có HAI đường gọi API GitHub bằng PAT
 * của sổ — vòng nuôi kho, và lượt phát hành `scripts/deployGithubKhoiloi.mts`. Cùng một mã lỗi
 * phải đọc ra cùng một câu ở cả hai, bằng không người vận hành phải học hai từ điển cho một API.
 *
 * `422` là mã của riêng đường phát hành, và nó gộp hai nguyên nhân rất khác nhau — nhánh vừa
 * nhích dưới chân lượt đẩy, và PAT thiếu scope `workflow` — nên câu chữ phải nói cả hai.
 */
export function explainFailure(status: number, body: unknown, what: string): string {
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
  if (status === 422) {
    return `GitHub từ chối (422) khi ${what}: nhánh vừa nhích dưới chân lượt đẩy, hoặc PAT thiếu scope \`workflow\` để đụng .github/workflows/${suffix}`;
  }
  // 5xx LÀ LỖI CỦA HỌ, VÀ PHẢI NÓI THẲNG RA THẾ — bằng không người vận hành đi thay một chìa còn
  // tốt. Đã xảy ra ngày 17/08/2026: `github:new` chết với「GitHub từ chối lượt hỏi danh tính (HTTP
  // 503). Kiểm lại PAT.」, tông chủ tạo PAT mới và dán nó qua khung chat — một chìa toàn tài khoản
  // bị đốt cho một sự cố năm phút bên GitHub. PAT hỏng thì API trả 401, không bao giờ trả 503.
  if (status >= 500) {
    return `GitHub đang trục trặc (${status}) khi ${what} — lỗi phía HỌ, KHÔNG phải PAT của bạn. Chờ một lát rồi chạy lại${suffix}`;
  }
  return `GitHub trả ${status} khi ${what}${suffix}`;
}

/**
 * Trạm này có phải trạm chịu trách nhiệm nuôi sổ không.
 *
 * VÌ SAO CẦN, và vì sao nó không hiện ra cho tới 13/08/2026: sổ kho GitHub sống trong
 * `app_settings`, mà `app_settings` nằm trong `SYNC_TABLE_ORDER` — nên nó **tự đi theo mọi lượt
 * chuyển trạm**, đúng như đã thiết kế. Cộng thêm ba điều đều đúng và đều vô hại khi đứng riêng:
 * mọi trạm mang cùng `vercel.json` (cùng cron `0 3 * * *`), `newMirrorStation` rải `CRON_SECRET`
 * cho mọi trạm, và `runKeepalive` chỉ đọc sổ của database nó đang nối. Ghép lại thì sau lượt
 * chuyển trạm kế tiếp, TRẠM CŨ vẫn giữ bản sao của sổ và cron của nó vẫn chạy — hai trạm cùng
 * nuôi một kho, không thấy nhau, vì `lastCommitAt` nằm ở hai database khác nhau.
 *
 * Kho vẫn sống — nhiều hoạt động hơn thì mục tiêu vẫn đạt. Nhưng nó đi ngược đúng thứ
 * `KEEPALIVE_INTERVAL_DAYS` đánh đổi để có: dấu chân nhỏ nhất có thể, vì GitHub đã gỡ
 * `gautamkrishnar/keepalive-workflow` do chính hành vi commit rác đều đặn. Ca xấu hơn là một trạm
 * đã nghỉ hẳn mà project Vercel vẫn sống: nó sẽ đẩy commit vào kho của người ta mãi mãi, và
 * không dòng sổ nào của trạm đang phục vụ hé ra điều đó.
 *
 * FAIL-OPEN, và chiều của nó là phần quan trọng nhất ở đây: không đọc được bảng điều phối, hay
 * trạm chưa khai `SITE_ID` (deploy cũ, máy phát triển) thì **VẪN NUÔI**. Thà thừa một commit còn
 * hơn để cả hệ thống lặng lẽ thôi nuôi vì một lượt đọc bucket hụt — và im lặng đúng là hình dạng
 * hỏng mà cả tính năng này sinh ra để chống. Cùng chiều với `activeSiteCheck` bên
 * `actions/mirrorSwitch.ts`, nơi bảng chưa init cũng coi như trạm này đang hoạt động.
 *
 * Chỉ gác đường TỰ ĐỘNG. Nút「Nuôi ngay」và「Chạy vòng nuôi」trên tab admin không đi qua đây: đó
 * là một con người bấm, và luật của tệp này là không cãi lại quyết định của con người —
 * cùng lẽ với `disabled_manually`.
 */
export type KeepaliveDuty = { feed: boolean; why: string };

export function reviewKeepaliveDuty(siteId: string, activeSiteId: string | null): KeepaliveDuty {
  const me = siteId.trim();
  const active = (activeSiteId ?? "").trim();

  if (active.length === 0) {
    return { feed: true, why: "Chưa đọc được trạm hoạt động từ bảng điều phối — nuôi cho chắc." };
  }
  if (me.length === 0) {
    return { feed: true, why: "Trạm này chưa khai SITE_ID — nuôi cho chắc." };
  }
  if (me === active) {
    return { feed: true, why: `Trạm đang hoạt động (${me}).` };
  }
  return { feed: false, why: `Trạm nghỉ (${me}) — để trạm đang hoạt động「${active}」nuôi.` };
}

/**
 * Duty của hai software repo CỐ Ý NGƯỢC chiều fail-open ở trên.
 *
 * Kho chính chỉ cần một commit mỗi 20 ngày để khỏi chết lịch; thừa một commit khi control doc
 * chớp là cái giá nhỏ. Repo phụ thì mang cấu hình admin theo NGÀY, kể cả `dailyPushes = 0`.
 * Một trạm cũ giữ snapshot `5` mà fail-open khi không đọc được active site sẽ đẩy mười commit
 * trái với lệnh tạm dừng ở trạm mới. Vì vậy chỉ đúng cặp SITE_ID hiện tại == active mới được
 * chạy tự động. Nút admin không dùng phép gác này: người bấm đang chủ động chọn database hiện tại.
 */
export function reviewCompanionNurtureDuty(siteId: string, activeSiteId: string | null): KeepaliveDuty {
  const me = siteId.trim();
  const active = (activeSiteId ?? "").trim();

  if (active.length === 0) {
    return { feed: false, why: "Chưa xác định được trạm hoạt động — không đẩy repo phụ để khỏi dùng cấu hình cũ." };
  }
  /**
   * SITE_ID RỖNG = BACKEND TRÊN VM, và đó là một danh tính KHẲNG ĐỊNH được, không phải「không rõ」.
   *
   * Bản đầu đọc nó thành「không chứng minh được」rồi fail-closed — đúng khi mỗi trạm còn là một bản
   * app đầy đủ và một trạm đã nghỉ vẫn có thể chạy cron với `dailyPushes` cũ. Từ 16/08/2026 điều ấy
   * hết đúng: năm trạm Vercel chỉ còn là vỏ proxy, không chạy mã nào, và backend trên VM là NƠI DUY
   * NHẤT có cron. Nên hàng rào ấy không còn chặn một trạm stale nào cả — nó chặn đúng cái máy duy
   * nhất được phép làm việc này.
   *
   * Cái giá đã trả, đo 21/08/2026: vòng nuôi kho phụ CHƯA TỪNG chạy kể từ ngày dọn về VM. Mỗi lượt
   * cron đều trả `{"companionNurture":{"skipped":true}}` và không ai đọc dòng ấy, nên ba kho phần
   * mềm nằm im suốt — trong khi phần chúng gánh chính là「trông như một tài khoản dev bình thường」.
   *
   * KHÔNG chữa bằng cách đặt SITE_ID cho VM: `registerSelfAction` và `backendIsStation`
   * (lib/mirror/switchGuard.ts) cấm thẳng, vì làm vậy là lên đạn lại lượt chuyển trạm và tầng
   * chuyển hướng — hai thứ đều đã hết đích. Chỗ phải sửa là cách ĐỌC cái rỗng ấy, tức ngay đây.
   *
   * Vẫn an toàn khi một vỏ proxy lỡ chuyển tiếp một lượt cron: mọi đường đều về cùng backend, cùng
   * database, và ledger trong kho mới là thứ chốt「đã đẩy mấy cái」— hai lượt cùng lúc không đẩy
   * trùng được.
   */
  if (me.length === 0) {
    return { feed: true, why: "Backend trên VM — nơi duy nhất chạy cron, không phải một trạm trong vòng xoay." };
  }
  if (me === active) {
    return { feed: true, why: `Trạm đang hoạt động (${me}).` };
  }
  return { feed: false, why: `Trạm nghỉ (${me}) — repo phụ chỉ do trạm đang hoạt động「${active}」nuôi.` };
}

/**
 * Kho này đã tới hạn ghi commit chưa.
 *
 * `lastCommitAt` rỗng ⇒ TỚI HẠN, cố ý: sổ không biết kho ấy im lặng bao lâu rồi, và đoán theo
 * hướng lạc quan ở đây nghĩa là để một kho có thể đã 59 ngày không ai đụng nằm chờ thêm 20 ngày
 * nữa. Nó cũng là điều đáng làm ngay: lượt ghi đầu tiên chính là phép thử PAT có thật sự push
 * được không, trả lời ngay lúc admin vừa bấm Lưu chứ không phải ba tuần sau.
 */
/**
 * Thứ tự nuôi kho trong MỘT lượt vòng: kho gần vách 60 ngày nhất đi trước.
 *
 * `runKeepalive` chạy TUẦN TỰ và tự cắt khi hết `LOOP_BUDGET_MS`, nên THỨ TỰ LẶP quyết định ai
 * bị bỏ lại. Lặp theo thứ tự sổ — tức thứ tự người ta thêm vào — thì cú cắt rơi vào đúng cái đuôi
 * ấy ở MỌI lượt chạy: mấy kho cuối không bao giờ tới lượt, im lặng suốt sáu mươi ngày rồi bị
 * GitHub tắt lịch, và `skipped` trong bảng tổng kết vẫn chỉ nói "còn n kho chưa tới lượt" chứ
 * không nói "vẫn là n kho ấy".
 *
 * Ba nấc so, mỗi nấc trả lời một câu:
 *
 *   1. `lastCommitAt` — mốc DUY NHẤT vách 60 ngày đọc (xem `isCommitDue`). Đây là nấc quyết định.
 *   2. `lastPingAt` — cho sổ mới toanh, khi mọi mốc ghi đều rỗng: vẫn phải có một trật tự luân
 *      phiên, bằng không nấc 3 sẽ ghim cứng thứ tự theo tên.
 *   3. Tên kho — để hai dòng cùng mốc không đổi chỗ giữa hai lượt chạy. So bằng `<`/`>` chứ không
 *      `localeCompare`: thứ tự phải là của dữ liệu, không phải của ICU trên máy đang chạy.
 *
 * Mốc rỗng hoặc không đọc được ⇒ đi ĐẦU, cùng lẽ với `isCommitDue`: "không biết" phải xử như "đã
 * lâu lắm". Một mốc rác vì thế được nuôi ở lượt kế và tự lành ngay sau lượt ghi sổ.
 *
 * Trả về MẢNG MỚI, không sắp lại sổ trong database: sổ là danh sách của con người, thứ tự trong
 * tab admin phải giữ đúng thứ tự người ta đã thêm.
 */
export function keepaliveOrder<
  T extends { owner: string; repo: string; lastCommitAt: string | null; lastPingAt: string | null },
>(stations: readonly T[]): T[] {
  const stamp = (raw: string | null): number => {
    if (!raw) {
      return 0;
    }
    const at = Date.parse(raw);
    return Number.isNaN(at) ? 0 : at;
  };
  return [...stations].sort((a, b) => {
    const byCommit = stamp(a.lastCommitAt) - stamp(b.lastCommitAt);
    if (byCommit !== 0) {
      return byCommit;
    }
    const byPing = stamp(a.lastPingAt) - stamp(b.lastPingAt);
    if (byPing !== 0) {
      return byPing;
    }
    const left = stationSlug(a);
    const right = stationSlug(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Hạng của một cái đếm ngược. `unknown` = chưa ghi mốc lần nào, nên KHÔNG BIẾT — và「không
 * biết」phải giữ nguyên là không biết, đừng gộp vào「còn nhiều ngày」cho gọn bảng.
 */
export type CountdownLevel = "unknown" | "critical" | "warn" | "ok";

/**
 * Còn N ngày trước mốc GitHub tắt lịch thì nặng tới đâu. Hai ngưỡng, và cả hai suy ra từ nhịp
 * ghi thật chứ không phải số tròn cho đẹp — một kho KHOẺ phải luôn ở hạng `ok`, bằng không
 * hạng `warn` mất hết nghĩa sau tuần đầu.
 *
 * Kho khoẻ dao động giữa 60 (vừa ghi) và 40 (đúng lúc tới hạn, trước khi vòng nuôi trong ngày
 * chạy). Nên ngưỡng `warn` là「THẤP HƠN 40」chứ không phải「từ 40 trở xuống」: đứng đúng ở 40 là
 * trạng thái bình thường mỗi chu kỳ, và cảnh báo cho nó là dạy người vận hành bỏ qua cảnh báo.
 *
 * Ở đây chứ không ở tab admin vì hai chỗ đọc nó theo hai kiểu: một chỗ tô màu MỘT hàng, một chỗ
 * ĐẾM cả sổ để nói「trang này giấu mất mấy kho」. Hai phép ấy mà lệch nhau một ngưỡng thì con số
 * cảnh báo và cái màu trên màn hình nói hai chuyện khác nhau.
 */
export function countdownLevel(days: number | null): CountdownLevel {
  if (days === null) return "unknown";
  // Còn ít hơn một chu kỳ ghi: lượt ghi kế mà hỏng nữa là không còn lần thứ ba nào trước mốc tắt.
  if (days <= KEEPALIVE_INTERVAL_DAYS) return "critical";
  // Đã trượt hẳn một lượt ghi — vòng nuôi có chạy, nhưng kho này không nhận được commit nào.
  if (days < SCHEDULE_DISABLE_DAYS - KEEPALIVE_INTERVAL_DAYS) return "warn";
  return "ok";
}

/**
 * Đếm kho đáng ngó trong một lát sổ, theo hai hạng nặng.
 *
 * CHỈ tính kho `enabled`: kho tắt đứng ngoài vòng nuôi hoàn toàn (`runKeepalive` lọc `enabled`),
 * nên đếm ngược của nó chắc chắn trôi về 0 — đó là trạng thái đã chọn, không phải sự cố. Đếm nó
 * vào thì lời cảnh báo đỏ vĩnh viễn, và người vận hành học được đúng một điều: bỏ qua nó.
 */
export function countUrgent(
  stations: readonly { enabled: boolean; daysToDisable: number | null }[],
): { critical: number; warn: number } {
  let critical = 0;
  let warn = 0;
  for (const station of stations) {
    if (!station.enabled) continue;
    const level = countdownLevel(station.daysToDisable);
    if (level === "critical") critical += 1;
    else if (level === "warn") warn += 1;
  }
  return { critical, warn };
}

export function isCommitDue(lastCommitAt: string | null, now: Date): boolean {
  if (!lastCommitAt) {
    return true;
  }
  const last = Date.parse(lastCommitAt);
  // Mốc không đọc được (sửa tay JSONB) cũng là "không biết" — xử như chưa từng ghi.
  if (Number.isNaN(last)) {
    return true;
  }
  return now.getTime() - last >= KEEPALIVE_INTERVAL_DAYS * MS_PER_DAY;
}
