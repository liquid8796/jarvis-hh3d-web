import { currentUser } from "@/lib/auth/guards";
import { unseenNotices } from "@/lib/services/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Những lời nhắn người đang đăng nhập CHƯA bấm「Đã hiểu」.
 *
 * Đây là đường CHẮC CHẮN, còn `/api/notice/stream` là đường NHANH. Popup hỏi đường này một lần
 * lúc mở trang rồi mới mở kênh: nhờ vậy một người vắng mặt lúc phát vẫn thấy lời nhắn ở lần
 * vào sau, và ngày kênh realtime hỏng (Neon chặn LISTEN, mạng công ty chặn SSE) thì tính năng
 * chỉ MẤT ĐỘ TỨC THÌ chứ không mất hẳn.
 *
 * 401 cho khách vãng lai là câu trả lời BÌNH THƯỜNG chứ không phải lỗi: popup dựng ở layout
 * gốc nên nó có mặt cả ở trang đăng nhập, và nó dùng đúng cú 401 này để biết mà nằm im.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({ notices: await unseenNotices(user.id) });
}
