import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createFishingSaleJournal } from "../src/lib/quest-engine/fishingJournal.mjs";

const messages=[], journal=createFishingSaleJournal({info:m=>messages.push(m)});
const bag=(items,pend=null)=>{ journal.sent('421["g:act",{"a":"bag"}]'); journal.received('431'+JSON.stringify([{ok:true,items,pend}])); };
const evt=x=>journal.received('42'+JSON.stringify(['g:evt',x]));
const old={id:1,f:"ca_chep_vang",w:.78,len:36,price:9};
const caught={type:"catch",f:"ca_chep_vang",w:.78,len:36};
journal.received('42["hello",{"me":{"id":7}}]');
bag([old]); evt({type:"reel"});
assert.equal(typeof journal.caught,"function","the journal must enrich catch events that lack price");
const token=journal.caught(caught);
assert.ok(token,"a live catch without price needs a basket read");
assert.equal(messages.length,0,"do not publish a bare catch while details are being read");
bag([old,{...old,id:2,price:1}]);
assert.equal(messages[0],"Câu Cá: Bắt được Cá Chép Vàng · ngư lực +1.","choose the new ID, not an older identical fish");
journal.finishCatch(token);
assert.equal(messages.length,1,"fallback cannot repeat a resolved catch");
evt({type:"reel"});
const ambiguous=journal.caught(caught);
bag([old,{...old,id:2,price:1},{...old,id:3,price:2},{...old,id:4,price:3}]);
journal.finishCatch(ambiguous);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'never choose between ambiguous new fish');
evt({type:"reel"});
const unchanged=journal.caught(caught);
bag([old,{...old,id:2,price:1}]); journal.finishCatch(unchanged);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'old matching fish cannot provide new catch details');
evt({type:"reel"});
evt({type:"bag",auto:{how:"sold",now:true,f:"ca_chep_vang",price:2}});
journal.caught(caught);
assert.match(messages.at(-1),/Bắt được Cá Chép Vàng · ngư lực \+2/,'same-fight immediate auto-sale can enrich catch');
evt({type:"st",s:"idle"}); evt({type:"reel"});
const waiting=journal.caught(caught);
evt({type:"bag",auto:{how:"sold",now:false,f:"ca_chep_vang",price:8}});
journal.finishCatch(waiting);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'full-bag sale of an older fish cannot enrich catch');
evt({type:"st",s:"idle"}); evt({type:"reel"});
const pending=journal.caught(caught);
bag([old],{...caught,price:7});
assert.match(messages.at(-1),/ngư lực \+7/,'confirmed pending fish provides details when basket is full');
journal.finishCatch(pending);
evt({type:"st",s:"idle"}); evt({type:"reel"});
evt({type:"bag",pend:{...caught,price:6}});
journal.caught(caught);
assert.match(messages.at(-1),/ngư lực \+6/,'pending details preceding catch in the same server batch are retained');
evt({type:"st",s:"idle"}); evt({type:"reel"});
const oldPending=journal.caught(caught); journal.finishCatch(oldPending);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'previous fight pending details are not reused');
evt({type:"reel"});
const resetToken=journal.caught(caught); journal.reset();
const count=messages.length; journal.finishCatch(resetToken);
assert.equal(messages.length,count,'late completion cannot log against a new connection');
for (const item of [
  {f:"den_hoa_dang",kind:"ODDITY",w:0,len:0},
  {f:"hop_go",kind:"JUNK",w:0,len:0},
  {f:"future_treasure",kind:"TREASURE",w:0,len:0,price:99},
]) {
  const before=messages.length;
  assert.equal(journal.caught(item),null,'non-fish items must not request or wait for basket details');
  assert.equal(messages.length,before+1);
  assert.match(messages.at(-1),/Câu được .*vật phẩm/);
  assert.ok(!/ngư lực|Linh Thạch|chưa rõ số/.test(messages.at(-1)),'items do not inherit fish classifications or sale proceeds');
}
assert.ok(messages.some(m=>m.includes('Đèn hoa đăng')),'name the actual oddity caught in the user capture');

// Chrome manual capture: bag.got is the new fish ID, not its +N value.
journal.received('42["hello",{"me":{"id":7}}]');
const captured={type:"catch",uid:7,f:"ngan_ly",kind:"FISH",w:2.34,len:57,big:false,h:"giua",isNew:true,caught:5,best:"den_hoa_dang",pct:4.2};
evt({type:"reel"});
evt({type:"bag",n:29,cap:30,got:2062373});
const capturedToken=journal.caught(captured);
bag([{id:2062372,f:"ngan_ly",w:2.34,len:57,price:9},{id:2062373,f:"ngan_ly",w:2.34,len:57,price:4}]);
journal.finishCatch(capturedToken);
assert.match(messages.at(-1),/Ngân Lý · ngư lực \+4/,'captured got ID resolves even without a previous basket and with an identical older fish');
evt({type:"reel"});
evt({type:"bag",n:30,cap:30,got:2062380});
const missingGot=journal.caught(captured);
bag([{id:2062381,f:"ngan_ly",w:2.34,len:57,price:8}],{f:"ngan_ly",w:2.34,len:57,price:8}); journal.finishCatch(missingGot);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'never substitute a different matching fish when the server provided an exact ID');
evt({type:"reel"});
const afterCatch=journal.caught(captured);
evt({type:"bag",n:30,cap:30,got:2062382});
bag([{id:2062381,f:"ngan_ly",w:2.34,len:57,price:8},{id:2062382,f:"ngan_ly",w:2.34,len:57,price:5}]); journal.finishCatch(afterCatch);
assert.match(messages.at(-1),/ngư lực \+5/,'the exact ID also binds when bag notification follows catch');
evt({type:"reel"});
const staleGot=journal.caught(captured);
bag([{id:2062382,f:"ngan_ly",w:2.34,len:57,price:5}]); journal.finishCatch(staleGot);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'a new fight cannot reuse the last caught ID');
evt({type:"reel"});
evt({type:"bag",got:2062390,pend:{f:"ngan_ly",w:2.34,len:57,price:9}});
const conflictingPending=journal.caught(captured); journal.finishCatch(conflictingPending);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'same-batch pending fish cannot override a stored got identity');
evt({type:"reel"});
evt({type:"bag",got:2062391,auto:{how:"sold",now:true,f:"ngan_ly",price:8}});
const conflictingAuto=journal.caught(captured); journal.finishCatch(conflictingAuto);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'auto-sale metadata cannot override a stored got identity');
evt({type:"reel"}); evt({type:"bag",got:2062392});
const lateAuto=journal.caught(captured);
evt({type:"bag",auto:{how:"sold",now:true,f:"ngan_ly",price:8}}); journal.finishCatch(lateAuto);
assert.match(messages.at(-1),/ngư lực chưa rõ/,'late auto-sale metadata cannot override a stored got identity');
assert.equal(journal.caught({type:"catch",f:"truc_thu",kind:"MYSTERY",w:0,len:0}),null,'the captured mystery item never reads the basket');
assert.match(messages.at(-1),/Câu được .*vật phẩm/);
assert.ok(!/ngư lực|Linh Thạch/.test(messages.at(-1)));

