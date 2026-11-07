/** Isolated loopback full-profile regression; never connects to the live game. */
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
const { WebSocketServer } = createRequire(import.meta.url)("next/dist/compiled/ws");
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
const cycles=3,logs=[],entries=[],wire=[],timers=new Set();
const html=`<!doctype html><meta charset="utf-8"><style>button{width:180px;height:90px;margin:100px}</style><div id="app"><div class="view fish-room"><button class="fish-main st-idle">Ném câu</button><span class="fish-day"><span class="short">0 / 100</span></span></div></div><script>
const b=document.querySelector(".fish-main"),trace=window.testTrace=[];
const mark=(type,data={})=>trace.push({type,at:Date.now(),...data});
let phase="idle",castDown=false,finished=0;
const setPhase=p=>{phase=p;b.className="fish-main st-"+p;b.textContent={idle:"Ném câu",wait:"Chờ",bite:"Giật!",reel:"Giữ / thả"}[p];mark("phase",{phase:p})};
const socket=new WebSocket("ws://"+location.host+"/socket.io/?EIO=4&transport=websocket");
const send=(name,data)=>socket.send("42"+JSON.stringify([name,data]));
socket.onmessage=e=>{
 const [name,data]=JSON.parse(e.data.slice(2));
 if(name==="g:evt"&&data.type==="bite")setPhase("bite");
 if(name==="g:evt"&&data.type==="st"&&data.s==="idle"){
  setPhase("idle");finished++;if(finished===3)document.body.classList.add("jvz-fish-finished");
 }
};
b.addEventListener("pointerdown",e=>{
 if(!e.isTrusted)return;mark("down",{phase});
 if(phase==="idle")castDown=true;
 else if(phase==="bite"){setPhase("reel");mark("hook");send("g:act",{a:"hook"});}
 else if(phase==="reel"){mark("reel-hold");send("g:input",{h:1});}
});
b.addEventListener("pointerup",e=>{
 if(!e.isTrusted)return;mark("up",{phase});
 if(phase==="idle"&&castDown){castDown=false;setPhase("wait");send("g:act",{a:"cast",x:1,y:1});}
 else if(phase==="reel")send("g:input",{h:0});
});
</script>`;
const server=http.createServer((req,res)=>{res.setHeader("content-type","text/html");res.end(html)});
const wss=new WebSocketServer({server,path:"/socket.io/"});
const later=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn()},ms);timers.add(t)};
wss.on("connection",socket=>{
 const send=(name,payload)=>{if(socket.readyState===1)socket.send("42"+JSON.stringify([name,payload]))};
 send("hello",{me:{id:99}});
 socket.on("message",raw=>{
  const [name,data]=JSON.parse(raw.toString().slice(2));wire.push({at:Date.now(),name,...data});
  if(name==="g:act"&&data.a==="cast")later(()=>send("g:evt",{type:"bite",dur:1.8}),350);
  if(name==="g:act"&&data.a==="hook"){
   send("g:evt",{type:"reel",t:0,z:.2,f:.8,fv:0,p:.3,in:0,zone:.3});
   let tick=0;
   const timer=setInterval(()=>{
    tick++;send("g:snap",[-3,tick*66,200,8000,0,Math.min(1000,300+tick*24),0,.3]);
    if(tick===30){
     clearInterval(timer);timers.delete(timer);
     send("g:evt",{type:"catch",uid:99,f:"ca_chep",w:1,price:1});
     send("g:evt",{type:"st",uid:99,s:"idle"});
    }
   },66);timers.add(timer);
  }
 });
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const baseUrl="http://127.0.0.1:"+server.address().port;
let browser;
try {
 try{browser=await chromium.launch({headless:true,channel:"chromium"})}
 catch(error){if(!/Executable doesn't exist/.test(String(error)))throw error;browser=await chromium.launch({headless:true,channel:"chrome"})}
 const page=await browser.newPage(),pageErrors=[];
 page.on("pageerror",e=>pageErrors.push(String(e)));
 const log=Object.fromEntries(["info","debug","warning","error"].map(level=>[level,(...args)=>logs.push({level,at:Date.now(),message:args.join(" ")})]));
 const session=createSession(page,{baseUrl,log,minActionDelayMs:0,maxActionDelayMs:1,pageTimeoutMs:5000});
 session.beginFishingTelemetry();
 const reel=session.fishingReel.bind(session);
 session.fishingReel=async(...args)=>{
  entries.push({at:Date.now(),phase:await page.locator(".fish-main").getAttribute("class")});
  return reel(...args);
 };
 const profile=loadProfile(),quest=profile.quests.find(q=>q.id==="cau-ca");
 assert.ok(quest);
 for(const o of quest.options)if(o.key==="castLimit"){o.selectedValue="0";o.allowCustom=true}
 const start=Date.now(),engine=createQuestEngine({log,shouldStop:()=>Date.now()-start>30000});
 const outcome=await engine.run(session,profile,quest);
 const trace=await page.evaluate(()=>window.testTrace),hooks=trace.filter(t=>t.type==="hook");
 const summary=logs.filter(l=>l.level==="debug"&&l.message.includes("kết thúc kéo"));
 const perFight=hooks.map((hook,i)=>{
  const end=hooks[i+1]?.at??Infinity;
  const entry=entries.find(e=>e.at>=hook.at&&e.at<end&&e.phase.includes("st-reel"));
  const hold=trace.find(t=>t.type==="reel-hold"&&t.at>=hook.at&&t.at<end);
  return {fight:i+1,entryDelayMs:entry?entry.at-hook.at:null,firstHoldDelayMs:hold?hold.at-hook.at:null};
 });
 console.log(JSON.stringify({outcome,pageErrors,hooks:hooks.length,entries:entries.length,reelEntries:entries.filter(e=>e.phase.includes("st-reel")).length,summaries:summary.length,perFight,wireCounts:wire.reduce((a,v)=>(a[v.a??v.name]=(a[v.a??v.name]??0)+1,a),{}),logs},null,2));
 assert.deepEqual(pageErrors,[]);
 assert.equal(hooks.length,cycles,"full engine must hook every fixture cycle");
 assert.equal(summary.length,cycles,"every completed fight must retain its debug summary");
 assert.equal(logs.filter(l=>l.level==="info"&&l.message==="Câu Cá: Bắt được Cá Chép Đỏ · giá bán +1 Linh Thạch.").length,cycles,
  "one clear result per completed fight in the journal");
 assert.ok(!logs.some(l=>l.level==="info"&&/bám lực|mẫu hợp lệ|tiến độ tối đa/.test(l.message)),
  "journal excludes controller telemetry");
 for(const fight of perFight){
  assert.notEqual(fight.entryDelayMs,null,"controller entry missing in fight "+fight.fight);
  assert.notEqual(fight.firstHoldDelayMs,null,"trusted reel hold missing in fight "+fight.fight);
  assert.ok(fight.firstHoldDelayMs<1000,"first servo hold must occur during fixture fight");
 }
 console.log("PASS full loaded profile to engine to session to trusted pointer hook to real WS snapshots to servo, "+cycles+" cycles");
} finally {
 for(const t of timers){clearTimeout(t);clearInterval(t)}
 await browser?.close();
 for(const s of wss.clients)s.terminate();
 await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));
}
