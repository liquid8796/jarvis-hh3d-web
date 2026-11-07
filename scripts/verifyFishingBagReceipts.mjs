import assert from "node:assert/strict";
import { createFishingSaleJournal } from "../src/lib/quest-engine/fishingJournal.mjs";

// Synthetic IDs and inventories only. Exercise real wire parsing and correlation.
let clock = 100, sequence = 1;
const messages = [], journal = createFishingSaleJournal({info:m=>messages.push(m)},()=>clock);
const hello = () => journal.received('42["hello",{"me":{"id":7}}]');
const send = (action, ids=[], ack=sequence++) => {
  journal.sent("42"+ack+JSON.stringify(["g:act",{a:action,ids}]));
  return ack;
};
const receive = (ack,result) => journal.received("43"+ack+JSON.stringify([result]));
const exchange = (action,result,ids=[]) => receive(send(action,ids),result);
assert.equal(exchange("sell",{ok:true,sold:[],stop:"cap"}),undefined,"self hello is required");
hello();
const fish = [{id:101,f:"ca_chep",price:4},{id:102,f:"ca_ro",price:8}];
assert.deepEqual(exchange("bag",{ok:true,items:fish,wallet:{fish:{room:1},room:0}}),
  {action:"bag",ok:true,stop:null,soldCount:null,released:null,remainingAllowance:1,at:100},
  "a correlated bag receipt returns only sanitized controller fields");
const capAck=send("sell",[101]);
const cap={ok:true,sold:[],stop:"cap",total:0,left:2,items:fish,wallet:{fish:{cap:1000,room:1},room:0}};
assert.deepEqual(receive(capAck,cap),
  {action:"sell",ok:true,stop:"cap",soldCount:0,released:null,remainingAllowance:1,at:100},
  "cap with no sale and positive remaining allowance must reach the controller");
assert.equal(messages.length,1);
assert.match(messages[0],/hạn mức/,"zero-sold daily cap is not silent");
assert.ok(!/Đã bán|thu .*Linh Thạch/.test(messages[0]),"a cap receipt is not a successful sale");
assert.equal(receive(capAck,cap),undefined,"duplicate ACK cannot create another receipt");
assert.equal(messages.length,1);
assert.equal(receive(999,cap),undefined,"unmatched ACK is ignored");

const releaseAck=send("release",[101]);
assert.equal(messages.length,1,"request alone cannot confirm release");
assert.deepEqual(receive(releaseAck,{ok:true,released:1,items:[fish[1]],wallet:{fish:{room:1},room:0}}),
  {action:"release",ok:true,stop:null,soldCount:null,released:1,remainingAllowance:1,at:100});
assert.match(messages.at(-1),/Đã thả 1 cá/);
assert.match(messages.at(-1),/ngư lực: \+4: 1 cá/);
assert.ok(!messages.at(-1).includes("Linh Thạch"),"release does not invent proceeds");
assert.equal(receive(releaseAck,{ok:true,released:1}),undefined);
assert.equal(messages.length,2);

exchange("bag",{ok:true,items:fish});
exchange("release",{ok:true,released:1},[101,102]);
assert.match(messages.at(-1),/chưa rõ: 1 cá/,"a partial count alone cannot identify which fish was released");
assert.ok(!messages.at(-1).includes("+4"),"do not classify partial release by request order");
exchange("release",{ok:true,released:1},[999]);
assert.match(messages.at(-1),/chưa rõ: 1 cá/,"unknown requested fish has no invented value");
const beforeFailures=messages.length;
assert.equal(exchange("release",{ok:false,released:1},[102]).ok,false);
exchange("release",{ok:true,released:0},[102]);
exchange("release",{ok:true,released:"1"},[102]);
assert.equal(messages.length,beforeFailures,"failed, zero and malformed releases do not log success");

const partial=exchange("sell",{ok:true,sold:[101,101,102],total:9,stop:"cap"},[101,102]);
assert.equal(partial.soldCount,2);
assert.equal(messages.length,beforeFailures+1,"partial cap uses one combined message");
assert.match(messages.at(-1),/Đã bán 2 cá.*thu 9 Linh Thạch.*hạn mức/);

const beforeUnknownCount=messages.length;
exchange("sell",{ok:true,total:3,stop:"cap"});
assert.equal(messages.length,beforeUnknownCount+1,"unknown sale count plus cap still produces one receipt log");
assert.match(messages.at(-1),/thu 3 Linh Thạch.*hạn mức/);

for (const invalid of [-1,1.5,"2",null,Number.MAX_SAFE_INTEGER+1]) {
  const receipt=exchange("release",{ok:1,released:invalid,stop:"untrusted",sold:[101],wallet:{fish:{room:invalid},room:99},left:88},[101]);
  assert.deepEqual(receipt,{action:"release",ok:false,stop:null,soldCount:null,released:null,remainingAllowance:null,at:100},
    "reject coercion, unsafe numbers, unknown stop text, unrelated counts and wallet fallbacks");
}
assert.equal(exchange("bag",{ok:true,wallet:{fish:{room:0}}}).remainingAllowance,0);
assert.equal(exchange("sell",{ok:false,stop:"cap"}).soldCount,null,"missing sold list is unknown, not zero");
const expired=send("release",[102]); clock=60101;
assert.equal(receive(expired,{ok:true,released:1}),undefined,"expired ACK is ignored");
const resetAck=send("sell",[102]); hello();
assert.equal(receive(resetAck,cap),undefined,"hello clears previous connection requests");
const malformed=send("bag");
assert.equal(journal.received("43"+malformed+"[null]"),undefined);
assert.equal(journal.received('43bad[{}]'),undefined);
assert.equal(journal.received('42[broken'),undefined);
console.log("PASS fishing bag receipts: sanitized summaries, cap, release, strict counts, correlation and reconnect");
