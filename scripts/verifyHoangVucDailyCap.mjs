#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";

const DAILY_ZERO = '#boss-info .remaining-attacks[data-count="0"]';
const ATTACK_SPENT = `#countdown-timer.is-visible, ${DAILY_ZERO}`;

const eachStep = (steps, visit) => {
  for (const step of steps ?? []) {
    visit(step);
    if (Array.isArray(step.steps)) eachStep(step.steps, visit);
  }
};

const quickClone = (value) => {
  const copy = structuredClone(value);
  eachStep(copy.steps, (step) => {
    if (
      step.action === "waitForCondition" &&
      step.optional === true &&
      step.condition?.selector === "#countdown-timer"
    ) {
      step.timeoutMs = 100;
    }
    if (step.action === "waitMilliseconds" && step.timeoutMs === 2500) step.timeoutMs = 300;
  });
  return copy;
};

const pageHtml = (remaining) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<body>
  <div id="boss-info">
    <div class="increase-damage">Đạo hữu được tăng 15% sát thương</div>
    <button id="change-element-button">Đổi hệ</button>
    <button class="battle-button" id="battle-button">KHIÊU CHIẾN</button>
    <div class="remaining-attacks" data-count="${remaining}">
      <span class="ra-label">Lượt đánh</span><span class="ra-count">${remaining}</span>
    </div>
  </div>
  <div id="countdown-timer" style="display:none"></div>
  <div id="boss-damage-screen" style="display:none">
    <button class="attack-button">Tấn Công</button>
    <button class="back-button">Trở lại</button>
  </div>
  <div id="damage-summary-container" style="display:none"><button class="close-button">Đóng</button></div>
  <ul class="notifications"></ul>
  <script>
    const one = (selector) => document.querySelector(selector);
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (target.id === 'battle-button') {
        one('#boss-damage-screen').style.display = 'block';
        return;
      }
      if (target.classList.contains('attack-button')) {
        setTimeout(() => {
          const holder = one('.remaining-attacks');
          const next = Math.max(0, Number(holder.dataset.count || 0) - 1);
          holder.dataset.count = String(next);
          one('.ra-count').textContent = String(next);
          document.body.dataset.attacked = String(Number(document.body.dataset.attacked || 0) + 1);
          fetch('/hv-hit?remaining=' + next);
          one('#damage-summary-container').style.display = 'block';
          const timer = one('#countdown-timer');
          if (next > 0) {
            timer.innerHTML = '<span class="cd-label">Hồi chiêu</span><span class="cd-time"><b>7</b>p <b>19</b>s</span>';
            timer.classList.add('is-visible');
            timer.style.display = 'inline-flex';
            one('#battle-button').style.display = 'none';
          } else {
            timer.classList.remove('is-visible');
            timer.style.display = 'none';
            timer.innerHTML = '';
            // Hoathinh3d 26/09/2026: hết lượt nhưng nút này lại hiện vì không còn next timestamp.
            one('#battle-button').style.display = '';
          }
        }, 120);
        return;
      }
      if (target.classList.contains('close-button')) one('#damage-summary-container').style.display = 'none';
      if (target.classList.contains('back-button')) one('#boss-damage-screen').style.display = 'none';
    });
  </script>
</body></html>`;

let remaining = 5;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.test");
  if (url.pathname === "/hv-hit") {
    remaining = Math.max(0, Number(url.searchParams.get("remaining") ?? remaining));
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(pageHtml(remaining));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const silent = { info: () => {}, warning: () => {}, debug: () => {} };
  const session = createSession(page, {
    baseUrl,
    log: silent,
    minActionDelayMs: 0,
    maxActionDelayMs: 1,
  });
  const engine = createQuestEngine({ log: silent });
  const quests = loadProfile().quests.filter(
    (quest) => quest.id === "hoang-vuc" || quest.id === "hoang-vuc-thuong",
  );
  assert.deepEqual(quests.map((quest) => quest.id), ["hoang-vuc", "hoang-vuc-thuong"]);

  for (const source of quests) {
    const quest = quickClone(source);
    const flattened = [];
    eachStep(quest.steps, (step) => flattened.push(step));
    assert(
      flattened.some(
        (step) => step.action === "repeat" && step.until?.kind === "visible" && step.until?.selector === ATTACK_SPENT,
      ),
      `${source.id}: repeat phải dùng nhân chứng server-backed`,
    );
    assert.equal(
      flattened.filter(
        (step) => step.action === "stopIf" && step.condition?.kind === "visible" && step.condition?.selector === DAILY_ZERO,
      ).length,
      2,
      `${source.id}: phải chốt hết ngày cả trước khi đánh và ngay sau lượt thứ năm`,
    );

    remaining = 0;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const alreadySpent = await engine.run(session, { dailyQuestPath: "/" }, quest);
    assert.equal(alreadySpent.outcome, "alreadyDone", `${source.id}: zero-at-load outcome`);
    assert.equal(alreadySpent.dailyCapReached, true, `${source.id}: zero-at-load daily cap`);
    assert.equal(alreadySpent.message, "đã hết 5 lượt hôm nay");
    assert.equal(await page.getAttribute("body", "data-attacked"), null);

    remaining = 1;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const finalHit = await engine.run(session, { dailyQuestPath: "/" }, quest);
    assert.equal(finalHit.outcome, "alreadyDone", `${source.id}: final-hit outcome`);
    assert.equal(finalHit.dailyCapReached, true, `${source.id}: final-hit daily cap`);
    assert.equal(finalHit.message, "đã hết 5 lượt hôm nay");
    assert.equal(await page.getAttribute("body", "data-attacked"), "1");
    assert.equal(await page.locator(".remaining-attacks").getAttribute("data-count"), "0");
    assert.equal(await page.locator(".ra-count").innerText(), "0");
    assert.equal(await page.locator("#battle-button").isVisible(), true);
    assert.equal(await page.locator("#countdown-timer").isVisible(), false);

    remaining = 2;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const ordinaryHit = await engine.run(session, { dailyQuestPath: "/" }, quest);
    assert.equal(ordinaryHit.outcome, "completed", `${source.id}: ordinary-hit outcome`);
    assert.equal(ordinaryHit.cooldownSeconds, 439, `${source.id}: ordinary-hit cooldown`);
    assert.equal(await page.locator(".remaining-attacks").getAttribute("data-count"), "1");
    assert.equal(await page.locator("#countdown-timer").isVisible(), true);
    assert.equal(await page.locator("#battle-button").isVisible(), false);
  }

  console.log(
    "PASS: Hoang Vực VIP/thường đọc data-count=0 và nhận đúng lượt thứ năm dù KHIÊU CHIẾN vẫn hiện.",
  );
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
