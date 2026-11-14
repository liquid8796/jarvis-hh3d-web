import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

type Step = { action: string; selector?: string; steps?: Step[]; body?: Step[] };
type Quest = {
  id: string; name: string; requiresVip: boolean; enabled: boolean;
  order: number; pagePath: string; fallbackCooldownSeconds: number;
  steps: Step[]; options: unknown[];
};
const profile = JSON.parse(readFileSync(
  path.join(process.cwd(), "src/lib/quest-engine/profile.json"), "utf8"),
) as { quests: Quest[] };
const find = (id: string): Quest => {
  const q = profile.quests.find(q => q.id === id);
  assert.ok(q, "Missing "+id);
  return q;
};
const flatten = (steps: Step[]): Step[] => steps.flatMap(
  s => [s, ...flatten(s.steps ?? s.body ?? [])],
);
const normalFlowSelectors: Record<string, string> = {
  "diem-danh": "#ddStamp",
  "phuc-loi-duong": "#plChests .pl-chest[data-state='ready']",
  "thi-luyen-tong-mon": "#tlScroll",
  "vong-quay-phuc-van": "#spinButton",
  "te-le-tong-mon": "#te-le-button",
  "phan-thuong-hoat-dong": "#jvz-pt-eta",
};
const ids = Object.keys(normalFlowSelectors);
assert.equal(ids.length, 6);
for (const id of ids) {
  const vip = find(id);
  const ordinary = find(id+"-thuong");
  assert.equal(vip.requiresVip, true, id+": preserve VIP entitlement");
  assert.equal(ordinary.requiresVip, false, id+": preserve ordinary entitlement");
  assert.deepEqual(vip.steps, ordinary.steps, id+": copy the complete ordinary action tree");
  assert.equal(vip.pagePath, ordinary.pagePath, id+": same quest page");
  assert.equal(vip.fallbackCooldownSeconds, ordinary.fallbackCooldownSeconds,
    id+": same fallback cooldown");
  assert.equal(vip.order, ordinary.order, id+": preserve original ordering");
  assert.equal(vip.enabled, false, id+": respect disabled-by-default setting");
  const controls = flatten(vip.steps).map(s => s.selector);
  assert.ok(controls.includes(normalFlowSelectors[id]),
    id+": expected ordinary control "+normalFlowSelectors[id]);
  console.log("PASS "+id+": "+vip.steps.length+" matching top-level steps");
}
assert.equal(new Set(profile.quests.map(q => q.id)).size, profile.quests.length,
  "no duplicate quest definitions");
assert.equal(profile.quests.length, 29,
  "all unrelated quest definitions remain present");
console.log("PASS six VIP quests mirror ordinary flows, paths and cooldowns with separate tier metadata");
