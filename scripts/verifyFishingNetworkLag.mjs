import assert from "node:assert/strict";
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
const slow=chooseFishingHold(fixture,{velocity:0,last:false,now:1_000,lastSwitchedAt:0,lookaheadSeconds:.48});
assert.equal(typeof slow,"boolean");
console.log("PASS fishing jitter test: age, lag, reorder, fight resets, bounded prediction");
