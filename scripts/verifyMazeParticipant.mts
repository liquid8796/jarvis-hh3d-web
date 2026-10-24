#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { configSchema } from "../src/lib/services/configs";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";

const source=readFileSync(new URL("../src/lib/quest-engine/mazeParticipantTick.js",import.meta.url),"utf8");
function fixture({now, cachedChest, totalText="Hôm nay đã nhận 10/300 Huyền Tinh"}: {now:number;cachedChest?:object;totalText?:string}) {
  const classes = () => {
    const bag = new Set<string>();
    return { add:(x:string)=>bag.add(x), remove:(x:string)=>bag.delete(x), contains:(x:string)=>bag.has(x) };
  };
  const body={classList:classes(),querySelectorAll:()=>[],isConnected:true,nodeType:1};
  const counter={textContent:totalText,classList:classes(),isConnected:true,nodeType:1,hidden:false,getBoundingClientRect:()=>({width:90,height:20})};
  const state=new Map<string,string>();
  if(cachedChest) state.set("__jvz_mc_participant_chest",JSON.stringify(cachedChest));
  const doc={
    body,querySelector:(s:string)=>s===".mc-ht-daily-text"||s==="#lobby-overview"?counter:null,
    querySelectorAll:()=>[],
  };
  const clock=class extends Date {static now(){return now;}};
  const script=source.replaceAll("{{mode}}","is-normal").replaceAll("{{roomCode}}","")
    .replaceAll("{{hostWaitSec}}","180").replaceAll("{{capCheck}}","đủ trần ngày");
  vm.runInNewContext("("+script+")()",{
    Date:clock,document:doc,window:{},getComputedStyle:()=>({display:"block",visibility:"visible"}),
    sessionStorage:{getItem:(k:string)=>state.get(k)??null,setItem:(k:string,v:string)=>state.set(k,v)},
    console,JSON,Number,String,Math,Event,HTMLInputElement:class{},
  },{timeout:500});
  return {done:body.classList.contains("jvz-mc-join-done"),state};
}
const at=Date.parse("2026-10-24T07:10:00Z");
assert.equal(fixture({now:at,cachedChest:{total:300,cap:300,at:Date.parse("2026-10-23T13:00:00Z")}}).done,false,"previous-day chest must NOT stop today's maze");
assert.equal(fixture({now:at,cachedChest:{total:300,cap:300,at:at-20000}}).done,true,"today's full chest stops run");
assert.equal(fixture({now:at,totalText:"Hôm nay đã nhận 300/300 Huyền Tinh"}).done,true,"live counter stops run");
assert.equal(fixture({now:at,totalText:"Hôm nay đã nhận 10/300 Huyền Tinh"}).done,false,"below cap keeps running");

for(const tier of ["vip","free"] as const){
  const config=configSchema.parse({accountTier:tier,quests:{meCung:{enabled:true,role:"join",mode:"is-hard",roomCode:"123456",hostWaitSec:90}}});
  const profile=profileForConfig(config);
  const quest=profile.quests.find((q:any)=>q.name==="Mê Cung"&&q.requiresVip===(tier==="vip"));
  assert(quest?.enabled,tier+" maze enabled");
  const loop=quest.steps.find((step:any)=>step.action==="repeat");
  assert(loop?.steps.some((x:any)=>x.action==="evaluateJavaScript"&&x.script.includes("__jvz_maze_participant_state")),tier+" participant controller selected");
  for(const [key,value] of [["role","join"],["mode","is-hard"],["roomCode","123456"],["hostWaitSec","90"]]){
    assert.equal(quest.options.find((x:any)=>x.key===key)?.selectedValue,value,tier+" option "+key);
  }
}
const host=configSchema.parse({quests:{meCung:{enabled:true}}});
for(const q of profileForConfig(host).quests.filter((q:any)=>q.name==="Mê Cung")){
 assert(!q.steps.some((step:any)=>step.action==="repeat"&&step.steps?.some((x:any)=>x.script?.includes("__jvz_maze_participant_state"))),"existing host flow must be retained");
}
// Recorded notes require rejoining another room after a kick/disband, even if
// the previous room was initially selected by its six-digit code.
function simulateKickFromPinnedRoom() {
  const now=Date.parse("2026-10-24T07:30:00Z");
  const css=(...names:string[])=>{
    const c=new Set(names);
    return {contains:(n:string)=>c.has(n),add:(n:string)=>c.add(n),remove:(n:string)=>c.delete(n)};
  };
  const elem=(text="",...classes:string[]):any=>({
    nodeType:1,isConnected:true,hidden:false,classList:css(...classes),textContent:text,
    getBoundingClientRect:()=>({width:120,height:40}),querySelector:()=>null,querySelectorAll:()=>[]
  });
  const body=elem(),lobby=elem(),list=elem();
  const oldButton=elem(),newButton=elem();
  const oldRow=elem("Mã #123456 · 2/5", "room-item","room-item--normal");
  const nextRow=elem("Mã #654321 · 2/5", "room-item","room-item--normal");
  oldRow.querySelector=(s:string)=>s==="button.btn-join-room"?oldButton:null;
  nextRow.querySelector=(s:string)=>s==="button.btn-join-room"?newButton:null;
  list.querySelectorAll=(s:string)=>s===".room-item"?[oldRow,nextRow]:[];
  const storage=new Map<string,string>();
  storage.set("__jvz_maze_participant_state",JSON.stringify({
    mode:"normal",requestedCode:"123456",startedAt:now-18000,room:"123456",
    waitingAt:now-18000,lastJoinAt:now-18000,lastRefreshAt:0,avoided:{}
  }));
  const nodes:Record<string,any>={"#lobby-overview":lobby,"#room-list":list};
  const script=source.replaceAll("{{mode}}","is-normal").replaceAll("{{roomCode}}","123456")
    .replaceAll("{{hostWaitSec}}","180").replaceAll("{{capCheck}}","đủ trần ngày");
  vm.runInNewContext("("+script+")()",{
    Date:class extends Date{static now(){return now;}},document:{
      body,querySelector:(s:string)=>nodes[s]??null,querySelectorAll:()=>[]
    },window:{},getComputedStyle:()=>({display:"block",visibility:"visible"}),
    sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)},
    console,JSON,Number,String,Math,Event,HTMLInputElement:class{}
  },{timeout:500});
  return {old:oldButton.classList.contains("jvz-mc-join-target"),next:newButton.classList.contains("jvz-mc-join-target")};
}
assert.deepEqual(simulateKickFromPinnedRoom(),{old:false,next:true},"after kick, fall back to another public room instead of immediately rejoining pinned room");
// The normal repeat ceiling (200) must not silently shorten the 35-minute
// participant quest, which requests 950 iterations at roughly 2-second cadence.
const engineSource=readFileSync(new URL("../src/lib/quest-engine/engine.mjs",import.meta.url),"utf8");
assert(engineSource.includes('mazeParticipant ? clamp(step.maxIterations ?? 950, 1, 1200)'),
  "Maze participant repeat must honor 950 iterations while other quests keep the generic 200 limit");

