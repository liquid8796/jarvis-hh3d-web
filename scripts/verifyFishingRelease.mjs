#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chromium} from "playwright-core";
const raw=readFileSync(new URL("../src/lib/quest-engine/fishingTick.js",import.meta.url),"utf8");
const source=(options={})=>Object.entries({sellBelow:4,sellEveryCasts:5,releaseBelow:0,releaseEveryCasts:5,castLimit:0,spot:"giua",...options}).reduce((s,[k,v])=>s.replaceAll("{{"+k+"}}",String(v)),raw);
let browser;
try{browser=await chromium.launch({headless:true,channel:"chromium"})}
catch(e){if(!/Executable doesn't exist/i.test(String(e)))throw e;browser=await chromium.launch({headless:true,channel:"chrome"})}
const failures=[];
try{
 const page=await browser.newPage();
 const errors=[];page.on("pageerror",e=>errors.push(String(e)));
 const tick=(options)=>page.evaluate("("+source(options)+")()");
 const setup=async({rare=false,full=false,selectedHigh=false}={})=>{
  await page.setContent('<div class="view fish-room"><button class="fish-main st-idle">Ném câu</button><button class="fish-quick-bag"><i class="fish-badge">'+(full?'30':'2')+'/30</i></button></div>');
  await page.evaluate(({rare,selectedHigh})=>{
   window.__jvzFish=undefined;window.__jvzFishReceipts=[];
   window.effects={sell:0,release:0,open:0,close:0,actions:[]};window.items=[{id:1,price:4,rare},{id:2,price:20,selected:selectedHigh}];
   window.renderBag=()=>{
    let sheet=document.querySelector(".sheet");if(!sheet){sheet=document.createElement("div");sheet.className="sheet";document.body.append(sheet)}
    sheet.innerHTML='<div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-bag"><div class="fish-bag-head">Giỏ</div><div class="fish-bag-grid"></div><div class="fish-bag-bar"></div></div>';
    sheet.querySelector(".sheet-head button").onclick=()=>{window.effects.close++;sheet.remove()};
    const grid=sheet.querySelector(".fish-bag-grid"),bar=sheet.querySelector(".fish-bag-bar");
    const renderBar=(confirmKind="")=>{
     const selected=[...grid.querySelectorAll(".on")];bar.replaceChildren();if(!selected.length)return;
     if(confirmKind){const ask=document.createElement("p");ask.className="fish-bag-ask";ask.textContent=(confirmKind==="sell"?"Bán":"Thả")+" cả cá hiếm?";bar.append(ask)}
     for(const kind of ["sell","release"]){
      const b=document.createElement("button");b.textContent=kind==="sell"?"Bán "+selected.length+" con · +4":"Thả về hồ";
      b.onclick=()=>{
       if(selected.some(c=>c.classList.contains("r4"))&&confirmKind!==kind){renderBar(kind);return}
       window.effects[kind]++;window.effects.actions.push({kind,ids:selected.map(c=>+c.dataset.id)});
       window.complete=(extra={})=>{
        const ids=new Set(selected.map(c=>+c.dataset.id));window.items=window.items.filter(i=>!ids.has(i.id));
        window.__jvzFishReceipts.push({action:kind,ok:true,soldCount:kind==="sell"?ids.size:0,released:kind==="release"?ids.size:null,at:Date.now(),...extra});
        document.querySelector(".fish-badge").textContent=window.items.length+"/30";window.renderBag();
       };
      };bar.append(b);
     }
    };
    for(const item of window.items){const card=document.createElement("button");card.className="fish-bag-item fish-card"+(item.rare?" r4":"")+(item.selected?" on":"");card.dataset.id=item.id;card.innerHTML="Cá "+item.id+'<span class="fish-bag-price">+'+item.price+"</span>";card.onclick=()=>{card.classList.toggle("on");item.selected=card.classList.contains("on");renderBar()};grid.append(card)}
    renderBar();
   };
   document.querySelector(".fish-quick-bag").onclick=()=>{window.effects.open++;window.renderBag()};
   window.renderBag();
  },{rare,selectedHigh});
 };
 const check=async(name,fn)=>{try{await fn();console.log("PASS "+name)}catch(e){failures.push(name+": "+e.message);console.error("FAIL "+name+": "+e.message)}};
 await check("daily cap receipt resolves unchanged non-full inventory without timeout/retry",async()=>{
  await setup();await tick();await tick();assert.equal(await page.evaluate(()=>window.effects.sell),1);
  await page.evaluate(()=>window.__jvzFishReceipts.push({action:"sell",ok:true,soldCount:0,stop:"cap",remainingAllowance:1,at:Date.now()}));
  const output=await tick();
  assert.match(output,/hạn mức|mua đủ/);assert.doesNotMatch(output,/Chưa xác nhận/);
  for(let n=0;n<4;n++)await tick();
  assert.equal(await page.evaluate(()=>window.effects.sell),1);
  assert.equal(await page.evaluate(()=>window.effects.release),0);
  assert.equal(await page.locator(".sheet").count(),0);
  assert.equal(await page.locator(".fish-main.jvz-fish-press").count(),1);
 });
 await check("release disabled preserves all fish when sale also disabled",async()=>{
  await setup();for(let n=0;n<4;n++)await tick({sellBelow:0});
  assert.equal(await page.evaluate(()=>window.effects.release+window.effects.sell),0);
 });
 await check("enabled release clears high preselection, waits once and confirms inventory",async()=>{
  await setup({selectedHigh:true});const o={sellBelow:0,releaseBelow:4};
  for(let n=0;n<5;n++)await tick(o);
  assert.deepEqual(await page.evaluate(()=>window.effects.actions),[{kind:"release",ids:[1]}]);
  assert.equal(await page.locator(".sheet").count(),1);
  await page.evaluate(()=>window.complete());await tick(o);
  assert.equal(await page.locator(".sheet").count(),0);
 });
 await check("sale precedes overlapping release and cap permits safe release",async()=>{
  await setup();const o={releaseBelow:4};await tick(o);await tick(o);
  await page.evaluate(()=>window.__jvzFishReceipts.push({action:"sell",ok:true,soldCount:0,stop:"cap",remainingAllowance:1,at:Date.now()}));
  for(let n=0;n<4;n++)await tick(o);
  assert.deepEqual(await page.evaluate(()=>window.effects.actions),[{kind:"sell",ids:[1]},{kind:"release",ids:[1]}]);
 });
 await check("rare release confirmation sends exactly once",async()=>{
  await setup({rare:true});const o={sellBelow:0,releaseBelow:4};
  for(let n=0;n<7;n++)await tick(o);
  assert.deepEqual(await page.evaluate(()=>window.effects.actions),[{kind:"release",ids:[1]}]);
  await page.evaluate(()=>window.complete());await tick(o);
  assert.equal(await page.locator(".sheet").count(),0);
 });
 await check("release interval opens at accepted cast N independent from sale cadence",async()=>{
  await setup();const o={sellBelow:0,releaseBelow:4,releaseEveryCasts:2,sellEveryCasts:5};
  await tick(o);await tick(o);await page.evaluate(()=>window.complete());await tick(o);
  await page.evaluate(()=>{window.__jvzFish.casts=1;window.__jvzFish.lastCast=0;window.items.unshift({id:3,price:4})});
  await tick(o);assert.equal(await page.evaluate(()=>window.effects.open),0);
  await page.evaluate(()=>{window.__jvzFish.casts=2});
  await tick(o);assert.equal(await page.evaluate(()=>window.effects.open),1);
  await tick(o);await tick(o);
  assert.equal(await page.evaluate(()=>window.effects.release),2);
 });
 await check("known remaining allowance prevents oversized sale and resets from fresh bag receipt",async()=>{
  await setup();await page.evaluate(()=>window.__jvzFishReceipts.push({action:"bag",ok:true,remainingAllowance:1,at:Date.now()}));
  for(let n=0;n<3;n++)await tick();
  assert.equal(await page.evaluate(()=>window.effects.sell),0);
  await page.evaluate(()=>{window.__jvzFish.casts=5;window.renderBag();window.__jvzFishReceipts.push({action:"bag",ok:true,remainingAllowance:1000,at:Date.now()})});
  await tick();await tick();
  assert.equal(await page.evaluate(()=>window.effects.sell),1);
 });
 await check("full cap backoff reopens basket and learns renewed allowance",async()=>{
  await setup({full:true});
  await page.evaluate(()=>window.__jvzFishReceipts.push({action:"bag",ok:true,remainingAllowance:1,at:Date.now()}));
  await tick();
  assert.equal(await page.locator(".sheet").count(),0,"close blocked full basket so next retry refreshes server state");
  assert.equal(await page.evaluate(()=>window.__jvzFish.bagChecked),false);
  await page.evaluate(()=>{window.__jvzFish.retryAfter=0});
  await tick();assert.equal(await page.evaluate(()=>window.effects.open),1);
  await page.evaluate(()=>window.__jvzFishReceipts.push({action:"bag",ok:true,remainingAllowance:1000,at:Date.now()}));
  await tick();await tick();
  assert.equal(await page.evaluate(()=>window.effects.sell),1);
 });
 await check("unknown strength stays protected from release",async()=>{
  await setup();await page.evaluate(()=>{const c=document.querySelector('[data-id="1"]');c.textContent="Cá chưa rõ";c.classList.add("on")});
  for(let n=0;n<4;n++)await tick({sellBelow:0,releaseBelow:4});
  assert.equal(await page.evaluate(()=>window.effects.release),0);
 });
 await check("pending release is not resent during unknown outcome",async()=>{
  await setup();const o={sellBelow:0,releaseBelow:4};await tick(o);await tick(o);
  for(let n=0;n<4;n++)await tick(o);
  assert.equal(await page.evaluate(()=>window.effects.release),1);
  await page.evaluate(()=>{window.__jvzFish.bagRequest.at=Date.now()-13000});
  assert.match(await tick(o),/Chưa xác nhận.*thả/);
  assert.equal(await page.evaluate(()=>window.effects.release),1);
  assert.ok(await page.evaluate(()=>window.__jvzFish.retryAfter>Date.now()));
 });
 assert.deepEqual(errors,[]);
 assert.deepEqual(failures,[]);
}finally{await browser.close()}
