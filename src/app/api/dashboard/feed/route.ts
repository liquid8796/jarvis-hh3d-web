import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { getDashboardFeed } from "@/lib/services/dashboard";
import { reapStaleJobs } from "@/lib/services/jobs";

/** Ảnh chụp một-lần làm lưới an toàn khi EventSource đang reconnect hoặc bị mạng chặn. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  return Response.json(await getDashboardFeed(user.id, after));
}
