import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/auth/cronSecret";
import { purgeExpiredJobEvents } from "@/lib/services/jobs";

/**
 * CỬA QUÉT DÀY NHỊP — chỉ một việc: xoá nhật ký đàn đã quá hạn lưu.
 *
 * VÌ SAO ĐỨNG RIÊNG khỏi `/api/cron`, và đây là lý do cứng chứ không phải gu sắp xếp: `/api/cron`
 * còn NUÔI KHO GITHUB (`runKeepalive`), mà việc ấy ĐẨY COMMIT lên bốn kho thật. Nó được thiết kế
 * cho nhịp ngày và có 40 ngày dự phòng. Gọi `/api/cron` mỗi 10 phút là rải ~144 commit mỗi ngày
 * lên kho của người ta — nên cửa dày nhịp buộc phải là một cửa khác, và
 * **TUYỆT ĐỐI KHÔNG ĐƯỢC THÊM `runKeepalive` (hay bất cứ việc nào tính bằng ngày) vào đây.**
 *
 * VÌ SAO PHẢI CÓ, khi đã có hai đường quét khác: hạn lưu đếm bằng GIỜ, nhưng
 *   • Vercel gói Hobby cho đúng **một** cron mỗi ngày — trần của nền tảng, không phải lựa chọn;
 *   • lượt quét đi nhờ `/api/worker` (0.81.3) bám đúng hạn lưu, nhưng chỉ chạy khi CÓ khôi lỗi
 *     đang trực — tức nó là một lời hứa có điều kiện.
 * Cửa này là lời hứa VÔ ĐIỀU KIỆN: một cái đồng hồ ngoài gõ đúng nhịp, không cần ai trực, không
 * cần ai mở web. Đồng hồ ấy là GitHub Actions (`.github/workflows/quet-nhat-ky.yml`) — chỗ dự án
 * này đã dùng làm lịch cho hai việc khác, và repo công khai nên phút chạy không giới hạn.
 *
 * TRẦN LÔ ĐẦY (10 lô = 50 nghìn dòng) như cron ngày, không phải trần dè dặt của lượt đi nhờ:
 * cửa này khai `maxDuration = 60` nên nó có ngân sách thời gian thật để tiêu.
 *
 * Trả số ra ngoài để MỘT lượt curl là biết nó có thật sự dọn được gì không — `more: true` nghĩa
 * là còn nợ và nhịp sau dọn tiếp. Đây cũng là cách đọc sức khoẻ của cả vòng quét mà không phải
 * mở trang admin.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jobEvents = await purgeExpiredJobEvents();
  return NextResponse.json({ ok: true, jobEvents });
}
