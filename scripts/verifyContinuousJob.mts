#!/usr/bin/env node
/**
 * Integration check for the durable multi-cycle job lifecycle.
 *
 * It creates one isolated temporary user, exercises the real service against DATABASE_URL,
 * and deletes that user (therefore the job/events via cascade) in finally. No real user's job
 * or configuration is read or changed.
 */
import { neon } from "@neondatabase/serverless";
import { claimNextJob, completeWorkerCycle, requestStop } from "../src/lib/services/jobs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);
const username = `__cycle_test_${Date.now()}`;
let userId = "";
let jobId = "";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const secondsFromNow = (date: Date) => Math.round((date.getTime() - Date.now()) / 1000);

try {
  const users = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Cycle verifier', 'not-a-login-hash', 'active')
    returning id
  `;
  userId = String(users[0].id);

  await sql`
    insert into user_configs (user_id, config)
    values (${userId}, ${JSON.stringify({ marker: "fresh-config" })}::jsonb)
  `;

  const jobs = await sql`
    insert into automation_jobs (
      user_id, status, config_snapshot, runner, attempts, next_run_at, started_at, last_heartbeat
    ) values (
      ${userId}, 'running', '{}'::jsonb, 'local', 1, now(), now(), now()
    )
    returning id
  `;
  jobId = String(jobs[0].id);

  // Worker mới gửi cooldown thật; config sửa giữa vòng phải được chụp lại cho vòng kế.
  const scheduled = await completeWorkerCycle(jobId, "done", "[verify] vòng mới xong", 45);
  assert(scheduled?.status === "queued", "done có lịch thật phải quay lại queued");
  const scheduledDelay = secondsFromNow(scheduled!.nextRunAt);
  assert(scheduledDelay >= 35 && scheduledDelay <= 55, `lịch đề xuất phải ~45s, nhận ${scheduledDelay}s`);
  const refreshed = await sql`
    select config_snapshot from automation_jobs where id = ${jobId}
  `;
  assert(
    (refreshed[0]?.config_snapshot as { marker?: string } | undefined)?.marker === "fresh-config",
    "config vòng kế phải được làm mới ở ranh giới an toàn",
  );

  // Chưa tới next_run_at thì không worker nào được nhận. Khi tới giờ, hai worker đua nhau
  // cũng chỉ đúng một người thắng nhờ FOR UPDATE SKIP LOCKED.
  const sleeping = await claimNextJob("verify-sleeping", { kind: "user", userId });
  assert(sleeping === null, "job đang nghỉ chưa được claim sớm");
  await sql`update automation_jobs set next_run_at = now() where id = ${jobId}`;
  const racingClaims = await Promise.all([
    claimNextJob("verify-racer-a", { kind: "user", userId }),
    claimNextJob("verify-racer-b", { kind: "user", userId }),
  ]);
  assert(racingClaims.filter(Boolean).length === 1, "hai worker đua phải chỉ có một người nhận job");

  // Worker cũ không gửi nextDelaySeconds: server phải tự cho nghỉ 5 phút rồi chạy tiếp.
  const oldWorkerDone = await completeWorkerCycle(jobId, "done", "[verify] vòng cũ xong");
  assert(oldWorkerDone?.status === "queued", "done phải quay lại queued");
  const doneDelay = secondsFromNow(oldWorkerDone!.nextRunAt);
  assert(doneDelay >= 280 && doneDelay <= 320, `fallback done phải ~300s, nhận ${doneDelay}s`);

  await sql`update automation_jobs set status = 'running', last_heartbeat = now() where id = ${jobId}`;
  const failedCycle = await completeWorkerCycle(jobId, "failed", "[verify] vòng lỗi");
  assert(failedCycle?.status === "queued", "failed phải quay lại queued, không chết job");
  const failedDelay = secondsFromNow(failedCycle!.nextRunAt);
  assert(failedDelay >= 1780 && failedDelay <= 1820, `fallback failed phải ~1800s, nhận ${failedDelay}s`);

  // Thu Đàn trong lúc job đang ngủ phải kết thúc ngay.
  await requestStop(userId);
  const queuedStop = await sql`select status from automation_jobs where id = ${jobId}`;
  assert(queuedStop[0]?.status === "stopped", "Thu Đàn khi queued phải thành stopped");

  // Thu Đàn trong lúc worker chạy: complete đến sau vẫn không được tái xếp vòng mới.
  await sql`update automation_jobs set status = 'stopping', finished_at = null where id = ${jobId}`;
  const raceStop = await completeWorkerCycle(jobId, "done", "[verify] xong đúng lúc Thu Đàn", 30);
  assert(raceStop?.status === "stopped", "stopping + complete(done) phải giữ stopped");

  console.log(
    "✔ lịch thật, refresh config, khóa hai worker, fallback 5m/30m và mọi đường Thu Đàn đều đúng.",
  );
} finally {
  if (userId) {
    await sql`delete from users where id = ${userId}`;
  }
}
