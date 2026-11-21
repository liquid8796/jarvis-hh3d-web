import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const jobId = "3d87d707-98e1-4b83-a74e-e5f32f998991";
const userId = "16c78ad3-77a2-44f2-9f92-7b6d9eab2881";
const workerId = "fixture-worker";
const rules = [{ questKey: "cauCa", enabled: true, windows: [{ start: "09:00", end: "10:00" }] }];
function fixture(scope: "operator" | "user" | null) {
  const state = {
    scope: scope === "user" ? { kind: scope, userId } : scope ? { kind: scope } : null,
    settings: {
      questSchedules: rules,
      workerAutoscale: { drainingWorkerIds: [] as string[] },
      game: { baseUrl: "https://example.com" },
    },
    job: { id: jobId, userId, configSnapshot: {
      questSchedules: [{ questKey: "biCanh", enabled: true, windows: [] }],
      questSchedulePolicy: { rules: [] },
      workerPref: "mine",
      isAdmin: true,
      quests: { meCung: { enabled: true }, biCanh: { enabled: false } },
    }, dailyDone: null } as object | null,
    jobBelongs: true,
    ownerRoles: [] as string[],
    leaseKind: null as "operator" | "user" | null,
    beatStatus: "running" as "running" | "stopping",
    legacyRequeue: false,
    legacyRequeueCount: 0,
    version: null as string | null,
    claimCount: 0,
    heartbeatCount: 0,
    completion: null as unknown[] | null,
    settingsError: false,
  };
  (globalThis as typeof globalThis & { __questRouteFixture: typeof state }).__questRouteFixture = state;
  return state;
}

const mocks: Record<string, string> = {
  "next/server": `
    export { NextResponse } from "next/server.js";
    export const after = () => {};
  `,
  "@/lib/auth/worker": "export const authorizeWorker = async () => globalThis.__questRouteFixture.scope;",
  "@/lib/services/jobs": `
    const state = () => globalThis.__questRouteFixture;
    export const claimNextJob = async () => { state().claimCount++; return state().job; };
    export const dailyQuotaPlan = () => null;
    export const jobBelongsTo = async () => state().jobBelongs;
    export const heartbeat = async () => { state().heartbeatCount++; return {status: state().beatStatus, workerId: "fixture-worker", userId: "16c78ad3-77a2-44f2-9f92-7b6d9eab2881", questScheduleWorkerKind: state().leaseKind, questScheduleLegacyRequeue: state().legacyRequeue}; };
    export const addEvent = () => {};
    export const completeWorkerCycle = (...args) => { state().completion = args; return {status: "queued"}; };
    export const sweepExpiredJobEventsIfDue = () => {};
  `,
  "@/lib/services/workers": "export const recordWorkerSeen = async (_workerId, _scope, version) => { globalThis.__questRouteFixture.version = version; };",
  "@/lib/services/settings": "export const getAppSettings = async () => structuredClone(globalThis.__questRouteFixture.settings);",
  "@/lib/services/questScheduleRollout": `
    export { questScheduleRevision } from "./src/lib/services/questScheduleRollout.ts";
    export const getQuestScheduleRules = async () => {
      const fixture = globalThis.__questRouteFixture;
      if (fixture.settingsError) throw Error("fixture settings unavailable");
      return structuredClone(fixture.settings.questSchedules);
    };
    export const requestLegacyQuestScheduleRequeue = async () => {
      const fixture = globalThis.__questRouteFixture;
      fixture.legacyRequeueCount++;
      fixture.legacyRequeue = fixture.settings.questSchedules.some(rule => rule.enabled);
      return fixture.legacyRequeue;
    };
  `,
  "@/lib/services/accounts": "export const recordDetectedPillBagCapsForJob = () => {};",
  "@/lib/services/users": "export const findById = async () => ({ roles: globalThis.__questRouteFixture.ownerRoles, tags: [] });",
};
const result = await build({
  entryPoints: [resolve("src/app/api/worker/route.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [{
    name: "offline-worker-effects",
    setup(builder) {
      builder.onResolve({ filter: /^(?:@\/|next\/server$)/ }, ({ path }) => (
        path in mocks ? { path, namespace: "fixture" } : undefined
      ));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: mocks[path],
        loader: "js",
        resolveDir: process.cwd(),
      }));
    },
  }],
});
const module = { exports: {} as { POST: (request: Request) => Promise<Response> } };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const post = (body: object) => module.exports.POST(new Request("https://example.com/api/worker", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const claim = { op: "claim", workerId, version: "1.3.260" };
const beat = { op: "heartbeat", jobId, version: "1.3.260", questSchedulesVersion: 1 };

for (const scope of ["operator", "user"] as const) {
  test(scope + " claim sends server rules separately from configurable quests", async () => {
    fixture(scope);
    const start = Date.now();
    const response = await post({ ...claim, questSchedulesVersion: 1 });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.questSchedulePolicy?.rules, scope === "operator" ? rules : []);
    assert.ok(payload.questSchedulePolicy.serverTimeMs >= start && payload.questSchedulePolicy.serverTimeMs <= Date.now());
    assert.match(payload.questSchedulePolicy.revision, /^[a-f0-9]{64}$/);
    assert.equal(payload.job.id, jobId);
    assert.equal(payload.job.config.quests.meCung.enabled, true);
    assert.equal(payload.job.config.quests.biCanh.enabled, false);
    assert.equal(payload.job.config.questSchedules, undefined);
    assert.equal(payload.job.config.questSchedulePolicy, undefined);
  });

  test(scope + " legacy worker can claim an exempt job while a restriction is enabled", async () => {
    const state = fixture(scope);
    if (scope === "operator") state.ownerRoles = ["gia-chu"];
    const response = await post({ ...claim, version: "1.3.259" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.job.id, jobId);
    assert.equal(payload.questSchedulePolicy, undefined);
    assert.ok(payload.webVersion);
    assert.equal(state.claimCount, 1);
    assert.equal(state.version, "1.3.259");
  });
}

test("legacy claim preserves existing automation for empty or disabled schedules", async () => {
  const state = fixture("user");
  for (const inactive of [[], [{ ...rules[0], enabled: false }]]) {
    state.settings.questSchedules = inactive;
    const response = await post({ ...claim, version: "1.3.259" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.job.id, jobId);
    assert.equal(payload.questSchedulePolicy, undefined);
  }
});

test("an admin owner is exempt on operator claim and receives active rules after a role change", async () => {
  const state = fixture("operator");
  state.ownerRoles = ["gia-chu"];
  const first = await (await post({ ...claim, questSchedulesVersion: 1 })).json();
  assert.equal(first.job.id, jobId);
  assert.deepEqual(first.questSchedulePolicy.rules, []);
  const adminHeartbeat = await (await post(beat)).json();
  assert.deepEqual(adminHeartbeat.questSchedulePolicy.rules, []);
  state.ownerRoles = ["de-tu"];
  const memberHeartbeat = await (await post(beat)).json();
  assert.deepEqual(memberHeartbeat.questSchedulePolicy.rules, rules);
  assert.notEqual(memberHeartbeat.questSchedulePolicy.revision, adminHeartbeat.questSchedulePolicy.revision);
});

test("legacy operator cooperatively stops only after the admin exemption ends", async () => {
  const state = fixture("operator");
  state.leaseKind = "operator";
  state.ownerRoles = ["gia-chu"];
  const oldBeat = { op: "heartbeat", jobId, version: "1.3.259" };
  assert.equal((await (await post(oldBeat)).json()).status, "running");
  assert.equal(state.legacyRequeueCount, 0);
  state.ownerRoles = ["de-tu"];
  assert.equal((await (await post(oldBeat)).json()).status, "stopping");
  assert.equal(state.legacyRequeue, true);
  assert.equal((await (await post(oldBeat)).json()).status, "stopping");
  assert.equal(state.legacyRequeueCount, 1, "a recorded legacy requeue is idempotent");
  assert.equal(state.beatStatus, "running", "policy stop preserves the explicit user stop path");
});

test("explicit user stop before legacy heartbeat takes precedence", async () => {
  const state = fixture("operator");
  state.leaseKind = "operator";
  state.beatStatus = "stopping";
  const response = await post({ op: "heartbeat", jobId, version: "1.3.259" });
  assert.equal((await response.json()).status, "stopping");
  assert.equal(state.legacyRequeueCount, 0);
});

test("personal heartbeat sends a fresh empty policy even if the global branch is unavailable", async () => {
  const state = fixture("user");
  state.settingsError = true;
  const response = await post(beat);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).questSchedulePolicy.rules, []);
});

test("personal token cannot override the authenticated scope of a known operator lease", async () => {
  const state = fixture("user");
  state.leaseKind = "operator";
  const response = await post(beat);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).questSchedulePolicy.rules, rules);
});

