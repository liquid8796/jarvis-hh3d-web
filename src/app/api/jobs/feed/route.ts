import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { getJobsFeed } from "@/lib/services/dashboard";
import { reapStaleJobs } from "@/lib/services/jobs";

/**
 * Feed job đời cũ/compatibility. Dashboard v0.19 dùng /api/dashboard/stream và feed hợp nhất;
 * giữ route này cho tab/bản deploy cũ đang mở trong lúc rollout. Từ khi có nhiều tài khoản,
 * hình trả về là `{ jobs, events }` theo đúng payload sống. Đây vẫn là một READ
 * cacheable-never; stale-job reaper tiện đường chạy để hệ nhỏ không phụ thuộc cron dày.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();

  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  return NextResponse.json(await getJobsFeed(user.id, after));
}
