import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";
import { isDailyQuotaQuest, skipQuestForToday, reachedDailyQuota } from "../src/lib/quest-engine/dailyQuota.mjs";
import { isDedicatedPageQuest } from "../src/lib/quest-engine/questGate.mjs";
import { applyQuestTimerGates } from "../src/lib/quest-engine/questTimers.mjs";
import { questsForAccount } from "../src/lib/quest-engine/engine.mjs";

const loaded = loadProfile();
const ids = ["bi-canh-tong-mon", "bi-canh-tong-mon-thuong"];
const knownDayCap = new Set(ids);
const config = {
  quests: { biCanh: { enabled: true } },
  questTimers: [{ questKey: "biCanh", hour: 23, minute: 59, second: 59 }],
};
for (const id of ids) {
  const quest = loaded.quests.find(q => q.id === id);
  assert.ok(quest, id + " exists");
  assert.ok(isDedicatedPageQuest(loaded, quest), id + " uses own-page lane");
  assert.equal(isDailyQuotaQuest(quest), false, id + " is never a daily_done quest");
  assert.equal(skipQuestForToday(quest, knownDayCap), false, id + " is not skipped even with stale daily marks");
  assert.equal(reachedDailyQuota(quest, { outcome: "alreadyDone", dailyCapReached: true }), false,
    id + " cannot append a new daily mark");
  assert.equal(quest.steps[0].action, "navigate");
  assert.equal(quest.steps[0].text, "/bi-canh-tong-mon/?nv_embed=1", id + " opens direct boss page");
  assert.ok(!quest.steps.some(step =>
    JSON.stringify(step).includes("#nv-btm-attack-btn") ||
    JSON.stringify(step).includes("/nhiem-vu-hang-ngay") ||
    JSON.stringify(step).includes("a.btn-go[href*=")),
    id + " must not navigate/check hub quest");
  assert.ok(quest.steps.some(step => step.selector === "#claim-reward-btn"));
  assert.ok(quest.steps.some(step => step.selector === "#contribute-boss-btn:not(:disabled)"));
  assert.ok(quest.steps.some(step => step.selector === "#attack-boss-btn"));
  assert.ok(quest.steps.some(step => step.condition?.selector === "#challenge-boss-btn"
    && step.condition?.text === "hết lượt"), id + " respects game daily attack limit");
  quest.enabled = true;
}
const [vip, free] = ids.map(id => loaded.quests.find(q => q.id === id));
assert.deepEqual(vip.steps, free.steps, "VIP/free use the same direct boss page sequence");
assert.ok(questsForAccount(loaded, { isVip: true }).some(q => q.id === vip.id));
assert.ok(questsForAccount(loaded, { isVip: false }).some(q => q.id === free.id));
applyQuestTimerGates(loaded, config, new Date("2026-11-02T00:00:00+07:00"));
assert.equal(vip.enabled, true, "legacy timer cannot suppress VIP");
assert.equal(free.enabled, true, "legacy timer cannot suppress free");
console.log("PASS: both Bí Cảnh tiers run each worker cycle, do not depend on hub/daily marks/timers");

// Optional sibling checkout. Web-only CI does not need to carry desktop source.
const pcFile = path.resolve("..", "jarvis-hh3d-pc", "src",
  "JarvisHH3D.Infrastructure", "Quests", "DefaultQuestProfile.cs");
if (existsSync(pcFile)) {
  const pc = readFileSync(pcFile, "utf8");
  assert.match(pc, /BiCanhVip\(L\)/, "desktop VIP uses dedicated flow");
  assert.match(pc, /private static QuestDefinition BiCanhVip[\s\S]*?BiCanhFree\(L\)/);
  console.log("PASS: desktop VIP/free share the own-page engine");
}
