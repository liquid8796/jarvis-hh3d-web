import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/auth/cronSecret";
import { readControlDoc } from "@/lib/control/read";
import { purgeExpiredChat } from "@/lib/services/chat";
import { runCompanionNurture, runKeepalive } from "@/lib/services/githubStations";
import { purgeExpiredJobEvents, reapStaleJobs, runDailyReset } from "@/lib/services/jobs";
import { reviewCompanionNurtureDuty, reviewCronScope, reviewKeepaliveDuty } from "@/lib/validation/githubStations";

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
 * HAI CÂU TRÊN HẾT ĐÚNG TỪ 21/08/2026, giữ lại vì chúng giải thích hình dạng cũ của tệp này.
 * Backend về VM từ 16/08 nên trần「một cron mỗi ngày」của Vercel không còn trói ai, và hoá ra nhịp
 * ngày KHÔNG phải nhịp mà kho phụ cần: dồn cả quota vào một lượt thì lịch sử commit của kho phụ
 * là một cụm năm cái lúc 10 giờ sáng, ngày nào cũng đúng giờ ấy — một dấu chân đọc ra ngay. Nay có
 * lịch thứ hai chạy MỖI GIỜ gọi `?only=companions`, và `companionDueByNow` quyết định tới giờ ấy
 * đáng lẽ đã có mấy commit. Ba việc quét dọn cùng lượt ngó kho chính GIỮ NGUYÊN nhịp ngày — lượt
 * mỗi giờ không đụng tới chúng.
 *
 * NHƯNG việc thứ tư ấy CHỈ chạy ở trạm đang hoạt động, khác hẳn ba việc trên — vì nó là việc duy
 * nhất ở đây đụng vào thứ NẰM NGOÀI database của trạm này (một kho trên GitHub, dùng chung cho
 * mọi trạm). Sổ kho đi theo mọi lượt chuyển trạm, mọi trạm cùng một cron, mọi trạm cùng có
 * `CRON_SECRET` — nên không có phép gác thì sau lượt chuyển trạm đầu tiên sẽ có hai trạm cùng
 * nuôi một kho mà không thấy nhau. Kho chính fail-open khi control doc chớp; repo phụ mang quota
 * admin nên fail-closed. Hai luật nằm ở `reviewKeepaliveDuty`/`reviewCompanionNurtureDuty`.
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
  // Budget tính từ ĐẦU request, không phải từ lúc housekeeping đã xong. Nếu ba lượt dọn mất
  // 20 giây thì phần GitHub chỉ còn 25 giây thật, không được tự tưởng mình vẫn còn nguyên 45.
  const routeStartedAt = Date.now();
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `?only=companions` là cửa của lịch MỖI GIỜ (xem `reviewCronScope`): nó chỉ tới để rải commit
  // kho phụ, không đụng quét dọn lẫn kho chính — hai thứ ấy giữ nguyên nhịp ngày như trước.
  const scoped = reviewCronScope(new URL(request.url).searchParams.get("only"));
  if (!scoped.ok) {
    return NextResponse.json({ error: scoped.why }, { status: 400 });
  }
  const scope = scoped.scope;

  let chat: { purged: number } | null = null;
  let events: Awaited<ReturnType<typeof purgeExpiredJobEvents>> | null = null;
  if (scope.housekeeping) {
    await reapStaleJobs();
    chat = await purgeExpiredChat();
    // Nhật ký đàn quá hạn — van xả duy nhất giữ cho lượt chuyển trạm không dài ra theo năm tháng.
    // Trả số ra ngoài để một lượt curl là biết nó có thật sự dọn được gì không; `more: true` nghĩa
    // là còn nợ, lượt cron sau dọn tiếp.
    events = await purgeExpiredJobEvents();
  }

  // Nuôi kho GitHub ĐỨNG SAU ba việc quét dọn, và thứ tự ấy là một lựa chọn: quét dọn là mạch
  // sống (xem đầu tệp), còn nuôi kho có 40 ngày dự phòng nên trượt một lượt cũng không sao. Nếu
  // ngân sách thời gian của function cạn thì thứ bị cắt phải là thứ chịu được cắt.
  //
  // Bọc try/catch vì cùng lý lẽ: sổ hỏng, database chớp, GitHub đổ — không việc nào trong số đó
  // được phép biến lượt quét dọn vừa chạy XONG thành một hồi đáp 500 trông như chưa chạy gì.
  //
  // Duty chỉ đặt ở route TỰ ĐỘNG, không nằm trong service mà nút admin gọi. Ba việc quét dọn phía
  // trên chỉ đụng database riêng nên vô hại khi nhiều trạm chạy; GitHub là tài nguyên dùng chung.
  let keepalive: unknown;
  let companionNurture: unknown;
  const activeSiteId = (await readControlDoc())?.activeSiteId ?? null;
  const siteId = process.env.SITE_ID ?? "";
  const keepaliveDuty = reviewKeepaliveDuty(siteId, activeSiteId);
  const companionDuty = reviewCompanionNurtureDuty(siteId, activeSiteId);

  if (!scope.keepalive) {
    keepalive = { skipped: true, why: "Lượt này chỉ tới vì kho phụ (?only=companions)." };
  } else if (!keepaliveDuty.feed) {
    // Nói ra bằng cùng hình dạng với nhánh chạy thật: một lượt curl phải phân biệt được
    // "đã ngó, không phải việc của trạm này" với "đã chạy và không có kho nào tới hạn".
    keepalive = { skipped: true, why: keepaliveDuty.why };
  } else {
    try {
      const summary = await runKeepalive({ deadlineAt: routeStartedAt + 10_000 });
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

  // KHÁC kho chính: repo phụ fail-closed. Khi control doc/SITE_ID không xác định, một trạm stale
  // có thể còn quota 5 trong khi active station vừa đặt 0; thừa commit lúc này là phá cấu hình.
  if (!scope.companions) {
    // Cửa của SCOPE phải đứng trước cửa của NHIỆM VỤ. Thiếu nó thì `?only=daily-reset` vẫn đi hỏi
    // hai chục kho phụ mỗi đêm — đo được ngay lượt chạy thử đầu tiên của timer nửa đêm. Không kho
    // nào bị đẩy commit (khung nuôi là 08:00–22:00 nên `companionDueByNow` chặn hết), nhưng đó là
    // hai chục lượt gọi API GitHub lúc 00:00 cho một việc không ai nhờ.
    companionNurture = { skipped: true, why: "Lượt này không tới vì kho phụ." };
  } else if (!companionDuty.feed) {
    companionNurture = { skipped: true, why: companionDuty.why };
  } else {
    // Báo RIÊNG: workflow kho chính và source kho phụ là hai lời hứa khác nhau. Một ledger lỗi
    // không được biến status khôi lỗi thành đỏ, cũng không được chặn các repo phụ còn lại.
    try {
      const summary = await runCompanionNurture({ deadlineAt: routeStartedAt + 45_000 });
      companionNurture = {
        checked: summary.checked,
        pushed: summary.pushed,
        completed: summary.completed,
        failed: summary.failed,
        skipped: summary.skipped,
        repos: summary.results.map((result) => ({
          slug: result.slug,
          ok: result.ok,
          pushed: result.pushed,
          ordinal: result.ordinal,
          target: result.target,
          note: result.note,
        })),
      };
    } catch (err) {
      companionNurture = { error: err instanceof Error ? err.message : "lỗi lạ" };
    }
  }

  /**
   * SANG NGÀY MỚI THÌ CHẠY LẠI — đứng CUỐI, sau mọi việc quét dọn.
   *
   * Thứ tự có nghĩa: `reapStaleJobs` ở đầu lượt kết liễu những đàn đã mất nhịp tim, nên tới đây
   * danh sách「đang chạy」chỉ còn đàn thật sự sống — ta không đi cắt ngang những cái xác.
   *
   * Lỗi ở đây KHÔNG được phép nuốt cả hồi đáp: nó là thứ duy nhất trong route này cắt ngang việc
   * đang chạy của người khác, nên một lượt hỏng phải đọc được từ chính hồi đáp cron.
   */
  let dailyReset: unknown = { skipped: true, why: "Lượt này không tới vì luật sang ngày mới." };
  if (scope.dailyReset) {
    try {
      dailyReset = await runDailyReset();
    } catch (err) {
      dailyReset = { error: err instanceof Error ? err.message : "lỗi lạ" };
    }
  }

  return NextResponse.json({
    ok: true,
    dailyReset,
    // `swept: false` + hai `null` là chữ ký của lượt mỗi giờ: một lượt curl phải phân biệt được
    // "đã quét, không có gì để dọn" với "lượt này vốn không tới để quét".
    swept: scope.housekeeping,
    chat: chat?.purged ?? null,
    jobEvents: events,
    keepalive,
    companionNurture,
  });
}
