#!/usr/bin/env node
/**
 * Lưới cho phép DỪNG SỚM khi trang game dựng màn kiểm tra (Cloudflare) giữa vòng.
 *
 * Ca thật đo được 20/08/2026 trên đàn `3ea5ccf0` (khôi lỗi ember-cache-56a7, tài khoản Nhã Vy):
 * cùng một đàn, cùng một máy, xen kẽ hai loại vòng —
 *
 *   05:10  vòng KHOẺ:   mỗi nhiệm vụ ~9 giây, không một lượt treo nào
 *   14:18  vòng CHẶN:   mọi trang câm, mỗi lượt đúng 25s, 3 lượt mỗi nhiệm vụ
 *   14:51  vòng CHẶN:   engine gọi ĐÍCH DANH「màn kiểm tra (Cloudflare)」
 *
 * Hai loại vòng chặn ấy là CÙNG một sự kiện: chỉ khác ở chỗ cổng đầu vòng có bắt được màn kiểm
 * tra trên trang chủ hay không. Khi không bắt được, mười ba nhiệm vụ lần lượt tự chứng minh lại
 * đúng một điều — hết ~16 phút, và giữ ghế khôi lỗi suốt chừng ấy.
 *
 * Lưới này chốt: gặp màn kiểm tra thì DỪNG NGAY sau lượt đầu, không thử lại 3 lượt, và nói ra
 * đúng tên nguyên nhân. Chạy engine THẬT trên Chromium THẬT trước một trang challenge dựng theo
 * đúng dấu hiệu `readinessProbe` đọc.
 */
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright-core";
import { createQuestEngine, CycleBlocked } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";

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

/** Màn "Just a moment" của Cloudflare — đúng hai dấu hiệu readinessProbe đọc: chữ + iframe. */
const CHALLENGE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><h1>Checking your browser before accessing the site.</h1>
<iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x/y" style="width:300px;height:65px"></iframe>
</body></html>`;

/** Trang game bình thường nhưng CHẬM: marker chỉ hiện sau 1,2s — đủ để phân biệt với trang chặn. */
const SLOW_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhiệm vụ</title></head>
<body><div id="wpadminbar"></div><div id="cham"></div>
<script>setTimeout(() => { const d = document.createElement('div'); d.className = 'nv-quest'; d.textContent = 'Điểm Danh'; document.body.appendChild(d); }, 1200);</script>
</body></html>`;

