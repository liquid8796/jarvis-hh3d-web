#!/usr/bin/env node
/** Exercise the real quest interpreter and worker capability clock without a browser. */
import assert from "node:assert/strict";
import { createQuestEngine, QuestAborted } from "../src/lib/quest-engine/engine.mjs";
import * as access from "../src/lib/quest-engine/fishingAccess.mjs";
import { splitTags } from "../src/lib/validation/tags";

const log = { info() {}, debug() {}, warning() {} };
const quest = { id: "cau-ca", name: "Câu Cá", kind: "customSteps", steps: [{ action: "click", selector: "#cast" }] };
let clicks: string[] = [];
const session = { humanDelay: async () => {}, click: async (selector: string) => { clicks.push(selector); return true; } };
const denied = createQuestEngine({ log, canFish: () => false });
const deniedResult = await denied.run(session, {}, quest);
assert.deepEqual(clicks, [], "expired fishing access never clicks the game");
assert.equal(deniedResult.outcome, "skipped");

let allowed = true;
const liveSession = { ...session, click: async (selector: string) => {
  clicks.push(selector); allowed = false; return true;
} };
const live = createQuestEngine({ log, canFish: () => allowed });
clicks = [];
const result = await live.run(liveSession, {}, { ...quest, steps: [
  { action: "click", selector: "#first" }, { action: "click", selector: "#second" },
] });
assert.deepEqual(clicks, ["#first"], "revocation interrupts between safe steps");
assert.equal(result.outcome, "skipped");
clicks = [];
await live.run(session, {}, { ...quest, id: "another", name: "Other quest" });
assert.deepEqual(clicks, ["#cast"], "expiry does not disable unrelated quests");

let reelStopped = false;
const reelEngine = createQuestEngine({ log, canFish: () => allowed });
allowed = true;
const reelResult = await reelEngine.run({
  ...session,
  fishingReel: async (shouldStop: () => boolean) => { allowed = false; reelStopped = shouldStop(); },
}, {}, { ...quest, id: "cau-ca-thuong", steps: [{ action: "fishingReel" }, { action: "click", selector: "#after" }] });
assert.equal(reelStopped, true, "expiry releases active reel control");
assert.equal(reelResult.outcome, "skipped");
await assert.rejects(createQuestEngine({ log, canFish: () => false, shouldStop: () => true }).run(session, {}, quest), QuestAborted);
console.log("PASS expired fishing skipped, active loop interrupted, reel released, other quests preserved");

let clock = Date.parse("2026-11-07T12:00:00.000Z");
const gate = access.createFishingAccessGate({ allowed: true, expiresAt: "2026-11-07T12:00:01.000Z" }, () => clock);
assert.equal(gate.canFish(), true);
clock += 1000;
assert.equal(gate.canFish(), false, "deadline expires even without heartbeat/network");
gate.update({ allowed: true, expiresAt: null }); assert.equal(gate.canFish(), true);
gate.update({ allowed: false, expiresAt: null }); assert.equal(gate.canFish(), false);
gate.update(undefined); assert.equal(gate.canFish(), false, "missing heartbeat field cannot regrant revoked access");
gate.update({ allowed: true, expiresAt: "bad" }); assert.equal(gate.canFish(), false);
assert.equal(access.createFishingAccessGate(undefined).canFish(), true, "older servers retain legacy unlimited behavior");
assert.deepEqual(splitTags("VIP, vip,  Thánh   nữ , thánh nữ"), ["VIP", "Thánh   nữ"]);
console.log("PASS worker deadline, heartbeat refresh, invalid data and normalized tag deduplication");
