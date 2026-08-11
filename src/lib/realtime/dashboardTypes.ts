export type JobStatus = "queued" | "running" | "stopping" | "stopped" | "failed" | "done";
export type AccountTier = "vip" | "free";

/**
 * Khôi lỗi đang làm tới đâu trong VÒNG NÀY — thứ duy nhất trả lời được "đàn kia đang bận
 * nhiệm vụ gì", vì mọi thứ khác về một lượt chạy chỉ là văn xuôi trong job_events.
 *
 * `running` là số NHIỀU vì nhiệm vụ chạy song song (mặc định tới 3 tab cùng lúc): một
 * trường "nhiệm vụ hiện tại" số ít sẽ phải chọn bừa một cái trong ba và nói dối về hai cái
 * còn lại. Rỗng là một trạng thái thật, không phải thiếu dữ liệu — nó là quãng khôi lỗi đang
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
  /** Bản của gói khôi lỗi, do nó tự khai. `null` = bản trước 0.71.0, chưa biết khai. */
  version: string | null;
};

export type DashboardPresence = {
  sectOnline: boolean;
  /**
   * Bản của TRẠM ĐANG PHỤC VỤ trang này — mốc để đối chiếu với bản của từng khôi lỗi.
   *
   * Đi trong payload chứ không đọc ở client: mục Khôi Lỗi là `"use client"`, mà nhập
   * package.json vào đó là ném cả tệp ấy sang trình duyệt. Và nó phải theo payload thật vì
   * sau một lượt chuyển trạm, trạm đang phục vụ có thể mang bản khác hẳn tab đang mở.
   */
  webVersion: string | null;
  /** Dùng ở server để biết chính xác lúc cần chuyển sang "vắng", không cần poll database. */
  sectLastSeen: string | null;
  mine: DashboardWorker[];
};

/**
 * Trạng thái bế quan trùng tu — bản chiếu của nhánh `maintenance` trong app_settings, đủ cho
 * client vẽ bảng/dải: đếm ngược trỏ vào `expectedEndAt`, thanh tiến độ nội suy giữa hai mốc.
 * Mốc là chuỗi ISO và client PHẢI tự phòng Date.parse hỏng — nguồn của chúng là một document
 * JSONB không ai ép kiểu ở tầng ghi.
 *
 * Tên vẫn mang tiền tố `Dashboard` vì đây là nơi nó sinh ra, nhưng từ 09/08/2026 nó KHÔNG còn
 * đi trong payload của Auto: người đọc nó giờ là MaintenanceGate ở layout gốc và
 * /api/maintenance. Đổi tên là đổi ở năm chỗ để được một tiền tố đẹp hơn — chưa đáng.
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
  resetEvents?: boolean;
};