const { readFishingCatchBag } = await import("../src/lib/quest-engine/fishingCatchDetails.mjs");
let browser;
try {
  try {browser=await chromium.launch({headless:true,channel:"chromium"});}
  catch(e){if(!/Executable doesn't exist/.test(String(e)))throw e;browser=await chromium.launch({headless:true,channel:"chrome"});}
  const page=await browser.newPage();
  await page.setContent('<div class="sheet" style="display:none">Hidden game launcher</div><div class="view fish-room"><button class="fish-main st-idle">Ném câu</button><button class="fish-quick-bag">Giỏ cá</button></div>');
  await page.evaluate(()=>{
    window.__jvzFish={casts:1,bagChecked:true,lastBagCast:1}; window.effects={opened:0,sold:0,selected:0,toggled:0};
    document.querySelector('.fish-quick-bag').onclick=()=>{
      window.effects.opened++;
      const sheet=document.createElement('div'); sheet.className='sheet';
      sheet.innerHTML='<div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-bag">Loading</div>';
      sheet.querySelector('.sheet-head button').onclick=()=>sheet.remove();
      document.body.append(sheet);
      setTimeout(()=>{
        sheet.querySelector('.fish-bag').innerHTML='<div class="fish-bag-head"><b>Giỏ 1/30</b></div><button class="fish-bag-item fish-card">Cá +1</button><div class="fish-bag-auto"><button class="notif-toggle">Tự bán</button></div><div class="fish-bag-bar"><button>Bán 1 con</button></div>';
        sheet.querySelector('.fish-bag-card, .fish-card').onclick=()=>window.effects.selected++;
        sheet.querySelector('.notif-toggle').onclick=()=>window.effects.toggled++;
        sheet.querySelector('.fish-bag-bar button').onclick=()=>window.effects.sold++;
      },120);
    };
  });
  const source=readFileSync(new URL('../src/lib/quest-engine/fishingTick.js',import.meta.url),'utf8').replace('{{sellBelow}}','4').replace('{{castLimit}}','0');
  const reading=readFishingCatchBag(page);
  await page.waitForFunction(()=>window.__jvzFish?.journalReading,{},{timeout:1000});
  const tick=await page.evaluate('('+source+')()');
  assert.match(tick,/đọc chi tiết/,'controller must not sell or cast during a detail-only bag read');
  await reading;
  assert.deepEqual(await page.evaluate(()=>window.effects),{opened:1,sold:0,selected:0,toggled:0});
  assert.equal(await page.locator('.sheet').count(),1,'close only the detail panel, preserving the hidden launcher');
  assert.equal(await page.evaluate(()=>Boolean(window.__jvzFish.journalReading)),false,'release controller lock');
  await page.evaluate(()=>{const s=document.createElement('div');s.className='sheet';s.textContent='existing user panel';document.body.append(s)});
  await readFishingCatchBag(page);
  assert.equal(await page.locator('.sheet').count(),2,'do not close or replace an existing user panel');
  assert.equal(await page.evaluate(()=>window.effects.opened),1);
  await page.evaluate(()=>{
    [...document.querySelectorAll('.sheet')].filter(s=>s.getClientRects().length).forEach(s=>s.remove());
    document.querySelector('.fish-quick-bag').onclick=()=>{
      const sheet=document.createElement('div');sheet.className='sheet';
      sheet.innerHTML='<div class="sheet-head"><button aria-label="Đóng">Đóng</button></div><div class="fish-bag">Loading</div>';
      sheet.querySelector('button').onclick=()=>sheet.remove(); document.body.append(sheet);
      setTimeout(()=>sheet.querySelector('.fish-bag').innerHTML='<div class="fish-bag-head">Late response</div><div class="fish-bag-bar"><button>Bán 1 con</button></div>',2000);
    };
  });
  await readFishingCatchBag(page);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.sheet').count(),1,'timeout closes the loading shell; late contents cannot become a sale panel');
  assert.equal(await page.evaluate(()=>Boolean(window.__jvzFish.journalReading)),false);
  console.log('PASS catch details: confirmed new fish, ambiguous/stale data, auto-sale, pending, reconnect and read-only basket inspection');
} finally {await browser?.close();}
