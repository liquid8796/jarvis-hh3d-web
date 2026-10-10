#!/usr/bin/env node
import assert from "node:assert/strict";
import { createQuestEngine, QuestAborted } from "../src/lib/quest-engine/engine.mjs";

const noOp = () => {};
const log = { info: noOp, warning: noOp, debug: noOp };
const run = async (id, stopAfter = Infinity) => {
  let ticks = 0;
  const quest = {
    id, name: "Câu Cá", kind: "customSteps", enabled: true, options: [
      { key: "castLimit", selectedValue: "0", choices: [{value:"0",label:"∞"}] }
    ],
    fallbackCooldownSeconds: 0,
    steps: [{
      action: "repeat", maxIterations: 200, maxSeconds: 480,
      until: { kind: "visible", selector: "body.jvz-fish-finished" },
      steps: [{
        action: "evaluateJavaScript",
        script: "() => { window.__jvzFish ||= {}; return ''; }",
      }]
    }]
  };
  const session = { evaluate: async (script, args) => {
    if (args?.selector === "body.jvz-fish-finished") return ticks >= 215;
    ticks++;
    return "";
  } };
  const engine = createQuestEngine({log, shouldStop:()=>ticks>=stopAfter});
  try { return {outcome: await engine.run(session, {}, quest), ticks}; }
  catch (error) { return { error, ticks}; }
};

for (const id of ["cau-ca", "cau-ca-thuong"]) {
  const normal = await run(id);
  assert.equal(normal.outcome?.outcome, "completed");
  assert.equal(normal.ticks, 215, id + " should not stop at 200");
  const stopped = await run(id, 207);
  assert.ok(stopped.error instanceof QuestAborted, id + " must respond to Thu Đàn");
  assert.equal(stopped.ticks, 207);
}
const regular = await run("ordinary-quest");
assert.equal(regular.outcome?.outcome, "completed");
assert.equal(regular.ticks, 200, "other quests retain 200-iteration cap");
console.log("PASS: VIP/free Câu Cá passes 200 ticks; only Thu Đàn interrupts; other repeats capped.");
