export type JobStatus = "queued" | "running" | "stopping" | "stopped" | "failed" | "done";
export type AccountTier = "vip" | "free";

/**
 * Linh sứ đang làm tới đâu trong VÒNG NÀY — thứ duy nhất trả lời được "đàn kia đang bận
 * nhiệm vụ gì", vì mọi thứ khác về một lượt chạy chỉ là văn xuôi trong job_events.
 *
 * `running` là số NHIỀU vì nhiệm vụ chạy song song (mặc định tới 3 tab cùng lúc): một
 * trường "nhiệm vụ hiện tại" số ít sẽ phải chọn bừa một cái trong ba và nói dối về hai cái
 * còn lại. Rỗng là một trạng thái thật, không phải thiếu dữ liệu — nó là quãng linh sứ đang
 * mở trình duyệt, qua cổng Cloudflare hoặc dò hạng tài khoản, trước khi nhiệm vụ đầu bắt đầu.
 *
 * `total` đã lọc theo hạng tài khoản, nên nó là số nhiệm vụ vòng này THẬT SỰ chạy, không
 * phải số ô người dùng đã tick trong Ngọc Giản.
 */
export type CycleProgress = {
  running: string[];
  done: number;
  total: number;
};

export type DashboardJob = {
  id: string;
  /** null = job đời một-cookie, trước khi có bảng game_accounts. */
  accountId: string | null;
  accountLabel: string | null;
  status: JobStatus;
  createdAt: string;
  nextRunAt: string;
  attempts: number;
  workerId: string | null;
};

export type DashboardEvent = {
  id: number;
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  /** Nhãn tài khoản của job sinh ra dòng này — để nhật ký gộp còn đọc được khi chạy nhiều tài khoản. */
  accountLabel: string | null;
};

export type DashboardAccount = {
  id: string;
  label: string;
  accountTier: AccountTier | null;
  enabled: boolean;
};

export type DashboardWorker = {
  id: string;
  lastSeen: string;
  online: boolean;
};

export type DashboardPresence = {
  sectOnline: boolean;
  /** Dùng ở server để biết chính xác lúc cần chuyển sang "vắng", không cần poll database. */
  sectLastSeen: string | null;
  mine: DashboardWorker[];
};

/**
 * Trạng thái bế quan trùng tu — bản chiếu của nhánh `maintenance` trong app_settings, đủ
 * cho client vẽ popup: đếm ngược trỏ vào `expectedEndAt`, thanh tiến độ nội suy giữa hai
 * mốc. Mốc là chuỗi ISO và client PHẢI tự phòng Date.parse hỏng — nguồn của chúng là một
 * document JSONB không ai ép kiểu ở tầng ghi.
 */
export type DashboardMaintenance = {
  active: boolean;
  startedAt: string | null;
  expectedEndAt: string | null;
  note: string;
};

export type DashboardLivePayload = {
  /** Job mới nhất của TỪNG tài khoản, theo thứ tự tạo tài khoản. */
  jobs: DashboardJob[];
  events: DashboardEvent[];
  presence: DashboardPresence;
  accounts: DashboardAccount[];
  /** Optional vì client có thể đang cầm frame của bản deploy cũ; vắng mặt = giữ nguyên. */
  maintenance?: DashboardMaintenance;
  resetEvents?: boolean;
};
