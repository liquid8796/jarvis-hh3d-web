/** Offline only: privacy, bounded capture, retention, and the real session boundary. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const root = await mkdtemp(path.join(os.tmpdir(), "fishing-diagnostics-test-"));
process.chdir(root); // Never write test evidence into an installed worker's diagnostics.
const { createSession } = await import("../src/lib/quest-engine/session.mjs");
const hook = ".fish-room .fish-main.st-bite.jvz-fish-press";
const privateError = new Error('page.click: Timeout 2500ms exceeded.\nCall log:\n' +
  ' - waiting for locator("' + hook + '")\n' +
  ' - locator resolved to <button data-token="secretToken">PRIVATE NAME</button>\n' +
  ' - attempting click action\n' +
  ' - waiting for element to be visible, enabled and stable\n' +
  ' - element is not stable\n' +
  ' - <div title="https://user:secretPassword@host.invalid/?token=secretToken">PRIVATE CHAT</div> intercepts pointer events\n' +
  ' - retrying click action, attempt #2\n' +
  ' - waiting 20ms\n' +
  ' - https://host.invalid/private?token=secretToken\n' +
  ' - waiting for element to be visible, enabled and stable\n');
const logs = [];
const log = { debug: m => logs.push(m), info() {}, warning() {} };
let clicks = 0, observations = 0;
const failedPage = {
  async click(selector, options) {
    clicks++;
    assert.equal(selector, hook);
    assert.deepEqual(options, { timeout: 2500, force: false, delay: 120 });
    throw privateError;
  },
  evaluate() { observations++; throw Error("observation private failure"); },
  isClosed: () => false
};
assert.equal(await createSession(failedPage, { baseUrl: "https://example.invalid", log }).click(hook, 2500, false, 120), false);
assert.equal(clicks, 1, "a failed hook never retries or changes the click options");
assert.ok(!logs.join("\n").match(/secretToken|secretPassword|PRIVATE|host\.invalid/),
  "failed-hook logs must not transmit DOM text, credentials or URLs");
assert.match(logs.join("\n"), /element is not stable/);
assert.match(logs.join("\n"), /intercepts pointer events/);
assert.equal(observations, 1, "failed hook captures a passive observation");

const { createFishingClickDiagnostics, sanitizeFishingClickError } =
  await import("../src/lib/quest-engine/fishingClickDiagnostics.mjs");
const safe = sanitizeFishingClickError(privateError);
assert.match(safe, /element is not stable/);
assert.match(safe, /intercepts pointer events/);
assert.match(safe, /retrying click action/);
assert.ok(safe.split("\n").length >= 10, "retain the bounded chronological call log, not first/last three lines");
assert.ok(!safe.match(/secretToken|secretPassword|PRIVATE|host\.invalid|data-token/));
assert.ok(sanitizeFishingClickError("PRIVATE".repeat(20000)).length < 14000);
assert.ok(!sanitizeFishingClickError({ toString() { throw Error("bad"); } }).includes("bad"));
const grouped = sanitizeFishingClickError("Call log:\n  5 × element is not stable\n  2 × waiting for element to be visible, enabled and stable");
assert.match(grouped, /5 x element is not stable/, "grouped Playwright reason must survive sanitization");
assert.match(grouped, /2 x waiting for element to be visible, enabled and stable/);

let otherObservations = 0;
const otherLogs = [];
const otherPage = {
  async click(selector, opts) {
    assert.equal(selector, "#other"); assert.deepEqual(opts, { timeout: 30, force: true, delay: 1000 });
    throw Error("ordinary fixture failure");
  },
  async evaluate() { otherObservations++; }
};
assert.equal(await createSession(otherPage, { baseUrl: "", log: { ...log, debug: m => otherLogs.push(m) } }).click("#other", 30, true, 2000), false);
assert.equal(otherObservations, 0, "non-hook clicks must not capture diagnostics");
assert.match(otherLogs[0], /ordinary fixture failure/);
assert.equal(await createSession({ async click() {} }, { baseUrl: "", log }).click(hook, 30), true,
  "successful hook needs no page observation");
assert.equal(await createSession(failedPage, { baseUrl: "", log: { ...log, debug() { throw Error("logger"); } } }).click(hook, 2500, false, 120), false,
  "diagnostic logging cannot replace original false result");

// The normal singleton is shared across createSession calls.
assert.equal(observations, 1, "a second failed hook in another session is throttled process-wide");

let browser;
try {
  try { browser = await chromium.launch({ headless: true, channel: "chromium" }); }
  catch (error) {
    if (!/Executable doesn't exist/.test(String(error))) throw error;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route("**/*", route => route.abort()); // no network, no live game
  await page.setContent('<style>button{position:absolute;left:100px;top:100px;width:180px;height:80px}' +
    '#cover{position:absolute;left:130px;top:110px;width:140px;height:60px;z-index:4;background:red}</style>' +
    '<div class="fish-room"><button class="fish-main st-bite jvz-fish-press">Giật!</button></div>' +
    '<div id="cover" data-token="secretToken">PRIVATE CHAT<input value="secretPassword"></div>' +
    '<p>PRIVATE NAME</p><script>window.actions=0;document.addEventListener("pointerdown",()=>window.actions++)</script>');
  let realError;
  try { await page.click(hook, { timeout: 180 }); } catch (error) { realError = error; }
  assert.ok(realError, "fixture must fail a real actionability check");
  const directory = path.join(root, "real");
  let now = 120000;
  const diagnostics = createFishingClickDiagnostics({ directory, now: () => now });
  const capture = await diagnostics.capture(page, realError);
  assert.equal(capture.status, "saved");
  const record = JSON.parse(await readFile(path.join(directory, capture.record), "utf8"));
  assert.match(record.callLog, /intercepts pointer events/);
  assert.equal(record.observation.button.enabled, true);
  assert.equal(record.observation.button.bounds.width, 180);
  assert.equal(record.observation.hitTest.acceptsPointer, false);
  assert.equal(record.observation.hitTest.element.tag, "input");
  assert.ok(!JSON.stringify(record).match(/PRIVATE|secretToken|secretPassword|cover|data-token/));
  assert.equal(record.screenshot, capture.image);
  const png = await readFile(path.join(directory, capture.image));
  assert.equal(png.readUInt32BE(16), 192, "screenshot is a tight crop, not the full page");
  assert.equal(png.readUInt32BE(20), 92);
  assert.ok(png.length < 100000);
  if (process.platform !== "win32") {
    assert.equal((await stat(path.join(directory, capture.image))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(directory, capture.record))).mode & 0o777, 0o600);
  }
  assert.equal(await page.evaluate(() => window.actions), 0, "diagnostics send no game input");

  // The screenshot API receives masks, no animation disabling, and a finite timeout.
  let screenshotOptions;
  const maskedPage = {
    isClosed: () => false,
    evaluate: (...args) => page.evaluate(...args),
    locator: (...args) => page.locator(...args),
    async screenshot(opts) { screenshotOptions = opts; return page.screenshot(opts); }
  };
  now += 60001;
  await diagnostics.capture(maskedPage, realError);
  assert.ok(screenshotOptions.mask.length >= 2);
  assert.equal(screenshotOptions.fullPage, false);
  assert.equal(screenshotOptions.animations, "allow");
  assert.ok(screenshotOptions.timeout > 0 && screenshotOptions.timeout <= 400);

  // Change only private pixels; the saved masked image must remain byte-for-byte identical.
  const beforePrivateChange = await page.screenshot(screenshotOptions);
  await page.evaluate(() => {
    document.querySelector("#cover").firstChild.textContent = "OTHER SECRET";
    document.querySelector("input").value = "different-password";
    document.querySelector("p").textContent = "ANOTHER PRIVATE NAME";
  });
  assert.deepEqual(await page.screenshot(screenshotOptions), beforePrivateChange,
    "private overlay text and input values must not change any saved image pixel");

  const failedScreenshot = createFishingClickDiagnostics({ directory: path.join(root, "failed-shot") });
  const failedShot = await failedScreenshot.capture({ ...maskedPage,
    async screenshot() { throw Error("PRIVATE screenshot failure"); }
  }, realError);
  assert.equal(failedShot.status, "saved", "screenshot failure preserves observation and call log");
  const failedRecord = JSON.parse(await readFile(path.join(root, "failed-shot", failedShot.record), "utf8"));
  assert.equal(failedRecord.screenshot, null);
  assert.equal(failedRecord.observationStatus, "observed");
  assert.ok(!JSON.stringify(failedRecord).includes("PRIVATE"));

  let screenshotCalls = 0, finishScreenshot;
  const hungScreenshot = createFishingClickDiagnostics({ directory: path.join(root, "hung-shot") });
  const hungShotPage = { ...maskedPage, screenshot() {
    screenshotCalls++; return new Promise(resolve => { finishScreenshot = resolve; });
  } };
  assert.equal((await hungScreenshot.capture(hungShotPage, realError)).status, "timeout");
  assert.equal((await hungScreenshot.capture(hungShotPage, realError)).status, "busy");
  assert.equal(screenshotCalls, 1, "pending screenshot work cannot accumulate");
  finishScreenshot(Buffer.alloc(100));
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal((await diagnostics.capture(page, realError)).status, "throttled");
  // Fixed names stay bounded across sessions AND freshly constructed instances (worker restarts).
  await writeFile(path.join(directory, "user-owned.txt"), "keep");
  for (let i = 0; i < 7; i++) {
    now += 60001;
    const restarted = createFishingClickDiagnostics({ directory, now: () => now });
    assert.equal((await restarted.capture(page, realError)).status, "saved");
  }
  const owned = (await readdir(directory)).filter(name => /^hook-\d\.(json|png)$/.test(name));
  assert.ok(owned.length <= 8, "at most four JSON/image pairs across restarts");
  assert.ok((await Promise.all(owned.map(name => stat(path.join(directory, name))))).reduce((n, s) => n + s.size, 0) < 450000);
  assert.equal(await readFile(path.join(directory, "user-owned.txt"), "utf8"), "keep");

  // Ordinary game gradients remain eligible; only CSS media is unsafe.
  await page.setContent('<div class="fish-room"><button class="fish-main st-bite" style="width:180px;height:80px;background:linear-gradient(red,blue)">Giật!</button></div>');
  now += 60001;
  assert.ok((await diagnostics.capture(page, privateError)).image, "normal gradient controls remain eligible");

  // Generated text, CSS media and shadow content cannot escape the light-DOM masks.
  for (const visual of ["pseudo", "background", "shadow"]) {
    await page.setContent('<div class="fish-room"><button class="fish-main st-bite jvz-fish-press" style="width:180px;height:80px"><span></span></button></div>');
    await page.evaluate(visual => {
      const child = document.querySelector(".fish-main span");
      if (visual === "pseudo") {
        const style = document.createElement("style");
        style.textContent = '.fish-main span::after{content:"PRIVATE GENERATED LABEL"}';
        document.head.append(style);
      } else if (visual === "background") {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>PRIVATE</text></svg>';
        child.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
        if (!getComputedStyle(child).backgroundImage.includes("url(")) throw Error("invalid image fixture");
      } else child.attachShadow({ mode: "open" }).textContent = "PRIVATE SHADOW LABEL";
    }, visual);
    now += 60001;
    const captured = await diagnostics.capture(page, privateError);
    const observed = JSON.parse(await readFile(path.join(directory, captured.record), "utf8"));
    assert.equal(observed.screenshot, null, visual + " content must skip screenshots conservatively");
    assert.equal(observed.observation.button.bounds.width, 180, "safe metadata remains available");
    assert.ok(!JSON.stringify(observed).includes("PRIVATE"));
  }

  let unsafeScreenshots = 0;
  const untrustedPage = { isClosed: () => false, async evaluate() {
    return { visibilityState: "PRIVATE", privateField: "PRIVATE".repeat(10000),
      screenshotSafety: "safe", clip: { x: 0, y: 0, width: 8000, height: 8000 },
      button: { tag: "PRIVATE", states: Array(10000).fill("PRIVATE"), display: "PRIVATE",
        enabled: "PRIVATE", bounds: { x: Infinity, y: 0, width: 180, height: 80 }, rawHtml: "PRIVATE" },
      hitTest: { acceptsPointer: "PRIVATE", element: { tag: "input", rawHtml: "PRIVATE" } }
    };
  }, async screenshot() { unsafeScreenshots++; return Buffer.alloc(100); } };
  const untrustedDir = path.join(root, "untrusted");
  const untrusted = await createFishingClickDiagnostics({ directory: untrustedDir }).capture(untrustedPage, privateError);
  const untrustedText = await readFile(path.join(untrustedDir, untrusted.record), "utf8");
  assert.equal(unsafeScreenshots, 0, "untrusted oversized crop must never reach screenshot API");
  assert.ok(!untrustedText.includes("PRIVATE"), "page-owned extra properties and arbitrary strings are discarded");
  assert.ok(untrustedText.length < 16000, "malformed page observation cannot inflate retained JSON");

  await page.setContent('<div class="fish-room"><button class="fish-main st-bite" style="width:180px;height:80px">Giật!</button></div>');
  const navigating = new EventEmitter(), mainFrame = {};
  Object.assign(navigating, {
    isClosed: () => false, mainFrame: () => mainFrame,
    evaluate: (...args) => page.evaluate(...args), locator: (...args) => page.locator(...args),
    async screenshot() { navigating.emit("framenavigated", mainFrame); return Buffer.alloc(100); }
  });
  const navDir = path.join(root, "navigation");
  const nav = await createFishingClickDiagnostics({ directory: navDir }).capture(navigating, privateError);
  const navRecord = JSON.parse(await readFile(path.join(navDir, nav.record), "utf8"));
  assert.equal(navRecord.screenshot, null, "navigation during screenshot invalidates its privacy masks");
  assert.equal(navigating.listenerCount("framenavigated"), 0);
  assert.equal(navigating.listenerCount("close"), 0);

  // A wrong/login page must not produce an image, even when its inputs sit at the old crop.
  await page.setContent('<input value="secretPassword"><p>PRIVATE CHAT</p>');
  now += 60001;
  const wrong = await diagnostics.capture(page, privateError);
  const wrongRecord = JSON.parse(await readFile(path.join(directory, wrong.record), "utf8"));
  assert.equal(wrongRecord.observation.button, null);
  assert.equal(wrongRecord.screenshot, null);
  assert.ok(!JSON.stringify(wrongRecord).match(/secretPassword|PRIVATE/));

  const closed = await browser.newPage();
  await closed.close();
  const closing = createFishingClickDiagnostics({ directory: path.join(root, "closed") });
  assert.equal((await closing.capture(closed, privateError)).status, "closed");
} finally { await browser?.close(); }

