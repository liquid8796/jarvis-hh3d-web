#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {createQuestEngine} from "../src/lib/quest-engine/engine.mjs";
import {configSchema} from "../src/lib/services/configs";
import {profileForConfig} from "../src/lib/quest-engine/profile.mjs";

const code=readFileSync(new URL("../src/lib/quest-engine/mazeParticipantTick.js",import.meta.url),"utf8");
const steps=JSON.parse(readFileSync(new URL("../src/lib/quest-engine/mazeParticipantSteps.json",import.meta.url),"utf8"));
const allClicks=steps.find((s:any)=>s.action==="repeat").steps.filter((s:any)=>s.action==="click");
assert.equal(allClicks.length,9);
assert(allClicks.every((s:any)=>s.journalOnSuccess?.length>10));
assert(steps[0].journalOnSuccess);
for(const tier of ["vip","free"] as const) {
  const config=configSchema.parse({accountTier:tier,quests:{meCung:{enabled:true,role:"join"}}});
  const quest=profileForConfig(config).quests.find((q:any)=>q.name==="Mê Cung"&&q.requiresVip===(tier==="vip"));
  assert(quest?.steps.some((s:any)=>s.action==="repeat"&&s.steps.some((item:any)=>item.journalOnSuccess)));
}

const state=new Map<string,string>();
const clock=Date.parse("2026-10-24T11:00:00Z");
const classes=()=>{const set=new Set<string>();return {add:(v:string)=>set.add(v),remove:(v:string)=>set.delete(v),contains:(v:string)=>set.has(v)}};
const element=(text=""):any=>({
 textContent:text,isConnected:true,nodeType:1,hidden:false,classList:classes(),disabled:false,
 getBoundingClientRect:()=>({width:120,height:40}),querySelectorAll:()=>[],querySelector:()=>null
});
function tick(screen:"lobby"|"room"|"battle", now=clock, extra:Record<string,any>={}, settings={mode:"is-normal",roomCode:"",hostWaitSec:"180",capCheck:"huyền tinh"}) {
 const body=element();
 const nodes:Record<string,any>={
  ...(screen==="lobby"?{"#lobby-overview":element(),"#room-list":element()}:{}),
  ...(screen==="room"?{"#room-panel":element(),"#room-code":element("123456"),"#btn-start":element("SẴN SÀNG")}:{}),
  ...(screen==="battle"?{"#screen-battle":element(),"#btn-next-stage":element()}:{}),
  ...extra
 };
 const s=code.replaceAll("{{mode}}",settings.mode).replaceAll("{{roomCode}}",settings.roomCode)
  .replaceAll("{{hostWaitSec}}",settings.hostWaitSec).replaceAll("{{capCheck}}",settings.capCheck);
 const result=vm.runInNewContext("("+s+")()",{
  Date:class extends Date {static now(){return now;}},
  document:{body,querySelector:(sel:string)=>nodes[sel]??null,querySelectorAll:()=>[]},
  window:{},sessionStorage:{getItem:(k:string)=>state.get(k)??null,setItem:(k:string,v:string)=>state.set(k,v)},
  getComputedStyle:()=>({display:"block",visibility:"visible"}),
  JSON,Math,String,Number,HTMLInputElement:class{},Event:class{},
 },{timeout:500});
 return {text:String(result),body};
}
const first=tick("lobby");
assert.match(first.text,/^!Mê Cung.*sảnh/m);
assert.match(first.text,/^!Mê Cung.*tìm phòng trống/m);
assert.match(first.text,/\n!Mê Cung/, "Separate Info lines with a real newline");
assert.equal(tick("lobby",clock+2000).text,"", "Polling without changes does NOT repeat Info");
assert.match(tick("lobby",clock+92_000).text,/Vẫn đang tìm phòng trống/, "Heartbeat after 90 seconds");

const room=tick("room",clock+94_000);
assert.match(room.text,/Đã vào phòng Mê Cung.*123456/);
assert.equal(tick("room",clock+96_000).text,"", "Waiting in the same room does not spam");
const fight=tick("battle",clock+98_000);
assert.match(fight.text,/Đang chiến đấu/);
assert.equal(tick("battle",clock+100_000).text,"", "Battle repeats are silent");
assert.match(tick("room",clock+102_000).text,/Đã vào phòng/, "Returning to lobby/room registers a transition");

state.set("__jvz_mc_participant_chest",JSON.stringify({total:100,cap:300,at:clock+103_000}));
assert.match(tick("battle",clock+104_000).text,/Đã nhận kết quả rương Boss 5: Huyền Tinh 100\/300/);
assert.equal(tick("battle",clock+106_000).text,"", "Chest result logged only once");
const before=JSON.parse(state.get("__jvz_maze_participant_state")!);
before.waitingAt=clock;
before.room="123456";
state.set("__jvz_maze_participant_state",JSON.stringify(before));
const expired=tick("room",clock+195_000);
assert.match(expired.text,/Đã chờ chủ phòng quá 180 giây/, "Host wait expiry logged");
assert(!expired.body.classList.contains("jvz-mc-join-done"));

const lines:string[]=[];
const logger={
 info:(_:string,msg:string)=>lines.push(msg),
 debug:(_:string,msg:string)=>{},
 warning:(_:string,msg:string)=>{}
};
const engine=createQuestEngine({log:logger,shouldStop:()=>false});
const clicked:string[]=[];
const session:any={
 resolveUrl:(path:string)=>"https://example.invalid"+path,
 navigate:async()=>({ok:true}),
 humanDelay:async()=>{},
 click:async(sel:string)=>{clicked.push(sel);return sel!=="#missing";},
 evaluate:async()=>false,
};
const outcome=await engine.run(session,{},{
 id:"me-cung",name:"Mê Cung",kind:"customSteps",fallbackCooldownSeconds:0,
 steps:[
  {action:"navigate",text:"/me-cung",journalOnSuccess:"Đã mở Mê Cung"},
  {action:"click",selector:"#ready",journalOnSuccess:"Đã bấm sẵn sàng"},
  {action:"click",selector:"#ready",journalOnSuccess:"Đã bấm sẵn sàng"},
  {action:"click",selector:"#missing",optional:true,journalOnSuccess:"KHÔNG được hiện"},
  {action:"click",selector:"#next",when:{kind:"visible",selector:"#missing"},journalOnSuccess:"KHÔNG được hiện"},
 ]});
assert.equal(outcome.outcome,"completed");
assert.deepEqual(lines,["Đã mở Mê Cung","Đã bấm sẵn sàng"],"Only successful clicks, throttled; skipped controls silent");
assert.equal(clicked.filter(x=>x==="#ready").length,2,"Logging must not alter action behavior");
console.log("PASS: VIP/free step journals, real Info transitions, no polling spam, chest, AFK, click success and skip semantics.");
