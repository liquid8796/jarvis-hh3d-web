#!/usr/bin/env node
/**
 * Kiểm chứng SỔ ĐỦ LƯỢT HÔM NAY — `dailyQuotaPlan` và phép hợp nhất trong `completeWorkerCycle`.
 *
 * Vì sao đáng có phép thử riêng: phần hợp nhất là một câu SQL thô dựng bằng `jsonb_agg(distinct
 * …)` trên một mảng nối — `tsc` không soát hộ được một tên cột hay một phép ép kiểu nào ở đó,
 * và cái giá của một lỗi im lặng là chín nhiệm vụ ngày nằm im suốt một ngày mà nhật ký không có
 * dòng nào để lần ra. `npm run smoke` chỉ với tới được nửa phía engine; nửa này phải chạm
 * database thật mới nói được gì.
 *
 * Ba luật của tính năng, mỗi luật một phép thử ở đây:
 *   • Sổ mang ngày CŨ đọc thành sổ trắng — mốc reset của game theo giờ Việt Nam.
 *   • Lời khai vắt qua nửa đêm bị TỪ CHỐI, không ghi nhầm sang ngày mới.
 *   • Đàn đã Thu thì không ghi gì — sổ của nó là rác, và lần Khai Đàn sau bắt đầu từ giấy trắng.
 *
 * Chạm database THẬT (xem ghi chú chung về chuyện production và máy nhà là một). Mọi thứ dựng ra
 * đều treo dưới một tài khoản tạm mang tiền tố `__quota_`, và `finally` dọn theo tiền tố ấy nên
 * một lần chạy hỏng trước đây cũng được quét nốt.
 */
