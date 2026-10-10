import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { parseFishingSnapshotFrame } from "../src/lib/quest-engine/fishingServo.mjs";

assert.equal(parseFishingSnapshotFrame('42["g:evt",{"type":"st"}]'),null);
assert.equal(parseFishingSnapshotFrame('42["g:snap",{"t":0.1,"z":0.5}]'),null);
assert.deepEqual(parseFishingSnapshotFrame('42["g:snap",{"t":0.07,"z":0.51,"f":0.5,"fv":-0.002,"p":0.313,"zone":0.336}]'),{
 t:.07,z:.51,f:.5,fv:-.002,p:.313,zone:.336,inside:false
});

const page=new EventEmitter(),socket=new EventEmitter();
socket.url=()=> "wss://example.invalid/socket.io/?EIO=4";
const presses=[];
let checks=0;
page.locator=()=>({boundingBox:async()=>({x:50,y:80,width:80,height:48})});
page.evaluate=async()=>++checks<=32;
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
 socket.emit("framereceived",'42["g:snap",'+JSON.stringify({t:i*.066,z,f,zone:.34,p:.3+i*.01,fv:0})+']');
},55);
try {
 await session.fishingReel();
} finally {clearInterval(timer)}
assert.equal(presses[0],"move:90:104");
assert.ok(presses.includes("down"),"trusted mouse must hold while chasing fish above");
assert.ok(presses.includes("up"),"trusted mouse must release to chase fish below");
assert.equal(presses[presses.length-1],"up","button must be released on reel end");
console.log("PASS passive Socket.IO g:snap telemetry drives trusted mouse down/up and releases at exit");
