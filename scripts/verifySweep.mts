#!/usr/bin/env node
/**
 * Kiểm chứng PHÉP DỌN trình duyệt mồ côi (scripts/sweepBrowsers.mts).
 *
 * Vì sao một script dọn dẹp lại đáng có phép thử riêng: nó GIẾT TIẾN TRÌNH. Sai một nhịp là
 * nó giết Chrome thật của chủ máy hoặc `next dev` của phiên khác — loại lỗi không có nút hoàn
 * tác và cũng không ai muốn phát hiện bằng cách gặp nó. Nên ba điều dưới đây phải đóng đinh:
 * nó nhặt đúng orphan, nó CHỪA lượt chụp đang chạy, và nó không đụng gì khi không có bằng
 * chứng.
 *
 * KHÔNG dùng `--all` ở đây, và đó là chủ ý sau một lần trả giá: cờ ấy bỏ qua hàng rào tuổi,
 * và ngày 09/08/2026 chính lượt kiểm chứng đầu tiên của bản này đã dùng nó rồi giết mất một
 * trình duyệt mở 7 giây trước — của một phiên đang chạy song song trên cùng cây làm việc.
 * Nhánh "không bắt tay được" dưới đây thử bằng một bản ghi CŨ trỏ vào cổng chết, cho cùng một
 * độ phủ mà không tháo hàng rào nào.
 */
import { chromium } from "playwright-core";
import { ORPHAN_AGE_MS, forget, listRecords, remember } from "./browserRegistry.mjs";
import { stillAlive } from "./killBrowser.mjs";
import { sweepOrphans } from "./sweepBrowsers.mjs";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

/** Mốc "đủ cũ để bị coi là mồ côi" — quá hàng rào tuổi một quãng rộng. */
const LONG_AGO = () => Date.now() - ORPHAN_AGE_MS * 6;
/** PID không bao giờ có thật trên Windows, dùng cho bản ghi trỏ vào hư không. */
const GHOST_PID = 999_999;

let orphanPid = 0;
try {
  // ---- 1. Orphan thật: mở một trình duyệt rồi bỏ mặc, ghi sổ với mốc đã cũ ----
  const server = await chromium.launchServer({ headless: true });
  orphanPid = server.process().pid!;
  remember({ pid: orphanPid, wsEndpoint: server.wsEndpoint(), startedAt: LONG_AGO() });
  assert(stillAlive(orphanPid), "orphan vừa dựng phải đang sống");

  // ---- 2. Một bản ghi MỚI: đóng vai lượt chụp đang chạy của phiên khác ----
  const livePid = GHOST_PID;
  remember({ pid: livePid, wsEndpoint: "ws://127.0.0.1:1/khong-co-that", startedAt: Date.now() });

  // ---- 3. Dọn mặc định ----
  const swept = await sweepOrphans();
  assert(!stillAlive(orphanPid), `orphan pid ${orphanPid} phải bị dọn, mà nó vẫn sống`);
  assert(swept.killed === 1, `phải giết đúng 1 trình duyệt còn sống, nhận ${swept.killed}`);
  assert(swept.stale === 0, `không có bản ghi chết nào để dọn ở lượt này, nhận ${swept.stale}`);

  const left = listRecords(0);
  assert(
    left.some((entry) => entry.pid === livePid),
    "bản ghi MỚI phải còn NGUYÊN — đây là hàng rào giữ cho phép dọn không giết lượt của phiên khác",
  );
  assert(!left.some((entry) => entry.pid === orphanPid), "bản ghi của orphan đã dọn phải bị xoá khỏi sổ");
  console.log(`✔ Dọn đúng orphan (pid ${orphanPid}), và chừa nguyên lượt chụp đang chạy.`);

  // ---- 4. Bản ghi CŨ trỏ vào cổng chết: xoá sổ, KHÔNG giết gì ----
  forget(livePid);
  remember({ pid: livePid, wsEndpoint: "ws://127.0.0.1:1/khong-co-that", startedAt: LONG_AGO() });
  const ghosts = await sweepOrphans();
  assert(ghosts.killed === 0, "không bắt tay được thì TUYỆT ĐỐI không được giết gì — đó là toàn bộ hàng rào an toàn");
  assert(ghosts.stale === 1, `bản ghi chết phải ra 'stale', nhận ${JSON.stringify(ghosts)}`);
  assert(!listRecords(0).some((entry) => entry.pid === livePid), "bản ghi chết phải bị xoá khỏi sổ");
  console.log("✔ Cổng chết: chỉ xoá dòng sổ, không một lệnh giết nào được phát.");

  // ---- 5. Sổ rỗng ----
  const empty = await sweepOrphans();
  assert(empty.killed + empty.stale === 0, "sổ rỗng thì phép dọn phải là phép rỗng");
  console.log("✔ Sổ rỗng: không làm gì, không ngã.");

  console.log("");
  console.log("TẤT CẢ XANH — phép dọn chỉ đụng thứ bắt tay được, và chừa lượt đang chạy.");
} finally {
  // Chết giữa chừng thì orphan của chính phép thử này không được nằm lại.
  if (orphanPid && stillAlive(orphanPid)) {
    const { killByPid } = await import("./killBrowser.mjs");
    killByPid(orphanPid);
  }
  if (orphanPid) forget(orphanPid);
  forget(GHOST_PID);
}
