#!/usr/bin/env node
/**
 * Kiểm chứng luật SANG NGÀY MỚI THÌ CHẠY LẠI — `reviewDailyReset` + `runDailyReset`.
 *
 * Vì sao đáng một phép thử riêng, và vì sao nó phải chạm database thật:
 *
 *   • Cái sai ở đây KHÔNG kêu, mà lại cắt ngang việc của người khác. Chạy nhầm một nhịp là cả
 *     tông môn bị buông việc đang làm; không chạy thì mốc nửa đêm trôi qua im lặng hàng tuần.
 *   • Nhánh quyết định kết cục nằm trong một câu SQL thô (`completeWorkerCycle`), tức `tsc`
 *     không soát hộ được một tên cột nào. Chỉ có chạy thật mới biết `restart_after_stop` có
 *     thật sự lái đàn về hàng chờ thay vì về nghĩa địa hay không.
 *   • Và ca đắt nhất là ca ĐỐI CHỨNG: một người bấm Thu Đàn lúc 00:05 KHÔNG được biến thành
 *     lượt reset. Đó là chỗ mà một thiết kế "suy theo mốc thời gian" sẽ hỏng, và là lý do cột
 *     `restart_after_stop` tồn tại (xem migration 0031).
 *
 * Mọi dòng nó tạo đều gắn với một tài khoản tạm mang tiền tố `__reset_`, và `finally` dọn theo
 * tiền tố ấy nên một lượt chạy hỏng trước đây cũng được quét nốt.
 *
 * Chạy: npm run vm -- npm run verify:daily-reset
 */
import { sqlTag } from "./pgTag.mjs";
import { completeWorkerCycle, runDailyReset } from "../src/lib/services/jobs";
import { getAppSettings, saveAppSettings } from "../src/lib/services/settings";
import { reviewDailyReset, vietnamDay } from "../src/lib/validation/dailyReset";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = sqlTag(process.env.DATABASE_URL);

