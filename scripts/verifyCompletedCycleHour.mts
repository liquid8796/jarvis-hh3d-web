import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { completedCycleMinimumSeconds } from "../src/lib/quest-engine/runCycle.mjs";
import { computeNextDelaySeconds } from "../src/lib/quest-engine/cooldown.mjs";

const floor=completedCycleMinimumSeconds([{id:"me-cung"}, {id:"phuc-loi-duong"}],["phuc-loi-duong"]);
assert.equal(floor,3600);
const wait=(results: Array<{ outcome: string; cooldownSeconds?: number }>,options: { random?: () => number } = {})=>computeNextDelaySeconds(results,{minimumSeconds:floor,random:()=>0,...options});
assert.equal(wait([{outcome:"completed",cooldownSeconds:420}]),3600,"7-minute quest must not accelerate entire completed board");
assert.equal(wait([{outcome:"alreadyDone",cooldownSeconds:60}]),3600);
assert.equal(wait([{outcome:"failed"}]),3600,"full board with nonfatal quest failures has the same rest interval");
assert.equal(wait([{outcome:"onCooldown",cooldownSeconds:7200}]),7200,"real 2-hour cooldown must remain 2h");
assert.equal(wait([], {random:()=>0.9999}),3625,"jitter stays within 25 seconds");
assert.equal(computeNextDelaySeconds([{outcome:"failed"}],{random:()=>0}),1800,"early failures keep their 30m fallback");
assert.equal(computeNextDelaySeconds([],{random:()=>0}),300,"empty check keeps its 5m fallback");
const source=readFileSync(new URL("../src/lib/quest-engine/runCycle.mjs",import.meta.url),"utf8");
assert.ok(source.includes("const minimumSeconds = completedCycleMinimumSeconds(quests, cappedToday);"),
  "one-hour minimum must be used by the actual all-quests-completed return path");
console.log("PASS: full-cycle 60m, old 7m regression, >60m timer, jitter, aborted/empty exceptions");
