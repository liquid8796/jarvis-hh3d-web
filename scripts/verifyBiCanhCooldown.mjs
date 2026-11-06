import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { completedCycleDelaySeconds } from "../src/lib/quest-engine/runCycle.mjs";
import { reachedDailyQuota } from "../src/lib/quest-engine/dailyQuota.mjs";

const browser = await chromium.launch({ headless: true, channel: "chromium" });
let state = "last";
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body:
    '<!doctype html><meta charset="utf-8"><div id="boss-status-container">' +
    (state === "summon" ? '<div class="summon-boss-section"><button class="contribute-btn contributed" disabled>Done</button></div>' :
      '<button id="challenge-boss-btn">' + (state === "spent" ? "Hết lượt hôm nay" : "KHIÊU CHIẾN") + '</button>') +
    '</div><div id="attack-modal" style="display:none"><button id="attack-boss-btn">Attack</button><button id="back-button">Back</button></div>' +
    '<script>window.attacks=0;const c=document.querySelector("#challenge-boss-btn");if(c)c.onclick=()=>document.querySelector("#attack-modal").style.display="block";' +
    'document.querySelector("#attack-boss-btn").onclick=()=>{window.attacks++;c.textContent=' + JSON.stringify(state === "last" ? "Hết lượt hôm nay" : "Còn 6:52") + ';};' +
    'document.querySelector("#back-button").onclick=()=>document.querySelector("#attack-modal").style.display="none";</script>'
  }));
  const profile = loadProfile();
  const session = createSession(page, { baseUrl: "http://fixture.test" });
  const engine = createQuestEngine({ log: { info() {}, warning() {}, debug() {} } });
  for (const id of ["bi-canh-tong-mon", "bi-canh-tong-mon-thuong"]) {
    const quest = structuredClone(profile.quests.find(q => q.id === id));
    // Avoid the real site's 12-second asynchronous-readiness grace in a synchronous local fixture.
    for (const step of quest.steps) if (step.action === "waitForCondition" && step.optional) step.timeoutMs = 500;
    for (const sample of [
      { state: "last", outcome: "alreadyDone", delay: 3600, attacks: 1 },
      { state: "spent", outcome: "alreadyDone", delay: 3600, attacks: 0 },
      { state: "summon", outcome: "onCooldown", delay: 300, attacks: 0 },
      { state: "new", outcome: "completed", delay: 412, attacks: 1 },
    ]) {
      state = sample.state;
      const actual = await engine.run(session, profile, quest);
      assert.equal(actual.outcome, sample.outcome, id + " " + state + ": result");
      assert.equal(await page.evaluate(() => window.attacks), sample.attacks, id + " " + state + ": attack count");
      assert.equal(completedCycleDelaySeconds([quest], [actual], [id], { random: () => 0 }), sample.delay, id + " " + state + ": schedule");
      assert.equal(reachedDailyQuota(quest, actual), false, id + ": never permanently cap same-day bosses");
      console.log("PASS", id, state, actual.outcome, sample.delay);
    }
  }
} finally {
  await browser.close();
}