let passed = 0;
const check = (name: string, condition: unknown, detail = "") => {
  if (!condition) throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✔ ${name}`);
  passed++;
};

const PREFIX = "__reset_";
const username = `${PREFIX}${Date.now()}`;

// ---------------------------------------------------------------------------------------------
// 1. LUẬT THUẦN — chạy trước, vì nó không cần dọn dẹp gì và nó là phần dễ sai nhất
// ---------------------------------------------------------------------------------------------

const NOON_VN = new Date("2026-08-24T05:00:00Z"); // 12:00 giờ VN
const JUST_AFTER_MIDNIGHT = new Date("2026-08-24T17:00:30Z"); // 00:00:30 ngày 25 giờ VN

check("mốc ngày theo giờ VIỆT NAM, không phải UTC", vietnamDay(new Date("2026-08-24T17:00:00Z")) === "2026-08-25", vietnamDay(new Date("2026-08-24T17:00:00Z")));
check("…và một phút trước đó vẫn là ngày cũ", vietnamDay(new Date("2026-08-24T16:59:00Z")) === "2026-08-24");

check("công tắc TẮT thì không chạy, dù chưa chạy lần nào", reviewDailyReset(NOON_VN, false, null).run === false);
check("bật mà chưa chạy lần nào → chạy ngay", reviewDailyReset(NOON_VN, true, null).run === true);
const first = reviewDailyReset(NOON_VN, true, null);
check("…và đóng dấu đúng ngày VN của lúc ấy", first.run && first.day === "2026-08-24", JSON.stringify(first));
check("đã chạy hôm nay rồi thì THÔI — nhịp cron dày hơn nhịp ngày", reviewDailyReset(NOON_VN, true, "2026-08-24").run === false);
check("dấu của hôm qua thì chạy tiếp", reviewDailyReset(NOON_VN, true, "2026-08-23").run === true);
check(
  "vừa qua nửa đêm: dấu của ngày hôm qua → chạy, và đóng dấu ngày MỚI",
  (() => {
    const v = reviewDailyReset(JUST_AFTER_MIDNIGHT, true, "2026-08-24");
    return v.run && v.day === "2026-08-25";
  })(),
);
check(
  "CHẠY BÙ: giữa trưa mà đêm qua lỡ mất thì vẫn chạy — không đòi phải đúng phút nửa đêm",
  reviewDailyReset(NOON_VN, true, "2026-08-22").run === true,
);
check(
  "lý do từ chối nói được thành câu, không phải một cờ câm",
  (() => {
    const off = reviewDailyReset(NOON_VN, false, null);
    const done = reviewDailyReset(NOON_VN, true, "2026-08-24");
    return !off.run && off.why.length > 10 && !done.run && done.why.includes("2026-08-24");
  })(),
);

// ---------------------------------------------------------------------------------------------
// 2. ĐƯỜNG THẬT — trên database, gồm ca đối chứng
// ---------------------------------------------------------------------------------------------

let userId = "";
const settingsBefore = await getAppSettings();
const hadEnabled = settingsBefore.dailyReset.enabled;
const hadDay = settingsBefore.dailyReset.lastRunDay;

const statusOf = async (jobId: string) => {
  const rows = (await sql`
    select status, restart_after_stop, next_run_at, worker_id, daily_done
    from automation_jobs where id = ${jobId}
  `) as Array<{
    status: string;
    restart_after_stop: boolean;
    next_run_at: string;
    worker_id: string | null;
    daily_done: unknown;
  }>;
  return rows[0];
};

try {
  const created = (await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Kiểm sang ngày mới', 'not-a-login-hash', 'active')
    returning id
  `) as { id: string }[];
  userId = created[0].id;

  /**
   * `sqlTag` là tagged template có THAM SỐ HOÁ — mọi `${...}` thành một placeholder `$n`, không
   * phải một mảnh SQL ghép vào. Nên mốc giờ và sổ đủ lượt phải là GIÁ TRỊ JS truyền xuống, không
   * phải `now() + interval` viết chen vào giữa (lỗi đã trả giá ở lượt chạy đầu: cú nhúng ấy
   * biến thành một truy vấn riêng và chết ở "syntax error at or near now").
   */
  const makeJob = async (status: string, extra: { farFuture?: boolean } = {}) => {
    const nextRunAt = new Date(Date.now() + (extra.farFuture ? 6 * 60 * 60 * 1000 : 0));
    const memoryOfYesterday = { day: "hom-qua", questIds: ["diem-danh"] };
    const rows = (await sql`
      insert into automation_jobs (user_id, status, last_heartbeat, worker_id, next_run_at, daily_done)
      values (${userId}, ${status}::job_status, now(), 'khoi-loi-thu', ${nextRunAt}, ${JSON.stringify(memoryOfYesterday)}::jsonb)
      returning id
    `) as { id: string }[];
    return rows[0].id;
  };

  const queuedJob = await makeJob("queued", { farFuture: true });
  const runningJob = await makeJob("running");
  // Đàn ĐANG DỪNG vì chủ nó bấm Thu Đàn — ca đối chứng, không được đụng tới.
  const userStoppingJob = await makeJob("stopping");

  // Bật luật và xoá dấu ngày để lượt này chắc chắn chạy.
  const settings = await getAppSettings();
  settings.dailyReset.enabled = true;
  settings.dailyReset.lastRunDay = null;
  await saveAppSettings(settings);

  const outcome = await runDailyReset();
  check("lượt reset có chạy", outcome.ran === true, JSON.stringify(outcome));
  check("…và đóng dấu đúng ngày hôm nay", outcome.ran && outcome.day === vietnamDay(new Date()));

  const afterQueued = await statusOf(queuedJob);
  check("đàn ĐANG NGHỈ: mốc chạy bị kéo về hiện tại", new Date(afterQueued.next_run_at).getTime() <= Date.now() + 2_000, afterQueued.next_run_at);
  check("…sổ đủ lượt của ngày cũ bị xoá", afterQueued.daily_done === null, JSON.stringify(afterQueued.daily_done));
  check("…và nó vẫn ở hàng chờ, không bị đụng trạng thái", afterQueued.status === "queued", afterQueued.status);

  const afterRunning = await statusOf(runningJob);
  check("đàn ĐANG CÀY: được xin buông ở điểm an toàn ('stopping')", afterRunning.status === "stopping", afterRunning.status);
  check("…và mang dấu để lượt buông ấy dẫn về hàng chờ", afterRunning.restart_after_stop === true);

  const afterUserStop = await statusOf(userStoppingJob);
  check(
    "ĐỐI CHỨNG: đàn đang dừng vì CHỦ bấm Thu Đàn thì KHÔNG bị đụng",
    afterUserStop.status === "stopping" && afterUserStop.restart_after_stop === false,
    `${afterUserStop.status} / cờ=${afterUserStop.restart_after_stop}`,
  );

  // Chạy lần hai trong cùng ngày: phải im.
  const again = await runDailyReset();
  check("chạy lại trong ngày → KHÔNG làm gì (idempotent)", again.ran === false, JSON.stringify(again));

  // ---- Khôi lỗi buông tay: đàn bị reset phải VỀ HÀNG CHỜ, đàn Thu Đàn phải CHẾT ----------
  const restarted = await completeWorkerCycle(runningJob, "stopped", "Đã thu đàn giữa chừng.");
  check("đàn bị reset: sau khi khôi lỗi buông thì về HÀNG CHỜ, không chết", restarted?.status === "queued", JSON.stringify(restarted));
  const restartedRow = await statusOf(runningJob);
  check(
    "…chạy lại NGAY, không nợ quãng nghỉ nào",
    new Date(restartedRow.next_run_at).getTime() <= Date.now() + 2_000,
    restartedRow.next_run_at,
  );
  check("…cờ đã tắt, không bám lại cho những cú Thu Đàn sau", restartedRow.restart_after_stop === false);
  check("…và nhả khôi lỗi ra để bộ cân tải chọn lại từ đầu", restartedRow.worker_id === null, String(restartedRow.worker_id));

  const userStopped = await completeWorkerCycle(userStoppingJob, "stopped", "Đã thu đàn.");
  check(
    "ĐỐI CHỨNG: đàn Thu Đàn vẫn CHẾT HẲN — luật mới không lật quyết định của người dùng",
    userStopped?.status === "stopped",
    JSON.stringify(userStopped),
  );

  console.log(`\n${passed} phép thử qua.`);
} finally {
  // Trả cấu hình về đúng như lúc chưa chạy lưới: đây là database THẬT, và một lưới kiểm để lại
  // một công tắc bật là một lưới kiểm vừa đổi nết của cả tông môn lúc nửa đêm.
  const settings = await getAppSettings();
  settings.dailyReset.enabled = hadEnabled;
  settings.dailyReset.lastRunDay = hadDay;
  await saveAppSettings(settings);

  if (userId) {
    await sql`delete from job_events where job_id in (select id from automation_jobs where user_id = ${userId})`;
    await sql`delete from automation_jobs where user_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await sql`delete from users where username like ${`${PREFIX}%`}`;
}
