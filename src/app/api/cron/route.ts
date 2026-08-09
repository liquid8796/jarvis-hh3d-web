import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeExpiredChat } from "@/lib/services/chat";
import { reapStaleJobs } from "@/lib/services/jobs";

/**
 * Người quét dọn — và CHỈ quét dọn.
 *
 * Từ khi mọi lượt chạy đều do một worker sống dai đảm nhiệm (khôi lỗi tông môn trên VM,
 * hoặc khôi lỗi máy nhà của đạo hữu), không còn ai cần được "gõ cửa đánh thức" nữa: worker
 * tự hỏi việc mỗi 5 giây. Route này chỉ còn hai việc vệ sinh — kết liễu job đang chạy mất
 * nhịp tim, và quét tin đàm đạo quá hạn lưu. Cả hai đều được gọi TIỆN ĐƯỜNG từ
 * đường đọc của dashboard rồi, nên cron ngoài giờ là lưới an toàn cho những ngày không ai
 * mở web, không phải mạch sống của hệ thống.
 *
 * Gọi từ đâu cũng được, miễn là mang đúng `Authorization: Bearer CRON_SECRET`:
 *   • Vercel Cron — tự gắn header ấy khi project có biến `CRON_SECRET`; gói Hobby chỉ
 *     1 lần/ngày, đủ cho vệ sinh.
 *   • Dịch vụ cron ngoài (cron-job.org…) — tự đặt header.
 *
 * TRƯỚC 09/08/2026 route này còn cho qua khi `user-agent` có chữ "vercel-cron", và đó là một
 * lỗ hổng thật chứ không phải tiện lợi: header do client đặt, nên bất kỳ ai gõ một dòng curl
 * cũng chạy được vòng quét. Hậu quả có giới hạn (hai việc đều idempotent, chỉ đụng thứ vốn đã
 * quá hạn) nhưng nó vẫn là một cửa mở, và mở ra một đường bào tài nguyên: mỗi lượt gọi là một
 * function chạy kèm mấy câu ghi database. Giờ cửa chỉ mở bằng bí mật.
 *
 * FAIL CLOSED khi chưa đặt `CRON_SECRET`: thà việc quét dọn không chạy (nó vốn đã có đường
 * chạy tiện thể từ nhịp đọc dashboard) còn hơn để ngỏ một endpoint cho cả Internet.
 */
export const maxDuration = 60;

/** So sánh không rò thời gian, và không ném khi hai chuỗi khác độ dài. */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!secret || presented.length === 0 || !secretMatches(presented, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();
  await purgeExpiredChat();

  return NextResponse.json({ ok: true, swept: true });
}
