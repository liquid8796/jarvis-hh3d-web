#!/usr/bin/env node
/**
 * Dọn những Chromium MỒ CÔI mà `npm run shot` để lại sau một lần treo hoặc một cú Ctrl-C.
 *
 *   npm run shot:clean            # dọn bản ghi cũ hơn 10 phút
 *   npm run shot:clean -- --all   # dọn TẤT CẢ, kể cả lượt chụp đang chạy
 *
 * Lượt chụp bình thường tự gọi phép dọn này lúc khởi động, nên thường không ai phải gõ tay.
 * Nó ở đây cho lúc muốn dẹp ngay mà không chụp gì cả.
 *
 * AN TOÀN, và đây là phần đáng đọc: nó KHÔNG quét tiến trình theo tên hay theo đường dẫn.
 * Nó chỉ đụng tới những gì có trong sổ (xem browserRegistry.mts), và trước khi đụng thì BẮT
 * TAY qua đúng `wsEndpoint` đã ghi. Một tiến trình lạ — Chrome thật của chủ máy chẳng hạn —
 * không bao giờ trả lời được cái bắt tay ấy, nên không có đường nào nó bị giết nhầm.
 */
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { ORPHAN_AGE_MS, forget, listRecords, registryPath, type BrowserRecord } from "./browserRegistry.mjs";
import { killByPid, stillAlive } from "./killBrowser.mjs";

/** Bắt tay mà quá ngần này thì coi như endpoint đã chết — đừng đứng đợi một cái xác. */
const CONNECT_TIMEOUT_MS = 3000;

/**
 * Hai kết cục, không phải ba.
 *
 * Bản đầu có thêm một kết cục「đóng tử tế」cho `browser.close()`, và ĐO ra là nó không tồn
 * tại: `close()` trên một trình duyệt nối qua `connect()` chỉ cắt kết nối, tiến trình server
 * vẫn sống nguyên. Nên mọi orphan còn thở đều đi tới `taskkill`, và giữ lại cái nhãn kia chỉ
 * để nhật ký nói「không đóng được」về một chuyện hoàn toàn bình thường.
 */
export type SweepResult = { killed: number; stale: number };

/**
 * Dọn một lượt. Trả về con số cho người gọi tự kể — hàm này chỉ nói khi có chuyện đáng nói,
 * vì nó chạy ở đầu MỌI lượt chụp và không được phép làm ồn khi máy đang sạch.
 */
export async function sweepOrphans(options: { all?: boolean; verbose?: boolean } = {}): Promise<SweepResult> {
  const records = listRecords(options.all ? 0 : ORPHAN_AGE_MS);
  const result: SweepResult = { closed: 0, killed: 0, stale: 0 };

  for (const record of records) {
    const outcome = await disposeOne(record);
    result[outcome] += 1;
    if (options.verbose) {
      const age = Math.round((Date.now() - record.startedAt) / 1000);
      const said =
        outcome === "killed"
          ? "bắt tay được → đúng của ta → đã giết cả cây"
          : "không bắt tay được (đã chết, hoặc cổng của ai khác) → chỉ xoá khỏi sổ";
      console.log(`  • pid ${record.pid} (mở ${age}s trước) — ${said}`);
    }
    forget(record.pid);
  }

  return result;
}

/**
 * Một bản ghi, một quyết định. Thứ tự cố ý và không đảo được: BẮT TAY TRƯỚC, giết sau.
 *
 * `connect()` thành công là BẰNG CHỨNG rằng PID ấy đúng là trình duyệt của ta — không phải
 * một tiến trình vô can vừa được hệ điều hành cấp lại đúng số PID đó. Đây là toàn bộ lý do
 * cuốn sổ này an toàn: không có bằng chứng thì không có lệnh giết, và Chrome thật của chủ máy
 * thì vĩnh viễn không trả lời được cái bắt tay ấy.
 */
async function disposeOne(record: BrowserRecord): Promise<keyof SweepResult> {
  let browser: Awaited<ReturnType<typeof chromium.connect>> | null = null;
  try {
    browser = await chromium.connect(record.wsEndpoint, { timeout: CONNECT_TIMEOUT_MS });
  } catch {
    // Không bắt tay được: hoặc tiến trình đã chết, hoặc cổng ấy giờ là của ai đó không nói
    // giao thức này. Cả hai đều KHÔNG cho phép ta giết gì cả — chỉ xoá dòng sổ.
    return "stale";
  }

  // Cắt kết nối cho gọn. KHÔNG trông vào nó để dừng tiến trình: đã đo, `close()` trên một
  // trình duyệt nối qua `connect()` chỉ cắt dây, server vẫn sống.
  await browser.close().catch(() => {});

  if (!stillAlive(record.pid)) return "stale";
  return killByPid(record.pid) ? "killed" : "stale";
}

// Chạy trực tiếp (`npm run shot:clean`) thì kể đầy đủ; import từ shotPage thì im lặng.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes("--all");
  console.log(`• Sổ trình duyệt: ${registryPath()}`);

  /**
   * `--all` bỏ qua hàng rào tuổi, và trên một cây làm việc DÙNG CHUNG thì đó là một cái bẫy
   * thật, không phải phòng xa: ngày 09/08/2026 chính lượt kiểm chứng của bản này gọi `--all`
   * và giết mất một trình duyệt mở 7 giây trước — gần như chắc chắn là lượt chụp của một
   * phiên đang chạy song song. Hàng rào mặc định đã làm đúng việc của nó; cái cờ này là chỗ
   * người ta tự tháo hàng rào ra. Nên nó phải NÓI trước khi làm.
   */
  if (all) {
    const live = listRecords(0).filter((entry) => Date.now() - entry.startedAt < ORPHAN_AGE_MS);
    if (live.length > 0) {
      console.log(
        `⚠ --all sẽ giết cả ${live.length} trình duyệt còn MỚI (${live
          .map((entry) => `pid ${entry.pid}, ${Math.round((Date.now() - entry.startedAt) / 1000)}s`)
          .join("; ")}). Nếu đang có phiên khác chụp ảnh, đó là của họ.`,
      );
    }
  }

  const swept = await sweepOrphans({ all, verbose: true });
  const total = swept.killed + swept.stale;
  console.log(
    total === 0
      ? `✔ Không có gì để dọn${all ? "" : " (chỉ xét bản ghi cũ hơn 10 phút — thêm --all để dọn tất)"}.`
      : `✔ Đã dọn ${total} bản ghi: ${swept.killed} còn sống phải giết, ${swept.stale} vốn đã chết.`,
  );
}
