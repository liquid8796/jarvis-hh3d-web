import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { reapStaleJobs } from "@/lib/services/jobs";
import { getQueueSnapshot } from "@/lib/services/queue";

/**
 * Ảnh chụp hàng đợi cho trang Hàng Đợi Công Việc, hỏi lại theo nhịp.
 *
 * Vì sao KHÔNG đi qua SSE như Auto: kênh SSE kia lọc theo đúng một người (payload dựng
 * từ `userId` của người nghe), còn hàng đợi là chuyện của cả tông môn — đổi kênh ấy thành
 * kênh chung là mở đường cho một lỗi lọc sai làm rò dữ liệu người khác. Một endpoint đọc
 * riêng, tự che tên ngay trong service, dễ soi hơn nhiều.
 *
 * `currentUser` chứ không `requireActiveUser`: route trả JSON, redirect của guard sẽ biến
 * lỗi quyền thành một trang HTML lạc chỗ giữa vòng poll.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cùng lý do với các đường đọc khác: dọn job mất nhịp tim tiện đường, để hệ nhỏ không phải
  // nuôi một cron riêng chỉ để làm việc đó.
  await reapStaleJobs();

  return NextResponse.json(await getQueueSnapshot(user));
}
