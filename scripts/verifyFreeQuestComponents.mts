import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const profile = JSON.parse(await readFile(path.join(root, "src", "lib", "quest-engine", "profile.json"), "utf8"));
assert.equal(profile.schemaVersion, 85, "refreshed free quest components require schema 85");

const find = (id: string) => {
  const quest = profile.quests.find((entry: { id?: string }) => entry.id === id);
  assert.ok(quest, `missing quest ${id}`);
  return quest;
};

const flatten = (steps: any[]): any[] => steps.flatMap((step) => [step, ...flatten(step.body ?? [])]);
const selectors = (quest: any): string[] => flatten(quest.steps).flatMap((step) => [
  step.selector,
  step.condition?.selector,
  step.when?.selector,
  step.until?.selector,
].filter((value): value is string => typeof value === "string"));

const assertIncludes = (haystack: string[], needle: string, label: string) =>
  assert.ok(haystack.includes(needle), `${label} must include ${needle}`);
const assertExcludesFragments = (haystack: string[], fragments: string[], label: string) => {
  for (const fragment of fragments) {
    assert.equal(haystack.some((selector) => selector.includes(fragment)), false, `${label} must not use stale ${fragment}`);
  }
};

{
  const quest = find("diem-danh-thuong");
  const all = selectors(quest);
  assertIncludes(all, "#ddPage", "Điểm Danh");
  assertIncludes(all, "#ddGrid .dd-tile.is-today", "Điểm Danh");
  assertIncludes(all, "#ddGrid .dd-tile.is-today.is-claimed", "Điểm Danh");
  assertIncludes(all, "#ddStamp", "Điểm Danh");
  assertExcludesFragments(all, ["#checkInButton", "#nv-checkin-btn"], "Điểm Danh");
  assert.ok(flatten(quest.steps).some((step) => step.action === "waitForCondition" && step.optional !== true && step.condition?.selector === "#ddGrid .dd-tile.is-today.is-claimed"), "Điểm Danh must require claimed-state proof");
}

{
  const quest = find("phuc-loi-duong-thuong");
  const all = selectors(quest);
  for (const selector of [
    "#plPage",
    "#plChests",
    "#plDayCount",
    "#plChests .pl-chest[data-state='ready']",
    "#plChests .pl-chest[data-state='cooldown']",
    "#plChests .pl-chest[data-state='cooldown'] .pl-chest__timer",
    "#plMiles .pl-mile[data-state='ready'] .pl-mile__btn",
  ]) assertIncludes(all, selector, "Phúc Lợi Đường");
  assertExcludesFragments(all, ["#countdown-timer", "#chest-", ".reward-progress-container", ".gift-box"], "Phúc Lợi Đường");
  assert.ok(flatten(quest.steps).some((step) => step.action === "waitForCondition" && step.optional !== true && step.condition?.kind === "hidden" && step.condition?.selector === "#plChests .pl-chest[data-state='ready']"), "Phúc Lợi Đường must require ready chest to leave ready state");
}

{
  const quest = find("thi-luyen-tong-mon-thuong");
  const all = selectors(quest);
  for (const selector of ["#tlPage", "#tlScroll", "#tlLeft", "#tlClock", "#tlPage[data-state='cooldown']", "#tlPage[data-state='ready']"]) assertIncludes(all, selector, "Thí Luyện Tông Môn");
  assertExcludesFragments(all, ["#countdown-timer", "#chestImage"], "Thí Luyện Tông Môn");
  assert.ok(flatten(quest.steps).some((step) => step.action === "waitForCondition" && step.optional !== true && step.condition?.kind === "hidden" && step.condition?.selector === "#tlPage[data-state='ready']"), "Thí Luyện Tông Môn must require leaving ready state");
}

console.log("PASS: free Check-in, Welfare Hall and Sect Trial follow the 29/09 server components and reject stale selectors.");
