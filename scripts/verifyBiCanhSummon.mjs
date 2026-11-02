import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { reachedDailyQuota } from "../src/lib/quest-engine/dailyQuota.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

// Regression for the 2026-11-02 Bí Cảnh recording: claim -> donate -> wait for a new boss.
// The donation POST succeeds once; already contributed must never click again.
const profile = loadProfile();
for (const id of ["bi-canh-tong-mon", "bi-canh-tong-mon-thuong"]) {
  const quest = profile.quests.find((item) => item.id === id);
  assert.ok(quest, `Missing quest ${id}`);
  const steps = quest.steps;
  const find = (pred) => steps.findIndex(pred);
  const claim = find((s) => s.action === "click" && s.selector === "#claim-reward-btn");
  const donate = find((s) => s.action === "click" && s.selector?.includes("contribute-boss-btn"));
  const confirm = find((s) => s.action === "click" && s.selector === "#custom-confirm-yes");
  const witness = find((s) => s.action === "waitForCondition" && s.condition?.selector === ".summon-boss-section .contribute-btn.contributed");
  const defer = find((s) => s.action === "stopIf" && s.condition?.selector === ".summon-boss-section");
  assert.ok(claim !== -1, `${id}: claim reward first`);
  assert.ok(donate > claim, `${id}: donate after claim`);
  assert.ok(confirm > donate, `${id}: confirm the 50 TT offering`);
  assert.ok(witness > confirm, `${id}: prove contribution landed`);
  assert.ok(defer > witness, `${id}: don't enter fight until new boss exists`);
  assert.equal(steps[donate].when?.selector, "#contribute-boss-btn:not(:disabled)", `${id}: never donate twice`);
  assert.equal(steps[confirm].when?.selector, "#custom-confirm-yes", `${id}: no speculative confirm`);
  assert.ok(steps[defer].deferSeconds >= 60, `${id}: waiting summon is a cooldown not the daily quota`);
  const attack = find((s) => s.action === "click" && ["#challenge-boss-btn", "#nv-btm-attack-btn"].includes(s.selector));
  assert.ok(attack > defer, `${id}: only attack after leaving summon state`);
  const cap = find((st) => st.action === "stopIf" &&
    st.condition?.selector === "#challenge-boss-btn" && st.condition?.text === "hết lượt");
  assert.ok(cap > defer, id + ": daily cap must not suppress a pending reward/donation");
  assert.equal(reachedDailyQuota(quest, { outcome: "onCooldown", cooldownSeconds: 300 }), false,
    id + ": summon wait must NOT consume daily quota");
  console.log(`PASS ${id}: claim -> donate once -> confirm -> witness -> deferred summon -> attack`);
}

// Optional 02/11 local evidence: read only, never print cookies or private network headers.
// When missing on CI this check is skipped, while the structural regression always runs.
const recording = process.env.APPDATA && path.join(process.env.APPDATA,
  "JarvisHH3D", "recordings", "bi-canh-tong-mon-20261102-134327");
if (recording && existsSync(path.join(recording, "network.json"))) {
  const before = readFileSync(path.join(recording, "dom", "05-click.html"), "utf8");
  const after = readFileSync(path.join(recording, "dom", "06-click.html"), "utf8");
  assert.match(before, /id="contribute-boss-btn" class="contribute-btn"/);
  assert.match(after, /class="contribute-btn contributed" disabled/);
  assert.doesNotMatch(after, /id="contribute-boss-btn"/);
  const network = JSON.parse(readFileSync(path.join(recording, "network.json"), "utf8"));
  for (const [endpoint, key] of [["claim-boss-reward", "reward_details"], ["contribute-boss", "contribution_data"]]) {
    const entry = network.entries.find((e) => e.url?.includes(endpoint));
    assert.equal(entry?.status, 200, endpoint + ": HTTP 200");
    const body = JSON.parse(entry.responseBody);
    assert.equal(body.success, true, endpoint + ": success=true");
    assert.ok(body[key], endpoint + ": required response data");
    if (endpoint === "contribute-boss")
      assert.equal(body.contribution_data.user_has_contributed, true);
  }
  console.log("PASS recording 20261102: real DOM and both POST acknowledgments");
}
