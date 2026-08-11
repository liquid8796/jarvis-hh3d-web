import { Client, neon } from "@neondatabase/serverless";
import { realtimeDatabaseUrl } from "@/lib/realtime/dashboardChannel";

/**
 * Kênh đánh thức RIÊNG cho thông báo tông môn.
 *
 * Vì sao không mượn `jarvis_dashboard` — kênh sẵn có, cùng cơ chế, mượn thì đỡ một tệp: vì hai
 * stream khác đang LISTEN trên kênh ấy (dashboard và hàng đợi), và cả hai đều làm mới ngay khi
 * nghe thấy BẤT KỲ tín hiệu hợp lệ nào. Mượn kênh nghĩa là mỗi lần phát một lời nhắn, mọi
 * dashboard và mọi bảng hàng đợi đang mở đều chạy lại truy vấn feed của chúng — một tính năng
 * đi đánh thức hai tính năng không liên quan. Một cái tên kênh mới thì rẻ hơn hẳn việc đi vá
 * hai route khác để chúng học cách bỏ qua.
 *
 * Payload cố ý RỖNG NGHĨA: nó chỉ là tiếng gõ cửa. Mỗi stream tự hỏi database phần của chính
 * mình, nên không có chuyện một payload đi lạc mang nội dung của người này tới trang người kia.
 */
export const NOTICE_CHANNEL = "jarvis_notice";

export function createNoticeListener(): Client {
  return new Client({ connectionString: realtimeDatabaseUrl() });
}

/** Gõ cửa mọi trang đang mở. Không ném: một lời nhắn đã LƯU rồi thì nó không được mất chỉ vì
 *  tiếng gõ cửa không kêu — trang sẽ thấy nó ở lượt tải sau. */
export async function pingNoticeChannel(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;
  try {
    const sql = neon(raw);
    await sql.query("select pg_notify($1, $2)", [NOTICE_CHANNEL, ""]);
  } catch (error) {
    console.error("notice: không gõ cửa được kênh realtime", error);
  }
}
