#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { DAILY_QUOTA_QUEST_IDS, skipQuestForToday } from "../src/lib/quest-engine/dailyQuota.mjs";

const profile = JSON.parse(readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"));
assert.equal(profile.schemaVersion, 87, "desktop/web profile schema must be aligned");
const readyCta = "#plMiles .pl-mile[data-state='ready'] .pl-mile__cta";
for (const id of ["phuc-loi-duong", "phuc-loi-duong-thuong"]) {
  assert.ok(DAILY_QUOTA_QUEST_IDS.has(id), id + ": daily quest still contributes to peer-gated quota");
  assert.ok(!skipQuestForToday({ id }, new Set([id])), id + ": daily completion must not hide monthly rewards");
  assert.ok(skipQuestForToday({ id: "diem-danh" }, new Set(["diem-danh"])),
    "other capped quests must still be skipped after completion");
  const quest = profile.quests.find((q: { id: string }) => q.id === id);
  assert.ok(quest, id);
  assert.equal(quest.steps[0].text, "/phuc-loi-duong", id + ": claim milestones before daily stop");
  const loop = quest.steps.find((s: { action: string; until?: { selector?: string } }) =>
    s.action === "repeat" && s.until?.selector === readyCta);
  assert.ok(loop, id + ": find unclaimed progress chests");
  assert.ok(loop.steps.some((s: { selector?: string; action: string }) => s.action === "click" && s.selector === readyCta),
    id + ": click actual claim CTA");
  assert.ok(quest.steps.some((s: { action: string; selector?: string }) =>
    s.action === "click" && s.selector === "#pl-claim-overlay.is-open .pl-claim-btn"),
    id + ": dismiss claim reminder");
  const firstStop = quest.steps.findIndex((s: { action: string }) => s.action === "stopIf");
  assert.ok(quest.steps.indexOf(loop) < firstStop, id + ": collect milestones BEFORE any daily cap stop");
  if (id.endsWith("-thuong")) {
    assert.ok(!quest.steps.some((s: { condition?: { selector?: string } }) =>
      s.condition?.selector?.includes("btn-go")), "free: no premature hub shortcut guard");
  } else {
    assert.ok(quest.steps.some((s: { action: string; selector?: string }) =>
      s.action === "click" && s.selector === "#nv-phucloi-open-btn"), "VIP: keep daily hub chest action");
  }
}

// Recording 08/10: image button and actual claim CTA are siblings; locked/claimed milestones
// must never be clicked, and the modal is dismissed before trying to click a CTA.
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.setContent(`<div id="pl-claim-overlay" class="is-open"><button class="pl-claim-btn">Đến nhận thưởng</button></div>
    <ol id="plMiles">
      <li class="pl-mile" data-state="ready"><button class="pl-mile__btn">🎁</button><button class="pl-mile__cta">Nhận thưởng</button></li>
      <li class="pl-mile" data-state="locked"><button class="pl-mile__btn" disabled>🎁</button><button class="pl-mile__cta" hidden>Nhận thưởng</button></li>
      <li class="pl-mile" data-state="claimed"><button class="pl-mile__btn" disabled>✓</button><button class="pl-mile__cta" hidden>Nhận thưởng</button></li>
    </ol>`);
  assert.equal(await page.locator("#pl-claim-overlay.is-open .pl-claim-btn").count(), 1);
  assert.equal(await page.locator(readyCta).count(), 1, "only ready CTA matches the October UI");
  await page.locator(readyCta).evaluate((btn) => {
    btn.closest(".pl-mile")!.setAttribute("data-state", "claimed");
  });
  assert.equal(await page.locator(readyCta).count(), 0, "after successful AJAX claim no CTA remains ready");
} finally {
  await browser.close();
}
console.log("PASS October monthly rewards: VIP/free, daily quota bypass, popup, ready-only CTA");
