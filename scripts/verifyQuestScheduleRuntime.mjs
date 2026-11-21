import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { acquireQuestSlot } from "../src/lib/quest-engine/questGate.mjs";
import { createQuestScheduleGate } from "../src/lib/quest-engine/questSchedules.mjs";
import test from "node:test";
import { createQuestEngine, QuestAborted } from "../src/lib/quest-engine/engine.mjs";
import { runCycle } from "../src/lib/quest-engine/runCycle.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";

const log = { info() {}, warning() {}, debug() {} };
const nowMs = 1_800_000_000_000;
const open = { allowed: true, nextOpenAt: null, closesAt: nowMs + 100, nowMs, message: "" };
const closed = { allowed: false, nextOpenAt: nowMs + 3_600_000, closesAt: null, nowMs, message: "Ngoài khung giờ." };

const quest = (steps) => ({ id: "hoang-vuc", name: "Hoang Vuc", kind: "customSteps", steps });

test("a cycle with no permitted quest skips browser launch and wakes at the next opening", async () => {
  let browserCalls = 0;
  const chromium = { launch() { browserCalls++; throw new Error("unexpected launch"); } };
  const result = await runCycle({
    chromium,
    config: { gameCookie: "session=fixture", accountTier: "vip", quests: { hoangVuc: { enabled: true } } },
    say: async () => {},
    questScheduleGate: { state: () => closed },
  });
  assert.equal(browserCalls, 0);
  assert.equal(result.outcome, "done");
  assert.equal(result.nextDelaySeconds, 3600);
  assert.equal(result.questScheduleWakeAtMs, closed.nextOpenAt);
});

test("a near-midnight daily reset wakes capped quests before another quest's later window", async () => {
  const now = Date.parse("2026-11-21T16:50:00Z"); // 23:50 Vietnam time
  const opening = Date.parse("2026-11-22T11:00:00Z"); // 18:00 the next day
  const revision = "c".repeat(64);
  const result = await runCycle({
    chromium: { launch() { throw new Error("unexpected launch"); } },
    config: {
      gameCookie: "session=fixture",
      accountTier: "free",
      quests: { hoangVuc: { enabled: true }, diemDanh: { enabled: true } },
    },
    dailyDone: { day: "2026-11-21", questIds: ["diem-danh-thuong"], resetsInSeconds: 600 },
    say: async () => {},
    questScheduleGate: {
      state: (questId) => questId === "hoang-vuc-thuong"
        ? { ...closed, nowMs: now, nextOpenAt: opening }
        : { ...open, nowMs: now, closesAt: null },
      revision: () => revision,
    },
  });
  assert.equal(result.outcome, "done");
  assert.ok(result.nextDelaySeconds >= 660 && result.nextDelaySeconds <= 685, String(result.nextDelaySeconds));
  assert.equal(result.questScheduleWakeAtMs, opening);
  assert.equal(result.questSchedulePolicyRevision, revision);
});

test("the renderer observes a window closing during the delay before a click", async () => {
  let permitted = open;
  let clicks = 0;
  const engine = createQuestEngine({ log, questScheduleState: () => permitted });
  const session = {
    evaluate: async () => "@khoang-mach:phu:1",
    humanDelay: async () => { permitted = closed; },
    click: async () => { clicks++; return true; },
  };
  const result = await engine.run(session, {}, quest([
    { action: "evaluateJavaScript", script: "() => ''" },
    { action: "click", selector: "button" },
  ]));
  assert.equal(clicks, 0);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.nextOpenAt, closed.nextOpenAt);
  assert.deepEqual(result.dailyMarks, ["khoang-mach:phu:1"]);
});

