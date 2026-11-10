/** Regression of the worker's trusted spot-menu path, using the observed live DOM. */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { prepareFishingSpot } from "../src/lib/quest-engine/fishingSpot.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
let browser;
try { browser = await chromium.launch({ headless: true, channel: "chromium" }); }
catch (error) {
  if (!/Executable doesn't exist/.test(String(error))) throw error;
  browser = await chromium.launch({ headless: true, channel: "chrome" });
}
try {
  const page = await browser.newPage();
  const logs = [];
  const session = createSession(page, { baseUrl: "https://example.invalid", minActionDelayMs: 0, maxActionDelayMs: 1,
    log: { debug: m => logs.push(m), info: m => logs.push(m), warning: m => logs.push(m) } });
  const setup = async (options = {}) => {
    await page.setContent('<style>.hidden{display:none}.sheet{position:fixed;inset:0;background:white;z-index:5}button{min-width:130px;min-height:50px}</style><div class="view fish-room"><button class="fish-spot"><small>Điểm câu</small><b></b></button><button class="fish-tide hunt hidden"></button><button class="fish-main st-idle jvz-fish-press">Ném câu</button></div>');
    await page.evaluate(options => {
      window.__jvzFish = { casts: 0, pendingCast: false, spot: options.spot };
      if (options.random !== undefined) Math.random = () => options.random;
      window.trace = [];
      const spot = document.querySelector('.fish-spot'), main = document.querySelector('.fish-main');
      spot.querySelector('b').textContent = options.current || 'Ven bờ';
      if (options.noSpot) spot.remove();
      if (options.phase) main.className = 'fish-main st-' + options.phase + ' jvz-fish-press';
      if (options.hunt) { const h = document.querySelector('.fish-tide'); h.classList.remove('hidden'); h.textContent = options.hunt; }
      if (options.overlay) { const s = document.createElement('div'); s.className = 'sheet'; s.textContent = 'Không liên quan'; document.body.append(s); }
      spot.onclick = () => {
        window.trace.push('open');
        if (options.phaseOnOpen) main.className = 'fish-main st-' + options.phaseOnOpen;
        if (options.spectatorOnOpen) { const s = document.createElement('div'); s.className = 'fish-spec'; s.textContent = 'Đang ngắm cảnh'; document.querySelector('.fish-room').append(s); }
        if (options.huntOnOpen) { const h = document.querySelector('.fish-tide'); h.classList.remove('hidden'); h.textContent = 'Cá Săn · Bãi sen'; }
        if (options.overlayOnOpen) { const s = document.createElement('div'); s.className = 'sheet unrelated'; s.textContent = 'Thông báo khác'; document.body.append(s); }
        const sheet = document.createElement('div'); sheet.className = 'sheet';
        sheet.innerHTML = '<div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-spots"></div>';
        sheet.querySelector('[aria-label="Đóng"]').onclick = () => { window.trace.push('close'); sheet.remove(); };
        for (const name of options.missingTarget ? ['Ven bờ'] : ['Bờ nông', 'Bãi sen', 'Giữa hồ', 'Dưới cầu đá']) {
          const card = document.createElement('button'); card.className = 'fish-hab kit-card';
          card.innerHTML = '<div class="fish-hab-text"><b>' + name + '</b><small>Cá vùng này</small></div>';
          card.onclick = event => {
            if (!event.isTrusted) return;
            window.trace.push('select:' + name);
            if (!options.reject) setTimeout(() => { spot.querySelector('b').textContent = name; sheet.remove(); }, options.delay || 0);
          };
          sheet.querySelector('.fish-spots').append(card);
        }
        document.body.append(sheet);
      };
      let held = false;
      main.addEventListener('pointerdown', e => { if (e.isTrusted) held = true; });
      main.addEventListener('pointerup', e => {
        if (!e.isTrusted || !held) return; held = false;
        window.trace.push('cast:' + spot.querySelector('b').textContent);
        main.classList.replace('st-idle', 'st-wait');
      });
      window.addEventListener('keyup', e => { if (e.isTrusted && e.code === 'Space') window.trace.push('space'); }, { once: true });
    }, options);
  };
  const cast = () => session.click('.fish-room .fish-main.st-idle.jvz-fish-press', 1000, false, 100);
  const trace = () => page.evaluate(() => window.trace);

  for (const [spot, label] of [['nong', 'Bờ nông'], ['sen', 'Bãi sen'], ['giua', 'Giữa hồ'], ['cau', 'Dưới cầu đá']]) {
    await setup({ spot });
    assert.equal(await cast(), true);
    assert.deepEqual(await trace(), ['open', 'select:' + label, 'cast:' + label], 'configured habitat must reach trusted cast');
  }
  for (const [random, label] of [[0, 'Bờ nông'], [.25, 'Bãi sen'], [.5, 'Giữa hồ'], [.999999, 'Dưới cầu đá']]) {
    await setup({ spot: 'random', random });
    assert.equal((await prepareFishingSpot(page)).ready, true);
    assert.deepEqual(await trace(), ['open', 'select:' + label], 'random spans four habitats');
  }
  await setup({ spot: 'random', random: 0 });
  for (const spot of ['sen,cau', ['sen', 'cau']]) {
    for (const [random, label] of [[0, 'Bãi sen'], [.49999, 'Bãi sen'], [.5, 'Dưới cầu đá'], [.999999, 'Dưới cầu đá']]) {
      await setup({ spot, random });
      assert.equal(await cast(), true);
      assert.deepEqual(await trace(), ['open', 'select:' + label, 'cast:' + label], 'random stays inside selected subset');
    }
  }
  await setup({ spot: 'sen,cau', random: 0 });
  await prepareFishingSpot(page);
  await page.evaluate(() => { Math.random = () => .75; });
  await prepareFishingSpot(page);
  assert.deepEqual(await trace(), ['open', 'select:Bãi sen', 'open', 'select:Dưới cầu đá'], 'multi-selection samples anew each cast');
  await setup({ spot: 'random', random: 0 });
  await prepareFishingSpot(page);
  await page.evaluate(() => { Math.random = () => .75; });
  await prepareFishingSpot(page);
  assert.deepEqual(await trace(), ['open', 'select:Bờ nông', 'open', 'select:Dưới cầu đá'], 'sample anew each cast');
  await setup({ spot: 'invalid' });
  assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['open', 'select:Giữa hồ', 'cast:Giữa hồ'], 'invalid runtime option uses legacy default');
  await setup({ delay: 150 });
  assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['open', 'select:Giữa hồ', 'cast:Giữa hồ']);
  assert.equal(await page.evaluate(() => window.__jvzFish.pendingCast), true);
  await page.evaluate(() => document.querySelector('.fish-main').classList.replace('st-wait', 'st-idle'));
  assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['open', 'select:Giữa hồ', 'cast:Giữa hồ', 'cast:Giữa hồ'], 'retain the selected point across casts');
  await setup({ current: 'Giữa hồ' }); assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['cast:Giữa hồ']);
  for (const phaseOnOpen of ['wait', 'bite', 'reel']) {
    await setup({ phaseOnOpen }); assert.equal(await cast(), false);
    assert.deepEqual(await trace(), ['open', 'close']);
    assert.equal(await page.evaluate(() => window.__jvzFish.retryAfter || 0), 0, 'readiness changes must not delay hook/reel with cast backoff');
  }
  for (const options of [{ huntOnOpen: true }, { spectatorOnOpen: true }, { overlayOnOpen: true }]) {
    await setup(options); assert.equal(await cast(), false);
    assert.ok(!(await trace()).some(x => x.startsWith('select:') || x.startsWith('cast:') || x === 'space'));
    if (options.overlayOnOpen) assert.equal(await page.locator('.unrelated').count(), 1);
  }
  for (const hunt of ['Cá Săn · Cầu đá', 'Săn · Bãi sen']) {
    await setup({ hunt }); assert.equal(await cast(), true);
    assert.deepEqual(await trace(), ['cast:Ven bờ'], 'preserve selected habitat during an active hunt');
  }
  await setup({ hunt: 'Cá Săn sau 10 phút' }); assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['open', 'select:Giữa hồ', 'cast:Giữa hồ']);
  await setup({ noSpot: true }); assert.equal(await cast(), true);
  assert.deepEqual(await trace(), ['cast:Ven bờ'], 'missing UI retains game-selected aim without guessed coordinates');
  for (const options of [{ reject: true }, { missingTarget: true }, { overlay: true }]) {
    await setup(options); assert.equal(await cast(), false);
    assert.ok(!(await trace()).some(x => x.startsWith('cast:') || x === 'space'), 'no cast or Space fallback during unconfirmed selection');
    assert.equal(await page.evaluate(() => window.__jvzFish.pendingCast), false);
    if (!options.overlay) assert.equal(await page.locator('.fish-spots').count(), 0, 'close only our own spot sheet');
  }
  console.log('PASS fishing spot: trusted selection, confirmation, repeated casts, hunts, missing UI and failure safety');
} finally { await browser.close(); }
