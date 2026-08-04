#!/usr/bin/env node
/**
 * Kiểm chứng chuỗi thật Neon HTTP write → trigger → LISTEN → snapshot dashboard.
 * Dùng user cô lập và xoá cascade trong finally, không đọc/chạm job của người dùng thật.
 */
import type { Notification } from "@neondatabase/serverless";
import { Client, neon } from "@neondatabase/serverless";
import {
  DASHBOARD_CHANNEL,
  parseDashboardSignal,
  realtimeDatabaseUrl,
} from "../src/lib/realtime/dashboardChannel";
import { getDashboardFeed } from "../src/lib/services/dashboard";
import { addEvent, clearVisibleJobEvents } from "../src/lib/services/jobs";
import { recordWorkerSeen } from "../src/lib/services/workers";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);
const listener = new Client({ connectionString: realtimeDatabaseUrl() });
const username = `__realtime_test_${Date.now()}`;
const workerId = `verify-live-${Date.now()}`;
let userId = "";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

function waitForSignal(user: string, topic: string, timeoutMs = 5_000) {
  const startedAt = Date.now();
  return new Promise<number>((resolve, reject) => {
    const onNotification = (message: Notification) => {
      const signal = parseDashboardSignal(message.payload);
      if (message.channel !== DASHBOARD_CHANNEL || signal?.userId !== user || signal.topic !== topic) {
        return;
      }
      cleanup();
      resolve(Date.now() - startedAt);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Không nhận tín hiệu ${topic} sau ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      listener.off("notification", onNotification);
    };
    listener.on("notification", onNotification);
  });
}

try {
  await listener.connect();
  await listener.query(`listen ${DASHBOARD_CHANNEL}`);

  const users = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Realtime verifier', 'not-a-login-hash', 'active')
    returning id
  `;
  userId = String(users[0].id);

  const jobSignal = waitForSignal(userId, "job");
  const jobs = await sql`
    insert into automation_jobs (user_id, status, config_snapshot, runner, next_run_at)
    values (${userId}, 'running', '{}'::jsonb, 'local', now())
    returning id
  `;
  const jobId = String(jobs[0].id);
  const jobMs = await jobSignal;

  const eventSignal = waitForSignal(userId, "event");
  await addEvent(jobId, "info", "[verify] realtime event");
  const eventMs = await eventSignal;

  const presenceSignal = waitForSignal(userId, "presence");
  await recordWorkerSeen(workerId, { kind: "user", userId });
  const presenceMs = await presenceSignal;

  const snapshot = await getDashboardFeed(userId, 0);
  assert(snapshot.jobs.some((job) => job.id === jobId), "snapshot không mang đúng job");
  assert(snapshot.events.some((event) => event.message === "[verify] realtime event"), "snapshot thiếu event");
  assert(snapshot.presence.mine.some((worker) => worker.id === workerId && worker.online), "snapshot thiếu worker online");

  const clearSignal = waitForSignal(userId, "events-cleared");
  const cleared = await clearVisibleJobEvents(userId);
  const clearMs = await clearSignal;
  assert(cleared === 1, `phải xoá đúng 1 event, nhận ${cleared}`);

  const afterClear = await getDashboardFeed(userId, 0);
  assert(afterClear.events.length === 0, "snapshot sau dọn vẫn còn event");

  const latencies = { jobMs, eventMs, presenceMs, clearMs };
  assert(Object.values(latencies).every((ms) => ms < 2_500), `tín hiệu quá chậm: ${JSON.stringify(latencies)}`);
  console.log(`✔ push DB thật đạt: ${JSON.stringify(latencies)}; snapshot job/log/presence/reset đều đúng.`);
} finally {
  if (userId) await sql`delete from users where id = ${userId}`;
  await listener.end().catch(() => undefined);
}
