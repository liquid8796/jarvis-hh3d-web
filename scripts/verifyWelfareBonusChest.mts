#!/usr/bin/env node
/**
 * Kiểm chứng cụm RƯƠNG MỐC của Phúc Lợi Đường bản THƯỜNG (schema 74).
 *
 *   npm run verify:welfare-bonus
 *
 * ── VÌ SAO CỤM NÀY TỒN TẠI ───────────────────────────────────────────────────────────────
 *
 * Ghi chú của tông chủ trong bản ghi `phuc-loi-duong-20260824-235006`, ba câu theo đúng thứ tự
 * ngài bấm: "một lúc nào đó khi đủ điều kiện nhận bonus rương, thì sẽ có popup thông báo như
 * này" · "bạn bấm nhận bonus các rương nào available dưới đây nhé … rương nào ko available để
 * bấm thì bỏ qua" · "sau khi nhận bonus rương có thể tiếp tục bấm các rương phúc lợi đường
 * bình thường như flow cũ mà chúng ta hay làm".
 *
 * ── VÀ NÓ CHỮA MỘT LỖI ĐANG SỐNG ─────────────────────────────────────────────────────────
 *
 * Popup `#pl-claim-overlay` là `position:fixed; inset:0; z-index:10050` kèm `backdrop-filter`
 * — nó CHE KÍN trang. Ngày nào còn rương mốc chưa nhận thì bốn cú bấm `#chest-N` của flow cũ
 * đều bị chặn; chúng `optional` nên im lặng trượt hết, rồi bước nghiệm thu BẮT BUỘC ở cuối
 * (đồng hồ phải rời `00:00`) hết giờ và cả nhiệm vụ báo hỏng. Bản vá này không chỉ thêm việc
 * — nó gỡ một cái chốt đang chặn phần việc cũ.
 *
 * ── BA CÁI BẪY TỆP NÀY ĐÓNG ĐINH ─────────────────────────────────────────────────────────
 *
 * 1. **CHỖ ĐỨNG.** Hàng mốc tích điểm theo THÁNG, chẳng liên quan đồng hồ 30 phút của bốn
 *    rương ngày. Đặt cụm SAU cổng `StopIf` đồng hồ là mọi lượt ghé rơi vào giữa cooldown —
 *    phần lớn các lượt — sẽ dừng trước khi kịp nhận, và popup cứ đứng đó sang tháng sau, đúng
 *    lúc điểm bị làm mới.
 * 2. **"Available" là do CSS của TRANG phán, không phải ta đoán**: `.gift-box{pointer-events:
 *    none}` · `.gift-box.active{pointer-events:auto}` · `.gift-box.received-reward` = đã nhận.
 * 3. **DOM rụng `active` SAU khi AJAX về, không phải ngay lúc bấm** — đo được ở chính bản ghi
 *    (`dom/03` chụp ngay sau cú bấm vẫn còn `active=1`). Bấm cả loạt là bấm trùng vào một
 *    rương đang chờ trả lời, nên cụm đánh dấu MỘT ô mỗi vòng rồi chờ nó rụng.
 *
 * Markup dưới đây CHÉP NGUYÊN VĂN từ `dom/01-load.html` (còn mốc chờ) và `dom/04-click.html`
 * (đã sạch), kèm đúng mấy dòng CSS quyết định chuyện bấm được hay không.
 */
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { conditionProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

const FREE_ID = "phuc-loi-duong-thuong";
const VIP_ID = "phuc-loi-duong";
const MARK = "body.jvz-pl-bonus";

type Condition = { kind?: string; selector?: string; text?: string };
type Step = {
  action: string;
  selector?: string;
  script?: string;
  optional?: boolean;
  forceClick?: boolean;
  condition?: Condition;
  when?: Condition;
  until?: Condition;
  steps?: Step[];
};

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Đúng mấy dòng CSS quyết định "bấm được hay không", chép từ thẻ style của trang. */
const CSS = `<style>
.gift-box { width: 60px; height: 40px; filter: grayscale(100%); cursor: pointer; pointer-events: none; }
.gift-box.active { filter: none; pointer-events: auto; }
.gift-box.received-reward { filter: none; }
.reward-progress-container { width: 100%; display: flex; justify-content: space-around; align-items: center; padding: 20px; }
.pl-claim-overlay { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; }
.pl-claim-overlay.is-open { opacity: 1; visibility: visible; }
</style>`;

/** Popup cảnh báo, chép từ `dom/01-load.html`. */
const OVERLAY = `<div class="pl-claim-overlay is-open" id="pl-claim-overlay" role="dialog" aria-modal="true"><div class="pl-claim-modal is-warn"><div class="pl-claim-card"><div class="pl-claim-eyebrow">Phúc Lợi Đường</div><h3 class="pl-claim-title">Còn rương mốc chưa nhận!</h3><div class="pl-claim-body"><ul class="pl-claim-list"><li><strong>Mốc 5000</strong><span>300 Tu Vi</span></li></ul></div></div><div class="pl-claim-actions"><button type="button" class="pl-claim-btn" id="pl-claim-close-btn">Đến nhận thưởng</button></div></div></div>`;

/** Hàng mốc CÒN MỘT MỐC CHỜ NHẬN — `dom/01-load.html`, nguyên văn. */
const ROW_PENDING = `<div class="reward-progress-container has-pending-claim"><div class="milestone" data-id="1" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 150 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 2000&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-open.png" class="gift-box received-reward" alt="Chest 1" style="pointer-events: none;"><div class="milestone-text reached">
 2000 </div></div><div class="line-between"></div><div class="milestone" data-id="2" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 300 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 5000&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-close.png" class="gift-box active remind-claim" alt="Chest 2" style=""><div class="milestone-text reached">
 5000 </div></div><div class="line-between"></div><div class="milestone" data-id="3" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 600 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 7500&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-close.png" class="gift-box " alt="Chest 3" style=""><div class="milestone-text ">
 7500 </div></div><div class="line-between"></div><div class="milestone" data-id="4" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;img class=&quot;hh3d-curr-icon hh3d-curr-icon--sm&quot; src=&quot;https://hoathinh3d.ad/wp-content/themes/halimmovies-child/assets/image/luyen-dan/tinh-thach.png&quot; alt=&quot;Tinh Thạch&quot; width=&quot;14&quot; height=&quot;14&quot; decoding=&quot;async&quot; loading=&quot;eager&quot; data-no-lazy=&quot;1&quot; /&gt; 300 Tinh Thạch&lt;/li&gt;&lt;li&gt;&lt;i class='fas fa-crown'&gt;&lt;/i&gt; Khung avatar &quot;Phúc Lợi Mùa 22&quot;&lt;/li&gt;&lt;li class='pl-tooltip-frame'&gt;&lt;img src='/wp-content/themes/halimmovies-child/assets/image/khung/v/khung-phuc-loi-mua-22.webp' alt='Phúc Lợi Mùa 22'&gt;&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 8100&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-close.png" class="gift-box " alt="Chest 4" style=""><div class="milestone-text ">
 8100 </div></div></div>`;

/** Cùng hàng ấy sau khi đã nhận hết — `dom/04-click.html`, nguyên văn. */
const ROW_DONE = `<div class="reward-progress-container"><div class="milestone" data-id="1" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 150 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 2000&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-open.png" class="gift-box received-reward" alt="Chest 1" style="pointer-events: none;"><div class="milestone-text reached">
 2000 </div></div><div class="line-between"></div><div class="milestone" data-id="2" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 300 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 5000&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-open.png" class="gift-box received-reward" alt="Chest 2" style=""><div class="milestone-text reached">
 5000 </div></div><div class="line-between"></div><div class="milestone" data-id="3" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;i class='fas fa-fist-raised'&gt;&lt;/i&gt; 600 Tu Vi&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 7500&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-close.png" class="gift-box " alt="Chest 3" style=""><div class="milestone-text ">
 7500 </div></div><div class="line-between"></div><div class="milestone" data-id="4" data-tooltip-content="&lt;div class='custom-tooltip-content'&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-gift'&gt;&lt;/i&gt; Phần thưởng:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;img class=&quot;hh3d-curr-icon hh3d-curr-icon--sm&quot; src=&quot;https://hoathinh3d.ad/wp-content/themes/halimmovies-child/assets/image/luyen-dan/tinh-thach.png&quot; alt=&quot;Tinh Thạch&quot; width=&quot;14&quot; height=&quot;14&quot; decoding=&quot;async&quot; loading=&quot;eager&quot; data-no-lazy=&quot;1&quot; /&gt; 300 Tinh Thạch&lt;/li&gt;&lt;li&gt;&lt;i class='fas fa-crown'&gt;&lt;/i&gt; Khung avatar &quot;Phúc Lợi Mùa 22&quot;&lt;/li&gt;&lt;li class='pl-tooltip-frame'&gt;&lt;img src='/wp-content/themes/halimmovies-child/assets/image/khung/v/khung-phuc-loi-mua-22.webp' alt='Phúc Lợi Mùa 22'&gt;&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;&lt;i class='fas fa-tasks'&gt;&lt;/i&gt; 5035 / 8100&lt;/strong&gt;&lt;/p&gt;&lt;/div&gt;"><img src="/wp-content/themes/halimmovies-child/assets/image/ruong-thuong-close.png" class="gift-box " alt="Chest 4" style=""><div class="milestone-text ">
 8100 </div></div></div>`;

const profile = loadProfile();
const questOf = (id: string) =>
  profile.quests.find((q: { id: string }) => q.id === id) as { id: string; steps: Step[] } | undefined;
const free = questOf(FREE_ID);
const vip = questOf(VIP_ID);
if (!free || !vip) {
  console.error("✗ không thấy đủ hai bản Phúc Lợi Đường trong hồ sơ.");
  process.exit(1);
}

const steps = free.steps ?? [];
const flat = (list: Step[]): Step[] => list.flatMap((s) => [s, ...(Array.isArray(s.steps) ? flat(s.steps) : [])]);
const allSteps = flat(steps);

const overlayClick = allSteps.find((s) => s.action === "click" && (s.selector ?? "") === "#pl-claim-close-btn");
const scanSteps = allSteps.filter((s) => s.action === "evaluateJavaScript" && (s.script ?? "").includes("jarvis-bonus"));
const bonusLoop = steps.find((s) => s.action === "repeat" && (s.until?.selector ?? "") === MARK);
const pickClick = allSteps.find((s) => s.action === "click" && (s.selector ?? "").includes("jarvis-bonus"));
const verdictStep = allSteps.find(
  (s) =>
    s.action === "evaluateJavaScript" &&
    (s.script ?? "").includes("received-reward") &&
    !(s.script ?? "").includes("jarvis-bonus"),
);
const scanSrc = scanSteps[0]?.script ?? "";
const verdictSrc = verdictStep?.script ?? "";

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end('<!doctype html><html lang="vi"><body></body></html>');
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  const render = (html: string) =>
    page.evaluate((h) => {
      document.body.className = "";
      document.body.innerHTML = h;
      (window as unknown as { __jvzPl?: unknown }).__jvzPl = undefined;
    }, html);
  const ask = (c: Condition) => page.evaluate(conditionProbe, c);
  const run = (src: string) =>
    page.evaluate(`(() => { const v = (${src}); return typeof v === "function" ? v() : v; })()`) as Promise<unknown>;
  const marked = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".gift-box.jarvis-bonus")).map((el) =>
        (el.closest(".milestone")?.querySelector(".milestone-text")?.textContent ?? "?").replace(/\s+/g, " ").trim(),
      ),
    );
  const flagged = () => page.evaluate(() => document.body.classList.contains("jvz-pl-bonus"));

  // ---- 1. Hồ sơ đang ship: cụm có ở bản THƯỜNG, và KHÔNG có ở bản VIP ---------------------
  {
    check("bản thường có bước đóng popup", Boolean(overlayClick), overlayClick?.selector ?? "KHÔNG CÓ");
    check("bản thường có hai bước quét mốc", scanSteps.length >= 2, `${scanSteps.length} bước quét`);
    check("bản thường có vòng nhận mốc", Boolean(bonusLoop), bonusLoop?.until?.selector ?? "KHÔNG CÓ");
    check("bản thường có bước bấm ô đã đánh dấu", Boolean(pickClick), pickClick?.selector ?? "KHÔNG CÓ");
    check("bản thường có bước phán xử", Boolean(verdictStep));
    // Tông chủ dặn thẳng "chỉ tài khoản thường thôi" — và bản VIP vốn đi đường khác hẳn
    // (nút #nv-phucloi-open-btn trên trang nhiệm vụ ngày, không ghé /phuc-loi-duong bao giờ).
    const vipTouches = flat(vip.steps ?? []).filter((s) =>
      `${s.selector ?? ""} ${s.condition?.selector ?? ""} ${s.when?.selector ?? ""} ${s.script ?? ""}`.includes("pl-claim") ||
      `${s.selector ?? ""} ${s.script ?? ""}`.includes("gift-box"),
    );
    check("bản VIP KHÔNG mang cụm này", vipTouches.length === 0, `${vipTouches.length} bước`);
  }

  // ---- 2. CHỖ ĐỨNG: cả cụm phải nằm TRƯỚC cổng StopIf đồng hồ ------------------------------
  {
    const stopAt = steps.findIndex((s) => s.action === "stopIf" && (s.condition?.selector ?? "") === "#countdown-timer");
    const clusterAt = [overlayClick, bonusLoop, verdictStep].map((s) => (s ? steps.indexOf(s) : -1)).filter((i) => i >= 0);
    check("hồ sơ có cổng StopIf đồng hồ", stopAt > 0, `ở bước ${stopAt}`);
    check(
      "TOÀN BỘ cụm rương mốc đứng trước cổng ấy",
      clusterAt.length === 3 && Math.max(...clusterAt) < stopAt,
      `cụm kết ở ${Math.max(...clusterAt)} · StopIf ở ${stopAt}`,
    );
    // Bẫy vòng lặp: `until` hỏi CỜ, mà cờ do bước quét cắm. Quét phải đứng TRƯỚC vòng, không
    // thì lần kiểm `until` đầu tiên thấy cờ chưa ai cắm và vòng thoát ngay lập tức.
    const firstScanAt = steps.indexOf(scanSteps[0]);
    const loopAt = steps.indexOf(bonusLoop as Step);
    check(
      "bước quét đứng TRƯỚC vòng nhận — không thì vòng thoát ngay lần kiểm đầu",
      firstScanAt >= 0 && firstScanAt < loopAt,
      `quét ở ${firstScanAt} · vòng ở ${loopAt}`,
    );
    check("bước bấm ô mốc dùng forceClick (ô đang chạy animation)", pickClick?.forceClick === true);
  }

  // ---- 3. conditionProbe trên markup thật -------------------------------------------------
  {
    await render(CSS + OVERLAY + ROW_PENDING);
    check("popup đang mở → cửa `visible` mở", (await ask({ kind: "visible", selector: "#pl-claim-overlay.is-open" })) === true);
    check("nút đóng popup có mặt", (await ask({ kind: "visible", selector: "#pl-claim-close-btn" })) === true);

    await page.evaluate(() => document.querySelector("#pl-claim-overlay")?.classList.remove("is-open"));
    check("đóng popup → cửa `hidden` mở", (await ask({ kind: "hidden", selector: "#pl-claim-overlay.is-open" })) === true);

    const counts = await page.evaluate(() => ({
      active: document.querySelectorAll(".reward-progress-container .gift-box.active").length,
      received: document.querySelectorAll(".reward-progress-container .gift-box.received-reward").length,
      total: document.querySelectorAll(".reward-progress-container .gift-box").length,
    }));
    check(
      "hàng mốc thật: 1 đang chờ, 1 đã nhận, 4 ô",
      counts.active === 1 && counts.received === 1 && counts.total === 4,
      JSON.stringify(counts),
    );
  }

  // ---- 4. Script quét ĐANG SHIP: đánh dấu đúng MỘT ô, và đúng ô available -----------------
  {
    await render(CSS + ROW_PENDING);
    const said = String(await run(scanSrc));
    check("còn mốc chờ → cắm cờ", await flagged(), said);
    const picked = await marked();
    check("…đánh dấu đúng MỘT ô", picked.length === 1, picked.join(", "));
    check("…và đúng ô mốc 5000 (ô đang available)", picked[0] === "5000", picked.join(", "));
    check("…kể ra mốc nào và còn mấy cái", said.startsWith("!") && said.includes("5000") && said.includes("còn 1"), said);
    const onReceived = await page.evaluate(() => document.querySelectorAll(".gift-box.received-reward.jarvis-bonus").length);
    check("KHÔNG đánh dấu nhầm ô đã nhận", onReceived === 0, `${onReceived} ô`);
    const hit = await page.evaluate((sel) => (sel ? document.querySelectorAll(sel).length : -1), pickClick?.selector ?? "");
    check("selector bấm khớp đúng một phần tử", hit === 1, `đếm được ${hit}`);
  }

  // ---- 5. Hàng đã sạch: không cắm cờ, và không kêu lên Hoạt Động --------------------------
  {
    await render(CSS + ROW_DONE);
    const said = String(await run(scanSrc));
    check("hàng đã sạch → KHÔNG cắm cờ", (await flagged()) === false, said);
    check("…và nói bằng dòng debug, không phải dòng lên Hoạt Động", !said.startsWith("!"), said);
    check("…không đánh dấu ô nào", (await marked()).length === 0);
  }

  // ---- 6. Ca NGƯỢC: hàng báo còn chờ mà không ô nào bấm được ------------------------------
  {
    // Trang đổi hình dạng, hoặc mốc bị khoá vì lý do khác. Phải KÊU chứ không được im — nhưng
    // cũng không được cắm cờ, vì cắm là vòng lặp quay không tải suốt 90 giây.
    await render(CSS + ROW_PENDING);
    await page.evaluate(() => {
      document.querySelectorAll(".gift-box.active").forEach((el) => el.classList.remove("active"));
    });
    const said = String(await run(scanSrc));
    check("hàng báo chờ mà không ô nào bấm được → KÊU", said.startsWith("!") && said.includes("không rương nào bấm được"), said);
    check("…nhưng KHÔNG cắm cờ (không thì vòng quay không tải)", (await flagged()) === false);
  }

  // ---- 7. Phán xử: đếm bằng ô đã nhận, không tin số lần bấm ------------------------------
  {
    await render(CSS + ROW_PENDING);
    await run(scanSrc); // ghi mốc chuẩn
    // Giả lập máy chủ nhận: ô rụng `active`, thành `received-reward`, hàng thôi báo chờ.
    await page.evaluate(() => {
      const box = document.querySelector(".gift-box.jarvis-bonus");
      box?.classList.remove("active", "remind-claim");
      box?.classList.add("received-reward");
      document.querySelector(".reward-progress-container")?.classList.remove("has-pending-claim");
    });
    const said = String(await run(verdictSrc));
    check("nhận được 1 mốc → phán xử đếm đúng", said.startsWith("!") && said.includes("Đã nhận 1 rương mốc"), said);
    check("…và nói hàng mốc đã sạch", said.includes("đã sạch"), said);

    // Ca NGƯỢC: bấm mà máy chủ không nhận — hàng vẫn báo chờ.
    await render(CSS + ROW_PENDING);
    await run(scanSrc);
    const missed = String(await run(verdictSrc));
    check("bấm mà không nhận được gì → phán xử KÊU", missed.startsWith("!") && missed.includes("KHÔNG nhận được"), missed);
  }
} finally {
  await browser.close();
  await new Promise<void>((ok) => server.close(() => ok()));
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Rương mốc Phúc Lợi Đường: ${results.length} phép thử thuận.`);
