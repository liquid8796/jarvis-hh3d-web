import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Regression based on 2026-10-26 recording: .ddg-day.is-today remains after success,
// but the primary stamp transitions from actionable to is-done+disabled.
const before = '<div id="ddGrid"><button class="ddg-day is-today" id="ddDay6"></button></div><button id="ddStamp" class="ddg-seal">Điểm Danh</button>';
const after = '<div id="ddGrid"><button class="ddg-day is-today" id="ddDay6"></button></div><button id="ddStamp" class="ddg-seal is-done" disabled="">Đã điểm danh</button>';
assert.match(before, /class="ddg-day is-today"/);
assert.match(after, /class="ddg-day is-today"/);
assert.match(after, /id="ddStamp" class="ddg-seal is-done" disabled/);
const expected = ["#ddGrid .ddg-day.is-today", "#ddStamp.is-done[disabled]", "#ddStamp:not(.is-done):not([disabled])"];
const forbidden = ["#ddGrid .dd-tile.is-today", "#ddGrid .dd-tile.is-today.is-claimed"];
const web = JSON.parse(readFileSync(resolve("src/lib/quest-engine/profile.json"), "utf8"));
const quest = web.quests.find((q: { id?: string }) => q.id === "diem-danh-thuong");
assert.ok(quest, "web free checkin exists");
const steps = quest.steps;
assert.equal(steps[0].action, "navigate");
assert.equal(steps[1].selector, "#ddPage");
assert.equal(steps[2].selector, expected[0]);
assert.equal(steps[3].action, "stopIf");
assert.equal(steps[3].condition?.selector, expected[1]);
assert.equal(steps[4].action, "click");
assert.equal(steps[4].selector, "#ddStamp");
assert.equal(steps[4].when?.selector, expected[2]);
assert.equal(steps[5].action, "waitForCondition");
assert.equal(steps[5].condition?.selector, expected[1]);
const serialized = JSON.stringify(steps);
for (const old of forbidden) assert.ok(!serialized.includes(old), "old checkin selector removed: " + old);
const pcSource = resolve("../jarvis-hh3d-pc/src/JarvisHH3D.Infrastructure/Quests/DefaultQuestProfile.cs");
if (existsSync(pcSource)) {
  const source = readFileSync(pcSource, "utf8");
  const start = source.indexOf("private static QuestDefinition CheckinFree(");
  const end = source.indexOf("private static List<QuestStep> WelfareProgressSteps()", start);
  assert.ok(start >= 0 && end > start, "PC checkin method present");
  const pc = source.slice(start, end);
  for (const selector of expected) assert.ok(pc.includes(selector), "PC missing selector " + selector);
  for (const old of forbidden) assert.ok(!pc.includes(old), "PC contains outdated selector: " + old);
  const persistence = readFileSync(resolve("../jarvis-hh3d-pc/src/JarvisHH3D.Infrastructure/Persistence/JsonQuestRepository.cs"), "utf8");
  assert.match(persistence, /migratedCheckin/, "PC must migrate existing user-saved checkin steps without resetting quest toggles");
}
console.log("PASS: checkin new calendar/stamp state, idempotence, PC/Web parity");
