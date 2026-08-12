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