test("heartbeat supplies current settings and an authoritative empty policy after removal", async () => {
  const state = fixture("operator");
  const first = await (await post(beat)).json();
  assert.equal(first.status, "running");
  assert.deepEqual(first.questSchedulePolicy?.rules, rules);
  state.settings.questSchedules = [];
  const second = await (await post(beat)).json();
  assert.deepEqual(second.questSchedulePolicy?.rules, []);
  assert.ok(second.questSchedulePolicy.serverTimeMs >= first.questSchedulePolicy.serverTimeMs);
  assert.notEqual(second.questSchedulePolicy.revision, first.questSchedulePolicy.revision);
  assert.equal(state.heartbeatCount, 2);
});

test("completion passes a schedule opening and authenticated scope separately from any proven quota outcome", async () => {
  const state = fixture("operator");
  const { questSchedulePolicy } = await (await post(beat)).json();
  const response = await post({
    op: "complete", jobId, outcome: "done", message: "cycle complete",
    nextDelaySeconds: 3600, questScheduleWakeAtMs: 1_800_000_000_000,
    questSchedulePolicyRevision: questSchedulePolicy.revision,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(state.completion, [jobId, "done", "cycle complete", 3600, undefined, {
    atMs: 1_800_000_000_000, policyRevision: questSchedulePolicy.revision,
  }, { kind: "operator" }]);
});

test("forbidden heartbeats don't disclose current schedule settings", async () => {
  const state = fixture("user");
  state.jobBelongs = false;
  const response = await post(beat);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
  assert.equal(state.heartbeatCount, 0);
});

test("a failed policy read doesn't replace worker restrictions with an empty policy", async () => {
  const state = fixture("operator");
  state.settingsError = true;
  await assert.rejects(post(beat), /fixture settings unavailable/);
});
