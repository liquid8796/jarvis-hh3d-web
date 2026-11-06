import assert from "node:assert/strict";
import { chooseFishingHold } from "../src/lib/quest-engine/fishingServo.mjs";
const simulate = (strategy, fishFn, ticks = 450, zone = .28) => {
 const dt=.066;let z=.5,velocity=0,last=null,lastSwitchedAt=0,inZone=0,shortTaps=0,downAt=null;
 for(let i=0;i<ticks;i++){
  const t=i*dt,f=fishFn(t),fv=(fishFn(t+.01)-f)/.01;
  const hold=strategy==="adaptive" ? chooseFishingHold({t,z,f,fv,zone},{velocity,last,lastSwitchedAt,now:t*1000}) : i%16<5;
  if(last!==null&&hold!==last){
   if(last===true&&downAt!==null&&t-downAt<.15)shortTaps++;
   lastSwitchedAt=t*1000;
  }
  if(last!==true&&hold)downAt=t;
  last=hold;
  velocity+=(hold?2.6:-2.2)*dt;
  velocity*=Math.exp(-2.5*dt);
  z+=velocity*dt;
  if(z<zone/2){z=zone/2;velocity=Math.max(0,velocity)*.3;}
  if(z>1-zone/2){z=1-zone/2;velocity=Math.min(0,velocity)*.3;}
  if(Math.abs(z-f)<=zone/2)inZone++;
 }
 return{ratio:inZone/ticks,shortTaps};
};
for(const fn of [
 t=>.5+.28*Math.sin(t*.8),
 t=>.5+.24*Math.sin(t*1.6)+.06*Math.sin(t*4),
 t=>.48+.25*Math.sin(t*.6)+.07*Math.sin(t*2.9)
]) {
 const a=simulate("adaptive",fn),b=simulate("fixed",fn);
 assert.ok(a.ratio>b.ratio+.10,"tracking "+a.ratio+" should beat fixed "+b.ratio);
 assert.ok(a.shortTaps<12,"avoid rapid taps "+a.shortTaps);
}
assert.equal(chooseFishingHold({z:.2,f:.8,fv:0,t:1,zone:.3},{velocity:0,last:false,now:1000,lastSwitchedAt:0}),true);
assert.equal(chooseFishingHold({z:.8,f:.2,fv:0,t:1,zone:.3},{velocity:0,last:true,now:1000,lastSwitchedAt:0}),false);
// The game kills outward velocity at the ruler edges. Retaining it predicts
// a sluggish rebound and over-corrects even when the fish is near that edge.
assert.equal(chooseFishingHold({z:.08,f:.09,fv:0,t:1,zone:.16},
  {velocity:-.7}), false, "release near the bottom after boundary velocity reset");
assert.equal(chooseFishingHold({z:.92,f:.91,fv:0,t:1,zone:.16},
  {velocity:.7}), true, "hold near the top after boundary velocity reset");
console.log("PASS adaptive fishing servo tracking and tap protection");
