#!/usr/bin/env node
/**
 * Integration check for the durable multi-cycle job lifecycle.
 *
 * It creates one isolated temporary user, exercises the real service against DATABASE_URL,
 * and deletes that user (therefore the job/events via cascade) in finally. No real user's job
 * or configuration is read or changed.
 */
import { sqlTag } from "./pgTag.mjs";
import { claimNextJob, completeWorkerCycle, heartbeat, requestStop } from "../src/lib/services/jobs";
import { getQueueSnapshot } from "../src/lib/services/queue";
import { recordWorkerSeen } from "../src/lib/services/workers";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = sqlTag(process.env.DATABASE_URL);
const username = `__cycle_test_${Date.now()}`;
/**
 * Ba tiến trình giả cho phép kiểm id khôi lỗi. Tên lấy theo `username` nên chúng dùng chung
 * một nguồn duy nhất, và mang tiền tố `__` để một lần chết giữa chừng còn quét lại được —
 * dòng của khôi lỗi TÔNG MÔN không có `user_id` nên nó không cascade theo lượt xoá người dùng.
 */
const sectWorkerId = `__sect_${username}`;
const ownWorkerId = `__own_${username}`;
const theirWorkerId = `__their_${username}`;
let userId = "";
let otherUserId = "";
let jobId = "";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const secondsFromNow = (date: Date) => Math.round((date.getTime() - Date.now()) / 1000);

/**
 * So tiến độ theo GIÁ TRỊ, không theo văn bản JSON.
 *
 * jsonb của Postgres sắp lại khoá khi lưu, nên `{running, done, total}` quay ra thành
 * `{done, total, running}` — so bằng JSON.stringify là một phép thử luôn đỏ dù dữ liệu đúng
 * từng chữ. (Chính phép chuẩn hoá ấy là thứ khiến mệnh đề WHEN của trigger 0010 chạy đúng.)
 */
const sameProgress = (raw: unknown, want: { running: string[]; done: number; total: number }) => {
  if (raw == null || typeof raw !== "object") return false;
  const got = raw as { running?: unknown; done?: unknown; total?: unknown };
  return (
    got.done === want.done &&
    got.total === want.total &&
    Array.isArray(got.running) &&
    got.running.length === want.running.length &&
    got.running.every((name, i) => name === want.running[i])
  );
};