test("a quest leaves its slot queue when the window closes", { timeout: 15_000 }, async (t) => {
  const seats = await Promise.all(["first", "second"].map((name) => acquireQuestSlot({ dedicated: true, name })));
  t.after(() => seats.forEach((seat) => seat.release()));
  let gameQuestVisits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/hoang-vuc") gameQuestVisits++;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      '<body class="logged-in"><main class="nv-quest">Thí Luyện</main></body>',
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const lines = [];
  let state = open;
  let closingTimer;
  const result = await runCycle({
    chromium,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    profileDir: "",
    config: {
      gameCookie: "wordpress_logged_in_fixture=1",
      accountTier: "free",
      quests: { hoangVuc: { enabled: true }, diemDanh: { enabled: true } },
    },
    dailyDone: { day: "2026-11-21", questIds: ["diem-danh-thuong"], resetsInSeconds: 600 },
    say: async (line) => { lines.push(line); },
    reportProgress: ({ done, running }) => {
      if (done === 0 && running.length === 0 && !closingTimer) {
        closingTimer = setTimeout(() => { state = closed; }, 100);
      }
    },
    questScheduleGate: { state: () => state },
  });
  assert.equal(result.outcome, "done");
  assert.equal(result.questScheduleWakeAtMs, closed.nextOpenAt);
  assert.ok(result.nextDelaySeconds >= 660 && result.nextDelaySeconds <= 685, String(result.nextDelaySeconds));
  assert.equal(gameQuestVisits, 0);
  assert.ok(lines.some((line) => line.includes(closed.message)));
});

