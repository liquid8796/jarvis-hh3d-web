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
    // Game filters isTrusted=false and listens to pointerdown / pointerup,
    // not DOM click. Mimic that contract in the fixture.
    const main = document.querySelector(".fish-main");
    let pressedAt = null;
    main.addEventListener("pointerdown", (event) => {
      if (event.isTrusted) pressedAt = performance.now();
    });
    main.addEventListener("pointerup", (event) => {
      if (!event.isTrusted || pressedAt === null) return;
      window.clicks.cast++;
      pressedAt = null;
      main.classList.replace("st-idle", "st-wait");
      main.textContent = "Chờ cá";
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
  await tick(); // controller flags request, does not itself click
  assert.equal(await page.evaluate(() => window.__jvzFish.casts), 0,
    "do not count a click as a successful cast before state changes");
  assert.equal(await page.locator(".fish-main.jvz-fish-press").count(), 1,
    "tick requests a trusted Playwright press");
  await page.evaluate(() => document.querySelector(".fish-main").click());
  assert.equal(await page.evaluate(() => window.clicks.cast), 0,
    "synthetic DOM click must be rejected, as on Cốc Cốc");
  await page.locator(".fish-main.jvz-fish-press").click({ delay: 280 });
  assert.equal(await page.evaluate(() => window.clicks.cast), 1,
    "trusted Playwright press casts successfully");
  await tick();
  assert.equal(await page.evaluate(() => window.__jvzFish.casts), 1,
    "count a real cast after game enters wait state");
  await page.evaluate(() => {
    const main = document.querySelector(".fish-main");
    main.classList.replace("st-wait", "st-reel");
    main.textContent = "GIỮ";
    window.holds = { down: 0, up: 0 };
    main.addEventListener("pointerdown", (e) => {
      if (e.isTrusted) { window.holds.down++; window.holds.at = performance.now(); }
    });
    main.addEventListener("pointerup", (e) => {
      if (e.isTrusted) { window.holds.up++; window.holds.duration = performance.now() - window.holds.at; }
    });
  });
  await tick();
  assert.equal(await page.locator(".fish-main.jvz-fish-press").count(), 1);
  await page.locator(".fish-main.jvz-fish-press").click({ delay: 280 });
  const holds = await page.evaluate(() => window.holds);
  assert.equal(holds.down, 1);
  assert.equal(holds.up, 1);
  assert.ok(holds.duration >= 250, "hold must last long enough to influence reel tension");
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
  // The launcher sheet remains mounted behind the list of fishing rooms.
  // A querySelector(".sheet") would wrongly re-open the launcher forever.
  await page.setContent('<div class="view hub"></div>' +
    '<div class="sheet"><button id="launcher">Câu Cá Tiên Giới</button></div>' +
    '<div class="sheet"><div class="room-item">1/12 người · đang chơi<button id="join">Vào</button></div></div>');
  await page.evaluate(() => {
    window.testRoom = { launch: 0, join: 0 };
    document.querySelector("#launcher").addEventListener("click", () => window.testRoom.launch++);
    document.querySelector("#join").addEventListener("click", () => window.testRoom.join++);
    window.__jvzFish = undefined;
  });
  await page.evaluate("(" + source + ")()");
  assert.deepEqual(await page.evaluate(() => window.testRoom), { launch: 0, join: 1 },
    "join the actual fishing room despite nested launcher overlay");

  console.log("PASS fishing browser fixture: trusted pointer input, protected sale, nested room, exit cap");
} finally {
  await browser.close();
}
