import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { createSession } from "../src/lib/quest-engine/session.mjs";

// Real transport: Playwright emits {payload: string | Buffer}, not a raw frame.
const { WebSocketServer } = createRequire(import.meta.url)("next/dist/compiled/ws");
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise(resolve => server.once("listening", resolve));
const timers = [];
let sending = true, browser, wireSocket;
server.on("connection", socket => {
  wireSocket = socket;
  socket.send('42["hello",{"me":{"id":7}}]');
  socket.send('42["g:evt",{"type":"reel"}]');
  let tick = 0;
  timers.push(setInterval(() => {
    if (!sending || socket.readyState !== 1) return;
    const frame = '42["g:snap",' + JSON.stringify({t: ++tick * .066, z: .2, f: .8, fv: 0, p: .3, zone: .26}) + ']';
    socket.send(tick % 2 ? frame : Buffer.from(frame));
  }, 66));
});
try {
  try { browser = await chromium.launch({ headless: true, channel: "chromium" }); }
  catch (error) {
    if (!/Executable doesn't exist/.test(String(error))) throw error;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const page = await browser.newPage(), received = [], sent = [];
  page.on("websocket", socket => {
    socket.on("framereceived", event => received.push(event));
    socket.on("framesent", event => sent.push(event));
  });
  const messages = [];
  const session = createSession(page, {baseUrl: "https://example.invalid",
    minActionDelayMs: 0, maxActionDelayMs: 1, log: {debug:()=>{},info:m=>messages.push(m),warning:()=>{}}});
  session.beginFishingTelemetry();
  await page.setContent('<div class="fish-room"><button class="fish-main st-reel" style="width:200px;height:100px">Reel</button></div>');
  await page.evaluate(port => {
    window.__test = {down:0,up:0,space:0};
    const button = document.querySelector("button");
    button.addEventListener("pointerdown", e => {if(e.isTrusted) window.__test.down++;});
    button.addEventListener("pointerup", e => {if(e.isTrusted) window.__test.up++;});
    document.addEventListener("keydown", e => {if(e.isTrusted && e.code==="Space") window.__test.space++;});
    return new Promise(resolve => {
      window.socket = new WebSocket("ws://127.0.0.1:"+port+"/socket.io/");
      window.socket.onopen = resolve;
    });
  }, server.address().port);
  await page.waitForTimeout(150);
  const started = Date.now();
  await session.fishingReel(() => Date.now()-started > 550);
  const input = await page.evaluate(() => window.__test);
  assert.ok(received.some(e=>typeof e.payload === "string"), "real text event payload");
  assert.ok(received.some(e=>Buffer.isBuffer(e.payload)), "real binary event payload");
  assert.ok(input.down > 0, "actual Playwright frame envelopes must cause trusted reel holding");
  assert.equal(input.up, input.down, "release every hold on exit");
  console.log("PASS real Playwright text/binary WebSocket envelopes drive trusted reel input");
  wireSocket.send('42["g:evts",[{"type":"catch","uid":999},{"type":"catch","uid":7},{"type":"catch","uid":7}]]');
  await page.waitForTimeout(100);
  assert.equal(messages.filter(m=>m.includes("server xác nhận bắt thành công")).length,1,
    "report exactly one authenticated self catch, not another player or duplicate");
  assert.ok(messages.some(m=>/bám lực:.*bắt được.*đã vào điều khiển/.test(m)),
    "terminal diagnostics must prove controller entry, not infer it from a catch");
  wireSocket.send('42["g:evts",[{"type":"reel","t":0,"z":0.5,"f":0.5,"zone":0.3,"p":0.3},{"type":"escaped"},{"type":"catch","uid":7}]]');
  await page.waitForTimeout(100);
  assert.equal(messages.filter(m=>m.includes("server xác nhận bắt thành công")).length,1,
    "late catch after terminal escape cannot manufacture success");
  assert.ok(messages.some(m=>/bám lực:.*cá thoát.*chưa vào điều khiển/.test(m)),
    "terminal diagnostics distinguish a fight that never entered the servo");
  assert.match(messages.filter(m=>m.includes("bám lực:")).at(-1), /tiến độ tối đa 30%/,
    "batched immediate escape preserves initial authoritative reel progress");
  console.log("PASS server-confirmed catch evidence is scoped to authenticated self and active fight");
  wireSocket.send('42["g:evt",{"type":"reel"}]');
  await page.waitForTimeout(50);
  const move = page.mouse.move;
  page.mouse.move = async () => { throw new Error("fixture: input move unavailable"); };
  try { await session.fishingReel(); } finally { page.mouse.move = move; }
  wireSocket.send('42["g:evt",{"type":"escaped"}]');
  await page.waitForTimeout(50);
  assert.match(messages.filter(m=>m.includes("bám lực:")).at(-1), /chưa vào điều khiển/,
    "failed input setup must not claim controller loop entry");
  console.log("PASS fight diagnostics do not confuse failed input setup with active control");
  sending = false;
  await page.evaluate(() => {
    const button = document.querySelector("button");
    button.className = "fish-main st-idle jvz-fish-press";
    window.__jvzFish = {pendingCast:false,castFailure:"",retryAfter:0};
    button.addEventListener("pointerup", e => {
      if(e.isTrusted) window.socket.send('42["g:act",{"a":"cast"}]');
    });
  });
  assert.equal(await session.click(".fish-main.st-idle.jvz-fish-press",1000,false,90), false);
  assert.ok(sent.some(e=>String(e.payload).includes('"a":"cast"')), "real framesent envelope");
  const state = await page.evaluate(() => ({fish:window.__jvzFish,input:window.__test}));
  assert.match(state.fish.castFailure,/sent-but-idle/,"decode outbound envelope for precise cast diagnostic");
  assert.equal(state.input.space,0,"no duplicate Space fallback after confirmed outbound cast");
  console.log("PASS real Playwright framesent envelope confirms cast transport without duplicate Space");
} finally {
  for(const timer of timers) clearInterval(timer);
  await browser?.close();
  for(const socket of server.clients) socket.terminate();
  await new Promise(resolve=>server.close(resolve));
}