function capExitScenario(screen: "room"|"battle"|"lobby", confirming=false) {
 const now=Date.parse("2026-10-24T08:00:00Z");
 const css=(...values:string[])=>{
   const c=new Set(values);
   return {contains:(x:string)=>c.has(x),add:(x:string)=>c.add(x),remove:(x:string)=>c.delete(x)};
 };
 const elem=(value=""):any=>({
   nodeType:1,isConnected:true,hidden:false,classList:css(),textContent:value,
   getBoundingClientRect:()=>({width:120,height:40}),querySelectorAll:()=>[]
 });
 const body=elem(), screenElem=elem(),daily=elem("300/300");
 const leave=elem(), confirm=elem(), next=elem();
 const nodes:Record<string,any>={
   ".mc-ht-daily-text":daily,
   ...(screen==="room"?{"#room-panel":screenElem,"#btn-leave-room":leave}:{}),
   ...(screen==="battle"?{"#screen-battle":screenElem,"#btn-next-stage":next}:{}),
   ...(screen==="lobby"?{"#lobby-overview":screenElem}:{}),
   ...(confirming?{"#confirm-overlay .confirm-btn-ok":confirm}:{})
 };
 const storage=new Map<string,string>();
 storage.set("__jvz_maze_participant_state",JSON.stringify({
   mode:"normal",requestedCode:"",startedAt:now-30000,
   room:screen==="lobby"?"": "123456",waitingAt:now-15000,leaving:confirming,
   lastJoinAt:0,lastRefreshAt:0,avoided:{}
 }));
 const script=source.replaceAll("{{mode}}","is-normal").replaceAll("{{roomCode}}","")
   .replaceAll("{{hostWaitSec}}","180").replaceAll("{{capCheck}}","huyền tinh");
 vm.runInNewContext("("+script+")()",{
   Date:class extends Date{static now(){return now;}},document:{
     body,querySelector:(s:string)=>nodes[s]??null,querySelectorAll:()=>[]
   },window:{},getComputedStyle:()=>({display:"block",visibility:"visible"}),
   sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)},
   console,JSON,Number,String,Math,Event,HTMLInputElement:class{}
 },{timeout:500});
 return {done:body.classList.contains("jvz-mc-join-done"),
   leave:leave.classList.contains("jvz-mc-join-leave"),
   confirm:confirm.classList.contains("jvz-mc-join-confirm"),
   next:next.classList.contains("jvz-mc-join-next")};
}
assert.equal(capExitScenario("room").done,false,"Cap reached inside room must not close browser before leaving");
assert.equal(capExitScenario("room").leave,true,"Cap reached in room should initiate leave");
assert.equal(capExitScenario("room",true).confirm,true,"Cap reached must confirm leave before completing");
assert.equal(capExitScenario("battle").done,false,"Cap reached during battle must not close active fight");
assert.equal(capExitScenario("battle").next,true,"Auto-next remains actionable during ongoing battle");
assert.equal(capExitScenario("lobby").done,true,"Once safely outside the room, cap can finish the quest");

console.log("PASS: VIP/free mapping, host default, daily cap, kick recovery, 950 maze iterations and safe post-battle exit.");
