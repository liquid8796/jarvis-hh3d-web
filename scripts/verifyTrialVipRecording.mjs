#!/usr/bin/env node
/**
 * Offline reproduction of the 15/11/2026 VIP Thí Luyện recording.
 *
 * Record: thi-luyen-tong-mon-20261115-004159:
 *   #tlPage ready + #tlLeft=3 -> click #tlScroll
 *   POST hh3d-ajax.php (action ac2e013b) success:true, 68 Tinh Thạch
 *   #tlLeft=2 while reveal animates, then page cooldown and #tlClock=07:26
 *   GET remaining time (action ed986282) returns 07:26.
 * We deliberately simulate accepted server responses locally; NO LIVE
 * requests/cookies, no changes to any game account or browser profile.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";

const profile = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url),"utf8"));
const trial = profile.quests.find(q => q.id === "thi-luyen-tong-mon");
assert.ok(trial && trial.requiresVip);
assert.ok(!trial.steps.some(s => s.selector === ".nv-quest" || s.text === "/nhiem-vu-hang-ngay"),
  "VIP trial must not navigate to hub");
const route = "/thi-luyen-tong-mon-hh3d/?nv_embed=1";
assert.equal(trial.steps[0].text, route);
let mode = "ready";
let openCalls = 0;
let pollCalls = 0;
const html = () => [
  "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Local trial fixture</title>",
  "<style>#tlPage{width:700px;height:450px}#tlScroll{width:260px;height:140px}",
  " #tlClock{display:inline-block}#tlPage[data-state='ready'] #tlClock{display:none}</style></head><body>",
  "<div id='tlPage' data-state='"+((mode==="denied"||mode==="ready-final")?"ready":mode)+"'>",
  "<button id='tlScroll' type='button' aria-label='Mở Thí Luyện'>Mở Thí Luyện</button>",
  "<p>Còn <b id='tlLeft'>"+(mode === "done" ? "0" : mode === "ready-final" ? "1" : mode === "cooldown" ? "2" : "3")+"</b>/3 lượt hôm nay</p>",
  "<b id='tlClock'>"+(mode === "locked" ? "23:59" : "07:26")+"</b>",
  "</div>",
  "<script>",
  "window.__trialClicks=0;const root=document.querySelector('#tlPage');",
  "const left=document.querySelector('#tlLeft');const clock=document.querySelector('#tlClock');",
  "document.querySelector('#tlScroll').addEventListener('click',async()=>{",
  " window.__trialClicks++;",
  " const response=await fetch('/wp-content/themes/halimmovies-child/hh3d-ajax.php',",
  " {method:'POST',body:'action=ac2e013b'});",
  " const result=await response.json();",
  " if(!result.success)return;",
  " left.textContent=String(Math.max(0,Number(left.textContent)-1));",
  " const remaining=Number(left.textContent);",
  // Shortened version of the captured client's 3800ms animation.
  " setTimeout(async()=>{",
  "  root.dataset.state=remaining===0?'done':'cooldown';",
  "  if(remaining>0){const t=await fetch('/wp-content/themes/halimmovies-child/hh3d-ajax.php',",
  "   {method:'POST',body:'action=ed986282'});",
  "   const data=await t.json();clock.textContent=data.data.time_remaining;}",
  " },550);",
  "});",
  "</script></body></html>"
].join("");
const server=createServer(async(req,res)=>{
  if(req.url?.startsWith("/wp-content/themes/halimmovies-child/hh3d-ajax.php")){
    const chunks=[];
    for await(const c of req) chunks.push(c);
    const body=Buffer.concat(chunks).toString("utf8");
    res.setHeader("Content-Type","application/json");
    if(body.includes("action=ac2e013b")){
      openCalls++;
      res.end(JSON.stringify(mode==="denied"
        ? {success:false,data:{message:"Rejected"}}
        : {success:true,data:{message:"Mở Thí Luyện cấp 7 nhận 68 Tinh Thạch.",tinh_thach:68}}));
    } else if(body.includes("action=ed986282")){
      pollCalls++;
      res.end(JSON.stringify({success:true,data:{time_remaining:"07:26"}}));
    } else {
      res.statusCode=400;
      res.end(JSON.stringify({success:false}));
    }
  }else{
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end(html());
  }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
let browser;
try {
  try {
    browser=await chromium.launch({headless:true,channel:"chromium"});
  }catch(error){
    if(!/Executable doesn't exist/i.test(String(error))) throw error;
    browser=await chromium.launch({headless:true,channel:"chrome"});
  }
  const log={info:()=>{},warning:()=>{},debug:()=>{}};
  const engine=createQuestEngine({log});
  async function runCase(which) {
    mode=which;openCalls=0;pollCalls=0;
    const page=await browser.newPage();
    const sess=createSession(page,{
      baseUrl:base,log,minActionDelayMs:0,maxActionDelayMs:1,
    });
    const q=structuredClone(trial);
    q.enabled=true;
    // Negative no-ack branch: shrink only this fixture's wait, without
    // weakening the production profile's 20s witness.
    if(which==="denied"){
      q.steps.find(s=>s.action==="waitForCondition").timeoutMs=900;
    }
    const started=performance.now();
    try{
      const result=await engine.run(sess,{dailyQuestPath:"/"},q);
      return {result,elapsed:performance.now()-started,clicks:await page.evaluate(()=>window.__trialClicks).catch(()=>0),calls:openCalls,polls:pollCalls};
    }finally{await page.close();}
  }
  const ready=await runCase("ready");
  console.log("ready",JSON.stringify(ready));
  assert.equal(ready.calls,1,"ready scroll should make exactly one POST");
  assert.ok(ready.elapsed>=450,"do not report success before reveal completed");
  assert.notEqual(ready.result.outcome,"failed",JSON.stringify(ready.result));
  assert.equal(ready.result.outcome,"completed","server-backed first turn must complete");
  assert.equal(ready.result.cooldownSeconds,446,"read the server's 07:26 countdown");
  const finalTurn=await runCase("ready-final");
  console.log("last-turn",JSON.stringify(finalTurn));
  assert.equal(finalTurn.calls,1,"the last turn must send one accepted POST");
  assert.equal(finalTurn.result.outcome,"alreadyDone","third accepted turn transitions to done");
  assert.equal(finalTurn.result.dailyCapReached,true);
  const cooldown=await runCase("cooldown");
  console.log("cooldown",JSON.stringify(cooldown));
  assert.equal(cooldown.calls,0,"do not click during cooldown despite enabled scroll");
  assert.equal(cooldown.result.outcome,"onCooldown","cooldown must not cap the day");
  assert.notEqual(cooldown.result.outcome,"failed");
  const done=await runCase("done");
  console.log("done",JSON.stringify(done));
  assert.equal(done.calls,0,"completed day cannot spend another turn");
  assert.equal(done.result.outcome,"alreadyDone","done is a genuine daily cap");
  const locked=await runCase("locked");
  console.log("locked",JSON.stringify(locked));
  assert.equal(locked.calls,0,"not joined for 24h cannot spend a turn");
  assert.equal(locked.result.outcome,"onCooldown","24h lock must not be daily cap");
  assert.notEqual(locked.result.outcome,"failed");
  const denied=await runCase("denied");
  console.log("denied",JSON.stringify(denied));
  assert.ok(denied.calls>=1,"rejected click test must actually send a POST");
  assert.equal(denied.result.outcome,"failed","rejected response must fail loudly");
  console.log("PASS recorded VIP trial: ready/cooldown/done/locked/denied, post-reveal witness and one POST per click");
}finally{
  if(browser) await browser.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
}
