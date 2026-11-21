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
  stdin: {
    contents: 'export * from "./src/lib/services/jobs.ts"; export { requestLegacyQuestScheduleRequeue } from "./src/lib/services/questScheduleRollout.ts";',
    resolveDir: process.cwd(),
  },
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
const module = { exports: {} as typeof import("../src/lib/services/jobs")
  & Pick<typeof import("../src/lib/services/questScheduleRollout"), "requestLegacyQuestScheduleRequeue"> };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { claimNextJob, completeWorkerCycle, requestLegacyQuestScheduleRequeue } = module.exports;

function database(persistedRules: QuestScheduleRule[], userTimerAtMs?: number, options: {
  ownerAdmin?: boolean;
  adminAtSelection?: boolean;
  leaseKind?: "operator" | "user";
  formerlyScheduleHeld?: boolean;
  policyRequeue?: boolean;
  supportsQuestSchedules?: boolean;
  status?: "running" | "stopping";
} = {}) {
  let inTransaction = false;
  let readLock = false;
  const now = Date.now();
  const state = {
    claimWritten: false,
    waitingMarker: false,
    policyRequeueMarked: false,
    quotaWrite: false,
    leaseMetadata: null as Record<string, unknown> | null,
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
      if (/end <= now\(\).*and exists/.test(sql) && !(options.adminAtSelection ?? options.ownerAdmin)) {
        return { rows: [] };
      }
      const held = options.formerlyScheduleHeld;
      // The previous unstable now()-based projection makes pickDispatch wait
      // for the old operator forever. The grace must start at a stable epoch.
      const stableDue = sql.includes("least(job.next_run_at, job.last_heartbeat + interval '30 seconds')");
      const dueAt = held ? (stableDue ? now - 25_000 : now) : now - 1_000;
      return { rows: [{ id: jobId, user_id: "owner", next_run_at: new Date(dueAt), last_worker_id: held ? "former-operator" : null, owner_pref: "any" }] };
    } else if (sql.startsWith("select w.id, w.user_id,")) {
      const current = { id: workerId, user_id: options.leaseKind === "user" ? "owner" : null,
        last_seen: new Date(now), last_assigned_at: null, max_jobs: 2, running: 0, db_now: now };
      return { rows: options.formerlyScheduleHeld ? [current, { ...current, id: "former-operator", user_id: null }] : [current] };
    } else if (sql.startsWith("with candidate as")) {
      if (options.leaseKind !== "user") {
        assert.ok(inTransaction && readLock, "legacy operator must claim under the same shared lock");
        if (persistedRules.some(rule => rule.enabled)) {
          assert.match(sql, /end <= now\(\) and exists/, "final lease enforces current owner role");
          if (!options.ownerAdmin) return { rows: [] };
        }
      }
      if (options.formerlyScheduleHeld) assert.match(sql, /least\(job.next_run_at, job.last_heartbeat \+ interval '30 seconds'\)/);
      state.claimWritten = true;
      assert.deepEqual(params.filter(value => value === "$questSchedulesVersion"), ["$questSchedulesVersion"]);
      const metadata = params.find(value => typeof value === "string" && value.startsWith('{"$questScheduleWorkerKind":'));
      assert.equal(typeof metadata, "string", "the lease captures the authenticated worker kind");
      state.leaseMetadata = JSON.parse(metadata as string);
      return { rows: [{ id: jobId, user_id: "owner", attempts: 1 }] };
    } else if (sql.startsWith("select (case job.config_snapshot")) {
      assert.ok(inTransaction && readLock);
      assert.match(sql, /when 'operator' then true when 'user' then false else \$\d+ end\) and not exists/);
      const operator = options.leaseKind === undefined ? params.includes(true) : options.leaseKind === "operator";
      return { rows: [{ applies: operator && !options.ownerAdmin }] };
    } else if (sql.startsWith("select uc.config from automation_jobs")) {
      if (userTimerAtMs === undefined) return { rows: [] };
      const local = new Date(userTimerAtMs + 7 * 3_600_000);
      return { rows: [{ config: {
        quests: { diemDanh: { enabled: true } },
        questTimers: [{ questKey: "diemDanh", hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds() }],
      } }] };
    } else if (sql.startsWith('update "automation_jobs" as job set config_snapshot')) {
      assert.ok(inTransaction && readLock, "role-loss marker is set under the same policy lock");
      assert.match(sql, /where job.id = \$\d+ and job.status = 'running' and job.config_snapshot->>\$\d+::text is distinct from 'user' and job.config_snapshot->\$\d+::text is distinct from '1'::jsonb and not exists/);
      assert.deepEqual(params.slice(0, 4), ["$questScheduleLegacyRequeue", jobId, "$questScheduleWorkerKind", "$questSchedulesVersion"]);
      state.policyRequeueMarked = options.status !== "stopping" && options.leaseKind !== "user"
        && !options.supportsQuestSchedules && !options.ownerAdmin;
      return { rows: state.policyRequeueMarked ? [{ id: jobId }] : [] };
    } else if (sql.startsWith("update automation_jobs set status = case")) {
      if (options.policyRequeue === undefined) {
        assert.ok(inTransaction && readLock, "schedule completion must write under the same shared lock");
      } else {
        assert.match(sql, /restart_after_stop or \( status = 'running' and coalesce\(config_snapshot->\$\d+::text = 'true'::jsonb, false\) \)/);
        assert.ok(params.includes("$questScheduleLegacyRequeue"));
      }
      state.waitingMarker = params.filter(value => value === "$questScheduleWaiting").length === 2;
      const nextRunAt = params.find(value => value instanceof Date);
      assert.ok(nextRunAt, "the completion must persist a wake time");
      const restarted = options.policyRequeue && options.status !== "stopping";
      const status = options.policyRequeue !== undefined && !restarted ? "stopped" : "queued";
      return { rows: [{ status, next_run_at: restarted ? new Date(now).toISOString() : nextRunAt.toISOString(), attempts: 1 }] };
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

test("legacy operator can lease only owners with current admin roles under active schedules", async () => {
  const active = { ...settings, questSchedules: rules };
  const ordinary = database(rules);
  assert.equal(await claimNextJob(workerId, { kind: "operator" }, { settings: active }), null);
  assert.equal(ordinary.claimWritten, false);

  const admin = database(rules, undefined, { ownerAdmin: true });
  assert.equal((await claimNextJob(workerId, { kind: "operator" }, { settings: active }))?.id, jobId);
  assert.deepEqual(admin.leaseMetadata, { $questScheduleWorkerKind: "operator" });

  const demoted = database(rules, undefined, { adminAtSelection: true });
  assert.equal(await claimNextJob(workerId, { kind: "operator" }, { settings: active }), null);
  assert.equal(demoted.claimWritten, false);
});

test("personal lease reaches a schedule-held job despite its still-online previous operator", async () => {
  const state = database(rules, undefined, { leaseKind: "user", formerlyScheduleHeld: true });
  const job = await claimNextJob(workerId, { kind: "user", userId: "owner" }, {
    settings: { ...settings, questSchedules: rules },
  });
  assert.equal(job?.id, jobId);
  assert.deepEqual(state.leaseMetadata, { $questScheduleWorkerKind: "user" });
});

test("cooperative legacy stop marks only an active incompatible shared lease", async () => {
  const affected = database(rules, undefined, { leaseKind: "operator" });
  assert.equal(await requestLegacyQuestScheduleRequeue(jobId), true);
  assert.equal(affected.policyRequeueMarked, true);
  for (const exempt of [
    { status: "stopping" as const },
    { leaseKind: "user" as const },
    { supportsQuestSchedules: true },
    { ownerAdmin: true },
  ]) {
    const protectedLease = database(rules, undefined, exempt);
    assert.equal(await requestLegacyQuestScheduleRequeue(jobId), false);
    assert.equal(protectedLease.policyRequeueMarked, false);
  }
  const inactive = database([]);
  assert.equal(await requestLegacyQuestScheduleRequeue(jobId), false);
  assert.equal(inactive.policyRequeueMarked, false);
});

test("legacy policy stop requeues while an explicit user stop stays stopped", async () => {
  database(rules, undefined, { policyRequeue: true, status: "running" });
  assert.equal((await completeWorkerCycle(jobId, "stopped", "pause for compatible worker"))?.status, "queued");
  database(rules, undefined, { policyRequeue: true, status: "stopping" });
  assert.equal((await completeWorkerCycle(jobId, "stopped", "explicit stop wins"))?.status, "stopped");
});

for (const exempt of [{ leaseKind: "user" as const }, { ownerAdmin: true }]) {
  test("previous schedule delay is ignored for an exempt completion " + JSON.stringify(exempt), async () => {
    const state = database(rules, undefined, exempt);
    const now = Date.now();
    const transition = await completeWorkerCycle(jobId, "done", "old schedule", 3_600, undefined, {
      atMs: now + 3_600_000, policyRevision: revision,
    });
    const wake = transition?.nextRunAt.getTime() ?? -1;
    assert.ok(wake >= now + 30_000 && wake <= Date.now() + 30_000);
    assert.equal(state.waitingMarker, false);
  });
}

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
