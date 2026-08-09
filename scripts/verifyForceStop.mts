#!/usr/bin/env node
/**
 * Kiểm chứng NÚT DỪNG trên trang Hàng Đợi — `forceStopJob` trong services/jobs.ts.
 *
 * Vì sao đáng có phép thử riêng: hàm ấy là một câu SQL thô có TỰ-JOIN để đọc trạng thái cũ,
 * tức `tsc` không soát hộ được tên cột nào, và ba kết cục của nó (dừng hẳn / gửi lệnh / đã
 * dừng từ trước) là ba nhánh mà giao diện nói ba câu khác nhau. Đoán sai một nhánh là nói
 * dối người đang đứng nhìn bảng.
 *
 * Chạm database THẬT (xem ghi chú chung về chuyện production và máy nhà là một). Mọi đàn thử
 * đều gắn với một tài khoản tạm mang tiền tố `__stop_`, và `finally` dọn theo tiền tố ấy nên
 * một lần chạy hỏng trước đây cũng được quét nốt.
 */
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { forceStopJob } from "../src/lib/services/jobs";
import { hasPermission } from "../src/lib/auth/permissions";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const PREFIX = "__stop_";
const username = `${PREFIX}${Date.now()}`;
const ACTOR = "Thái Thượng Kiểm Thử";

/** Trạng thái hiện tại của một đàn, đọc thẳng từ bảng. */
const statusOf = async (jobId: string): Promise<string | null> => {
  const rows = (await sql`select status from automation_jobs where id = ${jobId}`) as { status: string }[];
  return rows[0]?.status ?? null;
};

/** Số dòng nhật ký của một đàn — dùng để chứng minh nhánh "đã dừng" KHÔNG ghi thêm gì. */
const eventCount = async (jobId: string): Promise<number> => {
  const rows = (await sql`select count(*)::int as n from job_events where job_id = ${jobId}`) as { n: number }[];
  return rows[0]?.n ?? 0;
};

let userId = "";

