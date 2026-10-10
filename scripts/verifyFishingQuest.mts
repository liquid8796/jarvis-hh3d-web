#!/usr/bin/env node
/** October 10 fishing recording: require an admin gate and two tier-identical quests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enforceFishingAdminPolicy } from "../src/lib/quest-engine/fishingAccess.mjs";

const p = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"));
assert.equal(p.schemaVersion, 89);
const v = p.quests.find((q: { id: string }) => q.id === "cau-ca");
const f = p.quests.find((q: { id: string }) => q.id === "cau-ca-thuong");
assert.ok(v && f, "both tiers have a fishing quest");
for (const [quest, isFree] of [[v, false], [f, true]] as const) {
  assert.equal(quest.enabled, false, "disabled by default");
  assert.equal(quest.requiresVip, !isFree);
  assert.equal(quest.group, "Tiên Giới");
  assert.equal(quest.pagePath, "/game/");
  assert.equal(quest.kind, "customSteps");
  assert.ok(quest.options.some((o: { key: string }) => o.key === "sellBelow"));
  assert.ok(quest.options.some((o: { key: string }) => o.key === "castLimit"));
  const repeating = quest.steps.find((s: { action: string }) => s.action === "repeat");
  assert.ok(repeating);
  assert.ok(repeating.steps.some((s: { action: string; selector?: string; pressMs?: number }) =>
    s.action === "click" && s.selector?.includes("jvz-fish-press") && s.pressMs === 280),
    "game requires trusted Playwright input with hold time");
}
assert.deepEqual(v.steps, f.steps, "same game protocol for both account tiers");
const cfg = { quests: { cauCa: { enabled: true, sellBelow: 8, castLimit: 0 } } };
assert.equal(enforceFishingAdminPolicy(cfg, true), cfg, "admin may enable");
const denied = enforceFishingAdminPolicy(cfg, false);
assert.equal(denied.quests.cauCa.enabled, false, "non-admin cannot activate via forged config");
assert.equal(cfg.quests.cauCa.enabled, true, "policy must not mutate input");
console.log("PASS: Câu Cá twin quests, options and admin-only gate");
