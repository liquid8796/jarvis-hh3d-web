#!/usr/bin/env node
/**
 * Kiểm chứng lối「Giao đàn cho」— tông môn / máy nhà / ai rảnh cũng được.
 *
 * Vì sao đáng có phép thử riêng: luật thật là một mệnh đề SQL thô nhét vào câu claim
 * (`workerPrefFilter`), thứ `tsc` không soát hộ được chữ nào; và nó là luật PHÂN CÔNG — sai một
 * nhánh thì hoặc đàn nằm chờ vĩnh viễn không ai hiểu vì sao, hoặc lựa chọn「chỉ máy nhà」bị khôi
 * lỗi tông môn giành mất, tức là lời hứa riêng tư về nơi chạy bị phá trong im lặng.
 *
 * HAI ĐƯỜNG KIỂM, và sự khác nhau giữa chúng là có chủ ý:
 *
 *   • Nhánh KHÔI LỖI RIÊNG đi qua `claimNextJob` thật, đầu-tới-cuối — an toàn vì scope `user`
 *     đã chặn trong SQL, nó không với tới đàn của ai khác ngoài tài khoản tạm này.
 *   • Nhánh KHÔI LỖI TÔNG MÔN chỉ hỏi `pickDispatch` về đúng dòng job của mình. Gọi
 *     `claimNextJob` với scope `operator` trên database thật là quét hàng chờ của CẢ tông môn:
 *     phép thử sẽ giành mất đàn của người đang dùng, và ba phút sau reaper kết liễu nó thành
 *     `failed`. Hàm ấy là bản ĐANG CHẠY THẬT, không phải một bản chép gần giống — từ 14/08/2026
 *     luật「Giao đàn cho」rời khỏi SQL về đó, cạnh luật luân phiên.
 *
 * Chạm database THẬT (xem ghi chú chung: máy nhà và production là một). Mọi thứ dựng ra đều
 * treo dưới hai tài khoản tạm mang tiền tố `__pref_`, và `finally` quét theo tiền tố ấy nên một
 * lần chạy chết giữa chừng trước đây cũng được dọn nốt.
 */
import { neon } from "@neondatabase/serverless";
import { pickDispatch } from "../src/lib/services/dispatch";
import { claimNextJob } from "../src/lib/services/jobs";
import {
  configSchema,
  getStoredConfigForSnapshot,
  saveConfig,
  setWorkerPref,
  type WorkerPref,
} from "../src/lib/services/configs";
import { recordWorkerSeen, workerOnlineFor } from "../src/lib/services/workers";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");

const sql = neon(process.env.DATABASE_URL);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const PREFIX = "__pref_";
const stamp = Date.now();

let ownerId = "";
let strangerId = "";

