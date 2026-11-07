import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configSchema } from "../src/lib/services/configs.ts";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const base = configSchema.parse({});
assert.equal(base.quests.cauCa.releaseBelow, 0, "legacy configs must default release off");
assert.equal(base.quests.cauCa.releaseEveryCasts, 5);
for (const field of ["releaseBelow", "releaseEveryCasts"] as const) {
  const minimum = field === "releaseBelow" ? 0 : 1;
  const maximum = field === "releaseBelow" ? 30 : 10000;
  for (const value of [minimum, maximum]) {
    const parsed = configSchema.parse({ quests: { cauCa: { [field]: value } } });
    assert.equal(parsed.quests.cauCa[field], value);
  }
  for (const value of [minimum - 1, maximum + 1, 1.5, "4"]) {
    assert.equal(configSchema.safeParse({ quests: { cauCa: { [field]: value } } }).success, false);
  }
}
const original = JSON.parse(read("src/lib/quest-engine/profile.json"));
const profile = profileForConfig(configSchema.parse({ quests: { cauCa: {
  enabled: true, sellBelow: 8, sellEveryCasts: 3, releaseBelow: 4, releaseEveryCasts: 7,
} } }));
for (const id of ["cau-ca", "cau-ca-thuong"]) {
  const quest = profile.quests.find((q: { id: string }) => q.id === id);
  const options = new Map(quest.options.map((o: { key: string; selectedValue: string }) => [o.key, o.selectedValue]));
  assert.equal(options.get("releaseBelow"), "4");
  assert.equal(options.get("releaseEveryCasts"), "7");
  assert.equal(options.get("sellBelow"), "8");
  assert.equal(options.get("sellEveryCasts"), "3");
  const legacy = profileForConfig({ quests: { cauCa: { enabled: true } } }).quests.find((q: { id: string }) => q.id === id);
  assert.equal(legacy.options.find((o: { key: string }) => o.key === "releaseBelow").selectedValue, "0");
  assert.equal(legacy.options.find((o: { key: string }) => o.key === "releaseEveryCasts").selectedValue, "5");
  const raw = original.quests.find((q: { id: string }) => q.id === id);
  for (const [key, min, max, value] of [["releaseBelow", 0, 30, "0"], ["releaseEveryCasts", 1, 10000, "5"]]) {
    const option = raw.options.find((o: { key: string }) => o.key === key);
    assert.equal(option.selectedValue, value);
    assert.equal(option.customMinimum, min);
    assert.equal(option.customMaximum, max);
    assert.equal(option.allowCustom, true);
  }
}
const form = read("src/app/dashboard/ConfigForm.tsx");
const action = read("src/app/actions/automation.ts");
for (const [key, name, min, max, fallback] of [
  ["releaseBelow", "cauCaReleaseBelow", 0, 30, 0],
  ["releaseEveryCasts", "cauCaReleaseEveryCasts", 1, 10000, 5],
] as const) {
  const inputs = [...form.matchAll(new RegExp('<input[^>]*name="' + name + '"[^>]*/>', "g"))];
  assert.equal(inputs.length, 1, name + " has one shared VIP/free input");
  const input = inputs[0][0];
  assert.ok(input.includes("min={" + min + "}"));
  assert.ok(input.includes("max={" + max + "}"));
  assert.ok(input.includes("step={1}"));
  assert.ok(input.includes("defaultValue={config.quests.cauCa." + key + "}"));
  assert.ok(input.includes("disabled={!canFish}"));
  const expression = action.match(new RegExp(key + ": ([^\\n]+),"))?.[1];
  assert.ok(expression, name + " is persisted by the form action");
  const parse = new Function("formData", "return (" + expression + ");") as (data: FormData) => number;
  for (const [value, expected] of [[null, fallback], ["7", 7], ["-2", min], ["20000", max], ["3.9", 3], ["bad", fallback]] as const) {
    const data = new FormData();
    if (value !== null) data.set(name, value);
    assert.equal(parse(data), expected, name + ": " + value);
  }
}
console.log("PASS fishing release config: schema bounds/defaults, both twins, legacy off, form wiring and action parsing");
