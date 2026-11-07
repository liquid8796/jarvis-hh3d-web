import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { createFishingSaleJournal } from "../src/lib/quest-engine/fishingJournal.mjs";

// Real Socket.IO text/binary envelopes; all traffic stays on loopback.
const { WebSocketServer } = createRequire(import.meta.url)("next/dist/compiled/ws");
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise(resolve => server.once("listening", resolve));
const sockets = [];
server.on("connection", socket => sockets.push(socket));
let browser;
try {
  try { browser = await chromium.launch({headless:true,channel:"chromium"}); }
  catch(error) {
    if(!/Executable doesn't exist/.test(String(error))) throw error;
    browser = await chromium.launch({headless:true,channel:"chrome"});
  }
  const page = await browser.newPage(), messages = [];
  const session = createSession(page, {baseUrl:"http://127.0.0.1", minActionDelayMs:0,maxActionDelayMs:1,
    log:{info:m=>messages.push(m),debug:()=>{},warning:()=>{}}});
  session.beginFishingTelemetry();
  const connect = async () => {
    await page.evaluate(port => new Promise(resolve => {
      window.ws = new WebSocket("ws://127.0.0.1:"+port+"/socket.io/");
      window.ws.onopen = resolve;
    }), server.address().port);
    await page.waitForTimeout(30);
  };
  await connect();
  const receive = async (raw, binary=false) => {
    sockets.at(-1).send(binary ? Buffer.from(raw) : raw); await page.waitForTimeout(40);
  };
  const event = async data => receive('42["g:evt",'+JSON.stringify(data)+']');
  const send = async raw => {
    await page.evaluate(raw=>window.ws.send(raw),raw); await page.waitForTimeout(40);
  };
  await receive('42["hello",{"me":{"id":7}}]');
  await event({type:"reel"});
  await event({type:"catch",uid:999,f:"ca_chep",price:4});
  assert.deepEqual(messages, [], "never report another player's fish");
  await event({type:"catch",uid:7,f:"ca_chep:bachngoc",price:4});
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Cá Chép Đỏ · Bạch Ngọc/, "resolve the exact caught species and variant");
  assert.match(messages[0], /giá bán \+4 Linh Thạch/, "the observed price is not fish power");
  assert.ok(!messages[0].includes("ngư lực"));
  await event({type:"catch",uid:7,f:"ca_chep:bachngoc",price:4});
  assert.equal(messages.length,1,"one result per authenticated fight");
  await event({type:"reel"});
  await event({type:"catch",uid:7,f:"unknown_future_fish"});
  assert.match(messages.at(-1),/chưa rõ tên/);
  assert.ok(!messages.at(-1).includes("+0"),"missing values are not invented");
  await send('421["g:act",{"a":"bag"}]');
  await receive('431[{"ok":true,"items":[{"id":11,"f":"ca_chep","price":4},{"id":12,"f":"ca_ro","price":4},{"id":13,"f":"ca_bang","price":8}],"cap":30,"wallet":{"lt":9000}}]');
  const beforeSale=messages.length;
  await send('422["g:act",{"a":"sell","ids":[11,12,13]}]');
  assert.equal(messages.length,beforeSale,"click/request is not a completed sale");
  await receive('43999[{"ok":true,"sold":[11,12,13],"total":16}]');
  assert.equal(messages.length,beforeSale,"unrelated ACK is not a sale");
  await receive('432[{"ok":true,"sold":[11,13],"n":2,"total":10,"stop":"cap","items":[{"id":12,"f":"ca_ro","price":4}]}]',true);
  assert.equal(messages.length,beforeSale+1);
  assert.match(messages.at(-1),/Đã bán 2 cá/);
  assert.match(messages.at(-1),/\+4: 1 cá/);
  assert.match(messages.at(-1),/\+8: 1 cá/);
  assert.match(messages.at(-1),/thu 10 Linh Thạch/,"use server proceeds, not summed sticker prices");
  assert.match(messages.at(-1),/hạn mức/,"partial cap is visible");
  await receive('432[{"ok":true,"sold":[11,13],"total":10}]');
  assert.equal(messages.length,beforeSale+1,"duplicate ACK cannot repeat revenue");
  await send('423["g:act",{"a":"sell","ids":[12]}]');
  await receive('433[{"ok":false,"err":"held","sold":[],"total":0}]');
  assert.equal(messages.length,beforeSale+1,"failed sale never reports sold fish");
  await send('424["g:act",{"a":"sell","ids":[12,999]}]');
  await receive('434[{"ok":true,"sold":[12,999],"n":2}]');
  assert.match(messages.at(-1),/\+4: 1 cá/);
  assert.match(messages.at(-1),/chưa rõ giá: 1 cá/);
  assert.match(messages.at(-1),/chưa rõ số Linh Thạch/);
  const beforeMissingSold=messages.length;
  await send('4224["g:act",{"a":"sell","ids":[12]}]');
  await receive('4324[{"ok":true,"n":25,"total":4}]');
  assert.equal(messages.length,beforeMissingSold+1);
  assert.match(messages.at(-1),/chưa rõ số cá/,"ACK n is not a verified sold count");
  assert.ok(!messages.at(-1).includes("25 cá"));
  assert.match(messages.at(-1),/thu 4 Linh Thạch/);
  await send('4225["g:act",{"a":"sell","ids":[12]}]');
  await receive('4325[{"ok":true,"sold":[],"n":25,"total":0}]');
  assert.equal(messages.length,beforeMissingSold+1,"empty sold is not remaining bag count");
  await event({type:"reel"});
  await event({type:"bag",n:1,cap:30,auto:{how:"sold",now:true,f:"ca_chep",price:4}});
  assert.match(messages.at(-1),/Tự bán 1 cá/);
  assert.match(messages.at(-1),/\+4: 1 cá/);
  assert.match(messages.at(-1),/thu 4 Linh Thạch/);
  const afterAuto=messages.length;
  await event({type:"bag",n:1,cap:30,auto:{how:"sold",now:true,f:"ca_chep",price:4}});
  assert.equal(messages.length,afterAuto,"duplicate auto-sale event in same fight");
  await receive('42["g:evts",[{"type":"reel"},{"type":"bag","auto":{"how":"sold","now":true,"f":"ca_chep","price":4}}]]');
  assert.equal(messages.length,afterAuto,"replayed reel and bag batch is not a second receipt");
  await event({type:"st",uid:7,s:"idle"});
  await event({type:"reel"});
  await event({type:"bag",n:1,cap:30,auto:{how:"sold",now:true,f:"ca_chep",price:4}});
  assert.equal(messages.length,afterAuto+1,"same species/price on next fight is a new sale");
  await event({type:"bag",sync:true,auto:{how:"sold",f:"ca_chep",price:4}});
  await event({type:"bag",auto:{how:"cap",f:"ca_chep",price:4}});
  assert.equal(messages.length,afterAuto+1,"sync/cap events are not fresh sales");
  await send('425["g:act",{"a":"bag"}]');
  await receive('435[{"ok":true,"items":[],"pend":{"f":"ca_chep","price":6}}]');
  await send('426["g:act",{"a":"settle","how":"sell"}]');
  await receive('436[{"ok":true,"total":6}]');
  assert.match(messages.at(-1),/Đã bán 1 cá/);
  assert.match(messages.at(-1),/\+6: 1 cá/);
  await send('427["g:act",{"a":"sell","ids":[12]}]');
  const beforeReconnect=messages.length;
  await page.evaluate(()=>window.ws.close()); await page.waitForTimeout(40); await connect();
  await receive('42["hello",{"me":{"id":7}}]');
  await receive('437[{"ok":true,"sold":[12],"total":4}]');
  assert.equal(messages.length,beforeReconnect,"old pending requests are discarded on reconnect");
  const oldSocket=sockets.at(-1);
  await connect();
  await receive('42["hello",{"me":{"id":7}}]');
  oldSocket.send('42["g:evts",[{"type":"reel"},{"type":"bag","auto":{"how":"sold","price":99}}]]');
  await receive('42[broken');
  await receive('43bad[{}]');
  await page.waitForTimeout(40);
  assert.equal(messages.length,beforeReconnect,"old live socket and malformed frames cannot add receipts");
  const expired=[], journal=createFishingSaleJournal({info:m=>expired.push(m)},()=>clock);
  let clock=0;
  journal.received('42["hello",{"me":{"id":7}}]');
  journal.sent('421["g:act",{"a":"sell","ids":[1]}]');
  clock=60001;
  journal.received('431[{"ok":true,"sold":[1],"total":4}]');
  assert.deepEqual(expired,[],"expired requests cannot create late receipts");
  console.log("PASS fishing journal: exact names, price semantics, partial/failed sales, server totals, duplicate suppression, auto-sale, settle and reconnect");
} finally {
  await browser?.close();
  for(const socket of server.clients) socket.terminate();
  await new Promise(resolve=>server.close(resolve));
}
