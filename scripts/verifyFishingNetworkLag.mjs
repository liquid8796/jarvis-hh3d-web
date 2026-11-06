import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFishingTelemetry, chooseFishingHold } from "../src/lib/quest-engine/fishingServo.mjs";

const frame = (t, z=.55, f=.45) => '42["g:snap",'+JSON.stringify({t,z,f,fv:-.05,zone:.25,p:.3})+']';
const telemetry = createFishingTelemetry();
assert.equal(telemetry.ingest(frame(.066,.45,.5), 10000), true);
assert.equal(telemetry.ingest(frame(.132,.46,.5), 10066), true);
assert.equal(telemetry.ingest(frame(.198,.47,.5), 10450), true);
assert.ok(telemetry.current(10455).networkLagMs >= 240,
  "backlogged g:snap must be recognized as delayed, not fresh");
assert.equal(telemetry.ingest(frame(.170,.1,.1), 10460), false,
  "out-of-order snapshot must never overwrite latest gauge");
assert.ok(telemetry.current(10460).z > .46, "discarded stale frame must not reverse servo");
const fresh = telemetry.current(10455);
assert.ok(fresh.lookaheadSeconds > .26, "network delay should increase bounded prediction horizon");
assert.ok(fresh.lookaheadSeconds <= .52, "prediction must stay bounded for stability");
assert.equal(telemetry.current(10900), null,
  "stale gauge must release the mouse rather than steer blindly");
assert.equal(telemetry.ingest(frame(.264,.49,.5), 10910), false,
  "very late server state must not replace a fresh state");
assert.equal(telemetry.ingest(frame(1.1,.51,.5), 11040), true,
  "recovered on-time packet must restore telemetry");
assert.ok(telemetry.current(11045) !== null);
assert.equal(telemetry.ingest(frame(4.2,.55,.5), 14200), true);
assert.equal(telemetry.ingest(frame(.066,.52,.5), 14300), true,
  "new fishing fight resets the server clock and latency estimator");
assert.ok(telemetry.current(14305).networkLagMs < 20);
assert.equal(telemetry.ingest('42["g:evt",{"type":"st","s":"reel"}]', 14306), false);
const fixture={z:.45,f:.65,fv:.05,zone:.2};
// Live 2026-11-06: g:evts batches local st:reel then authoritative reel.
// Each fight has its own clock; never infer its identity from t alone.
const wire = (event, payload) => '42'+JSON.stringify([event,payload]);
const reel = {type:'reel',t:0,z:.5,f:.5,fv:0,p:.3,in:1,zone:.26,ft:.3282,sp:.75};
for (const oldTime of [.33, 2]) {
  const fight = createFishingTelemetry();
  assert.equal(fight.ingest(frame(oldTime),100000),true);
  fight.ingest(wire('g:evts', [{type:'st',uid:7,s:'reel'},reel]),109538);
  assert.equal(fight.ingest(frame(.462),110000),true,
    'authoritative reel must reset a short old fight or missed first 400ms');
  assert.equal(fight.current(110000).networkLagMs,0);
  assert.equal(fight.ingest(frame(2.1),111638),true);
  assert.equal(fight.current(111638).networkLagMs,0);
  fight.ingest(wire('g:evt',{type:'st',uid:999,s:'idle'}),111639);
  assert.ok(fight.current(111639),'another player state must not clear our fight');
  fight.ingest(wire('g:evt',{type:'escaped',hint:'test'}),111640);
  assert.equal(fight.current(111640),null,'escape clears old gauge');
  assert.equal(fight.ingest(frame(2.166),111704),false,'late escaped-fight frame stays rejected');
  fight.ingest(wire('g:evt',reel),120000);
  assert.ok(fight.current(120000),'single reel event seeds first valid gauge');
  fight.reset();
  assert.equal(fight.current(120000),null,'socket lifecycle can clear telemetry');
}
const ordered = createFishingTelemetry();
ordered.ingest(wire('g:evts',[{type:'escaped'},reel]),130000);
assert.ok(ordered.current(130000),'event batches must preserve escape then reel order');
ordered.ingest(wire('g:evt',{type:'catch',uid:999}),130001);
assert.ok(ordered.current(130001),'broadcast catch must not end our fight');
ordered.ingest(wire('g:evt',{...reel,line:{}}),130002);
assert.equal(ordered.current(130002),null,'special hunt cannot reuse normal bar gauge');
assert.equal(ordered.ingest(frame(.066),130068),false);
const live = JSON.parse(readFileSync(new URL('./fixtures/fishing-live-20261106.json',import.meta.url),'utf8'));
for (const oldTime of [.33,2]) {
  const replay=createFishingTelemetry();
  replay.ingest(frame(oldTime),1000);
  let accepted=0;
  for(const record of live.frames) {
    const at=100000+record.at;
    const ok=replay.ingest(wire(record.event,record.data),at);
    if(record.event==='g:snap' && record.data[1]>0) {
      const current=replay.current(at);
      assert.ok(current,'recorded current gauge stays fresh');
      assert.equal(current.t,record.data[1]/1000,'only equal-time duplicates may be ignored');
      if(ok) accepted++;
    }
  }
  assert.equal(accepted,52,'52 advancing frames plus three equal-time duplicates');
  assert.equal(replay.current(100000+live.frames.at(-1).at),null,
    'recorded escaped event clears gauge immediately, before freshness expires');
}
console.log('PASS live 56-snapshot replay across short/long prior fights and ordered lifecycle events');
const caught = JSON.parse(readFileSync(new URL('./fixtures/fishing-catch-20261106.json',import.meta.url),'utf8'));
const catchReplay=createFishingTelemetry();
catchReplay.ingest(frame(.33),1000);
let maxProgress=0;
for(const record of caught.frames){
  const at=200000+record.at;
  catchReplay.ingest(wire(record.event,record.data),at);
  if(record.event==='g:snap'){
    const gauge=catchReplay.current(at);
    assert.ok(gauge,'actual successful catch telemetry remains fresh');
    maxProgress=Math.max(maxProgress,gauge.p);
  }
}
assert.equal(maxProgress,1,'captured successful fight reaches server progress 1.000');
assert.equal(caught.outcome.bagAfter,caught.outcome.bagBefore+1);
console.log('PASS successful live catch replay: server p=1.000 and verified bag increment');
const slow=chooseFishingHold(fixture,{velocity:0,last:false,now:1_000,lastSwitchedAt:0,lookaheadSeconds:.48});
assert.equal(typeof slow,"boolean");
console.log("PASS fishing jitter test: age, lag, reorder, fight resets, bounded prediction");