/** Trang game hỏng thật: không màn kiểm tra, cũng không bao giờ có marker. */
const BROKEN_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhiệm vụ</title></head>
<body><div id="wpadminbar"></div><p>Trang đang bảo trì.</p></body></html>`;

const questWaiting = (path: string) => ({
  id: "thu",
  name: "Thử",
  enabled: true,
  kind: "customSteps",
  requiresVip: false,
  pagePath: path,
  steps: [
    { action: "navigate", text: path, timeoutMs: 15000 },
    // 3 giây thay vì 25: lưới đo HÀNH VI (dừng sớm hay thử lại), không đo con số.
    { action: "waitForSelector", selector: ".nv-quest", timeoutMs: 3000 },
  ],
});

async function main() {
  let mode: "challenge" | "slow" | "broken" = "challenge";
  let hits = 0;
  const server: Server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(mode === "challenge" ? CHALLENGE_PAGE : mode === "slow" ? SLOW_PAGE : BROKEN_PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (addr == null || typeof addr === "string") throw new Error("không mở được cổng fixture");
  const base = `http://127.0.0.1:${addr.port}`;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newContext().then((c) => c.newPage());
    const logged: string[] = [];
    const session = createSession(page, {
      baseUrl: base,
      minActionDelayMs: 1,
      maxActionDelayMs: 2,
      log: { info: (m: string) => logged.push(m), warning: (m: string) => logged.push(m), debug: () => {} },
    });
    // Đúng ba kênh engine dùng (info/warning/debug) — thêm `error` là khai một cửa không có thật.
    const engine = createQuestEngine({
      log: { info: () => {}, warning: () => {}, debug: () => {} },
    });
    const profile = { schemaVersion: 1, quests: [] };

    console.log("Màn kiểm tra giữa vòng — phải DỪNG SỚM");
    mode = "challenge";
    hits = 0;
    let thrown: unknown = null;
    const t0 = Date.now();
    try {
      await engine.run(session, profile, questWaiting("/hub"));
    } catch (err) {
      thrown = err;
    }
    const elapsed = Date.now() - t0;
    check("ném CycleBlocked chứ không trả về failed", thrown instanceof CycleBlocked, String(thrown));
    if (thrown instanceof CycleBlocked) {
      check(
        "…lời báo gọi ĐÚNG TÊN nguyên nhân (Cloudflare), không đổ cho selector",
        thrown.message.includes("Cloudflare") && !thrown.message.includes(".nv-quest"),
        thrown.message,
      );
    }
    // navigate + 1 lượt chờ. Nếu vẫn thử lại 3 lượt thì phải có 3 lần tải trang.
    check("chỉ tải trang MỘT lượt, không thử lại 3 lượt", hits === 1, `${hits} lượt tải`);
    check("…nên dừng trong ~1 lượt chờ, không phải 3", elapsed < 3000 * 2.5, `${elapsed}ms`);

    console.log("\nTrang game CHẬM — không được nhầm là bị chặn");
    mode = "slow";
    hits = 0;
    const slow = await engine.run(session, profile, questWaiting("/hub"));
    check("trang chậm 1,2s vẫn chạy xong bình thường", slow.outcome !== "failed", `${slow.outcome}: ${slow.message ?? ""}`);
    check("…và chỉ cần một lượt tải", hits === 1, `${hits} lượt tải`);

    console.log("\nTrang hỏng THẬT (không màn kiểm tra) — giữ nguyên nết cũ: thử lại rồi mới chịu thua");
    mode = "broken";
    hits = 0;
    let brokenThrew: unknown = null;
    let broken: { outcome?: string; message?: string } = {};
    try {
      broken = await engine.run(session, profile, questWaiting("/hub"));
    } catch (err) {
      brokenThrew = err;
    }
    check("KHÔNG ném CycleBlocked khi chỉ là trang hỏng", brokenThrew === null, String(brokenThrew));
    check("vẫn kết luận failed như trước", broken.outcome === "failed", `${broken.outcome}`);
    check("…và vẫn thử đủ 3 lượt (nết cũ không đổi)", hits === 3, `${hits} lượt tải`);
    // ---- Gỡ màn kiểm tra GIỮA VÒNG (đo sản xuất 20/08: màn tới giữa vòng, không ở cổng) ----
    // Cú bấm đặt ở cổng đầu vòng (1.3.18) chưa một lần được chạy vì màn kiểm tra không tới ở
    // cổng. `clickTurnstile` được TIÊM vào engine nên ở đây giả lập được mà không cần trình
    // duyệt thật phải thắng Cloudflare thật.
    console.log("\nGỡ được màn kiểm tra giữa vòng — phải ĐI TIẾP, không bỏ chạy");
    {
      mode = "challenge";
      hits = 0;
      let clicks = 0;
      // Gỡ thành công: đổi fixture sang trang khoẻ rồi khai true, đúng như một cú bấm ăn thua.
      const engineClearing = createQuestEngine({
        log: { info: () => {}, warning: () => {}, debug: () => {} },
        clickTurnstile: async () => {
          clicks++;
          mode = "slow";
          return { cleared: true, clicked: true };
        },
      });
      let threw: unknown = null;
      let out: { outcome?: string } = {};
      try {
        out = await engineClearing.run(session, profile, questWaiting("/hub"));
      } catch (err) {
        threw = err;
      }
      check("gỡ được thì KHÔNG ném CycleBlocked", threw === null, String(threw));
      check("…và nhiệm vụ chạy tiếp cho tới khi xong", out.outcome !== "failed", String(out.outcome));
      check("…chỉ cần đúng một cú bấm", clicks === 1, `${clicks} cú`);
    }

    console.log("\nGỡ xong màn kiểm tra lại dựng lại — phải có TRẦN, không lặp vô tận");
    {
      mode = "challenge";
      hits = 0;
      let clicks = 0;
      // Khai gỡ được MÃI nhưng trang vẫn là challenge: đúng cái bẫy vòng lặp vô tận.
      const engineLying = createQuestEngine({
        log: { info: () => {}, warning: () => {}, debug: () => {} },
        clickTurnstile: async () => {
          clicks++;
          return { cleared: true, clicked: true };
        },
      });
      let threw: unknown = null;
      try {
        await engineLying.run(session, profile, questWaiting("/hub"));
      } catch (err) {
        threw = err;
      }
      check("chạm trần thì ném CycleBlocked chứ không quay vòng mãi", threw instanceof CycleBlocked, String(threw));
      check(
        "…và lời báo kể ĐÚNG là đã gỡ được 2 lần mà nó cứ dựng lại",
        threw instanceof CycleBlocked && threw.message.includes("Đã gỡ được 2 lần mà màn kiểm tra cứ dựng lại"),
        threw instanceof CycleBlocked ? threw.message.slice(-70) : "",
      );
      check("…và số cú bấm bị chặn ở trần (2)", clicks === 2, `${clicks} cú`);
    }

    // Đúng cảnh SẢN XUẤT đo được 20/08/2026: nhánh gỡ có chạy, nhưng không tìm thấy ô nào để bấm
    // (màn kiểm tra dạng tự chạy). Lời báo phải nói ra ĐÚNG điều đó — bản đầu nói「Đã thử bấm … mà
    // không qua」cho cả ca này, tức nói dối về một việc chưa hề xảy ra.
    console.log("\nKHÔNG có ô nào để bấm — đúng cảnh sản xuất đo được 20/08/2026");
    {
      mode = "challenge";
      const engineNoBox = createQuestEngine({
        log: { info: () => {}, warning: () => {}, debug: () => {} },
        clickTurnstile: async () => ({ cleared: false, clicked: false }),
      });
      let threw: unknown = null;
      try {
        await engineNoBox.run(session, profile, questWaiting("/hub"));
      } catch (err) {
        threw = err;
      }
      check(
        "lời báo nói RÕ là không tìm thấy ô, chứ KHÔNG nói dối là đã bấm",
        threw instanceof CycleBlocked &&
          threw.message.includes("Không tìm thấy ô nào để bấm") &&
          !threw.message.includes("Đã bấm"),
        threw instanceof CycleBlocked ? threw.message.slice(-70) : String(threw),
      );
    }

    console.log("\nKhông tiêm cách gỡ (cờ tắt) — giữ nguyên nết 1.3.19");
    {
      mode = "challenge";
      hits = 0;
      let threw: unknown = null;
      try {
        await engine.run(session, profile, questWaiting("/hub"));
      } catch (err) {
        threw = err;
      }
      check("vẫn dừng sớm như cũ", threw instanceof CycleBlocked, String(threw));
      check(
        "…và lời báo KHÔNG nhận vơ là đã thử bấm",
        threw instanceof CycleBlocked && !threw.message.includes("Đã thử bấm"),
        threw instanceof CycleBlocked ? threw.message.slice(-60) : "",
      );
    }
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
