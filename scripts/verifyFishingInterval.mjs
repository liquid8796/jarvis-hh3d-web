#!/usr/bin/env -S npx tsx
/** Full config -> both profile twins -> real engine/session -> isolated browser regression. */
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { configSchema } from "../src/lib/services/configs.ts";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";

const html = (capacity, perCast, firstFull = false) => `<!doctype html><meta charset="utf-8">
<style>button{min-width:100px;min-height:40px}.sheet{position:fixed;inset:50px;background:white;z-index:10}</style>
<div id="app"><div class="view fish-room">
<div class="room-top"><button aria-label="Rời phòng">Rời phòng</button></div>
<button class="fish-quick-bag"><span class="fish-badge">1/${capacity}</span></button>
<button class="fish-main st-idle">Ném câu</button></div></div>
<script>
window.trace=[];window.gameAuto=true;let casts=0,nextId=2,fish=[{id:1}],pressed=false;
const main=document.querySelector(".fish-main"),cap=${capacity},perCast=${perCast},firstFull=${firstFull};
const mark=(type,extra={})=>window.trace.push({type,casts,phase:main.className,...extra});
const badge=()=>document.querySelector(".fish-badge").textContent=fish.length+"/"+cap;
function renderBag(){
 let sheet=document.querySelector(".sheet");if(!sheet){sheet=document.createElement("div");sheet.className="sheet";document.body.append(sheet)}
 sheet.innerHTML='<div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-bag"><div class="fish-bag-head">Giỏ</div><div class="fish-bag-auto"><button class="notif-toggle '+(window.gameAuto?'on':'')+'" aria-checked="'+window.gameAuto+'">Tự bán</button></div><div class="fish-bag-grid"></div><div class="fish-bag-bar"></div></div>';
 sheet.querySelector(".sheet-head button").onclick=()=>{mark("close");sheet.remove()};
 const auto=sheet.querySelector(".notif-toggle");auto.onclick=()=>{window.gameAuto=!window.gameAuto;auto.classList.toggle("on",window.gameAuto);auto.setAttribute("aria-checked",String(window.gameAuto));mark("auto",{on:window.gameAuto})};
 const grid=sheet.querySelector(".fish-bag-grid"),bar=sheet.querySelector(".fish-bag-bar");
 const barRender=()=>{
  bar.replaceChildren();const selected=[...grid.querySelectorAll(".on")];if(!selected.length)return;
  const sell=document.createElement("button");sell.textContent="Bán "+selected.length+" con · +"+selected.length*4;
  sell.onclick=()=>{const ids=new Set(selected.map(c=>+c.dataset.id));mark("sale",{count:ids.size});setTimeout(()=>{fish=fish.filter(f=>!ids.has(f.id));badge();renderBag()},80)};
  bar.append(sell);
 };
 for(const item of fish){const card=document.createElement("button");card.className="fish-bag-item fish-card";card.dataset.id=item.id;card.textContent="Cá "+item.id+" +4";card.onclick=()=>{card.classList.toggle("on");barRender()};grid.append(card)}
}
document.querySelector(".fish-quick-bag").onclick=()=>{mark("open");renderBag()};
main.onpointerdown=e=>{if(e.isTrusted&&main.classList.contains("st-idle"))pressed=true};
main.onpointerup=e=>{
 if(!e.isTrusted||!pressed||!main.classList.contains("st-idle"))return;pressed=false;
 if(document.querySelector(".sheet")){mark("unsafe-cast");return}
 casts++;mark("cast");main.className="fish-main st-wait";main.textContent="Chờ cá";
 setTimeout(()=>{for(let i=0;i<(firstFull&&casts===1?cap:perCast);i++)fish.push({id:nextId++});badge();main.className="fish-main st-idle";main.textContent="Ném câu"},800);
};
</script>`;
let scenario={capacity:30,perCast:1};
const server=http.createServer((_req,res)=>{res.setHeader("content-type","text/html; charset=utf-8");res.end(html(scenario.capacity,scenario.perCast,scenario.firstFull))});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const baseUrl="http://127.0.0.1:"+server.address().port;
let browser;
try {
 try {browser=await chromium.launch({headless:true,channel:"chromium"})}
 catch(error){if(!/Executable doesn't exist/i.test(String(error)))throw error;browser=await chromium.launch({headless:true,channel:"chrome"})}
 for(const test of [
  {name:"n=2",n:2,limit:4,expected:[0,2,4]},
  {name:"n=1 free",n:1,limit:2,free:true,expected:[0,1,2]},
  {name:"legacy default",limit:5,expected:[0,5]},
  {name:"full basket override",n:50,limit:2,capacity:3,perCast:3,expected:[0,1,2]},
  {name:"interval resets after safety sale",n:2,limit:3,firstFull:true,expected:[0,1,3]},
 ]) {
  scenario={capacity:test.capacity??30,perCast:test.perCast??1,firstFull:test.firstFull??false};
  const page=await browser.newPage(),errors=[],logs=[];
  page.on("pageerror",e=>errors.push(String(e)));
  const log=Object.fromEntries(["info","debug","warning","error"].map(level=>[level,(...args)=>logs.push(args.join(" "))]));
  const config=configSchema.parse({quests:{cauCa:{enabled:true,sellBelow:4,castLimit:test.limit,...(test.n===undefined?{}:{sellEveryCasts:test.n})}}});
  const profile=profileForConfig(config),quest=profile.quests.find(q=>q.id===(test.free?"cau-ca-thuong":"cau-ca"));
  const session=createSession(page,{baseUrl,log,minActionDelayMs:0,maxActionDelayMs:1,pageTimeoutMs:5000});
  const start=Date.now(),engine=createQuestEngine({log,shouldStop:()=>Date.now()-start>25000});
  const outcome=await engine.run(session,profile,quest);
  const trace=await page.evaluate(()=>window.trace);
  assert.equal(outcome.outcome,"completed",test.name+": "+JSON.stringify(outcome));
  assert.deepEqual(errors,[]);
  assert.deepEqual(trace.filter(e=>e.type==="sale").map(e=>e.casts),test.expected,test.name+" sells before first cast then every n accepted casts");
  assert.equal(trace.filter(e=>e.type==="cast").length,test.limit);
  assert.equal(trace.some(e=>e.type==="unsafe-cast"),false);
  assert.equal(trace.some(e=>e.type==="open"&&!e.phase.includes("st-idle")),false,"never open basket mid-fight");
  assert.equal(await page.evaluate(()=>window.gameAuto),false,"disable native immediate sales so they cannot bypass n");
  console.log("PASS interval full pipeline "+test.name+" -> sales at "+test.expected.join(","));
  await page.close();
 }
 const page=await browser.newPage();
 const source=readFileSync(new URL("../src/lib/quest-engine/fishingTick.js",import.meta.url),"utf8")
  .replaceAll("{{sellBelow}}","4").replaceAll("{{castLimit}}","0").replaceAll("{{sellEveryCasts}}","5").replaceAll("{{spot}}","giua");
 await page.setContent('<div class="view fish-room"><button class="fish-main st-idle">Ném câu</button><button class="fish-quick-bag"><span class="fish-badge">1/30</span></button></div>');
 await page.evaluate(()=>{window.__jvzFish=undefined;window.opened=0;document.querySelector(".fish-quick-bag").onclick=()=>window.opened++});
 const tick=()=>page.evaluate("("+source+")()");
 await tick();await tick();
 assert.equal(await page.locator(".jvz-fish-press").count(),0,"first sale/check cannot be bypassed by a slow basket open");
 assert.equal(await page.evaluate(()=>window.__jvzFish.bagChecked),false);
 assert.equal(await page.evaluate(()=>window.opened),1,"throttle repeated opener clicks");
 console.log("PASS initial basket must finish loading/checking before first cast");
 await page.setContent('<div class="view fish-room"><button class="fish-main st-idle">Ném câu</button></div>');
 await page.evaluate(()=>{window.__jvzFish=undefined});
 assert.match(await tick(), /Chưa mở được giỏ/);
 assert.equal(await page.locator(".jvz-fish-press").count(),0,"missing basket opener cannot skip the first sale check");
 console.log("PASS missing initial basket opener backs off without casting");
 await page.close();
} finally {
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
