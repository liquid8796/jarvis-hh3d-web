export type JobStatus = "queued" | "running" | "stopping" | "stopped" | "failed" | "done";
export type AccountTier = "vip" | "free";

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

export type DashboardLivePayload = {
  /** Job mới nhất của TỪNG tài khoản, theo thứ tự tạo tài khoản. */
  jobs: DashboardJob[];
  events: DashboardEvent[];
  presence: DashboardPresence;
  accounts: DashboardAccount[];
  resetEvents?: boolean;
};
