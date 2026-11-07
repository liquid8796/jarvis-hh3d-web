#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const source = readFileSync(new URL("../src/lib/quest-engine/fishingTick.js", import.meta.url), "utf8")
  .replaceAll("{{sellBelow}}", "4").replaceAll("{{castLimit}}", "0").replaceAll("{{spot}}", "giua");
let browser;
try { browser = await chromium.launch({ headless: true, channel: "chromium" }); }
catch (error) {
  if (!/Executable doesn't exist/i.test(String(error))) throw error;
  browser = await chromium.launch({ headless: true, channel: "chrome" });
}
try {
  const page = await browser.newPage();
  const tick = () => page.evaluate("(" + source + ")()");
  // The game's co()/z(): a rare species can have low ngư lực. First click only asks.
  await page.setContent(`<div class="view fish-room">
    <button class="fish-main st-idle">Ném câu</button>
    <button class="fish-quick-bag"><i class="fish-badge">1/30</i></button>
  </div><div class="sheet"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div>
    <div class="fish-bag"><div class="fish-bag-head">Giỏ 1/30</div>
      <div class="fish-bag-grid"><button class="fish-bag-item fish-card r4" aria-pressed="false">Cá hiếm<span class="fish-bag-price">+4</span></button></div>
      <div class="fish-bag-bar"></div>
    </div>
  </div>`);
  await page.evaluate(() => {
    window.__jvzFish = undefined;
    window.sales = { sent: 0, confirmed: 0, closed: 0 };
    const card = document.querySelector(".fish-card"), bar = document.querySelector(".fish-bag-bar");
    const render = (confirm = false) => {
      bar.innerHTML = confirm ? '<p class="fish-bag-ask">Bán cả 1 cá hiếm ★4+?</p>' : "";
      if (!card.classList.contains("on")) return;
      const sell = document.createElement("button"); sell.textContent = "Bán 1 con · +4";
      sell.onclick = () => {
        if (!confirm) { render(true); return; }
        window.sales.sent++;
        window.completeSale = () => {
          window.sales.confirmed++; card.remove(); bar.replaceChildren();
          document.querySelector(".fish-badge").textContent = "0/30";
        };
      };
      bar.append(sell);
    };
    card.onclick = () => {
      card.classList.toggle("on"); card.setAttribute("aria-pressed", String(card.classList.contains("on"))); render();
    };
    document.querySelector(".sheet-head button").onclick = () => {
      window.sales.closed++; document.querySelector(".sheet").remove();
    };
  });
  await tick();
  await tick();
  assert.equal(await page.evaluate(() => window.sales.sent), 0, "first click only opens the game's rare-fish confirmation");
  await tick();
  assert.equal(await page.evaluate(() => window.sales.sent), 1, "complete rare-fish confirmation instead of closing the basket");
  assert.equal(await page.evaluate(() => window.sales.closed), 0, "keep basket open until the game responds");
  await tick(); await tick();
  assert.equal(await page.evaluate(() => window.sales.sent), 1, "do not resubmit an unacknowledged sale");
  await page.evaluate(() => window.completeSale());
  await tick();
  assert.equal(await page.evaluate(() => window.sales.confirmed), 1);
  assert.equal(await page.evaluate(() => window.sales.closed), 1, "close only after confirmed inventory update");

  const failures = [];
  const check = async (name, run) => { try { await run(); console.log("PASS " + name); } catch (error) { failures.push(name + ": " + error.message); } };
  const room = '<div class="view fish-room"><button class="fish-main st-idle">Ném câu</button><button class="fish-quick-bag"><i class="fish-badge">30/30</i></button></div>';
  await check("wait for basket payload before declaring it empty", async () => {
    await page.setContent(room.replace("30/30","1/30") + '<div class="sheet"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-bag">Đang tải</div></div>');
    await page.evaluate(() => { window.__jvzFish=undefined; document.querySelector(".sheet-head button").onclick=()=>document.querySelector(".sheet").remove(); });
    assert.match(await tick(), /đợi.*giỏ|đang.*giỏ/i);
    assert.equal(await page.locator(".fish-bag").count(),1);
  });
  await check("full basket is rechecked without a new successful cast", async () => {
    await page.setContent(room);
    await page.evaluate(() => { window.__jvzFish={casts:5,ticks:0,bagChecked:true,lastBagCast:5};window.opened=0;document.querySelector(".fish-quick-bag").onclick=()=>window.opened++; });
    await tick();
    assert.equal(await page.evaluate(()=>window.opened),1);
    assert.equal(await page.locator(".jvz-fish-press").count(),0);
  });
  await check("pending full-basket dialog opens existing basket, never releases fish", async () => {
    await page.setContent(room + '<div class="sheet"><div class="fish-bag-pend"><button id="release">Thả về hồ</button><button id="open">Mở giỏ dọn chỗ</button></div></div>');
    await page.evaluate(() => { window.__jvzFish=undefined;window.pendingClicks={open:0,release:0};document.querySelector("#open").onclick=()=>window.pendingClicks.open++;document.querySelector("#release").onclick=()=>window.pendingClicks.release++; });
    await tick();
    assert.deepEqual(await page.evaluate(()=>window.pendingClicks),{open:1,release:0});
  });
  await check("daily sale cap backs off instead of trying to cast into full bag", async () => {
    await page.setContent(room + '<div class="sheet"><div class="fish-bag"><div class="fish-bag-head"><p class="fish-bag-capnote">Hôm nay Ngư Ông đã mua đủ</p></div><button class="fish-bag-item fish-card on"><span class="fish-bag-price">+4</span></button><div class="fish-bag-bar"><button disabled>Ngư Ông đã mua đủ hôm nay</button></div></div></div>');
    await page.evaluate(()=>{window.__jvzFish=undefined;});
    assert.match(await tick(), /mua đủ|hạn mức/i);
    assert.ok(await page.evaluate(()=>window.__jvzFish.retryAfter > Date.now()));
  });

  await check("delayed rare-fish prompt is confirmed once", async () => {
    await page.setContent(room.replace("30/30","1/30") + '<div class="sheet"><div class="fish-bag"><div class="fish-bag-head">Giỏ</div><button class="fish-bag-item fish-card r4 on"><span class="fish-bag-price">+4</span></button><div class="fish-bag-bar"><button>Bán 1 con · +4</button></div></div></div>');
    await page.evaluate(()=>{
      window.__jvzFish=undefined; window.delayedSent=0;
      const bar=document.querySelector(".fish-bag-bar");
      bar.querySelector("button").onclick=()=>setTimeout(()=>{
        bar.innerHTML='<p class="fish-bag-ask">Bán cả 1 cá hiếm ★4+?</p><button>Bán 1 con · +4</button>';
        bar.querySelector("button").onclick=()=>window.delayedSent++;
      },50);
    });
    await tick(); await page.waitForTimeout(80); await tick(); await tick();
    assert.equal(await page.evaluate(()=>window.delayedSent),1);
  });
  await check("selection changes are not a sale acknowledgement", async () => {
    await page.evaluate(()=>{
      const card=document.querySelector(".fish-card");card.classList.remove("on");
      card.onclick=()=>card.classList.toggle("on");
    });
    await tick(); await tick();
    assert.equal(await page.evaluate(()=>window.delayedSent),1);
    assert.equal(await page.locator(".fish-card.on").count(),0,"pending request must not reselect a deselected fish");
  });

  assert.deepEqual(failures, []);

  console.log("PASS fishing sales: rare-fish confirmation, delayed receipt, no duplicate request");
} finally { await browser.close(); }
