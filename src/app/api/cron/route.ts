import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/auth/cronSecret";
import { readControlDoc } from "@/lib/control/read";
import { purgeExpiredChat } from "@/lib/services/chat";
import { runKeepalive } from "@/lib/services/githubStations";
import { purgeExpiredJobEvents, reapStaleJobs } from "@/lib/services/jobs";
import { reviewKeepaliveDuty } from "@/lib/validation/githubStations";

/**
 * Người quét dọn — cộng đúng MỘT việc không phải quét dọn, thêm vào 12/08/2026.
 *
 * Từ khi mọi lượt chạy đều do một worker sống dai đảm nhiệm (khôi lỗi tông môn trên VM,
 * hoặc khôi lỗi máy nhà của đạo hữu), không còn ai cần được "gõ cửa đánh thức" nữa: worker
 * tự hỏi việc mỗi 5 giây. Route này giữ ba việc vệ sinh — kết liễu job đang chạy mất
 * nhịp tim, quét tin đàm đạo quá hạn lưu, và quét nhật ký đàn quá hạn lưu. Hai việc đầu còn
 * được gọi TIỆN ĐƯỜNG từ đường đọc của dashboard, nên với chúng cron ngoài giờ là lưới an
 * toàn cho những ngày không ai mở web, không phải mạch sống của hệ thống.
 *
 * Việc thứ tư — NUÔI KHO GITHUB (deploy/github-actions.md §7) — đi nhờ đúng cái lịch này thay
 * vì dựng lịch thứ hai, và đó không phải lười: gói Hobby cho đúng MỘT cron mỗi ngày, nên một
 * lịch thứ hai là bất khả. May thay nhịp ngày cũng chính là nhịp việc ấy cần.
 *
 * NHƯNG việc thứ tư ấy CHỈ chạy ở trạm đang hoạt động, khác hẳn ba việc trên — vì nó là việc duy
 * nhất ở đây đụng vào thứ NẰM NGOÀI database của trạm này (một kho trên GitHub, dùng chung cho
 * mọi trạm). Sổ kho đi theo mọi lượt chuyển trạm, mọi trạm cùng một cron, mọi trạm cùng có
 * `CRON_SECRET` — nên không có phép gác thì sau lượt chuyển trạm đầu tiên sẽ có hai trạm cùng
 * nuôi một kho mà không thấy nhau. Luật và toàn bộ lý lẽ nằm ở `reviewKeepaliveDuty`.
 *
 * Việc thứ ba TỪ 13/08/2026 cũng có đường đi kèm, nhưng không phải trên một trang: nó đi nhờ
 * `/api/worker` (`sweepExpiredJobEventsIfDue`). Trước đó nó chỉ có mỗi cron, và đó là một lỗ
 * thật chứ không phải một lựa chọn — hạn lưu đặt được theo GIỜ trong khi lượt quét duy nhất chạy
 * mỗi NGÀY, nên mọi hạn lưu ngắn hơn 24 giờ đều không được thi hành. Giờ cron trở lại đúng vai
 * lưới an toàn cho những ngày không khôi lỗi nào lên ca; nó vẫn gánh trần lô ĐẦY (`maxDuration`
 * 60 giây ở đây), còn lượt đi nhờ kia chỉ dám hai lô.
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

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();
  const chat = await purgeExpiredChat();
  // Nhật ký đàn quá hạn — van xả duy nhất giữ cho lượt chuyển trạm không dài ra theo năm tháng.
  // Trả số ra ngoài để một lượt curl là biết nó có thật sự dọn được gì không; `more: true` nghĩa
  // là còn nợ, lượt cron sau dọn tiếp.
  const events = await purgeExpiredJobEvents();

  // Nuôi kho GitHub ĐỨNG SAU ba việc quét dọn, và thứ tự ấy là một lựa chọn: quét dọn là mạch
  // sống (xem đầu tệp), còn nuôi kho có 40 ngày dự phòng nên trượt một lượt cũng không sao. Nếu
  // ngân sách thời gian của function cạn thì thứ bị cắt phải là thứ chịu được cắt.
  //
  // Bọc try/catch vì cùng lý lẽ: sổ hỏng, database chớp, GitHub đổ — không việc nào trong số đó
  // được phép biến lượt quét dọn vừa chạy XONG thành một hồi đáp 500 trông như chưa chạy gì.
  //
  // Và CHỈ trạm đang hoạt động mới nuôi — xem `reviewKeepaliveDuty` để biết vì sao, và vì sao
  // phép gác này chỉ đặt ở đây chứ không đặt trong `runKeepalive`: ba việc quét dọn phía trên
  // vô hại khi chạy song song ở nhiều trạm (chúng chỉ đụng dữ liệu của chính database ấy), còn
  // nuôi kho thì đẩy commit lên một kho DÙNG CHUNG. Hai loại việc khác nhau, hai luật khác nhau.
  let keepalive: unknown;
  const duty = reviewKeepaliveDuty(process.env.SITE_ID ?? "", (await readControlDoc())?.activeSiteId ?? null);
  if (!duty.feed) {
    // Nói ra bằng cùng hình dạng với nhánh chạy thật: một lượt curl phải phân biệt được
    // "đã ngó, không phải việc của trạm này" với "đã chạy và không có kho nào tới hạn".
    keepalive = { skipped: true, why: duty.why };
  } else {
    try {
      const summary = await runKeepalive();
      keepalive = {
        checked: summary.checked,
        committed: summary.committed,
        failed: summary.failed,
        skipped: summary.skipped,
        // Câu chữ của từng kho đi luôn ra hồi đáp: một lượt curl là biết kho nào hỏng, khỏi phải
        // mở trang admin. Chúng đã được ghi vào sổ rồi, đây chỉ là bản sao cho người đang gõ lệnh.
        stations: summary.results.map((r) => ({ slug: r.slug, ok: r.ok, note: r.note })),
      };
    } catch (err) {
      keepalive = { error: err instanceof Error ? err.message : "lỗi lạ" };
    }
  }

  return NextResponse.json({ ok: true, swept: true, chat: chat.purged, jobEvents: events, keepalive });
}
