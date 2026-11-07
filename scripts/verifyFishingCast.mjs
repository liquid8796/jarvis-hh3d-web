import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createSession } from "../src/lib/quest-engine/session.mjs";

let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "chromium" });
} catch (error) {
  if (!/Executable doesn't exist/.test(String(error))) throw error;
  browser = await chromium.launch({ headless: true, channel: "chrome" });
}
try {
  const page = await browser.newPage();
  const select = ".fish-room .fish-main.st-idle.jvz-fish-press";
  const session = createSession(page, {
    baseUrl: "https://example.invalid",
    minActionDelayMs: 0, maxActionDelayMs: 1,
    log: { debug:()=>{}, info:()=>{}, warning:()=>{} }
  });
  // The profile invokes fishingReel on every tick, not only while reeling.
  // A locator auto-wait here blocks casting and misses the short bite window.
  page.setDefaultTimeout(900);
  for (const phase of ["missing", "idle", "load", "wait", "bite"]) {
    await page.setContent(phase === "missing" ? "<main>Hub</main>" :
      `<div class="fish-room"><button class="fish-main st-${phase}">test</button></div>`);
    const started = performance.now();
    await session.fishingReel();
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 300,
      `non-reel ${phase} must return immediately, took ${Math.round(elapsed)}ms`);
  }
  page.setDefaultTimeout(30_000);
  console.log("PASS real Playwright reel probe does not block missing/idle/load/wait/bite ticks");
  const setup = async (mode) => {
    await page.setContent('<div class="fish-room"><button class="fish-main st-idle jvz-fish-press" type="button">Ném câu</button></div>');
    await page.evaluate(mode => {
      window.__jvzFish = { pendingCast: false, castFailure: "", retryAfter: 0 };
      window.__test = { modes: mode, down: 0, up: 0, space: 0, sent: 0 };
      const b = document.querySelector(".fish-main");
      let pending = false;
      b.addEventListener("pointerdown", e => {
        if (e.isTrusted) { window.__test.down++; pending = true; }
      });
      b.addEventListener("pointerup", e => {
        if (!e.isTrusted || !pending) return;
        window.__test.up++;
        pending = false;
        if (mode === "pointer") {
          b.classList.remove("st-idle");
          b.classList.add("st-wait");
        }
      });
      let keydown = false;
      window.addEventListener("keydown", e => {
        if (e.code === "Space" && e.isTrusted) { e.preventDefault(); keydown = true; }
      });
      window.addEventListener("keyup", e => {
        if (e.code !== "Space" || !e.isTrusted || !keydown) return;
        keydown = false;
        window.__test.space++;
        if (mode === "keyboard") {
          b.classList.remove("st-idle");
          b.classList.add("st-wait");
        }
      });
    }, mode);
  };
  await setup("pointer");
  assert.equal(await session.click(select, 2500, false, 120), true);
  assert.deepEqual(await page.evaluate(() => [window.__test.down, window.__test.up, window.__test.space]),[1,1,0],
    "native pointerdown/up must trigger a cast without a synthetic DOM click");
  assert.equal(await page.evaluate(() => window.__jvzFish.pendingCast),true,
    "only a confirmed game transition can mark the cast pending");
  await setup("keyboard");
  assert.equal(await session.click(select, 2500, false, 120), true);
  assert.equal(await page.evaluate(() => window.__test.space), 1,
    "game source supports keydown/keyup Space as the fallback cast path");
  // Pointer movement itself can expose a dialog after spot preparation.
  await setup("keyboard");
  await page.mouse.move(800, 600);
  await page.evaluate(() => {
    document.querySelector(".fish-main").addEventListener("pointermove", () => {
      const blocker = document.createElement("div");
      blocker.className = "sheet";
      blocker.textContent = "Late dialog before press";
      document.body.append(blocker);
    }, { once: true });
  });
  assert.equal(await session.click(select, 2500, false, 120), false);
  assert.deepEqual(await page.evaluate(() => [window.__test.down, window.__test.space]), [0, 0],
    "recheck readiness after moving the mouse and before pressing");

  // A late accepted cast must not gain a recovery timer or another input.
  await setup("keyboard");
  await page.evaluate(() => {
    document.querySelector(".fish-main").addEventListener("pointerup", () => {
      document.activeElement?.blur();
      document.querySelector(".fish-main").addEventListener("focus", () => {
        document.querySelector(".fish-main").classList.replace("st-idle", "st-wait");
      }, { once: true });
    }, { once: true });
  });
  assert.equal(await session.click(select, 2500, false, 120), true);
  assert.equal(await page.evaluate(() => window.__test.space), 0);
  assert.equal(await page.evaluate(() => window.__jvzFish.retryAfter), 0);
  // A late dialog/spectator transition must not be bypassed by Space.
  for (const late of ["sheet", "spectator", "disabled", "load"]) {
    await setup("keyboard");
    await page.evaluate(late => {
      document.querySelector(".fish-main").addEventListener("pointerup", () => {
        setTimeout(() => {
          const main = document.querySelector(".fish-main");
          if (late === "disabled") main.disabled = true;
          else if (late === "load") main.classList.replace("st-idle", "st-load");
          else {
            const blocker = document.createElement("div");
            blocker.className = late === "sheet" ? "sheet" : "fish-spec";
            blocker.textContent = "Late blocker";
            document.querySelector(".fish-room").append(blocker);
          }
        }, 10);
      }, { once: true });
    }, late);
    assert.equal(await session.click(select, 2500, false, 120), false, late + " must block fallback");
    assert.equal(await page.evaluate(() => window.__test.space), 0, late + " must not receive Space");
    assert.equal(await page.evaluate(() => window.__jvzFish.pendingCast), false);
  }
  await setup("none");
  assert.equal(await session.click(select, 2500, false, 120), false);
  const failure = await page.evaluate(() => ({
    pending: window.__jvzFish.pendingCast,
    retry: window.__jvzFish.retryAfter,
    reason: window.__jvzFish.castFailure,
    down: window.__test.down,
    up: window.__test.up,
    space: window.__test.space
  }));
  assert.equal(failure.pending,false,"do not count a cast that did not reach the game");
  assert.ok(failure.retry > Date.now());
  assert.match(failure.reason,/g:act|Space|pointerup/);
  assert.deepEqual([failure.down,failure.up,failure.space],[1,1,1]);
  // Real screenshot regression: an active splash can cover the game room.
  // Without a gate check, pointer hits the splash, Space casts behind it, and
  // the mouse cannot reel the fish. Fail closed before either input path.
  await setup("pointer");
  await page.evaluate(() => {
    const blocker = document.createElement("div");
    blocker.className = "bt-wrap";
    blocker.style.cssText = "position:fixed;inset:0;background:#fff;z-index:9999";
    blocker.innerHTML = '<div class="pl-gate"><button class="pl-go">Vào Ngay</button></div>';
    blocker.querySelector(".pl-go").addEventListener("click", () => blocker.remove());
    document.body.append(blocker);
  });
  assert.equal(await session.click(select, 2500, false, 120), false);
  assert.deepEqual(await page.evaluate(() => [window.__test.down, window.__test.up, window.__test.space]),[0,0,0]);
  assert.match(await page.evaluate(() => window.__jvzFish.castFailure), /Vào Ngay/);
  await page.locator(".pl-go").click();
  assert.equal(await page.locator(".bt-wrap").count(), 0);
  assert.equal(await session.click(select, 2500, false, 120), true);
  assert.equal(await page.evaluate(() => window.__jvzFish.retryAfter), 0,
    "accepted cast clears old retry timer before bite/hook");

  const profile = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url),"utf8"));
  for (const id of ["cau-ca","cau-ca-thuong"]) {
    const quest = profile.quests.find(q => q.id === id);
    assert.ok(quest, id + " must exist");
    const repeat = quest.steps.find(s => s.action === "repeat");
    assert.ok(repeat.steps.some(s => s.action === "click" &&
      s.selector === ".pl-go.jvz-fish-enter"), id + " must dismiss the preload gate");
  }
  const engine = readFileSync(new URL("../src/lib/quest-engine/engine.mjs", import.meta.url),"utf8");
  assert.match(engine,/quest.id !== "cau-ca" && quest.id !== "cau-ca-thuong"/,
    "the short bite/hook window must not wait through normal humanDelay");
  console.log("PASS REA fishing native pointer cast, Space fallback, no-ack recovery, fast hook timing");
} finally { await browser.close(); }
