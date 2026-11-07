#!/usr/bin/env node
/** October 10 fishing recording: require an access gate and two tier-identical quests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";
import { configSchema } from "../src/lib/services/configs";
import { enforceFishingAccessPolicy } from "../src/lib/quest-engine/fishingAccess.mjs";

const p = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"));
assert.ok(p.schemaVersion >= 92, "fishing quest is present in later profile schema migrations");
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
  const trustedClicks = repeating.steps.filter(
    (s: { action: string }) => s.action === "click");
  assert.equal(trustedClicks.length, 3,
    "enter Tiên Giới first; cast and hook have distinct timing");
  assert.ok(trustedClicks.some((s: {selector: string; pressMs: number}) =>
    s.selector === ".pl-go.jvz-fish-enter" && s.pressMs === 80),
    "official Vào Ngay is required before background game clicks");
  assert.ok(trustedClicks.some((s: {selector: string; pressMs: number}) =>
    s.selector.includes(".st-idle.jvz-fish-press") && s.pressMs === 280),
    "retain reliable 280ms casting input");
  assert.ok(trustedClicks.some((s: {selector: string; pressMs: number}) =>
    s.selector.includes(".st-bite.jvz-fish-press") && s.pressMs === 90),
    "recorded successful hook released after 88–115ms");
  assert.ok(repeating.steps.some((s: {action: string; timeoutMs?: number}) =>
    s.action === "waitMilliseconds" && (s.timeoutMs ?? 1000) <= 260),
    "poll bite promptly before the Giật! window closes");
}
assert.deepEqual(v.steps, f.steps, "same game protocol for both account tiers");
for (const quest of [v, f]) {
  const repeating = quest.steps.find((s: { action: string }) => s.action === "repeat");
  assert.equal(repeating.maxIterations, 200, "profile retains caps for other quests");
  assert.equal(repeating.maxSeconds, 480, "engine bypass is restricted to fishing runtime");
}
const cfg = { quests: { cauCa: { enabled: true, sellBelow: 8, castLimit: 0 } } };
assert.equal(enforceFishingAccessPolicy(cfg, true), cfg, "authorized user may enable");
const denied = enforceFishingAccessPolicy(cfg, false);
assert.equal(denied.quests.cauCa.enabled, false, "unauthorized user cannot activate via forged config");
assert.equal(cfg.quests.cauCa.enabled, true, "policy must not mutate input");
console.log("PASS: Câu Cá twin quests, options and access gate");

assert.equal(configSchema.parse({}).quests.cauCa.spot, "giua", "old config retains Giữa hồ");
assert.equal(configSchema.safeParse({quests:{cauCa:{spot:"invalid"}}}).success, false);
for (const spot of ["nong", "sen", "giua", "cau", "random"]) {
  const config = configSchema.parse({ quests: { cauCa: { enabled: true, spot } } });
  const profile = profileForConfig(config);
  for (const q of profile.quests.filter((q: { id: string }) => ["cau-ca", "cau-ca-thuong"].includes(q.id))) {
    assert.equal(q.options.find((o: { key: string; selectedValue: string }) => o.key === "spot")?.selectedValue, spot, "spot survives validation and both profile twins");
  }
}
console.log("PASS fishing spot config defaults, validation and twin translation");

assert.equal(configSchema.parse({}).quests.cauCa.sellEveryCasts, 5,
  "old config defaults to checking and selling every five accepted casts");
const legacyFishing = configSchema.parse({ quests: { cauCa: { enabled: true, sellBelow: 8, castLimit: 10 } } });
assert.equal(legacyFishing.quests.cauCa.sellEveryCasts, 5, "existing fishing configs receive the interval default");
for (const quest of [v, f]) {
  const interval = quest.options.find((o: { key: string }) => o.key === "sellEveryCasts");
  assert.ok(interval, "both raw profile twins expose the sell interval");
  assert.equal(interval.selectedValue, "5");
  assert.equal(interval.allowCustom, true);
  assert.equal(interval.customMinimum, 1);
  assert.equal(interval.customMaximum, 10000);
}
for (const sellEveryCasts of [1, 5, 7, 10000]) {
  const config = configSchema.parse({ quests: { cauCa: { enabled: true, sellEveryCasts } } });
  assert.equal(config.quests.cauCa.sellEveryCasts, sellEveryCasts);
  const twins = profileForConfig(config).quests.filter((q: { id: string }) => ["cau-ca", "cau-ca-thuong"].includes(q.id));
  assert.equal(twins.length, 2);
  for (const quest of twins) {
    assert.equal(quest.options.find((o: { key: string; selectedValue: string }) => o.key === "sellEveryCasts")?.selectedValue,
      String(sellEveryCasts), "custom interval survives validation and both profile twins");
  }
}
for (const sellEveryCasts of [0, -1, 1.5, 10001, Number.NaN, Infinity, "5", null]) {
  assert.equal(configSchema.safeParse({ quests: { cauCa: { sellEveryCasts } } }).success, false,
    `reject invalid interval ${String(sellEveryCasts)}`);
}
for (const oldConfig of [legacyFishing, cfg]) {
  for (const quest of profileForConfig(oldConfig).quests.filter((q: { id: string }) => ["cau-ca", "cau-ca-thuong"].includes(q.id))) {
    assert.equal(quest.options.find((o: { key: string; selectedValue: string }) => o.key === "sellEveryCasts")?.selectedValue, "5",
      "legacy profile callers also receive the interval default");
  }
}

// Exercise the real form conversion without importing Next's authenticated server-action dependencies.
const actionSource = readFileSync(new URL("../src/app/actions/automation.ts", import.meta.url), "utf8");
const intervalExpression = actionSource.match(/^\s*sellEveryCasts: (.+),\s*$/m)?.[1];
assert.ok(intervalExpression, "server action reads the interval field");
const readInterval = new Function("formData", `return (${intervalExpression});`) as (form: FormData) => number;
for (const [raw, expected] of [[undefined, 5], ["", 5], ["abc", 5], ["1", 1], ["7", 7], ["7.9", 7], ["-2", 1], ["10001", 10000]] as const) {
  const form = new FormData();
  if (raw !== undefined) form.set("cauCaSellEveryCasts", raw);
  const interval = readInterval(form);
  assert.equal(interval, expected, `server normalizes interval ${String(raw)}`);
  assert.equal(configSchema.safeParse({ quests: { cauCa: { sellEveryCasts: interval } } }).success, true);
}
const formSource = readFileSync(new URL("../src/app/dashboard/ConfigForm.tsx", import.meta.url), "utf8");
assert.equal((formSource.match(/name="cauCaSellEveryCasts"/g) ?? []).length, 1, "one shared input serves both account tiers");
assert.match(formSource, /name="cauCaSellEveryCasts" min=\{1\} max=\{10000\} step=\{1\}/);
assert.match(formSource, /defaultValue=\{config\.quests\.cauCa\.sellEveryCasts\}/);
console.log("PASS fishing sale interval defaults, bounds, form conversion and twin translation");
