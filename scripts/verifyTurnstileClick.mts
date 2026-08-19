#!/usr/bin/env node
/**
 * Lưới cho cú bấm Turnstile tại chỗ (cách 2, schema browser 19/08/2026).
 *
 * KIỂM ĐƯỢC GÌ: cơ chế — tìm đúng iframe, tính đúng toạ độ ô tick, và một cú bấm THẬT của
 * Chromium rơi vào vùng ô tick. Chạy trên Chromium thật, không mock, đúng lối
 * verifyTeLeConfirm / verifyMazeCapMark.
 *
 * KHÔNG kiểm được (và không giả vờ kiểm): liệu Cloudflare có CHẤP NHẬN cú bấm hay không. Cái đó
 * cần một màn Turnstile thật, mà ta không dựng lại được từ đây — xem báo cáo lượt vá.
 *
 * Mẹo dựng fixture: iframe phải khớp `iframe[src*="challenges.cloudflare.com"]`, nên `src` của nó
 * mang đúng chuỗi con ấy trong ĐƯỜNG DẪN cục bộ (`/challenges.cloudflare.com/widget`). Nhờ vậy nó
 * CÙNG GỐC với trang cha, và widget báo về vị trí bấm qua postMessage — không cần chọc vào một
 * frame khác gốc như đời thật.
 */
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright-core";
import {
  attemptTurnstileClick,
  turnstileCheckboxPoint,
  TURNSTILE_IFRAME_SELECTOR,
  MAX_TURNSTILE_CLICKS,
} from "../src/lib/quest-engine/runCycle.mjs";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Widget giả: một ô 300×65, bắt click rồi gửi toạ độ (tương đối với chính nó) lên cha.
const WIDGET_HTML = `<!doctype html><meta charset="utf-8">
<body style="margin:0">
<div style="width:100%;height:100%;position:fixed;inset:0" id="w"></div>
<script>
document.getElementById('w').addEventListener('click', (e) => {
  parent.postMessage({ cf: true, x: e.clientX, y: e.clientY }, '*');
});
</script>`;

// Trang cha: iframe khớp selector, đặt ở (200,150) kích thước 300×65. Cha ghi lại click cuối.
const IFRAME_LEFT = 200;
const IFRAME_TOP = 150;
const IFRAME_W = 300;
const IFRAME_H = 65;
const parentHtml = (opts: { hidden?: boolean; none?: boolean }) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;width:1366px;height:768px;position:relative">
${
  opts.none
    ? "<!-- không có iframe Turnstile -->"
    : `<iframe src="/challenges.cloudflare.com/widget"
       style="position:absolute;left:${IFRAME_LEFT}px;top:${IFRAME_TOP}px;width:${IFRAME_W}px;height:${IFRAME_H}px;border:0${
        opts.hidden ? ";display:none" : ""
      }"></iframe>`
}
<script>
window.__cfClick = null;
addEventListener('message', (e) => { if (e.data && e.data.cf) window.__cfClick = { x: e.data.x, y: e.data.y }; });
</script>`;

async function main() {
  // ── Phần thuần: turnstileCheckboxPoint ───────────────────────────────────────────────
  console.log("turnstileCheckboxPoint — hình học ô tick");
  {
    // rand = 0.5 → jitter = 0, toạ độ chốt cứng.
    const mid = () => 0.5;
    const p = turnstileCheckboxPoint({ x: 200, y: 150, width: 300, height: 65 }, mid);
    check("widget normal: ~30px từ trái, canh giữa dọc", p.x === 230 && p.y === 150 + 32.5, `${p.x},${p.y}`);

    // Bản compact 130 rộng: 30 < 130/2 nên vẫn 30px từ trái.
    const c = turnstileCheckboxPoint({ x: 0, y: 0, width: 130, height: 65 }, mid);
    check("widget compact 130px: vẫn 30px từ trái (30 < một nửa)", c.x === 30, String(c.x));

    // Widget rất hẹp (<2×INSET=60): nhắm GIỮA thay vì 30px.
    const narrow = turnstileCheckboxPoint({ x: 0, y: 0, width: 40, height: 65 }, mid);
    check("widget hẹp 40px: nhắm giữa (20), không phải 30", narrow.x === 20, String(narrow.x));

    // Jitter kéo tối đa vẫn nằm trong widget, không rơi ra ngoài mép.
    const lo = turnstileCheckboxPoint({ x: 0, y: 0, width: 300, height: 65 }, () => 0); // jitter -6
    const hi = turnstileCheckboxPoint({ x: 0, y: 0, width: 300, height: 65 }, () => 1); // jitter +6
    check(
      "jitter ±6 vẫn nằm gọn trong widget",
      lo.x >= 6 && hi.x <= 294 && lo.y >= 6 && hi.y <= 59,
      `lo=${lo.x},${lo.y} hi=${hi.x},${hi.y}`,
    );
  }

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (url.includes("/challenges.cloudflare.com/")) res.end(WIDGET_HTML);
    else if (url.startsWith("/none")) res.end(parentHtml({ none: true }));
    else if (url.startsWith("/hidden")) res.end(parentHtml({ hidden: true }));
    else res.end(parentHtml({}));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (addr == null || typeof addr === "string") throw new Error("không mở được cổng fixture");
  const base = `http://127.0.0.1:${addr.port}`;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newContext({ viewport: { width: 1366, height: 768 } }).then((c) => c.newPage());

    // ── Ca chính: bấm rơi đúng vùng ô tick ───────────────────────────────────────────
    console.log("\nattemptTurnstileClick — trên Chromium thật");
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(TURNSTILE_IFRAME_SELECTOR);

    const res = await attemptTurnstileClick(page);
    check("thấy iframe Turnstile → bấm", res.clicked, res.note);

    const hit = (await page.evaluate(() => (window as unknown as { __cfClick: { x: number; y: number } | null }).__cfClick)) as
      | { x: number; y: number }
      | null;
    check("cú bấm THẬT rơi vào trong widget (widget nhận được click)", hit != null, JSON.stringify(hit));
    if (hit) {
      // Toạ độ tương đối widget: kỳ vọng x≈30±6, y≈32.5±6. Nới thêm 1px cho làm tròn.
      check(
        "…đúng vùng Ô TICK: x trong [23,37], y trong [26,39]",
        hit.x >= 23 && hit.x <= 37 && hit.y >= 26 && hit.y <= 39,
        `x=${hit.x} y=${hit.y}`,
      );
    }

    // ── Không có iframe: không bấm, không ném ─────────────────────────────────────────
    console.log("\nCác ca biên — không bao giờ ném");
    await page.goto(`${base}/none`, { waitUntil: "networkidle" });
    const noneRes = await attemptTurnstileClick(page);
    check("không có iframe → clicked=false, note nói rõ", !noneRes.clicked && noneRes.note.includes("không thấy"), noneRes.note);

    // ── iframe display:none: boundingBox null → không bấm ──────────────────────────────
    await page.goto(`${base}/hidden`, { waitUntil: "networkidle" });
    const hiddenRes = await attemptTurnstileClick(page);
    check("iframe ẩn (không kích thước) → clicked=false", !hiddenRes.clicked, hiddenRes.note);

    check("trần số lần bấm là một hằng số > 0", MAX_TURNSTILE_CLICKS > 0, String(MAX_TURNSTILE_CLICKS));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
