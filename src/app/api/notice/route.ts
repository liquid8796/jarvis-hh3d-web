import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth/guards";
import { guestNotices, unseenNotices } from "@/lib/services/notices";
import { GUEST_SEEN_COOKIE, parseGuestSeen } from "@/lib/validation/guestSeen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Những lời nhắn NGƯỜI ĐANG XEM chưa bấm「Đã hiểu」— thành viên đã đăng nhập, hoặc khách vãng lai.
 *
 * Đây là đường CHẮC CHẮN, còn `/api/notice/stream` là đường NHANH. Popup hỏi đường này một lần
 * lúc mở trang rồi mới mở kênh: nhờ vậy một người vắng mặt lúc phát vẫn thấy lời nhắn ở lần
 * vào sau, và ngày kênh realtime hỏng (Neon chặn LISTEN, mạng công ty chặn SSE) thì tính năng
 * chỉ MẤT ĐỘ TỨC THÌ chứ không mất hẳn.
 *
 * ── KHÁCH VÃNG LAI: TRẢ LỜI THẬT, NHƯNG KHÔNG MỞ KÊNH ────────────────────────────────────────
 *
 * Trước 16/08/2026 chỗ này trả 401 cho khách và popup nằm im. Nay có phạm vi「khách chưa đăng
 * nhập」nên khách phải nhận được lời nhắn — nhưng CHỈ qua đường fetch này, không qua SSE. Cờ
 * `live` trong hồi đáp là chỗ nói điều đó ra cho popup.
 *
 * Vì sao khách KHÔNG được mở kênh: mỗi kênh SSE giữ một session Postgres cho `LISTEN` (xem bình
 * chú ở `stream/route.ts`). Với thành viên thì số tab có trần — bằng số người của tông môn. Với
 * khách thì không: mỗi con bot, mỗi tab của mỗi người lạ là một kết nối, và trần kết nối của
 * Neon thì có thật. Đổi một tính năng「popup hiện tức thì cho người lạ」lấy nguy cơ hết kết nối
 * database là một cuộc đổi chác tồi — nhất là ngay sau ngày Neon vừa hạ tông môn bằng hạn mức.
 *
 * ── VÀ MỘT LƯỢT ĐỌC DATABASE CHO MỌI LƯỢT KHÁCH GHÉ ──────────────────────────────────────────
 *
 * Trước đây khách bị chặn TRƯỚC khi chạm database. Nay câu hỏi「có lời nhắn nào cho khách không」
 * phải hỏi thật, và nó hỏi trên mọi lượt tải trang của mọi người lạ — kể cả bot quét. Bộ nhớ đệm
 * dưới đây cắt gần hết chỗ ấy: câu trả lời cho khách là MỘT danh sách dùng chung (không phụ
 * thuộc người xem), nên giữ lại vài giây là đủ để một cơn bot chỉ tốn một lượt truy vấn.
 */

/**
 * Giữ danh sách lời nhắn cho khách bao lâu.
 *
 * Mười giây: đủ ngắn để một lời nhắn vừa phát tới tay khách gần như tức thì (họ vốn đã không có
 * kênh SSE, nên độ trễ thật là「tới lần tải trang sau」), và đủ dài để cắt một cơn quét.
 *
 * Bộ nhớ mức module là CHỦ Ý và cũng là giới hạn đã biết: mỗi instance serverless giữ một bản
 * riêng, nên hiệu quả tỉ lệ với việc Vercel dùng lại instance (Fluid Compute thì có). Không có
 * instance nào giữ dữ liệu RIÊNG của ai ở đây — danh sách cho khách giống hệt nhau với mọi
 * người, nên không có đường nào cho nội dung của người này lọt sang người kia.
 */
const GUEST_CACHE_MS = 10_000;

let guestCache: { at: number; notices: Awaited<ReturnType<typeof guestNotices>> } | null = null;

/**
 * Danh sách ĐẦY ĐỦ cho khách (chưa trừ phần đã xem), có đệm.
 *
 * Đệm bản CHƯA TRỪ chứ không đệm bản đã lọc: phần「đã xem」khác nhau theo từng trình duyệt, nên
 * đệm sau khi lọc là đệm câu trả lời của người này rồi đưa cho người khác. Lọc bằng cookie làm ở
 * ngoài, trên bộ nhớ, không tốn thêm lượt hỏi nào.
 */
async function guestNoticesCached(): Promise<Awaited<ReturnType<typeof guestNotices>>> {
  const now = Date.now();
  if (guestCache && now - guestCache.at < GUEST_CACHE_MS) return guestCache.notices;
  const notices = await guestNotices();
  guestCache = { at: now, notices };
  return notices;
}

export async function GET() {
  const user = await currentUser();

  if (user && user.status === "active") {
    return Response.json({ notices: await unseenNotices(user.id), live: true });
  }

  const seen = new Set(parseGuestSeen((await cookies()).get(GUEST_SEEN_COOKIE)?.value));
  const notices = (await guestNoticesCached()).filter((notice) => !seen.has(notice.id));
  return Response.json({ notices, live: false });
}
