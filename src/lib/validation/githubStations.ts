/**
 * Luật của SỔ KHO GITHUB — hằng số và phép kiểm hình dạng, thuần, không đụng mạng lẫn database.
 *
 * Tách khỏi `services/githubStations.ts` vì `services/settings.ts` cần mấy hằng số này cho Zod,
 * mà service thì lại đọc/ghi qua chính settings — nhập thẳng vào nhau là một vòng tròn. Ở đây
 * cũng là chỗ script kiểm chứng hỏi luật mà không phải dựng gì (cùng lẽ với `validation/retention.ts`).
 */

/**
 * Trần số kho trong sổ. Bằng đúng trần của sổ gương trạm, và cùng lý do: đây là một danh sách
 * do người gõ tay, không phải một bảng dữ liệu — quá tám dòng thì thứ cần sửa là cách làm việc,
 * không phải con số này. Trần cũng là hàng rào cho vòng nuôi kho: mỗi kho là 2–3 lượt HTTPS,
 * và cả vòng phải lọt trong `maxDuration` của một function.
 */
export const GITHUB_STATION_LIMIT = 8;

/** Tệp mốc nuôi kho. Trong `.github/` nhưng KHÔNG trong `.github/workflows/` — xem `PAT_SCOPES_NOTE`. */
export const HEARTBEAT_PATH = ".github/heartbeat.txt";

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
 * Kho này đã tới hạn ghi commit chưa.
 *
 * `lastCommitAt` rỗng ⇒ TỚI HẠN, cố ý: sổ không biết kho ấy im lặng bao lâu rồi, và đoán theo
 * hướng lạc quan ở đây nghĩa là để một kho có thể đã 59 ngày không ai đụng nằm chờ thêm 20 ngày
 * nữa. Nó cũng là điều đáng làm ngay: lượt ghi đầu tiên chính là phép thử PAT có thật sự push
 * được không, trả lời ngay lúc admin vừa bấm Lưu chứ không phải ba tuần sau.
 */
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