test("a deferred quest stays subscribed to schedule edits while another cooldown wakes first", { timeout: 15_000 }, async (t) => {
  const revision = "b".repeat(64);
  const opening = { ...closed, nextOpenAt: nowMs + 36_000_000 };
  const visits = [];
  const server = createServer((req, res) => {
    visits.push(req.url);
    const markup = req.url === "/diem-danh"
      ? '<main id="ddPage"><div id="ddGrid"><i class="ddg-day is-today">Hôm nay</i></div><button id="ddStamp" class="is-done" disabled>Đã điểm danh</button></main>'
      : '<main class="nv-quest">Thí Luyện</main>';
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      '<body class="logged-in">' + markup + '</body>',
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const result = await runCycle({
    chromium,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    profileDir: "",
    config: {
      gameCookie: "wordpress_logged_in_fixture=1",
      accountTier: "free",
      quests: { hoangVuc: { enabled: true }, diemDanh: { enabled: true } },
    },
    say: async () => {},
    questScheduleGate: {
      state: (questId) => questId === "hoang-vuc-thuong" ? opening : { ...open, closesAt: null },
      revision: () => revision,
    },
  });
  assert.equal(result.outcome, "done");
  assert.ok(visits.includes("/diem-danh"));
  assert.ok(!visits.includes("/hoang-vuc"));
  assert.ok(result.nextDelaySeconds < 36_000);
  assert.equal(result.questScheduleWakeAtMs, opening.nextOpenAt);
  assert.equal(result.questSchedulePolicyRevision, revision);
});

test("a repeating quest stops at the cutoff before starting another tick", async () => {
  let state = open;
  let ticks = 0;
  const engine = createQuestEngine({ log, questScheduleState: () => state });
  const session = {
    async evaluate() {
      state = closed;
      ticks++;
    },
  };
  const result = await engine.run(session, {}, quest([
    { action: "repeat", maxIterations: 3, steps: [{ action: "evaluateJavaScript", script: "() => ''" }] },
  ]));
  assert.equal(ticks, 1);
  assert.equal(result.outcome, "skipped");
  assert.equal(result.nextOpenAt, closed.nextOpenAt);
});

test("a user stop stays terminal when the quest window also closes", async () => {
  const engine = createQuestEngine({ log, shouldStop: () => true, questScheduleState: () => closed });
  await assert.rejects(
    engine.run({}, {}, quest([{ action: "click", selector: "button" }])),
    QuestAborted,
  );
});

test("browser clicks cannot wait for a target past the current window", async () => {
  let permitted = open;
  const requests = [];
  const page = { click: async (selector, options) => requests.push({ selector, ...options }) };
  const session = createSession(page, { log, baseUrl: "http://example.test", questScheduleState: () => permitted });
  assert.equal(await session.click("#claim", 5000), true);
  assert.equal(requests.find((request) => !request.trial).timeout, 100);
  permitted = closed;
  assert.equal(await session.click("#claim", 5000), false);
  assert.equal(requests.filter((request) => !request.trial).length, 1);
});

test("click actionability still honors the configured timeout across healthy policy renewals", async (t) => {
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const policy = createQuestScheduleGate([], {
    serverTimeMs: nowMs,
    monotonicNow: () => elapsed,
    maxStaleMs: 20_000,
  });
  let nextHeartbeat = 10_000;
  let inputs = 0;
  const readyAt = 21_000;
  const page = {
    async click(_selector, { timeout, trial }) {
      const until = Math.min(elapsed + timeout, readyAt);
      while (nextHeartbeat <= until) {
        elapsed = nextHeartbeat;
        policy.update([], { serverTimeMs: nowMs + elapsed });
        nextHeartbeat += 10_000;
      }
      elapsed = until;
      if (elapsed < readyAt) {
        const err = new Error("element still loading");
        err.name = "TimeoutError";
        throw err;
      }
      if (!trial) inputs++;
    },
  };
  const session = createSession(page, { log, baseUrl: "http://example.test", questScheduleState: policy.state });

  elapsed = 9_000;
  assert.equal(await session.click("#claim", 15_000), true);
  assert.equal(inputs, 1);
  assert.equal(elapsed, readyAt);
});

test("passive renderer waits settle when a policy deadline passes", async () => {
  const page = { evaluate: async (source) => Function("return " + source)() };
  const state = { ...open, closesAt: nowMs + 10 };
  const session = createSession(page, { log, baseUrl: "http://example.test", questScheduleState: () => state });
  const result = await Promise.race([
    session.evaluate("() => new Promise((resolve) => setTimeout(() => resolve('finished waiting'), 25))"),
    new Promise((resolve) => setTimeout(() => resolve("unresolved"), 75)),
  ]);
  assert.equal(result, "finished waiting");
});

test("scheduled renderer callbacks cannot dispatch a delayed quest action after cutoff", async () => {
  let effects = 0;
  const page = { evaluate: async (source) => Function("recordEffect", "return " + source)(() => { effects++; }) };
  const state = { ...open, closesAt: nowMs + 10 };
  const session = createSession(page, { log, baseUrl: "http://example.test", questScheduleState: () => state });
  await session.evaluate("() => { setTimeout(recordEffect, 25); }", undefined, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(effects, 0);
});

test("the worker negotiates policy and reports the revision that scheduled its next wake", { timeout: 10_000 }, async (t) => {
  const revision = "a".repeat(64);
  const serverTimeMs = Date.parse("2026-11-21T00:00:00Z");
  const policy = {
    revision,
    serverTimeMs,
    rules: [{ questKey: "hoangVuc", enabled: true, windows: [{ start: "08:00", end: "09:00" }] }],
  };
  let firstClaim;
  let complete;
  const claimed = new Promise((resolve) => { firstClaim = resolve; });
  const completed = new Promise((resolve) => { complete = resolve; });
  let sentJob = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let response = {};
    if (body.op === "claim") {
      firstClaim(body);
      if (!sentJob && body.questSchedulesVersion === 1) {
        sentJob = true;
        response = {
          job: {
            id: "00000000-0000-4000-8000-000000000001",
            userId: "fixture",
            config: { gameCookie: "session=fixture", gameBaseUrl: "http://127.0.0.1:9", accountTier: "vip", quests: { hoangVuc: { enabled: true } } },
          },
          questSchedulePolicy: policy,
        };
      }
    }
    if (body.op === "complete") complete(body);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const worker = spawn(process.execPath, [fileURLToPath(new URL("./worker.mjs", import.meta.url))], {
    env: {
      ...process.env,
      WEB_URL: `http://127.0.0.1:${server.address().port}`,
      WORKER_FALLBACK_URL: "",
      WORKER_TOKEN: "fixture",
      WORKER_SELF_UPDATE: "0",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    worker.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  assert.equal((await claimed).questSchedulesVersion, 1);
  const result = await completed;
  assert.equal(result.outcome, "done");
  assert.equal(result.questScheduleWakeAtMs, Date.parse("2026-11-21T01:00:00Z"));
  assert.equal(result.questSchedulePolicyRevision, revision);
});