try {
  const users = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'Cycle verifier', 'not-a-login-hash', 'active')
    returning id
  `;
  userId = String(users[0].id);

  /**
   * `workerPref: "mine"` là HÀNG RÀO CÁCH LY, không phải một thứ đang được kiểm ở đây.
   *
   * Tệp này chạy trên database THẬT, nơi sáu khôi lỗi tông môn hỏi việc mỗi 5 giây. Một đàn
   * kiểm đã tới giờ mà chủ nó chưa chọn gì (tức `any`) là đàn HỢP LỆ trong mắt chúng — và từ
   * 14/08/2026 bộ cân tải còn xếp chúng đứng TRƯỚC hai khôi lỗi giả của tệp này trong hàng luân
   * phiên, nên cuộc đua bên dưới thua trắng cả hai suất. Chọn「chỉ máy nhà」thì luật phân công
   * loại hẳn khôi lỗi tông môn ra, và cuộc đua chỉ còn đúng hai kẻ ta dựng lên.
   */
  await sql`
    insert into user_configs (user_id, config)
    values (${userId}, ${JSON.stringify({ marker: "fresh-config", workerPref: "mine" })}::jsonb)
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
  // cũng chỉ đúng một người thắng.
  //
  // Điểm danh cả ba khôi lỗi giả trước, đúng thứ tự cửa `/api/worker` làm: từ 14/08/2026 bộ cân
  // tải chỉ chia việc cho khôi lỗi CÓ TÊN trong sổ và đang trực (services/dispatch.ts), nên một
  // khôi lỗi ma nay luôn về tay không — và phép thử sẽ xanh vì lý do sai.
  //
  // Cuộc đua giờ có HAI lớp gác chứ không một: luân phiên chọn sẵn đúng một người tới lượt
  // (bên kia nhận "waiting-turn"), rồi `FOR UPDATE SKIP LOCKED` vẫn đứng đó làm trọng tài cuối
  // cho trường hợp hai ảnh chụp sổ lệch nhau vài mili giây. Kết luận cần kiểm không đổi: đúng
  // một người cầm được job.
  for (const racer of ["verify-sleeping", "verify-racer-a", "verify-racer-b"]) {
    await recordWorkerSeen(racer, { kind: "user", userId }, null, 2);
  }
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

  // ---- Tiến độ vòng chạy: cột cycle_progress ------------------------------------------
  //
  // Cột này là thứ Hàng Đợi Công Việc đọc để nói "đàn kia đang làm nhiệm vụ gì". Ba luật
  // dưới đây là ba cách nó có thể nói dối, và cả ba đều từng là kịch bản thật của cột khác:
  // ghi rồi không dọn (kể chuyện vòng trước suốt cả cooldown), dọn quá tay (khôi lỗi đời cũ
  // bị xoá trắng mỗi 5 giây), và đánh thức cả tông môn mỗi nhịp tim.
  await sql`
    update automation_jobs
    set status = 'running', finished_at = null, next_run_at = now(), last_heartbeat = now()
    where id = ${jobId}
  `;

  const beating = { running: ["Mê Cung"], done: 2, total: 8 };
  await heartbeat(jobId, beating);
  const afterBeat = await sql`select cycle_progress from automation_jobs where id = ${jobId}`;
  assert(
    sameProgress(afterBeat[0]?.cycle_progress, beating),
    `nhịp tim phải ghi được tiến độ, nhận ${JSON.stringify(afterBeat[0]?.cycle_progress)}`,
  );

  // Khôi lỗi ĐÃ CÀI ngoài kia không biết trường này. Với nó, nhịp tim phải là một phép
  // "tôi còn sống" thuần tuý — không phải một lệnh xoá lặp lại mỗi 5 giây.
  await heartbeat(jobId);
  const afterOldBeat = await sql`select cycle_progress from automation_jobs where id = ${jobId}`;
  assert(
    sameProgress(afterOldBeat[0]?.cycle_progress, beating),
    "nhịp tim của khôi lỗi đời cũ (không gửi progress) phải GIỮ NGUYÊN cột, không xoá",
  );

  // Vòng xong → không còn nhiệm vụ nào đang chạy. Thiếu phép dọn này thì một đàn đang nghỉ
  // hiện lên hàng đợi là "đang nghỉ — Mê Cung" suốt cả cooldown.
  const cycled = await completeWorkerCycle(jobId, "done", "[verify] xong vòng có tiến độ", 45);
  assert(cycled?.status === "queued", "vòng có tiến độ vẫn phải quay lại queued");
  const afterComplete = await sql`select cycle_progress from automation_jobs where id = ${jobId}`;
  assert(
    afterComplete[0]?.cycle_progress === null,
    `hoàn thành vòng phải dọn tiến độ, còn lại ${JSON.stringify(afterComplete[0]?.cycle_progress)}`,
  );

  // Vòng mới bắt đầu từ giấy trắng: claim phải dọn phần sót của vòng trước.
  await sql`
    update automation_jobs
    set next_run_at = now(), cycle_progress = ${JSON.stringify(beating)}::jsonb
    where id = ${jobId}
  `;
  // Điểm danh ngay trước lượt claim: khôi lỗi này chưa từng gõ cửa, mà bộ cân tải chỉ chia
  // việc cho tên có trong sổ VÀ đang trực — cửa sổ 30 giây đã trôi qua từ lâu ở đoạn này.
  await recordWorkerSeen("verify-progress", { kind: "user", userId }, null, 2);
  const reclaimed = await claimNextJob("verify-progress", { kind: "user", userId });
  assert(reclaimed?.id === jobId, "job phải được claim lại để kiểm phép dọn lúc nhận việc");
  const afterClaim = await sql`select cycle_progress from automation_jobs where id = ${jobId}`;
  assert(
    afterClaim[0]?.cycle_progress === null,
    `claim phải dọn tiến độ vòng trước, còn lại ${JSON.stringify(afterClaim[0]?.cycle_progress)}`,
  );

  // ---- Ranh giới riêng tư của Hàng Đợi Công Việc ---------------------------------------
  //
  // Trang này cố ý cho thấy đàn của người khác, nên phép cắt phải được ghim ở ĐƯỜNG THẬT —
  // qua đúng câu SQL và đúng hàm mà route gọi — chứ không chỉ ở hàm thuần bên trong. Dựng
  // một đạo hữu thứ hai đang chạy dở, rồi hỏi ảnh chụp bằng con mắt của người thứ nhất.
  const others = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${`${username}_other`}, 'Cycle verifier 2', 'not-a-login-hash', 'active')
    returning id
  `;
  otherUserId = String(others[0].id);

  const secret = { running: ["Mê Cung", "Luyện Đan Đường"], done: 1, total: 5 };
  const otherJobs = await sql`
    insert into automation_jobs (
      user_id, status, config_snapshot, runner, attempts, next_run_at, started_at,
      last_heartbeat, cycle_progress
    ) values (
      ${otherUserId}, 'running', '{}'::jsonb, 'local', 3, now(), now(), now(),
      ${JSON.stringify(secret)}::jsonb
    )
    returning id
  `;
  const otherJobId = String(otherJobs[0].id);
  await sql`
    update automation_jobs
    set status = 'running', cycle_progress = ${JSON.stringify(beating)}::jsonb
    where id = ${jobId}
  `;

  // Tìm theo ID CHÍNH XÁC: ảnh chụp là hàng đợi của cả tông môn, nên nó cũng chứa đàn thật
  // của những người dùng thật đang chạy — bắt "dòng đầu tiên không phải của mình" là bắt
  // nhầm một người vô can, và phép thử sẽ xanh/đỏ theo việc hôm đó ai đang khai đàn.
  const snapshot = await getQueueSnapshot({ id: userId });
  const mineRow = snapshot.entries.find((entry) => entry.id === jobId);
  const theirRow = snapshot.entries.find((entry) => entry.id === otherJobId);

  assert(mineRow?.mine === true, "ảnh chụp phải có dòng của chính mình");
  assert(
    sameProgress(mineRow?.progress, beating),
    `dòng của mình phải thấy đủ tên nhiệm vụ, nhận ${JSON.stringify(mineRow?.progress)}`,
  );
  assert(theirRow != null && theirRow.mine === false, "ảnh chụp phải thấy được đàn của đạo hữu khác");
  /**
   * TÊN NHIỆM VỤ ĐI QUA ĐƯỢC, và đây là một ranh giới đã DỊCH CÓ CHỦ Ý ngày 08/08/2026 theo
   * yêu cầu của tông chủ (lý lẽ đầy đủ ở đầu `services/queue.ts`).
   *
   * Tới 12/08/2026 phép thử này vẫn còn ghim luật CŨ — nó đòi `progress.running === null` cho
   * dòng người khác, thứ `readProgress` không bao giờ trả về (nó trả mảng), nên chốt đã ĐỎ
   * suốt từ hôm ấy. Một phép thử đỏ vì chính nó lạc hậu là thứ dạy người ta thôi chạy cả bộ,
   * nên nó được sửa cho nói đúng luật hôm nay chứ không phải bị gỡ đi.
   */
  assert(
    sameProgress(theirRow!.progress, secret),
    `dòng người khác phải mang đủ tiến độ lẫn tên nhiệm vụ (luật 08/08/2026), nhận ${JSON.stringify(theirRow!.progress)}`,
  );
  assert(
    theirRow!.accountLabel === null,
    "tên tài khoản game của người khác thì KHÔNG bao giờ đi qua — ranh giới ấy chưa từng dịch",
  );

  // ---- ID khôi lỗi: tông môn cho MỌI người, khôi lỗi riêng cho chủ nó -------------------
  //
  // Luật hiện hành (xem `visibleWorkerId`): id khôi lỗi TÔNG MÔN mở cho mọi đạo hữu từ
  // 19/08/2026 — trước đó là đặc quyền của bậc trị sự — còn id khôi lỗi RIÊNG thì vẫn chỉ chủ
  // nó, bậc trị sự cũng không. Vế thứ hai mới là vế phải canh, nên nó được kiểm bằng cả một
  // phép quét thô trên nguyên payload. Dựng đủ ba tiến trình rồi hỏi bằng hai con mắt.
  await sql`insert into workers (id, user_id, version) values (${sectWorkerId}, null, '9.9.9-verify')`;
  await sql`insert into workers (id, user_id, version) values (${ownWorkerId}, ${userId}, '9.9.9-verify')`;
  await sql`insert into workers (id, user_id, version) values (${theirWorkerId}, ${otherUserId}, '9.9.9-verify')`;
  await sql`update automation_jobs set worker_id = ${sectWorkerId} where id = ${jobId}`;
  await sql`update automation_jobs set worker_id = ${theirWorkerId} where id = ${otherJobId}`;

  const asMember = await getQueueSnapshot({ id: userId });
  const asAdmin = await getQueueSnapshot({ id: userId });
  const memberMine = asMember.entries.find((entry) => entry.id === jobId);
  const adminMine = asAdmin.entries.find((entry) => entry.id === jobId);
  const memberTheirs = asMember.entries.find((entry) => entry.id === otherJobId);
  const adminTheirs = asAdmin.entries.find((entry) => entry.id === otherJobId);

  assert(memberMine?.workerKind === "sect", "đàn do khôi lỗi tông môn cầm phải khai đúng LOẠI cho mọi người");
  assert(
    memberMine?.workerId === sectWorkerId,
    `môn đồ thường phải thấy đích danh tiến trình tông môn đang cầm đàn — nhận ${memberMine?.workerId}`,
  );
  assert(
    adminMine?.workerId === sectWorkerId,
    `bậc trị sự cũng thấy đúng cái đó, không hơn không kém, nhận ${adminMine?.workerId}`,
  );
  assert(
    adminTheirs?.workerKind === "personal" && adminTheirs?.workerId === null,
    `id khôi lỗi RIÊNG của người khác không đi qua, kể cả với bậc trị sự — nhận ${adminTheirs?.workerId}`,
  );
  assert(memberTheirs?.workerId === null, "khôi lỗi riêng của người khác thì không ai thấy id");
  // Phép kiểm thô nhất, phủ cả những trường thêm vào sau này: id máy nhà của NGƯỜI KHÁC không
  // được xuất hiện ở BẤT KỲ đâu trong payload đi ra trình duyệt — với cả hai con mắt. Đây là vế
  // KHÔNG dịch của cú mở ngày 19/08, nên nó phải được canh bằng phép quét thô nhất có thể.
  assert(
    !JSON.stringify(asMember).includes(theirWorkerId),
    "id khôi lỗi riêng của người khác lọt ra trong ảnh chụp của môn đồ thường",
  );
  assert(
    !JSON.stringify(asAdmin).includes(theirWorkerId),
    "id khôi lỗi riêng của người khác lọt ra trong ảnh chụp của bậc trị sự",
  );

  // ---- Sổ khôi lỗi của tab Khôi Lỗi ------------------------------------------------------
  const memberSect = asMember.workers.filter((worker) => worker.kind === "sect");
  const adminSect = asAdmin.workers.filter((worker) => worker.kind === "sect");
  const memberRow = memberSect.find((worker) => worker.id === sectWorkerId);
  assert(
    memberRow != null,
    `môn đồ thường phải thấy TỪNG khôi lỗi tông môn một, nhận ${JSON.stringify(memberSect)}`,
  );
  assert(
    memberRow!.version === "9.9.9-verify",
    `và thấy cả số bản của nó, nhận ${memberRow!.version}`,
  );
  assert(
    !memberSect.some((worker) => worker.id === null),
    "sổ tông môn đã có tiến trình thì KHÔNG được kèm dòng gộp — dòng ấy chỉ dành cho sổ rỗng",
  );
  const adminRow = adminSect.find((worker) => worker.id === sectWorkerId);
  assert(adminRow != null, "bậc trị sự thấy đúng danh sách ấy");
  assert(adminRow!.version === "9.9.9-verify", `và thấy cả số bản của nó, nhận ${adminRow!.version}`);
  assert(
    adminRow!.online === true && adminRow!.lastSeen === null,
    "khôi lỗi vừa điểm danh phải là ĐANG TRỰC, và mốc điểm danh không đi xuống dây lúc ấy",
  );
  assert(
    asMember.workers.some((worker) => worker.kind === "mine" && worker.id === ownWorkerId),
    "khôi lỗi riêng của chính mình phải có mặt trong sổ",
  );
  assert(
    !asMember.workers.some((worker) => worker.id === theirWorkerId) &&
      !asAdmin.workers.some((worker) => worker.id === theirWorkerId),
    "khôi lỗi riêng của người khác không bao giờ vào sổ này",
  );

  console.log(
    "✔ lịch thật, refresh config, khóa hai worker, fallback 5m/30m, mọi đường Thu Đàn, " +
      "vòng đời tiến độ, ranh giới riêng tư của hàng đợi và phép cắt id khôi lỗi đều đúng.",
  );
} finally {
  for (const id of [userId, otherUserId]) {
    if (id) {
      await sql`delete from users where id = ${id}`;
    }
  }
  // Khôi lỗi tông môn giả KHÔNG cascade theo người dùng (nó không thuộc về ai), nên phải quét
  // tay — bỏ sót là để lại một dòng「tông môn」ma trong sổ điểm danh của trạm thật.
  await sql`delete from workers where id in (${sectWorkerId}, ${ownWorkerId}, ${theirWorkerId})`;
}