try {
  const makeUser = async (suffix: string): Promise<string> => {
    const rows = (await sql`
      insert into users (username, display_name, password_hash, status)
      values (${`${PREFIX}${suffix}_${stamp}`}, 'Kiểm giao đàn', 'not-a-login-hash', 'active')
      returning id
    `) as { id: string }[];
    return rows[0].id;
  };

  ownerId = await makeUser("chu");
  strangerId = await makeUser("khach");

  /**
   * ĐIỂM DANH TRƯỚC KHI CLAIM — đúng thứ tự cửa `/api/worker` làm ở mỗi lượt gõ cửa.
   *
   * Bắt buộc từ 14/08/2026: bộ cân tải chỉ chia việc cho khôi lỗi CÓ TÊN trong sổ và đang trực
   * (nó phải biết còn bao nhiêu ghế, và lần cuối được giao việc là bao giờ). Một khôi lỗi ma —
   * gọi thẳng `claimNextJob` mà chưa từng điểm danh — nay về tay không, và đó là hành vi đúng:
   * ở production không có đường nào tới được claim mà không đi qua điểm danh.
   *
   * Điểm danh LẠI trước từng lượt claim, không phải một lần lúc mở màn: khôi lỗi thật gõ cửa
   * mỗi 5 giây nên `last_seen` của nó luôn tươi, còn một tệp kiểm chạy hàng chục lượt đi-về tới
   * Neon thì dễ dàng vượt cửa sổ 30 giây giữa chừng — và khi ấy phép thử sẽ đổ lỗi cho luật
   * phân công về một chuyện thật ra chỉ là "khôi lỗi giả đã vắng mặt".
   *
   * Khai 5 ghế chứ không phải 2 (trần chuẩn) vì mục 4 dưới đây vét ba đàn một lúc: trần ghế
   * nay được gác Ở MÁY CHỦ, nên một khôi lỗi khai 2 sẽ dừng đúng ở đàn thứ hai — hành vi đúng,
   * nhưng nó thuộc luật khác và đã có lưới riêng (`verify:dispatch`). Tệp này soi luật「Giao đàn
   * cho」, nên nó phải mở đủ ghế để phần ấy nói được hết câu.
   */
  const claimAsMine = async () => {
    await recordWorkerSeen(`${PREFIX}mine`, { kind: "user", userId: ownerId }, null, 5);
    return claimNextJob(`${PREFIX}mine`, { kind: "user", userId: ownerId });
  };

  /**
   * Một đàn đang xếp hàng nhưng CHƯA TỚI GIỜ — và cái "chưa tới giờ" ấy là hàng rào cách ly.
   *
   * Tệp này chạy trên database THẬT, nơi sáu khôi lỗi tông môn đang hỏi việc mỗi 5 giây. Một
   * đàn kiểm đã tới giờ mà chủ nó chưa chọn「Giao đàn cho」(tức `any`) là một đàn HỢP LỆ trong
   * mắt chúng: 14/08/2026 đo được đúng chuyện đó — đàn `virgin` bị một khôi lỗi thật cầm mất
   * giữa hai mục, và mục 4 báo lỗi như thể luật phân công hỏng.
   *
   * Ba cái giá phải trả nếu để lọt: phép thử đỏ ngẫu nhiên, một khôi lỗi thật tốn một vòng chạy
   * cho tài khoản rác không cookie, và dòng job biến mất giữa chừng khi `finally` xoá tài khoản.
   *
   * Mục 4 tự kéo đàn của mình về hiện tại ngay trước khi vét, lúc chủ đã chọn「chỉ máy nhà」—
   * khi ấy luật phân công đã loại khôi lỗi tông môn ra, nên cuộc đua chỉ còn một mình.
   */
  const makeQueuedJob = async (userId: string): Promise<string> => {
    const rows = (await sql`
      insert into automation_jobs (user_id, status, last_heartbeat, next_run_at)
      values (${userId}, 'queued'::job_status, now(), now() + interval '1 hour')
      returning id
    `) as { id: string }[];
    return rows[0].id;
  };

  /** Kéo mọi đàn của một đạo hữu về hiện tại — mở cổng cho lượt vét ở mục 4. */
  const makeDue = async (userId: string) => {
    await sql`
      update automation_jobs set next_run_at = now()
      where user_id = ${userId} and status = 'queued'
    `;
  };

  /**
   * Một khôi lỗi loại ấy có CẦM ĐƯỢC đàn này không.
   *
   * Từ 14/08/2026 luật「Giao đàn cho」không còn là mệnh đề SQL (`workerPrefFilter`) mà nằm trong
   * `pickDispatch` — bộ cân tải luân phiên. Nên phép soi ở đây cũng dời theo: đọc pref của CHỦ
   * đàn từ đúng chỗ cửa phát việc đọc (`user_configs`, không phải snapshot đông lạnh trong dòng
   * job), rồi hỏi thẳng hàm đang chạy thật.
   *
   * Thả ĐÚNG MỘT khôi lỗi vào sổ mỗi lượt hỏi: câu hỏi ở đây là「có được phép cầm không」, còn
   * thả cả hai loại vào cùng lúc thì câu trả lời hoá thành「ai tới lượt」— luật khác, đã có lưới
   * riêng ở `verify:dispatch`.
   */
  const NOW = Date.now();
  const canServe = async (jobId: string, runnerUserId: string | null): Promise<boolean> => {
    const rows = (await sql`
      select
        job.user_id,
        coalesce(
          (select uc.config->>'workerPref' from user_configs as uc where uc.user_id = job.user_id),
          'any'
        ) as owner_pref
      from automation_jobs as job
      where job.id = ${jobId}::uuid
    `) as { user_id: string; owner_pref: string }[];
    assert(rows.length === 1, `không tìm thấy đàn ${jobId}`);

    return (
      pickDispatch({
        askedBy: "kiem-tra",
        now: NOW,
        runners: [
          {
            id: "kiem-tra",
            userId: runnerUserId,
            lastSeen: NOW,
            lastAssignedAt: null,
            maxJobs: 2,
            running: 0,
          },
        ],
        jobs: [
          {
            id: jobId,
            userId: rows[0].user_id,
            ownerPref: rows[0].owner_pref,
            dueAt: NOW,
          },
        ],
      }).jobId === jobId
    );
  };

  /** Khôi lỗi tông môn có cầm được đàn này không. */
  const sectCanSee = (jobId: string) => canServe(jobId, null);

  /** Khôi lỗi riêng của chính chủ có cầm được đàn này không. */
  const mineCanSee = (jobId: string, userId: string) => canServe(jobId, userId);

  const setPrefRaw = async (userId: string, raw: string) => {
    await sql`
      insert into user_configs (user_id, config, updated_at)
      values (${userId}, jsonb_build_object('workerPref', ${raw}::text), now())
      on conflict (user_id) do update set
        config = jsonb_set(user_configs.config, '{workerPref}', to_jsonb(${raw}::text), true),
        updated_at = now()
    `;
  };

  // ---- 1. Chưa chọn gì: cả hai loại đều nhận được -----------------------------------------
  // Đây là hàng chục nghìn document đã nằm sẵn trong database, không có khoá `workerPref` nào.
  const virgin = await makeQueuedJob(ownerId);
  const configRows = (await sql`
    select count(*)::int as n from user_configs where user_id = ${ownerId}
  `) as { n: number }[];
  assert(configRows[0].n === 0, "tài khoản tạm chưa được lưu cấu hình lần nào — tiền đề của ca này");
  assert(await sectCanSee(virgin), "chưa chọn gì thì khôi lỗi tông môn PHẢI thấy đàn (nếp cũ)");
  assert(await mineCanSee(virgin, ownerId), "chưa chọn gì thì khôi lỗi máy nhà cũng phải thấy đàn");
  console.log("✔ Document chưa có trường nào: cả tông môn lẫn máy nhà đều nhận được — nếp cũ giữ nguyên.");

  // ---- 2. Chọn「chỉ tông môn」: máy nhà không thấy, và claim thật cũng không cầm được -------
  await setWorkerPref(ownerId, "sect");
  const forSect = await makeQueuedJob(ownerId);
  assert(await sectCanSee(forSect), "đàn giao cho tông môn thì tông môn phải thấy");
  assert(!(await mineCanSee(forSect, ownerId)), "đàn giao cho tông môn thì khôi lỗi máy nhà KHÔNG được thấy");

  console.log("✔「Chỉ tông môn」: máy nhà không nhìn thấy đàn ấy.");

  // ---- 3. Chọn「chỉ máy nhà」: tông môn không thấy, máy nhà cầm được thật ------------------
  await setWorkerPref(ownerId, "mine");
  const forMine = await makeQueuedJob(ownerId);
  assert(!(await sectCanSee(forMine)), "đàn giao cho máy nhà thì khôi lỗi tông môn KHÔNG được thấy");
  assert(await mineCanSee(forMine, ownerId), "đàn giao cho máy nhà thì máy nhà phải thấy");
  console.log("✔「Chỉ máy nhà」: tông môn không nhìn thấy đàn ấy nữa.");

  // ---- 4. Vét hàng chờ bằng khôi lỗi máy nhà: đúng ba đàn, không hơn không kém -------------
  //
  // Ba đàn của chủ lúc này: `virgin` (lập khi chưa chọn gì), `forSect` (lập khi còn chọn tông
  // môn) và `forMine`. Vét cạn rồi so BẰNG TẬP HỢP, và phép so ấy chứng minh hai chuyện cùng lúc:
  //
  //   • `forSect` cũng bị cầm — tức đổi lựa chọn có hiệu lực NGAY với đàn ĐANG NẰM CHỜ, không
  //     phải đợi hết một vòng. Đây là lý do cửa phát việc đọc `user_configs` chứ không đọc
  //     snapshot đông lạnh trong dòng job.
  //   • Không có id nào lạ — khôi lỗi riêng không với sang hàng chờ của người khác.
  //
  // Kéo cả ba về hiện tại NGAY TRƯỚC lượt vét, không sớm hơn: tới đây chủ đã chọn「chỉ máy nhà」
  // nên khôi lỗi tông môn thật đã bị luật loại ra, và cuộc đua chỉ còn một mình khôi lỗi kiểm.
  await makeDue(ownerId);
  const claimedIds = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const claimed = await claimAsMine();
    if (!claimed) break;
    claimedIds.add(claimed.id);
  }
  const expected = [virgin, forSect, forMine].sort();
  assert(
    JSON.stringify([...claimedIds].sort()) === JSON.stringify(expected),
    `khôi lỗi máy nhà phải cầm đúng ba đàn của chủ — nhận ${JSON.stringify([...claimedIds])}`,
  );
  console.log("✔ Vét hàng chờ: đúng ba đàn của chủ, kể cả đàn lập từ lúc còn chọn tông môn (đổi ý có hiệu lực ngay).");

  // ---- 5. Giá trị lạ trong JSONB: hỏng theo hướng VẪN PHỤC VỤ -----------------------------
  await setPrefRaw(strangerId, "khong-phai-mot-lua-chon");
  const junkJob = await makeQueuedJob(strangerId);
  assert(await sectCanSee(junkJob), "giá trị lạ thì tông môn vẫn phải nhận được — fail-open");
  assert(await mineCanSee(junkJob, strangerId), "giá trị lạ thì máy nhà cũng vẫn phải nhận được");
  console.log("✔ Giá trị lạ (chỉ có thể do sửa tay database): cả hai loại vẫn cầm được, đàn không nằm câm.");

  // ---- 6. Lựa chọn KHÔNG bị Khắc Ngọc Giản xoá, và cũng không xoá ngọc giản ---------------
  // Hai chiều của cùng một lỗi: hai đường ghi vào chung một document JSONB.
  await setWorkerPref(ownerId, "mine");
  const withQuest = configSchema.parse({});
  withQuest.quests.diemDanh.enabled = true;
  await saveConfig(ownerId, withQuest);

  const afterSave = await getStoredConfigForSnapshot(ownerId);
  assert(
    afterSave.workerPref === "mine",
    `Khắc Ngọc Giản KHÔNG được trả lựa chọn về mặc định — nhận '${afterSave.workerPref}'`,
  );
  assert(afterSave.quests.diemDanh.enabled, "ngọc giản vừa khắc phải còn nguyên");

  await setWorkerPref(ownerId, "sect");
  const afterPref = await getStoredConfigForSnapshot(ownerId);
  assert(afterPref.workerPref === "sect", "đổi lựa chọn phải ghi được");
  assert(
    afterPref.quests.diemDanh.enabled,
    "đổi lựa chọn KHÔNG được nuốt phần nhiệm vụ của ngọc giản",
  );
  console.log("✔ Hai đường ghi chung một document: không bên nào xoá việc của bên kia.");

  // ---- 7. Sổ điểm danh trả lời theo ĐÚNG LOẠI ---------------------------------------------
  // Cửa Khai Đàn hỏi hàm này để biết có nên cảnh báo「sẽ phải nằm chờ」— lệch với luật claim ở
  // trên là hứa một đằng phát việc một nẻo.
  await sql`
    insert into workers (id, user_id, last_seen)
    values (${`${PREFIX}w_${stamp}`}, ${ownerId}, now())
  `;
  assert(await workerOnlineFor(ownerId, "mine"), "khôi lỗi vừa điểm danh của chính chủ phải được tính là 'mine'");
  assert(await workerOnlineFor(ownerId, "any"), "'any' phải tính cả khôi lỗi riêng");
  assert(
    !(await workerOnlineFor(strangerId, "mine")),
    "khôi lỗi của người khác KHÔNG được tính là máy nhà của mình",
  );

  // Nhánh 'sect' đối chiếu với sự thật đo thẳng từ bảng — không dựng khôi lỗi tông môn giả,
  // vì một dòng `user_id is null` sẽ khiến MỌI đạo hữu thấy「tông môn đang trực」suốt 30 giây.
  const sectRows = (await sql`
    select count(*)::int as n from workers
    where user_id is null and last_seen > now() - interval '30 seconds'
  `) as { n: number }[];
  const sectReallyOnline = sectRows[0].n > 0;
  assert(
    (await workerOnlineFor(ownerId, "sect")) === sectReallyOnline,
    "nhánh 'sect' phải nói đúng sổ điểm danh của khôi lỗi tông môn",
  );
  assert(
    (await workerOnlineFor(strangerId, "sect")) === sectReallyOnline,
    "nhánh 'sect' không phụ thuộc vào người hỏi",
  );
  console.log(
    `✔ Sổ điểm danh theo loại: 'mine' chỉ tính khôi lỗi của chính chủ, 'sect' đúng theo tông môn (đang ${
      sectReallyOnline ? "trực" : "vắng"
    }).`,
  );

  console.log("");
  console.log("TẤT CẢ XANH — đàn đi đúng loại khôi lỗi được chọn, đổi ý có hiệu lực ngay, và hai đường ghi không giẫm chân nhau.");
} finally {
  // `automation_jobs`, `job_events`, `user_configs`, `workers` đều `on delete cascade` theo user.
  await sql`delete from users where username like ${`${PREFIX}%`}`.catch(() => {});
}
