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
 *   • Nhánh KHÔI LỖI TÔNG MÔN chỉ soi mệnh đề `workerPrefFilter` áp lên đúng dòng job của mình.
 *     Gọi `claimNextJob` với scope `operator` trên database thật là quét hàng chờ của CẢ tông
 *     môn: phép thử sẽ giành mất đàn của người đang dùng, và ba phút sau reaper kết liễu nó
 *     thành `failed`. Mệnh đề được EXPORT chính vì chuyện này — soi bản đang chạy thật, không
 *     chép lại một bản gần giống.
 *
 * Chạm database THẬT (xem ghi chú chung: máy nhà và production là một). Mọi thứ dựng ra đều
 * treo dưới hai tài khoản tạm mang tiền tố `__pref_`, và `finally` quét theo tiền tố ấy nên một
 * lần chạy chết giữa chừng trước đây cũng được dọn nốt.
 */
import { neon } from "@neondatabase/serverless";
import { sql as drizzleSql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { claimNextJob, workerPrefFilter } from "../src/lib/services/jobs";
import {
  configSchema,
  getStoredConfigForSnapshot,
  saveConfig,
  setWorkerPref,
  type WorkerPref,
} from "../src/lib/services/configs";
import { workerOnlineFor } from "../src/lib/services/workers";
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

  /** Một đàn đang xếp hàng, đủ điều kiện claim ngay (không gắn tài khoản game — cột nullable). */
  const makeQueuedJob = async (userId: string): Promise<string> => {
    const rows = (await sql`
      insert into automation_jobs (user_id, status, last_heartbeat)
      values (${userId}, 'queued'::job_status, now())
      returning id
    `) as { id: string }[];
    return rows[0].id;
  };

  /** Khôi lỗi tông môn có NHÌN THẤY đàn này trong hàng chờ không — đúng mệnh đề đang chạy thật. */
  const sectCanSee = async (jobId: string): Promise<boolean> => {
    const found = await db().execute(drizzleSql`
      select id from automation_jobs
      where id = ${jobId}::uuid${workerPrefFilter({ kind: "operator" })}
    `);
    return (found.rows?.length ?? 0) > 0;
  };

  /** Khôi lỗi riêng của chính chủ có nhìn thấy đàn này không — cùng mệnh đề, scope kia. */
  const mineCanSee = async (jobId: string, userId: string): Promise<boolean> => {
    const found = await db().execute(drizzleSql`
      select id from automation_jobs
      where id = ${jobId}::uuid${workerPrefFilter({ kind: "user", userId })}
    `);
    return (found.rows?.length ?? 0) > 0;
  };

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

  const refusedClaim = await claimNextJob(`${PREFIX}mine`, { kind: "user", userId: ownerId });
  assert(
    refusedClaim === null,
    `khôi lỗi máy nhà không được cầm đàn nào của chủ mình khi chủ đã chọn tông môn — nhận ${refusedClaim?.id}`,
  );
  console.log("✔「Chỉ tông môn」: máy nhà không nhìn thấy, và claim thật trả về rỗng.");

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
  //     phải đợi hết một vòng. Đây là lý do mệnh đề đọc `user_configs` chứ không đọc snapshot
  //     đông lạnh trong dòng job.
  //   • Không có id nào lạ — khôi lỗi riêng không với sang hàng chờ của người khác.
  const claimedIds = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const claimed = await claimNextJob(`${PREFIX}mine`, { kind: "user", userId: ownerId });
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
