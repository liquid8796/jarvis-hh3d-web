#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const source = readFileSync(new URL("../src/lib/quest-engine/fishingTick.js", import.meta.url), "utf8")
  .replace("{{sellBelow}}", "4").replace("{{castLimit}}", "1");
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.setContent(`<div class="view fish-room">
      <div class="room-top"><button aria-label="Rời phòng" id="leave">Rời phòng</button></div>
      <button class="fish-quick-bag"><i class="fish-badge">2/30</i></button>
      <button class="fish-main st-idle">Ném câu</button>
    </div><div class="sheet"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div>
      <div class="fish-bag">
        <div class="fish-bag-auto"><button class="notif-toggle on" aria-checked="true">Tự bán</button></div>
        <div class="fish-bag-grid">
          <button class="fish-bag-item fish-card on" id="rare">Cá tiên +20</button>
          <button class="fish-bag-item fish-card" id="weak">Cá thường +4</button>
        </div>
        <div class="fish-bag-bar"><button class="btn small jade">Bán 1 con</button></div>
      </div>
    </div>`);
  await page.evaluate(() => {
    window.clicks = { sold: 0, cast: 0, left: 0 };
    const byId = (id) => document.getElementById(id);
    for (const id of ["rare", "weak"])
      byId(id).addEventListener("click", () => byId(id).classList.toggle("on"));
    document.querySelector(".fish-bag-bar button").addEventListener("click", () => {
      window.clicks.sold++;
    });
    document.querySelector(".sheet-head button").addEventListener("click", () => {
      document.querySelector(".sheet").remove();
    });
    document.querySelector(".fish-main").addEventListener("click", () => {
      window.clicks.cast++;
    });
    byId("leave").addEventListener("click", () => (window.clicks.left++));
  });
  const tick = () => page.evaluate("(" + source + ")()");
  await tick();
  assert.equal(await page.locator("#rare.on").count(), 0, "rare fish selection is cleared before selling");
  await tick();
  assert.ok(await page.locator("#weak.on").count(), "weak fish selected");
  assert.equal(await page.locator("#rare.on").count(), 0, "rare fish protected");
  await tick();
  assert.equal(await page.evaluate(() => window.clicks.sold), 1, "sell only selected weak fish");
  await tick(); // close bag
  await tick(); // attempt a cast but UI stays idle: no server confirmation
  assert.equal(await page.evaluate(() => window.__jvzFish.casts), 0,
    "do not count a click as a successful cast before state changes");
  await page.evaluate(() => {
    const main = document.querySelector(".fish-main");
    main.classList.replace("st-idle", "st-wait");
    main.textContent = "Chờ cá";
  });
  await tick();
  assert.equal(await page.evaluate(() => window.__jvzFish.casts), 1,
    "count a real cast after game enters wait state");
  await page.evaluate(() => {
    const main = document.querySelector(".fish-main");
    main.classList.replace("st-wait", "st-reel");
    main.textContent = "GIỮ";
    window.holds = { down: 0, up: 0 };
    main.addEventListener("pointerdown", () => window.holds.down++);
    main.addEventListener("pointerup", () => window.holds.up++);
  });
  await tick();
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => window.holds), { down: 1, up: 1 },
    "reeling pulses must release the button (g:input h=1 → h=0)");
  await page.evaluate(() => {
    const main = document.querySelector(".fish-main");
    main.classList.replace("st-reel", "st-idle");
    main.textContent = "Ném câu";
  });
  await tick();
  assert.equal(await page.evaluate(() => window.clicks.left), 1, "exit after configured cast limit");
  assert.equal(await page.locator("body.jvz-fish-finished").count(), 1);

  const disabledSource = readFileSync(new URL("../src/lib/quest-engine/fishingTick.js", import.meta.url), "utf8")
    .replace("{{sellBelow}}", "0").replace("{{castLimit}}", "0");
  await page.setContent(`<div class="view fish-room"><button class="fish-main st-idle">Ném câu</button></div>
    <div class="sheet"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div>
      <div class="fish-bag">
        <div class="fish-bag-auto"><button class="notif-toggle on" aria-checked="true">Tự bán cá ★1–2</button></div>
        <div class="fish-bag-grid"><button class="fish-bag-item fish-card" id="fish-low">Cá +1</button></div>
      </div>
    </div>`);
  await page.evaluate(() => {
    window.__jvzFish = undefined;
    document.querySelector(".notif-toggle").addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.classList.toggle("on");
      button.setAttribute("aria-checked", button.classList.contains("on") ? "true" : "false");
    });
  });
  await page.evaluate("(" + disabledSource + ")()");
  assert.equal(await page.locator(".notif-toggle[aria-checked=false]").count(), 1,
    "sellBelow=0 must disable built-in automatic fish sales");
  console.log("PASS fishing browser fixture: selective sale, cast confirmation, exit cap");
} finally {
  await browser.close();
}
