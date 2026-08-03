export type JobStatus = "queued" | "running" | "stopping" | "stopped" | "failed" | "done";

export type DashboardJob = {
  id: string;
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
  job: DashboardJob | null;
  events: DashboardEvent[];
  presence: DashboardPresence;
  resetEvents?: boolean;
};
