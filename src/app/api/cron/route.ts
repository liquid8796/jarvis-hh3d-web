import { NextResponse } from "next/server";
import { purgeExpiredChat } from "@/lib/services/chat";
import { reapStaleJobs } from "@/lib/services/jobs";

/**
 * Người quét dọn — và CHỈ quét dọn.
 *
 * Từ khi mọi lượt chạy đều do một worker sống dai đảm nhiệm (linh sứ tông môn trên VM,
 * hoặc linh sứ máy nhà của đạo hữu), không còn ai cần được "gõ cửa đánh thức" nữa: worker
 * tự hỏi việc mỗi 5 giây. Route này chỉ còn hai việc vệ sinh — kết liễu job đang chạy mất
 * nhịp tim, và quét tin đàm đạo quá hạn lưu. Cả hai đều được gọi TIỆN ĐƯỜNG từ
 * đường đọc của dashboard rồi, nên cron ngoài giờ là lưới an toàn cho những ngày không ai
 * mở web, không phải mạch sống của hệ thống.
 *
 * Gọi từ đâu cũng được:
 *   • Vercel Cron — gói Hobby chỉ 1 lần/ngày, đủ cho vệ sinh.
 *   • Dịch vụ cron ngoài (cron-job.org…), kèm `Authorization: Bearer CRON_SECRET`.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  const secret = process.env.CRON_SECRET;
  const authorized =
    isVercelCron ||
    (secret ? request.headers.get("authorization") === `Bearer ${secret}` : false);

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();
  await purgeExpiredChat();

  return NextResponse.json({ ok: true, swept: true });
}
