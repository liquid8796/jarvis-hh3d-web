import { Client, neon } from "@neondatabase/serverless";

export const DASHBOARD_CHANNEL = "jarvis_dashboard";

export type DashboardSignal = {
  userId: string;
  topic: "job" | "event" | "presence" | "events-cleared" | "config";
};

/**
 * LISTEN cần một session thật nên không đi qua host `-pooler` dùng cho query một-phát.
 * Giữ nguyên database/path/credentials của DATABASE_URL (dự án này dùng DB `jarvis`, trong
 * khi DATABASE_URL_UNPOOLED do integration sinh mặc định lại trỏ tới `neondb`) và chỉ thay host.
 */
export function realtimeDatabaseUrl(): string {
  const explicit = process.env.REALTIME_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  const url = new URL(raw);
  const unpooledHost = process.env.PGHOST_UNPOOLED?.trim();
  url.hostname = unpooledHost || url.hostname.replace("-pooler.", ".");
  return url.toString();
}

export function createDashboardListener(): Client {
  return new Client({ connectionString: realtimeDatabaseUrl() });
}

export function parseDashboardSignal(payload: string | undefined): DashboardSignal | null {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as Partial<DashboardSignal>;
    if (
      typeof value.userId !== "string" ||
      !["job", "event", "presence", "events-cleared", "config"].includes(String(value.topic))
    ) {
      return null;
    }
    return value as DashboardSignal;
  } catch {
    return null;
  }
}

/** Tín hiệu hiếm do app tự phát; thay đổi thường ngày được trigger DB phát trong cùng transaction. */
export async function notifyDashboard(signal: DashboardSignal): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;
  const sql = neon(raw);
  await sql.query("select pg_notify($1, $2)", [DASHBOARD_CHANNEL, JSON.stringify(signal)]);
}
