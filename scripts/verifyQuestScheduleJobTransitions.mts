import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import type { AppSettings } from "../src/lib/services/settings";
import type { QuestScheduleRule } from "../src/lib/validation/questSchedules";

const jobId = "70dbb956-1033-40fd-bc8a-ad679c4a3c81";
const workerId = "fixture-worker";
const settings = {
  questSchedules: [], workerAutoscale: { drainingWorkerIds: [] }, maintenance: { active: false },
} as unknown as AppSettings;
const rules: QuestScheduleRule[] = [{
  questKey: "meCung", enabled: true, windows: [{ start: "09:00", end: "10:00" }],
}];
const revision = createHash("sha256").update(JSON.stringify(rules)).digest("hex");

const { outputFiles } = await build({
  entryPoints: ["src/lib/services/jobs.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [{
    name: "offline-job-postgres",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/db\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: [
          'import { drizzle } from "drizzle-orm/node-postgres";',
          'import * as schema from "@/lib/db/schema";',
          'export { schema };',
          'export const db = () => drizzle(globalThis.__questJobPgClient, { schema });',
        ].join("\n"),
        resolveDir: process.cwd(),
      }));
    },
  }],
});
const module = { exports: {} as typeof import("../src/lib/services/jobs") };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { claimNextJob, completeWorkerCycle } = module.exports;

function database(persistedRules: QuestScheduleRule[], userTimerAtMs?: number) {
  let inTransaction = false;
  let readLock = false;
  const now = Date.now();
  const state = {
    claimWritten: false,
    waitingMarker: false,
    quotaWrite: false,
  };
  Object.assign(globalThis, { __questJobPgClient: { query } });
  async function query({ text }: { text: string }, params: unknown[]) {
    const sql = text.trim().replace(/\s+/g, " ");
    if (sql === "begin") {
      assert.equal(inTransaction, false);
      inTransaction = true;
    } else if (sql === "commit" || sql === "rollback") {
      assert.equal(inTransaction, true);
      inTransaction = false;
      readLock = false;
    } else if (sql.startsWith("select pg_advisory_xact_lock_shared(")) {
      assert.equal(inTransaction, true);
      readLock = true;
    } else if (sql.startsWith("select value->'questSchedules'")) {
      assert.ok(inTransaction && readLock, "policy read must follow acquisition of the shared lock");
      return { rows: [{ rules: persistedRules, present: true }] };
    } else if (sql.startsWith("select job.id, job.user_id,")) {
      return { rows: [{ id: jobId, user_id: "owner", next_run_at: new Date(now - 1_000), last_worker_id: null, owner_pref: "any" }] };
    } else if (sql.startsWith("select w.id, w.user_id,")) {
      return { rows: [{ id: workerId, user_id: null, last_seen: new Date(now), last_assigned_at: null, max_jobs: 2, running: 0, db_now: now }] };
    } else if (sql.startsWith("with candidate as")) {
      state.claimWritten = true;
      assert.ok(inTransaction && readLock, "legacy claim must write under the same shared lock");
      assert.deepEqual(params.filter(value => value === "$questSchedulesVersion"), ["$questSchedulesVersion"]);
      return { rows: [{ id: jobId, user_id: "owner", attempts: 1 }] };
    } else if (sql.startsWith("select uc.config from automation_jobs")) {
      if (userTimerAtMs === undefined) return { rows: [] };
      const local = new Date(userTimerAtMs + 7 * 3_600_000);
      return { rows: [{ config: {
        quests: { diemDanh: { enabled: true } },
        questTimers: [{ questKey: "diemDanh", hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds() }],
      } }] };
    } else if (sql.startsWith("update automation_jobs set status = case")) {
      assert.ok(inTransaction && readLock, "schedule completion must write under the same shared lock");
      state.waitingMarker = params.filter(value => value === "$questScheduleWaiting").length === 2;
      const nextRunAt = params.find(value => value instanceof Date);
      assert.ok(nextRunAt, "the completion must persist a wake time");
      return { rows: [{ status: "queued", next_run_at: nextRunAt.toISOString(), attempts: 1 }] };
    } else if (sql.startsWith("update automation_jobs") && sql.includes("daily_done")) {
      state.quotaWrite = true;
    } else {
      assert.match(sql, /^(?:update workers set last_assigned_at|insert into "job_events"|delete from job_events)/);
    }
    return { rows: [] };
  }
  return state;
}

test("legacy lease rechecks policy if it was activated after candidate selection", async () => {
  const state = database(rules);
  assert.equal(await claimNextJob(workerId, { kind: "operator" }, { settings }), null);
  assert.equal(state.claimWritten, false);
});

test("legacy worker still receives a lease after schedules are removed", async () => {
  const state = database([]);
  assert.equal((await claimNextJob(workerId, { kind: "operator" }, { settings }))?.id, jobId);
  assert.equal(state.claimWritten, true);
});

test("current schedule completion persists its exact opening without writing quota", async () => {
  const state = database(rules);
  const atMs = Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000;
  const transition = await completeWorkerCycle(jobId, "done", "schedule wait", 7_200, undefined, { atMs, policyRevision: revision });
  assert.equal(transition?.status, "queued");
  assert.equal(transition.nextRunAt.getTime(), atMs);
  assert.equal(state.waitingMarker, true);
  assert.equal(state.quotaWrite, false);
});

test("a normal cooldown can win without losing the schedule deferral", async () => {
  const state = database(rules);
  const now = Date.now();
  const transition = await completeWorkerCycle(jobId, "done", "mixed cycle", 600, undefined, {
    atMs: now + 3_600_000,
    policyRevision: revision,
  });
  const wake = transition?.nextRunAt.getTime() ?? -1;
  assert.ok(wake >= now + 600_000 && wake <= Date.now() + 600_000);
  assert.equal(state.waitingMarker, true);
});

test("an earlier user timer can win without losing the schedule deferral", async () => {
  const timerAt = Math.ceil((Date.now() + 90_000) / 1000) * 1000;
  const state = database(rules, timerAt);
  const transition = await completeWorkerCycle(jobId, "done", "mixed cycle", 600, undefined, {
    atMs: timerAt + 3_600_000,
    policyRevision: revision,
  });
  assert.equal(transition?.nextRunAt.getTime(), timerAt);
  assert.equal(state.waitingMarker, true);
});

test("an outdated mixed completion cannot restore a wait after a policy edit", async () => {
  const state = database([]);
  const now = Date.now();
  const transition = await completeWorkerCycle(jobId, "done", "mixed cycle", 600, undefined, {
    atMs: now + 3_600_000,
    policyRevision: revision,
  });
  const wake = transition?.nextRunAt.getTime() ?? -1;
  assert.ok(wake >= now + 30_000 && wake <= Date.now() + 30_000);
  assert.equal(state.waitingMarker, false);
});
