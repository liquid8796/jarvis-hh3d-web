import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSettingsSchema } from "../src/lib/services/settings";

// A legacy settings document must not enable restrictions or drop unrelated settings.
const legacy = appSettingsSchema.parse({ membership: { requireApproval: false } });
assert.deepEqual((legacy as Record<string, unknown>).questSchedules, []);
assert.equal(legacy.membership.requireApproval, false);

const { QUEST_SCHEDULE_OPTIONS, questScheduleState, applyQuestScheduleGates,
  secondsUntilNextQuestSchedule, createQuestScheduleGate } = await import("../src/lib/quest-engine/questSchedules.mjs");
const { parseQuestSchedules, questSchedulesSchema } = await import("../src/lib/validation/questSchedules");
let passed = 1;
const check = (name: string, run: () => void) => { run(); passed++; console.log("PASS", name); };
const daily = [{ questKey: "hoangVuc", enabled: true, windows: [{ start: "08:00", end: "10:00" }] }];
const at = (iso: string) => new Date(iso);
const state = (iso: string) => questScheduleState(daily, "hoang-vuc", at(iso));

check("UTC+7 opening is inclusive and closing is exclusive", () => {
  assert.equal(state("2026-11-21T00:59:59.999Z").allowed, false);
  assert.equal(state("2026-11-21T01:00:00.000Z").allowed, true);
  assert.equal(state("2026-11-21T02:59:59.999Z").allowed, true);
  assert.equal(state("2026-11-21T03:00:00.000Z").allowed, false);
  assert.equal(state("2026-11-21T03:00:00.000Z").nextOpenAt, Date.parse("2026-11-22T01:00:00.000Z"));
});
check("overnight window covers both dates and excludes its end", () => {
  const overnight = [{ questKey: "cauCa", enabled: true, windows: [{ start: "23:00", end: "02:00" }] }];
  for (const [time, allowed] of [
    ["2026-11-21T15:59:59Z", false], ["2026-11-21T16:00:00Z", true],
    ["2026-11-21T17:30:00Z", true], ["2026-11-21T19:00:00Z", false],
  ] as const) assert.equal(questScheduleState(overnight, "cau-ca-thuong", at(time)).allowed, allowed, time);
  assert.equal(questScheduleState(overnight, "cau-ca", at("2026-11-21T19:00:00Z")).nextOpenAt,
    Date.parse("2026-11-22T16:00:00Z"));
});
check("multiple windows form a union and choose the closest opening", () => {
  const rules = [{ ...daily[0], windows: [{ start: "08:00", end: "09:00" }, { start: "15:00", end: "16:00" }] }];
  assert.equal(questScheduleState(rules, "hoang-vuc", at("2026-11-21T02:00:00Z")).allowed, false);
  assert.equal(questScheduleState(rules, "hoang-vuc", at("2026-11-21T02:00:00Z")).nextOpenAt,
    Date.parse("2026-11-21T08:00:00Z"));
  assert.equal(questScheduleState(rules, "hoang-vuc", at("2026-11-21T08:30:00Z")).allowed, true);
});
check("disabled rules and missing rules leave quests available", () => {
  assert.equal(questScheduleState([{ ...daily[0], enabled: false }], "hoang-vuc", at("2026-11-21T04:00:00Z")).allowed, true);
  assert.equal(questScheduleState([], "hoang-vuc", at("2026-11-21T04:00:00Z")).allowed, true);
  assert.equal(questScheduleState(daily, "van-dap", at("2026-11-21T04:00:00Z")).allowed, true);
});
check("all concrete quest variants have a single global scheduling identity", () => {
  const profile = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"));
  const knownIds = QUEST_SCHEDULE_OPTIONS.flatMap(option => option.questIds);
  assert.equal(new Set(knownIds).size, knownIds.length);
  assert.deepEqual([...knownIds].sort(), profile.quests.map((q: {id:string}) => q.id).sort());
  for (const option of QUEST_SCHEDULE_OPTIONS) {
    const rules = [{ questKey: option.key, enabled: true, windows: [{ start: "08:00", end: "10:00" }] }];
    for (const id of option.questIds) assert.equal(questScheduleState(rules, id, at("2026-11-21T00:00:00Z")).allowed, false, id);
  }
});
check("server gate clones the config, blocks both variants, and never enables a disabled quest", () => {
  const config = { quests: { luyenDan: { enabled: true, keep: 3 }, luyenDanThuong: { enabled: true }, vanDap: { enabled: false } } };
  const rules = [{ questKey: "luyenDan", enabled: true, windows: [{ start: "08:00", end: "10:00" }] }];
  const closed = applyQuestScheduleGates(config, rules, at("2026-11-21T00:00:00Z"));
  assert.equal(closed.quests.luyenDan.enabled, false);
  assert.equal(closed.quests.luyenDanThuong.enabled, false);
  assert.equal(closed.quests.luyenDan.keep, 3);
  assert.equal(closed.quests.vanDap.enabled, false);
  assert.equal(config.quests.luyenDan.enabled, true);
  const open = applyQuestScheduleGates(config, rules, at("2026-11-21T01:00:00Z"));
  assert.equal(open.quests.vanDap.enabled, false);
  assert.equal(open.quests.luyenDan.enabled, true);
});
check("wake targets the next opening only for user-enabled blocked quests", () => {
  const enabled = { quests: { hoangVuc: { enabled: true } } };
  assert.equal(secondsUntilNextQuestSchedule(enabled, daily, at("2026-11-21T00:59:00Z")), 60);
  assert.equal(secondsUntilNextQuestSchedule(enabled, daily, at("2026-11-21T01:30:00Z")), null);
  assert.equal(secondsUntilNextQuestSchedule({ quests: { hoangVuc: { enabled: false } } }, daily, at("2026-11-21T00:59:00Z")), null);
});
check("live gate re-evaluates time and accepts newer admin policy", () => {
  let now = Date.parse("2026-11-21T02:59:59Z");
  const gate = createQuestScheduleGate(daily, { now: () => now });
  assert.equal(gate.state("hoang-vuc").allowed, true);
  now += 1000;
  assert.equal(gate.state("hoang-vuc").allowed, false);
  gate.update([{ ...daily[0], enabled: false }]);
  assert.equal(gate.state("hoang-vuc").allowed, true);
});
check("validation accepts daily windows and rejects ambiguous or malformed schedules", () => {
  assert.deepEqual(questSchedulesSchema.parse(daily), daily);
  assert.equal(parseQuestSchedules(daily).ok, true);
  for (const bad of [
    null, {}, [{ ...daily[0], questKey: "unknown" }], [daily[0], daily[0]],
    [{ ...daily[0], windows: [] }],
    [{ ...daily[0], windows: [{ start: "08:00", end: "08:00" }] }],
    [{ ...daily[0], windows: [{ start: "24:00", end: "10:00" }] }],
    [{ ...daily[0], windows: [{ start: "8:00", end: "10:00" }] }],
    [{ ...daily[0], enabled: "true" }],
    [{ ...daily[0], windows: Array.from({ length: 9 }, () => ({ start: "08:00", end: "10:00" })) }],
  ]) assert.equal(parseQuestSchedules(bad).ok, false, JSON.stringify(bad));
  assert.equal(parseQuestSchedules([{ ...daily[0], enabled: false, windows: [] }]).ok, true);
});
check("malformed active policies fail closed instead of silently permitting execution", () => {
  assert.equal(questScheduleState([{ ...daily[0], windows: [] }], "hoang-vuc", at("2026-11-21T01:00:00Z")).allowed, false);
  assert.equal(questScheduleState([{ ...daily[0], windows: [{ start: "bad", end: "10:00" }] }], "hoang-vuc", at("2026-11-21T01:00:00Z")).allowed, false);
  assert.equal(questScheduleState(null, "hoang-vuc", at("2026-11-21T01:00:00Z")).allowed, false);
});
check("overlapping and adjacent windows close only when the union closes", () => {
  const union = [{ ...daily[0], windows: [
    { start: "08:00", end: "09:00" }, { start: "08:30", end: "10:00" }, { start: "10:00", end: "11:00" },
  ] }];
  assert.equal(questScheduleState(union, "hoang-vuc", at("2026-11-21T01:30:00Z")).closesAt,
    Date.parse("2026-11-21T04:00:00Z"));
  const allDay = [{ ...daily[0], windows: [{ start: "00:00", end: "12:00" }, { start: "12:00", end: "00:00" }] }];
  assert.equal(questScheduleState(allDay, "hoang-vuc", at("2026-11-21T05:00:00Z")).closesAt, null);
  assert.equal(questScheduleState(allDay, "hoang-vuc", at("2026-11-21T05:00:00Z")).allowed, true);
});
check("live gate uses monotonic server time, rejects stale replies, and fails closed after silence", () => {
  let tick = 100;
  let localWall = Date.parse("2020-01-01T00:00:00Z");
  const serverTime = Date.parse("2026-11-21T02:59:59Z");
  const gate = createQuestScheduleGate(daily, {
    now: () => localWall, monotonicNow: () => tick, maxStaleMs: 20_000, serverTimeMs: serverTime,
  });
  assert.equal(gate.state("hoang-vuc").allowed, true);
  tick += 1000;
  localWall -= 100_000;
  assert.equal(gate.state("hoang-vuc").allowed, false);
  assert.equal(gate.state("hoang-vuc").nowMs, serverTime + 1000);
  assert.equal(gate.update([], { serverTimeMs: serverTime - 1 }), false);
  assert.equal(gate.state("hoang-vuc").allowed, false);
  assert.equal(gate.update([]), false);
  tick += 20_000;
  assert.equal(gate.state("van-dap").allowed, false);
  gate.update([], { serverTimeMs: serverTime + 21_000 });
  assert.equal(gate.state("van-dap").allowed, true);
});
check("persisted corruption is isolated and never resets other branches", () => {
  const settings = appSettingsSchema.parse({
    membership: { requireApproval: false },
    questSchedules: [{ ...daily[0], windows: [{ start: "bad", end: "10:00" }] }],
  });
  assert.equal(settings.membership.requireApproval, false);
  assert.equal(questScheduleState(settings.questSchedules, "hoang-vuc", at("2026-11-21T01:00:00Z")).allowed, false);
  assert.equal(questScheduleState(settings.questSchedules, "van-dap", at("2026-11-21T01:00:00Z")).allowed, true);
});
check("pending browser operations cannot outlive the policy freshness deadline", () => {
  const gate = createQuestScheduleGate([], {
    monotonicNow: () => 100, maxStaleMs: 20_000, serverTimeMs: 100_000,
  });
  assert.equal(gate.state("hoang-vuc").closesAt, 120_000);
});
check("response transit uncertainty cannot extend windows or authorization freshness", () => {
  const gate = createQuestScheduleGate(daily, {
    monotonicNow: () => 100, serverTimeMs: Date.parse("2026-11-21T02:59:59Z"), uncertaintyMs: 1500,
  });
  assert.equal(gate.state("hoang-vuc").allowed, false);
  assert.equal(gate.state("hoang-vuc").nextOpenAt, Date.parse("2026-11-22T01:00:00Z"));
  const pending = createQuestScheduleGate([], {
    monotonicNow: () => 100, serverTimeMs: 100_000, maxStaleMs: 20_000, uncertaintyMs: 2000,
  });
  assert.equal(pending.state("van-dap").closesAt, 118_000);
  const staleOnArrival = createQuestScheduleGate([], {
    monotonicNow: () => 100, serverTimeMs: 100_000, maxStaleMs: 20_000, uncertaintyMs: 21_000,
  });
  assert.equal(staleOnArrival.state("van-dap").allowed, false);
});
console.log("PASS quest scheduling:", passed, "behavior groups");
