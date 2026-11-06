import assert from "node:assert/strict";
import { completedCycleDelaySeconds, completedCycleMinimumSeconds } from "../src/lib/quest-engine/runCycle.mjs";
import { computeNextDelaySeconds } from "../src/lib/quest-engine/cooldown.mjs";

const wait = (ids: string[], results: object[], capped: string[] = [], random = () => 0) =>
  completedCycleDelaySeconds(ids.map((id) => ({ id })), results, capped, { random });
const result = (questId: string, cooldownSeconds: number, outcome = "onCooldown") =>
  ({ questId, cooldownSeconds, outcome });

for (const id of ["phan-thuong-hoat-dong", "phan-thuong-hoat-dong-thuong", "hoang-vuc", "phuc-loi-duong"]) {
  assert.equal(wait([id], [result(id, 420)]), 420, id + ": unfinished turns keep their timer");
  assert.equal(wait([id], [result(id, 7200)]), 7200, id + ": longer timers remain intact");
  assert.equal(wait([id], [{ questId: id, outcome: "failed" }]), 1800, id + ": failure is not exhausted quota");
}
const hub = "phan-thuong-hoat-dong";
const maze = "me-cung";
assert.equal(wait([hub, maze], [result(hub, 1800), result(maze, 60)]), 1800,
  "short repeating timer must not override the unfinished hub's 30-minute timer");
assert.equal(wait([hub, maze], [result(hub, 60, "alreadyDone"), result(maze, 420)], [hub]), 3600,
  "completed daily timer is ignored and ordinary board rests hourly");
assert.equal(wait([hub, maze], [result(hub, 60, "alreadyDone"), result(maze, 7200)], [hub]), 7200,
  "completed daily timer cannot shorten a remaining 2-hour quest");
assert.equal(wait(["phuc-loi-duong"], [result("phuc-loi-duong", 60)], ["phuc-loi-duong"]), 3600,
  "monthly welfare revisit survives daily cap");

for (const id of ["bi-canh-tong-mon", "bi-canh-tong-mon-thuong"]) {
  const spent = { questId: id, outcome: "alreadyDone", dailyCapReached: true, cooldownSeconds: 420 };
  assert.equal(wait([id], [spent]), 3600, id + ": exhausted boss is rechecked hourly");
  assert.equal(wait([id], [result(id, 412)], [id]), 412, id + ": new boss clears hourly wait and stale daily mark");
  assert.equal(wait([id], [result(id, 420, "completed")]), 420, id + ": successful attack uses game timer");
  assert.equal(wait([id], [{ questId: id, outcome: "failed" }]), 1800, id + ": unknown boss state is retryable");
  assert.equal(wait([hub, id], [result(hub, 60, "alreadyDone"), result(id, 412)], [hub]), 412);
}
for (const id of ["hy-su-duong", "hy-su-duong-thuong"]) {
  assert.equal(completedCycleMinimumSeconds([{ id }], [id]), 0, id + ": no hub/hour floor");
  assert.equal(wait([id], [result(id, 120)]), 120, id + ": own timer remains independent");
  assert.equal(wait([hub, id], [result(hub, 7200), result(id, 3600)]), 3600,
    id + ": long hub timer cannot postpone wedding revisit");
  assert.equal(wait([hub, id], [result(hub, 7200), result(id, 120)]), 120);
  assert.equal(wait([hub, id], [result(hub, 1800), result(id, 3600)]), 1800,
    id + ": wedding fallback cannot postpone an unfinished hub");
}
assert.equal(wait([], [], [], () => 0.9999), 3625, "jitter applied only once");
assert.equal(computeNextDelaySeconds([{ outcome: "failed" }], { random: () => 0 }), 1800);
assert.equal(computeNextDelaySeconds([], { random: () => 0 }), 300);
console.log("PASS: unfinished hubs, capped groups, boss transitions, Hỷ Sự independence, failure fallback and jitter");
