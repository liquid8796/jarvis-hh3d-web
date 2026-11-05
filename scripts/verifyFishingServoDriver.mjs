import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { parseFishingSnapshotFrame } from "../src/lib/quest-engine/fishingServo.mjs";

assert.equal(parseFishingSnapshotFrame('42["g:evt",{"type":"st"}]'),null);
assert.equal(parseFishingSnapshotFrame('42["g:snap",{"t":0.1,"z":0.5}]'),null);
assert.deepEqual(parseFishingSnapshotFrame('42["g:snap",{"t":0.07,"z":0.51,"f":0.5,"fv":-0.002,"p":0.313,"zone":0.336}]'),{
 t:.07,z:.51,f:.5,fv:-.002,p:.313,zone:.336,inside:false
});

const packet = (v) => '42["g:snap",'+JSON.stringify(v)+']';
const recorded = [-3,66,510,4975,-380,313,1,0.25661090000000003,3460,7598];
assert.deepEqual(parseFishingSnapshotFrame(packet(recorded)),{
  t:.066,z:.51,f:.4975,fv:-.038,p:.313,zone:.25661090000000003,inside:true
}, "decode the 2026-11-05 compact live fishing snapshot");
assert.deepEqual(parseFishingSnapshotFrame(packet(
  [-3,1386,128,4658,2141,338,0,.2566109,7247,7598,0,0]
)),{
  t:1.386,z:.128,f:.4658,fv:.2141,p:.338,zone:.2566109,inside:false
});
for(const invalid of [
  [-2,66,510,4975,-380,313,1,.2566],
  [-3,66,510],
  [-3,66,510,4975,-380,313,1,2.5],
  [-3,66,510,4975,-380,1313,1,.3],
  [-3,66,510,4975,-380,313,2,.3],
  [-3,66,510,"bad",-380,313,1,.3],
]) assert.equal(parseFishingSnapshotFrame(packet(invalid)),null,
  "fail closed on unknown/corrupt compact packets");

const page=new EventEmitter(),socket=new EventEmitter();
socket.url=()=> "wss://example.invalid/socket.io/?EIO=4";
const presses=[];
let checks=0;
page.locator=()=>({boundingBox:async()=>({x:50,y:80,width:80,height:48})});
page.evaluate=async(fn)=>String(fn).includes(".pl-gate")?false:++checks<=32;
page.mouse={
 move:async (x,y)=>presses.push("move:"+x+":"+y),
 down:async()=>presses.push("down"),
 up:async()=>presses.push("up")
};
const session=createSession(page,{baseUrl:"https://example.invalid",log:{debug:()=>{},info:()=>{},warning:()=>{}}});
session.beginFishingTelemetry();
page.emit("websocket",socket);
let i=0;
const timer=setInterval(()=>{
 i++;
 const low=i<14, z=low?.2:.82, f=low?.8:.15;
 socket.emit("framereceived",packet(
  [-3,Math.round(i*66),Math.round(z*1000),Math.round(f*10000),0,
    Math.round((.3+i*.01)*1000),1,.34,0,5000]
));
},55);
try {
 await session.fishingReel();
} finally {clearInterval(timer)}
assert.equal(presses[0],"move:90:104");
assert.ok(presses.includes("down"),"trusted mouse must hold while chasing fish above");
assert.ok(presses.includes("up"),"trusted mouse must release to chase fish below");
assert.equal(presses[presses.length-1],"up","button must be released on reel end");
console.log("PASS passive Socket.IO g:snap telemetry drives trusted mouse down/up and releases at exit");

const stalledPage = new EventEmitter(), stalledSocket = new EventEmitter();
stalledSocket.url = () => "wss://example.invalid/socket.io/";
const timeline = [];
let loops = 0;
stalledPage.locator = () => ({ boundingBox: async () => ({ x: 10, y: 10, width: 60, height: 40 }) });
stalledPage.evaluate = async (fn) => {
  if (String(fn).includes(".pl-gate")) return false;
  const active = ++loops <= 20;
  if (!active) timeline.push("reel-finished");
  return active;
};
stalledPage.mouse = {
  move: async () => {},
  down: async () => timeline.push("down"),
  up: async () => timeline.push("up")
};
const stalledSession = createSession(stalledPage, {
  baseUrl: "https://example.invalid",
  log: { debug: () => {}, info: () => {}, warning: () => {} }
});
stalledSession.beginFishingTelemetry();
stalledPage.emit("websocket", stalledSocket);
stalledSocket.emit("framereceived",
  '42["g:snap",'+JSON.stringify({ t: .066, z: .15, f: .85, zone: .27, p: .21, fv: 0 })+']');
await stalledSession.fishingReel();
assert.ok(timeline.includes("down"), "start holding with a fresh valid position");
assert.ok(timeline.includes("up"), "release when g:snap stops arriving");
assert.ok(timeline.indexOf("up") < timeline.indexOf("reel-finished"),
  "stale telemetry must release during reel, not only at its end");
console.log("PASS stale 400ms g:snap gap releases trusted mouse before reel exits");
