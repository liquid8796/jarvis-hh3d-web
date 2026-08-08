import { NextResponse } from "next/server";
import { getMaintenanceFeed } from "@/lib/services/dashboard";

/**
 * Cờ bế quan trùng tu — bốn trường, không hơn. `MaintenanceWatch` hỏi endpoint này mỗi phút
 * (mười giây khi đang bế quan) để biết lúc nào phải gọi `router.refresh()`.
 *
 * KHÔNG có guard, và đó là chủ ý: dải nhắc bế quan hiện cả cho khách chưa đăng nhập, nên nhịp
 * soát của họ cũng phải gọi được. Thứ lộ ra là đúng cái thông báo mà trang đã in ra cho mọi
 * người đọc — không có gì để giấu ở đây.
 *
 * `force-dynamic` + `no-store`: đây là một CÔNG TẮC, và một công tắc bị cache thì trưởng môn
 * gạt xong vẫn thấy cửa đóng. Route handler trong Next 16 không tự cache GET, nhưng nói rõ ra
 * thì không phụ thuộc vào mặc định của một phiên bản.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const maintenance = await getMaintenanceFeed();
  return NextResponse.json(maintenance, { headers: { "cache-control": "no-store" } });
}