try {
  // ---- 0. Ai được bấm nút này ----------------------------------------------------------
  // Phần thuần, nhưng nó là LÝ DO tính năng tồn tại nên nó đứng đầu chứ không nằm cuối.
  assert(hasPermission({ roles: ["gia-chu"] }, "job.force_stop"), "Gia chủ phải dừng được đàn");
  assert(
    hasPermission({ roles: ["thai-thuong-truong-lao"] }, "job.force_stop"),
    "Thái thượng trưởng lão phải dừng được đàn — đây là cả yêu cầu của tính năng",
  );
  assert(!hasPermission({ roles: ["chuong-mon"] }, "job.force_stop"), "Chưởng môn KHÔNG được dừng đàn");
  assert(!hasPermission({ roles: ["de-tu"] }, "job.force_stop"), "Đệ tử KHÔNG được dừng đàn");
  assert(!hasPermission({ roles: [] }, "job.force_stop"), "môn đồ thường KHÔNG được dừng đàn");
  console.log("✔ Quyền: Gia chủ và Thái thượng trưởng lão được, Chưởng môn/đệ tử/môn đồ thì không.");

  const created = (await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Kiểm dừng đàn', 'not-a-login-hash', 'active')
    returning id
  `) as { id: string }[];
  userId = created[0].id;

  const makeJob = async (status: string): Promise<string> => {
    const rows = (await sql`
      insert into automation_jobs (user_id, status, last_heartbeat)
      values (${userId}, ${status}::job_status, now())
      returning id
    `) as { id: string }[];
    return rows[0].id;
  };

  // ---- 1. Đàn đang XẾP HÀNG: chết ngay ------------------------------------------------
  const queuedJob = await makeJob("queued");
  const stoppedNow = await forceStopJob(queuedJob, ACTOR);
  assert(stoppedNow.ok, `dừng đàn đang xếp hàng phải thành công: ${JSON.stringify(stoppedNow)}`);
  assert(stoppedNow.ok && stoppedNow.ended, "đàn đang xếp hàng phải chết NGAY, không phải 'đã gửi lệnh'");
  assert((await statusOf(queuedJob)) === "stopped", "trạng thái phải là 'stopped'");
  const queuedFinished = (await sql`
    select finished_at from automation_jobs where id = ${queuedJob}
  `) as { finished_at: string | null }[];
  assert(queuedFinished[0].finished_at !== null, "đàn đã chết phải có mốc kết thúc");
  console.log("✔ Đàn đang xếp hàng: chết ngay, có mốc kết thúc, kết cục `ended`.");

  // ---- 2. Đàn ĐANG CHẠY: chuyển sang 'stopping', KHÔNG chết ngay -----------------------
  const runningJob = await makeJob("running");
  const asked = await forceStopJob(runningJob, ACTOR);
  assert(asked.ok, `dừng đàn đang chạy phải thành công: ${JSON.stringify(asked)}`);
  assert(asked.ok && !asked.ended, "đàn đang chạy KHÔNG được chết ngay — khôi lỗi còn phải thu ở điểm an toàn");
  assert((await statusOf(runningJob)) === "stopping", "trạng thái phải là 'stopping'");
  const runningFinished = (await sql`
    select finished_at from automation_jobs where id = ${runningJob}
  `) as { finished_at: string | null }[];
  assert(runningFinished[0].finished_at === null, "đàn mới nhận lệnh CHƯA kết thúc — mốc ấy phải còn trống");
  console.log("✔ Đàn đang chạy: sang 'stopping', chưa có mốc kết thúc, kết cục 'đã gửi lệnh'.");

  // ---- 3. Nhật ký có gọi tên người ra lệnh ---------------------------------------------
  const events = (await sql`
    select level, message from job_events where job_id = ${runningJob} order by id
  `) as { level: string; message: string }[];
  assert(events.length === 1, `phải có đúng một dòng nhật ký, nhận ${events.length}`);
  assert(events[0].message.includes(ACTOR), `nhật ký phải gọi tên người ra lệnh: ${events[0].message}`);
  assert(events[0].level === "warning", `dòng ấy phải ở mức 'warning', nhận '${events[0].level}'`);
  console.log("✔ Nhật ký: một dòng, mức warning, gọi đích danh người ra lệnh.");

  // ---- 4. Bấm LẠI một đàn đang dừng: từ chối, và KHÔNG ghi thêm nhật ký ----------------
  const before = await eventCount(runningJob);
  const again = await forceStopJob(runningJob, ACTOR);
  assert(!again.ok, "bấm lại một đàn đang dừng phải bị từ chối");
  assert(!again.ok && again.reason === "already-stopping", `lý do phải là 'already-stopping', nhận ${JSON.stringify(again)}`);
  assert((await eventCount(runningJob)) === before, "KHÔNG được ghi thêm dòng nhật ký nào — nó sẽ nói dối là vừa có lệnh mới");
  assert((await statusOf(runningJob)) === "stopping", "trạng thái không được đổi");
  console.log("✔ Bấm lại đàn đang dừng: từ chối đúng lý do, không đẻ thêm nhật ký.");

  // ---- 5. Đàn đã về đích, và id không có thật ------------------------------------------
  const doneJob = await makeJob("done");
  const onDone = await forceStopJob(doneJob, ACTOR);
  assert(!onDone.ok && onDone.reason === "not-found", `đàn đã xong phải ra 'not-found', nhận ${JSON.stringify(onDone)}`);
  assert((await statusOf(doneJob)) === "done", "đàn đã xong không được đổi trạng thái");

  const ghost = await forceStopJob(randomUUID(), ACTOR);
  assert(!ghost.ok && ghost.reason === "not-found", "id không có thật phải ra 'not-found', không được ném");
  console.log("✔ Đàn đã về đích và id bịa: từ chối gọn, không đụng vào gì.");

  // ---- 6. Chỉ đụng ĐÚNG một đàn --------------------------------------------------------
  // Cùng một chủ, hai đàn cùng chạy: dừng cái này KHÔNG được kéo cái kia theo. `requestStop`
  // vốn dừng TẤT CẢ đàn của một người, nên đây là chỗ hai hàm dễ bị chép nhầm luật nhất.
  const twinA = await makeJob("running");
  const twinB = await makeJob("running");
  const onlyA = await forceStopJob(twinA, ACTOR);
  assert(onlyA.ok, "dừng đàn A phải thành công");
  assert((await statusOf(twinA)) === "stopping", "đàn A phải nhận lệnh");
  assert((await statusOf(twinB)) === "running", "đàn B của CÙNG người phải còn chạy — lệnh này dừng một đàn, không dừng một người");
  console.log("✔ Phạm vi: dừng đúng một đàn, đàn khác của cùng chủ không suy suyển.");

  console.log("");
  console.log("TẤT CẢ XANH — ba kết cục đúng, nhật ký gọi tên, và không dừng lây sang đàn khác.");
} finally {
  if (userId) {
    // `automation_jobs` và `job_events` đi theo `on delete cascade` của schema.
    await sql`delete from users where username like ${`${PREFIX}%`}`.catch(() => {});
  }
}
