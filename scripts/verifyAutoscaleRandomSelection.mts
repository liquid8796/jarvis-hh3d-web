import assert from "node:assert/strict";
import { chooseWorkflowTransitions, chooseWorkflowTransitionsWithPriority, autoscaleEligibleStations } from "../src/lib/validation/workerAutoscale";

// Injected random values make these regressions deterministic and prove no registration-order bias.
const first = () => 0;
const last = () => 0.999999;
const active = ["guild/a", "guild/b", "guild/c", "guild/d"];
const inactive = ["guild/e", "guild/f", "guild/g", "guild/h"];

const shrinkFirst = chooseWorkflowTransitions(active, inactive, 2, first);
const shrinkLast = chooseWorkflowTransitions(active, inactive, 2, last);
assert.notDeepEqual(shrinkFirst.selected, shrinkLast.selected, "scale-in must not always spare the oldest registered workers");
for (const plan of [shrinkFirst, shrinkLast]) {
  assert.equal(plan.selected.length, 2);
  assert.equal(plan.disable.length, 2);
  assert.equal(plan.enable.length, 0);
  assert.deepEqual([...plan.selected, ...plan.disable].sort(), [...active].sort());
}

const growFirst = chooseWorkflowTransitions(["guild/a"], inactive, 3, first);
const growLast = chooseWorkflowTransitions(["guild/a"], inactive, 3, last);
assert.notDeepEqual(growFirst.enable, growLast.enable, "scale-out must not always pick earliest registered inactive workers");
for (const plan of [growFirst, growLast]) {
  assert.deepEqual(plan.disable, []);
  assert.equal(plan.enable.length, 2);
  assert.ok(plan.selected.includes("guild/a"), "scale-out retains the current worker");
}

assert.deepEqual(chooseWorkflowTransitions(["guild/a", "guild/b"], inactive, 2, first), {
  selected: ["guild/a", "guild/b"], enable: [], disable: [],
}, "reconciliation at target must not churn or swap workers");
const zero = chooseWorkflowTransitions(active, inactive, 0, first);
assert.deepEqual(zero.disable, active);
const all = chooseWorkflowTransitions(active, inactive, 8, first);
assert.equal(all.enable.length, 4);
assert.equal(all.disable.length, 0);

const manualHold = chooseWorkflowTransitionsWithPriority(active, inactive, 2, ["guild/c"], first);
assert.ok(manualHold.selected.includes("guild/c"), "manual-run priority survives random downscale");
assert.ok(!manualHold.disable.includes("guild/c"));
const heldInactive = chooseWorkflowTransitionsWithPriority(active, inactive, 5, ["guild/h"], first);
assert.ok(heldInactive.selected.includes("guild/h"), "manually activated inactive workflow must be retained");
assert.ok(heldInactive.selected.filter(s => active.includes(s)).length === active.length,
  "no existing worker is sacrificed when target has room for its manual hold");

const eligible = autoscaleEligibleStations([
  {owner:"guild",repo:"a"}, {owner:"guild",repo:"b"}, {owner:"guild",repo:"c"},
], ["guild/b"]);
assert.deepEqual(eligible.map(s=>s.repo), ["a","c"], "manual disables are excluded before random sampling");

console.log("PASS autoscale random scale-out/scale-in, no-churn reconciliation, manual priorities and explicit pauses");
