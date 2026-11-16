import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const failures=[];
try {
 const page=await browser.newPage();
 for(const [platform,file] of [['web','../src/lib/quest-engine/fishingTick.js'],['pc','../../jarvis-hh3d-pc/src/JarvisHH3D.Infrastructure/Quests/FishingTick.js']]) for(const id of ['cau-ca','cau-ca-thuong']) {
  const tick=readFileSync(new URL(file,import.meta.url),'utf8').replace(/\{\{[^}]+\}\}/g,'0');
  const run=()=>page.evaluate('('+tick+')()');
  const check=async(name,fn)=>{try{await fn();console.log('PASS',platform,id,name);}catch(e){failures.push(platform+' '+id+' '+name+': '+e.message);}};
  const setup=async(extra='')=>{
   await page.setContent('<div class="view fish-room"><button class="fish-main st-idle jvz-fish-press">Ném câu</button></div>'+extra);
   await page.evaluate(()=>{window.__jvzFish={casts:0,ticks:0,bagChecked:true,lastBagCast:0};const close=document.querySelector('.sheet-head button');if(close)close.onclick=()=>document.querySelector('.sheet').remove();});
  };
  await check('backoff clears stale cast marker',async()=>{
   await setup();await page.evaluate(()=>Object.assign(window.__jvzFish,{castFailure:'blocked',retryAfter:Date.now()+5000}));
   await run();assert.equal(await page.locator('.jvz-fish-press').count(),0,'failure tick must revoke click permission');
   for(let i=0;i<12;i++){await run();assert.equal(await page.locator('.jvz-fish-press').count(),0);}
   await page.evaluate(()=>window.__jvzFish.retryAfter=Date.now()-1);await run();assert.equal(await page.locator('.jvz-fish-press').count(),1);
  });
  await check('weekly result dismissed before casting',async()=>{
   await setup('<div class="sheet" role="dialog" aria-label="Kết quả giải câu tuần"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fr-result">Kết quả</div></div>');
   await run();assert.equal(await page.locator('.sheet').count(),0,'known first-entry result closes');assert.equal(await page.locator('.jvz-fish-press').count(),0);
   await run();assert.equal(await page.locator('.jvz-fish-press').count(),1);
  });
  await check('unknown dialogs retained',async()=>{
   await setup('<div class="sheet"><div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><p>Confirm purchase</p></div>');await run();assert.equal(await page.locator('.sheet').count(),1);
  });
 }
}finally{await browser.close();}
assert.equal(failures.length,0,failures.join('\n'));
