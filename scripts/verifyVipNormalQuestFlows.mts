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
  if (id === "thi-luyen-tong-mon") {
    // Recorded VIP flow (15/11): the hub .nv-quest + quick-link gate is stale.
    // Keep the ordinary variant untouched; the VIP-only direct-page update
    // must not be reverted by the earlier parity invariant.
    assert.notDeepEqual(vip.steps, ordinary.steps, "VIP trial uses the new recorded flow");
    assert.equal(vip.pagePath, "/thi-luyen-tong-mon-hh3d/?nv_embed=1");
    assert.equal(vip.fallbackCooldownSeconds, 450, "recorded VIP interval ~07:26");
    assert.equal(vip.steps[0].action, "navigate");
    assert.equal((vip.steps[0] as any).text, vip.pagePath, "navigate to own page first");
    assert.equal(vip.steps.some((step: any) =>
      step.action === "navigate" && step.text === "/nhiem-vu-hang-ngay" ||
      step.selector === ".nv-quest" ||
      step.condition?.selector?.includes("a.btn-go[")), false, "no stale hub selectors");
    assert.ok(vip.steps.some((step: any) => step.action === "click" &&
      step.selector === "#tlPage[data-state='ready'] #tlScroll"),
      "only click the scroll in ready state");
    assert.ok(vip.steps.some((step: any) => step.action === "waitForCondition" &&
      step.condition?.selector === "#tlPage[data-state='cooldown'], #tlPage[data-state='done']"),
      "require a server-backed state transition after the reveal");
    assert.ok(vip.steps.some((step: any) => step.action === "stopIf" &&
      step.condition?.selector === "#tlPage[data-state='cooldown']" && step.deferSeconds > 0),
      "cooldown must not be mistaken for the day's quota");
  } else {
    assert.deepEqual(vip.steps, ordinary.steps, id+": copy the ordinary action tree");
    assert.equal(vip.pagePath, ordinary.pagePath, id+": same quest page");
    assert.equal(vip.fallbackCooldownSeconds, ordinary.fallbackCooldownSeconds,
      id+": same fallback cooldown");
  }
  assert.equal(vip.order, ordinary.order, id+": preserve original ordering");
  assert.equal(vip.enabled, false, id+": respect disabled-by-default setting");
  const controls = flatten(vip.steps).map(s => s.selector);
  assert.ok(controls.includes(normalFlowSelectors[id]),
    id+": expected ordinary control "+normalFlowSelectors[id]);
  console.log("PASS "+id+": "+vip.steps.length+" top-level steps" +
    (id === "thi-luyen-tong-mon" ? " (recorded VIP exception)" : " (ordinary parity)"));
}
assert.equal(new Set(profile.quests.map(q => q.id)).size, profile.quests.length,
  "no duplicate quest definitions");
assert.equal(profile.quests.length, 29,
  "all unrelated quest definitions remain present");
console.log("PASS five shared VIP flows plus the recorded VIP Trial exception; no ordinary quest modified");
