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
      quests: { meCung: { enabled: true }, biCanh: { enabled: false } },
    }, dailyDone: null } as object | null,
    jobBelongs: true,
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
    export const heartbeat = async () => { state().heartbeatCount++; return {status: "running", workerId: "fixture-worker", userId: "16c78ad3-77a2-44f2-9f92-7b6d9eab2881"}; };
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
  `,
  "@/lib/services/accounts": "export const recordDetectedPillBagCapsForJob = () => {};",
  "@/lib/services/users": "export const findById = async () => null;",
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
    assert.deepEqual(payload.questSchedulePolicy?.rules, rules);
    assert.ok(payload.questSchedulePolicy.serverTimeMs >= start && payload.questSchedulePolicy.serverTimeMs <= Date.now());
    assert.match(payload.questSchedulePolicy.revision, /^[a-f0-9]{64}$/);
    assert.equal(payload.job.id, jobId);
    assert.equal(payload.job.config.quests.meCung.enabled, true);
    assert.equal(payload.job.config.quests.biCanh.enabled, false);
    assert.equal(payload.job.config.questSchedules, undefined);
    assert.equal(payload.job.config.questSchedulePolicy, undefined);
  });

  test(scope + " legacy worker cannot claim during an enabled restriction", async () => {
    const state = fixture(scope);
    const response = await post({ ...claim, version: "1.3.259" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.job, null);
    assert.ok(payload.webVersion);
    assert.equal(state.claimCount, 0);
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

test("heartbeat supplies current settings and an authoritative empty policy after removal", async () => {
  const state = fixture("user");
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

test("completion passes a schedule opening separately from any proven quota outcome", async () => {
  const state = fixture("user");
  const { questSchedulePolicy } = await (await post(beat)).json();
  const response = await post({
    op: "complete", jobId, outcome: "done", message: "cycle complete",
    nextDelaySeconds: 3600, questScheduleWakeAtMs: 1_800_000_000_000,
    questSchedulePolicyRevision: questSchedulePolicy.revision,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(state.completion, [jobId, "done", "cycle complete", 3600, undefined, {
    atMs: 1_800_000_000_000, policyRevision: questSchedulePolicy.revision,
  }]);
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