import { neon } from "@neondatabase/serverless";
import {
  claimNextJob,
  completeWorkerCycle,
  dailyQuotaPlan,
  vietnamDayKey,
} from "../src/lib/services/jobs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const PREFIX = "__quota_";
const username = `${PREFIX}${Date.now()}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const today = vietnamDayKey();
const yesterday = vietnamDayKey(new Date(Date.now() - DAY_MS));

/** Sổ đang nằm trong database, đọc thẳng từ cột. */
const bookOf = async (jobId: string) => {
  const rows = (await sql`
    select daily_done from automation_jobs where id = ${jobId}
  `) as { daily_done: { day: string; questIds: string[] } | null }[];
  return rows[0]?.daily_done ?? null;
};

let userId = "";
let jobId = "";

/**
 * Giành lại đàn cho vòng kế — đúng đường mà khôi lỗi thật đi.
 *
 * Kéo `next_run_at` về hiện tại trước: `completeWorkerCycle` vừa xếp lịch vài phút nữa, và cửa
 * claim tôn trọng lịch ấy. Không kéo thì mọi lượt giành lại ở đây trả về null và phép thử xanh
 * vì không có gì để kiểm — kiểu hỏng tệ nhất.
 */
const reclaim = async () => {
  await sql`update automation_jobs set next_run_at = now() where id = ${jobId}`;
  const job = await claimNextJob("khoi-lo-kiem-thu", { kind: "user", userId });
  assert(job !== null, "không giành lại được đàn thử");
  return job!;
};

try {
  // ---- 0. Ngày theo giờ Việt Nam ---------------------------------------------------------
  // Phần thuần, nhưng nó là gốc của cả tính năng nên nó đứng đầu. Bảy tiếng lệch nghĩa là mỗi
  // ngày có một cửa sổ bảy tiếng mà sổ nói「chưa sang ngày」trong khi game đã mở lại lượt.
  assert(
    vietnamDayKey(new Date("2026-08-11T16:59:59Z")) === "2026-08-11",
    "23:59:59 giờ VN vẫn phải là ngày 11",
  );
  assert(
    vietnamDayKey(new Date("2026-08-11T17:00:00Z")) === "2026-08-12",
    "00:00:00 giờ VN đã phải là ngày 12 — mốc reset đi theo giờ Việt Nam, không phải UTC",
  );
  console.log("✔ Mốc sang ngày cắt đúng nửa đêm giờ Việt Nam.");

  // ---- 1. Đọc sổ ra kế hoạch --------------------------------------------------------------
  const fresh = dailyQuotaPlan(null);
  assert(fresh.questIds.length === 0, "sổ trắng phải ra kế hoạch rỗng");
  assert(
    fresh.resetsInSeconds > 0 && fresh.resetsInSeconds <= 24 * 3600,
    `mốc sang ngày phải nằm trong một ngày, nhận ${fresh.resetsInSeconds}`,
  );
  assert(
    dailyQuotaPlan({ day: today, questIds: ["diem-danh"] }).questIds.join() === "diem-danh",
    "sổ của HÔM NAY phải được dùng",
  );
  assert(
    dailyQuotaPlan({ day: yesterday, questIds: ["diem-danh"] }).questIds.length === 0,
    "sổ của hôm qua phải đọc thành sổ trắng — không thì nhiệm vụ chết cứng sang ngày mới",
  );
  console.log("✔ Sổ ngày cũ đọc thành sổ trắng; sổ hôm nay được dùng nguyên.");

  // ---- 2. Dựng một đàn thật ---------------------------------------------------------------
  const created = (await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Kiểm sổ đủ lượt', 'not-a-login-hash', 'active')
    returning id
  `) as { id: string }[];
  userId = created[0].id;

  const job = (await sql`
    insert into automation_jobs (user_id, status, next_run_at)
    values (${userId}, 'queued'::job_status, now())
    returning id
  `) as { id: string }[];
  jobId = job[0].id;

  const firstClaim = await reclaim();
  assert(
    firstClaim.dailyDone == null,
    "đàn vừa lập phải có sổ TRẮNG — đó là cả luật「Khai Đàn lại thì kiểm lại từ vòng 1」",
  );
  console.log("✔ Đàn mới lập: sổ trắng, vòng 1 kiểm đủ.");

  // ---- 3. Ghi lời khai đầu tiên -----------------------------------------------------------
  await completeWorkerCycle(jobId, "done", "vòng thử 1", 300, {
    day: today,
    questIds: ["diem-danh", "hoang-vuc"],
  });
  const afterFirst = await bookOf(jobId);
  assert(afterFirst?.day === today, `sổ phải mang ngày hôm nay, nhận ${afterFirst?.day}`);
  assert(
    [...(afterFirst?.questIds ?? [])].sort().join() === "diem-danh,hoang-vuc",
    `sổ phải có đúng hai cái tên, nhận ${JSON.stringify(afterFirst?.questIds)}`,
  );

  const secondClaim = await reclaim();
  assert(
    dailyQuotaPlan(secondClaim.dailyDone).questIds.length === 2,
    "vòng sau phải nhận được sổ vừa ghi",
  );
  console.log("✔ Lời khai vòng trước tới được vòng sau.");

  // ---- 4. Hợp nhất, không ghi đè và không nhân bản ------------------------------------------
  // Đây là chỗ câu SQL dễ sai nhất: `hoang-vuc` xuất hiện ở CẢ hai lời khai. Ghi đè là mất
  // `diem-danh`; nối thẳng là sổ phình lên theo số vòng cho tới hết ngày.
  await completeWorkerCycle(jobId, "done", "vòng thử 2", 300, {
    day: today,
    questIds: ["hoang-vuc", "van-dap"],
  });
  const merged = await bookOf(jobId);
  assert(
    [...(merged?.questIds ?? [])].sort().join() === "diem-danh,hoang-vuc,van-dap",
    `hợp nhất phải ra đúng ba cái tên, nhận ${JSON.stringify(merged?.questIds)}`,
  );
  console.log("✔ Hợp nhất giữ cái cũ, thêm cái mới, không nhân bản cái trùng.");

  // ---- 5. Lời khai vắt qua nửa đêm bị từ chối -----------------------------------------------
  await reclaim();
  await completeWorkerCycle(jobId, "done", "vòng thử 3", 300, {
    day: yesterday,
    questIds: ["me-cung-khong-duoc-ghi"],
  });
  const afterStale = await bookOf(jobId);
  assert(
    [...(afterStale?.questIds ?? [])].sort().join() === "diem-danh,hoang-vuc,van-dap",
    `lời khai của hôm qua phải bị bỏ, nhận ${JSON.stringify(afterStale?.questIds)}`,
  );
  console.log("✔ Lời khai mang ngày cũ bị từ chối — thà kiểm thừa còn hơn nghỉ nhầm một ngày.");

  // ---- 6. Đàn đã Thu thì không ghi gì -------------------------------------------------------
  await reclaim();
  await completeWorkerCycle(jobId, "stopped", "thu đàn thử", 300, {
    day: today,
    questIds: ["bi-canh-tong-mon"],
  });
  const afterStop = await bookOf(jobId);
  assert(
    [...(afterStop?.questIds ?? [])].sort().join() === "diem-danh,hoang-vuc,van-dap",
    `đàn đã Thu thì sổ đứng yên, nhận ${JSON.stringify(afterStop?.questIds)}`,
  );
  console.log("✔ Đàn đã Thu: không ghi thêm gì — lần Khai Đàn sau bắt đầu từ giấy trắng.");

  console.log("\n✔ Sổ đủ lượt hôm nay: mọi phép thử thuận.");
} finally {
  // Dọn theo TIỀN TỐ chứ không theo id vừa dựng: một lần chạy hỏng giữa chừng trước đây cũng
  // để lại rác, và không có gì quét nó ngoài chỗ này.
  await sql`delete from users where username like ${`${PREFIX}%`}`;
}