// A non-settling read cannot hang cancellation or accumulate more in-flight reads.
let resolveRead, hangingReads = 0;
const hanging = Object.assign(new EventEmitter(), { isClosed: () => false, evaluate() {
  hangingReads++; return new Promise(resolve => { resolveRead = resolve; });
} });
let hangNow = 0;
const stalled = createFishingClickDiagnostics({ directory: path.join(root, "stalled"), now: () => hangNow });
const started = performance.now();
assert.equal((await stalled.capture(hanging, privateError)).status, "timeout");
assert.ok(performance.now() - started < 1200, "total diagnostic caller delay stays bounded");
assert.equal(hanging.listenerCount("framenavigated"), 0, "timeout removes capture listeners even if read never settles");
assert.equal(hanging.listenerCount("close"), 0);
hangNow += 60001;
assert.equal((await stalled.capture(hanging, privateError)).status, "busy");
assert.equal(hangingReads, 1);
resolveRead(null);
await new Promise(resolve => setTimeout(resolve, 20));

const brokenDir = path.join(root, "not-a-directory");
await writeFile(brokenDir, "keep");
assert.equal((await createFishingClickDiagnostics({ directory: brokenDir }).capture(failedPage, privateError)).status, "unavailable");
assert.equal(await readFile(brokenDir, "utf8"), "keep");
console.log("PASS fishing hook diagnostics: real blocked click, privacy, masks/crop, no retries, global throttle, restart ring, closed pages, hung reads, disk failure");
console.log("Offline test artifacts: " + root);

