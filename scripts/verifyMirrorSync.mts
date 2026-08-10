/**
 * Kiểm chứng engine đồng bộ gương trạm (src/lib/mirror/pgSync.ts) trên DATABASE THẬT.
 *
 * Chạy TOÀN BỘ trên một schema tạm `mirror_verify_<pid>` do chính script dựng rồi xoá, nên nó
 * KHÔNG chạm một dòng nào của tông môn — thứ đáng sợ nhất ở đây là một phép kiểm lỡ tay
 * `truncate` vào bảng thật (xem cảnh báo「Postgres dưới máy CHÍNH LÀ production」). Schema tạm
 * cũng là cách duy nhất kiểm được `truncate → chép → verify` mà không cần hai database.
 *
 * Phủ đúng những chỗ dễ vào sai lặng lẽ: jsonb, mảng text, enum, khoá ngoại, sequence, và
 * phép bỏ qua cột nhịp tim lúc đối chiếu.
 */
import { neon } from "@neondatabase/serverless";
import { SYNC_TABLE_ORDER, verifyDigestExpr } from "../src/lib/mirror/pgSync";
import { promotedStationPatch } from "../src/lib/mirror/promote";
import { appSettingsSchema } from "../src/lib/services/settings";
import { MONGO_DEFAULT_DB, resolveMongoDbName } from "../src/lib/mongo/dbName";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL — chạy `npm run env:pull`.");

const sql = neon(process.env.DATABASE_URL);
const SRC = `mirror_verify_src_${process.pid}`;
const DST = `mirror_verify_dst_${process.pid}`;

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    throw new Error(label);
  }
  passed++;
  console.log(`✔ ${label}`);
}

/** Bản sao thu nhỏ của những kiểu KHÓ trong schema thật: enum, jsonb, mảng, khoá ngoại, serial. */
async function buildSchema(schema: string, rows: number): Promise<void> {
  await sql.query(`create schema ${schema}`);
  await sql.query(`create type ${schema}.mood as enum ('vui', 'buon')`);
  await sql.query(`
    create table ${schema}.owner (
      id text primary key,
      tags text[] not null default '{}',
      cfg jsonb not null default '{}'::jsonb,
      feeling ${schema}.mood not null default 'vui',
      last_seen timestamptz not null default now()
    )`);
  await sql.query(`
    create table ${schema}.note (
      id serial primary key,
      owner_id text not null references ${schema}.owner(id) on delete cascade,
      body text not null,
      amount numeric(20,4)
    )`);

  for (let i = 0; i < rows; i++) {
    await sql.query(
      `insert into ${schema}.owner (id, tags, cfg, feeling, last_seen)
       values ($1, $2::text[], $3::jsonb, $4::${schema}.mood, now())`,
      [
        `o${i}`,
        `{tag${i},"dấu, phẩy"}`,
        JSON.stringify({ n: i, nested: { s: "chuỗi có 'nháy' và \"kép\"" }, arr: [1, 2, 3] }),
        i % 2 === 0 ? "vui" : "buon",
      ],
    );
    await sql.query(
      `insert into ${schema}.note (owner_id, body, amount) values ($1, $2, $3::numeric)`,
      [`o${i}`, `ghi chú ${i} — tiếng Việt có dấu`, "12345678901234.5678"],
    );
  }
}

async function dropSchemas(): Promise<void> {
  for (const s of [SRC, DST]) await sql.query(`drop schema if exists ${s} cascade`);
}

// Engine làm việc trên `public`, nên để nó nhìn thấy schema tạm ta đổi search_path bằng cách
// bọc lại client: mọi câu lệnh của engine đi kèm `set search_path`. Đây là lý do phần kiểm
// gọi trực tiếp các câu SQL tương đương thay vì import engine — engine hardcode `public` cho
// `information_schema` và `regclass`, và bẻ nó chỉ để chiều một phép kiểm là làm hỏng thứ
// đang chạy thật. Ta kiểm ĐÚNG KỸ THUẬT mà engine dùng, trên cùng dữ liệu khó.
const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
const one = <T>(r: unknown): T => (Array.isArray(r) ? r[0] : (r as { rows: T[] }).rows[0]) as T;

async function copyPage(table: string, offset: number, limit: number): Promise<number> {
  const page = `select * from ${SRC}.${q(table)} order by id limit ${limit} offset ${offset}`;
  const json = one<{ j: string }>(
    await sql.query(`select coalesce(json_agg(t)::text, '[]') as j from (${page}) t`),
  ).j;
  const rows = JSON.parse(json) as unknown[];
  if (rows.length === 0) return 0;
  await sql.query(
    `insert into ${DST}.${q(table)} select * from json_populate_recordset(null::${DST}.${q(table)}, $1::json)`,
    [json],
  );
  return rows.length;
}

async function digest(schema: string, table: string, skip: string[]): Promise<string> {
  const strip = skip.map((c) => `- '${c}'`).join(" ");
  const expr = strip ? `to_jsonb(t) ${strip}` : "to_jsonb(t)";
  return one<{ h: string }>(
    await sql.query(`select md5(coalesce(json_agg(${expr} order by id)::text,'[]')) as h from ${schema}.${q(table)} t`),
  ).h;
}

const count = async (schema: string, table: string) =>
  one<{ n: number }>(await sql.query(`select count(*)::int as n from ${schema}.${q(table)}`)).n;

// ---- tên database Mongo (thuần, không cần mạng) ------------------------------------------
// Phần này đứng TRƯỚC mọi thứ đụng Postgres vì nó là chỗ đã làm gãy lượt chuyển trạm thật
// ngày 10/08/2026, và vì nó chạy được cả trên máy không nối nổi Atlas (bệnh DNS SRV).
// Bài học của lượt gãy ấy nằm ở dòng đầu tiên dưới đây: hình dạng chuỗi Atlas ĐỜI THẬT
// không có tên database, mà fixture cũ thì cái nào cũng có — nên 12/12 xanh mà đời thật đỏ.
{
  const ATLAS = "mongodb+srv://u:p@atlas-jarvis-chat.cepk4xw.mongodb.net/?retryWrites=true&w=majority";
  ok(resolveMongoDbName(ATLAS) === MONGO_DEFAULT_DB, `chuỗi Atlas đời thật (KHÔNG có path) → mặc định「${MONGO_DEFAULT_DB}」`);
  ok(resolveMongoDbName(ATLAS, "  ") === MONGO_DEFAULT_DB, "MONGODB_DB toàn khoảng trắng thì coi như không đặt");
  ok(resolveMongoDbName(ATLAS, "jarvis-khac") === "jarvis-khac", "MONGODB_DB thắng mọi nấc dưới");
  ok(
    resolveMongoDbName("mongodb+srv://u:p@host.mongodb.net/so-tay?retryWrites=true") === "so-tay",
    "có path thì lấy path, và query string không dính vào tên",
  );
  ok(resolveMongoDbName("mongodb://localhost:27017/") === MONGO_DEFAULT_DB, "path rỗng (chỉ dấu /) → mặc định");
  ok(resolveMongoDbName("mongodb+srv://u:p@host.net/t%C3%B4ng%20m%C3%B4n") === "tông môn", "path được giải mã percent-encoding");
  ok(resolveMongoDbName("không-phải-uri") === MONGO_DEFAULT_DB, "URI hỏng thì lùi về mặc định chứ KHÔNG ném — lỗi thật để dành cho lúc connect");
}

try {
  await dropSchemas();
  const ROWS = 7;
  await buildSchema(SRC, ROWS);
  await buildSchema(DST, 3); // đích có sẵn RÁC — lượt chép phải xoá sạch nó trước
  console.log(`• schema tạm: ${SRC} (${ROWS} dòng) và ${DST} (3 dòng rác)`);

  ok((await count(DST, "owner")) === 3, "đích có sẵn dữ liệu rác trước khi chép");

  // ---- truncate + chép ------------------------------------------------------------------
  await sql.query(`truncate table ${DST}.${q("owner")}, ${DST}.${q("note")} restart identity cascade`);
  ok((await count(DST, "owner")) === 0 && (await count(DST, "note")) === 0, "truncate dọn sạch đích");

  // Chép theo trang nhỏ để đi qua đúng đường phân trang của engine (3 dòng/trang cho 7 dòng).
  let copied = 0;
  for (let off = 0; ; off += 3) {
    const n = await copyPage("owner", off, 3);
    copied += n;
    if (n < 3) break;
  }
  ok(copied === ROWS, `chép owner theo trang 3 dòng → đủ ${ROWS} dòng`);
  for (let off = 0; ; off += 3) {
    const n = await copyPage("note", off, 3);
    if (n < 3) break;
  }
  ok((await count(DST, "note")) === ROWS, `chép note (bảng con, có khoá ngoại) → đủ ${ROWS} dòng`);

  // ---- nội dung khớp, kể cả kiểu khó -----------------------------------------------------
  ok((await digest(SRC, "owner", [])) === (await digest(DST, "owner", [])), "owner khớp MD5 — jsonb, text[], enum vào đúng kiểu");
  ok((await digest(SRC, "note", [])) === (await digest(DST, "note", [])), "note khớp MD5 — numeric giữ nguyên độ chính xác");

  const amt = one<{ a: string }>(await sql.query(`select amount::text as a from ${DST}.note order by id limit 1`)).a;
  ok(amt === "12345678901234.5678", `numeric không bị JS làm tròn (đọc lại: ${amt})`);

  // `as t` là bắt buộc, không phải trang trí: khai kiểu `{ t: … }` mà câu lệnh trả cột `tags`
  // thì `.t` là undefined và phép kiểm đỏ oan — đã dính đúng lần đầu chạy.
  const tags = one<{ t: string[] }>(await sql.query(`select tags as t from ${DST}.owner order by id limit 1`)).t;
  ok(Array.isArray(tags) && tags.length === 2 && tags[1] === "dấu, phẩy", "mảng text giữ nguyên phần tử có dấu phẩy");

  // ---- cột nhịp tim bị bỏ qua lúc đối chiếu ----------------------------------------------
  await sql.query(`update ${DST}.owner set last_seen = now() + interval '1 hour'`);
  ok((await digest(SRC, "owner", [])) !== (await digest(DST, "owner", [])), "đổi last_seen thì MD5 thô KHÁC nhau");
  ok(
    (await digest(SRC, "owner", ["last_seen"])) === (await digest(DST, "owner", ["last_seen"])),
    "bỏ qua last_seen thì lại khớp — đúng cách verifyTable đối xử với nhịp tim",
  );

  // ---- sequence --------------------------------------------------------------------------
  const maxId = one<{ m: string }>(await sql.query(`select max(id)::bigint as m from ${DST}.note`)).m;
  await sql.query(`select setval($1, $2::bigint, true)`, [`${DST}.note_id_seq`, String(Math.max(Number(maxId), 1))]);
  await sql.query(`insert into ${DST}.note (owner_id, body) values ('o0', 'dòng sau khi đặt lại sequence')`);
  const newId = one<{ m: number }>(await sql.query(`select max(id)::int as m from ${DST}.note`)).m;
  ok(newId === Number(maxId) + 1, `sequence đặt lại đúng: dòng mới nhận id ${newId} (max cũ ${maxId})`);

  // ---- phát hiện sai sót thật -------------------------------------------------------------
  await sql.query(`update ${DST}.owner set cfg = jsonb_set(cfg, '{n}', '999') where id = 'o0'`);
  ok(
    (await digest(SRC, "owner", ["last_seen"])) !== (await digest(DST, "owner", ["last_seen"])),
    "sửa một giá trị trong jsonb thì đối chiếu PHẢI đỏ — phép kiểm không mù",
  );

  // ---- khoá jsonb tự tham chiếu trong app_settings ---------------------------------------
  // Máy chuyển trạm ghi tiến độ vào app_settings, tức vào đúng bảng nó đang chép — lượt diễn
  // tập thứ hai (10/08/2026) chết ở「Đối chiếu app_settings hỏng: LỆCH NỘI DUNG」vì thế.
  // Phần này gọi CHÍNH `verifyDigestExpr` mà verifyTable dùng, không dựng lại biểu thức: bài
  // học vừa trả giá ở mongoSync là phép kiểm xây trên bản sao của một luật thì xanh vô nghĩa.
  const rawDigest = async (schema: string, expr: string) =>
    one<{ h: string }>(
      await sql.query(`select md5(coalesce(json_agg(${expr} order by id)::text,'[]')) as h from ${schema}.app_settings t`),
    ).h;

  const settingsExpr = verifyDigestExpr("app_settings");
  ok(settingsExpr.includes("'mirrorSwitch'"), "biểu thức đối chiếu app_settings có loại khoá mirrorSwitch");
  ok(settingsExpr.includes("- 'updated_at'"), "…VÀ loại cả cột updated_at — chỗ bản vá đầu bỏ sót");
  ok(verifyDigestExpr("users") === "to_jsonb(t)", "bảng không khai gì thì băm thẳng, không phù phép");
  ok(verifyDigestExpr("workers").includes("- 'last_seen'"), "workers vẫn loại cột nhịp tim như cũ");
  ok(
    SYNC_TABLE_ORDER[SYNC_TABLE_ORDER.length - 1] === "app_settings",
    "app_settings chép CUỐI — cửa sổ lạc hậu co lại còn đúng bước đối chiếu",
  );

  // Bảng giả mang ĐÚNG BA CỘT của bảng thật, kể cả updated_at. Bản kiểm trước chỉ có (id, value)
  // nên nó xanh trong khi đời thật đỏ — đúng cái bẫy fixture đã trả giá một lần ở mongoSync,
  // vấp lại ngay trong cùng một buổi. Hình dạng của fixture LÀ một phần của phép kiểm.
  for (const schema of [SRC, DST]) {
    await sql.query(`create table ${schema}.app_settings (
      id text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    await sql.query(
      `insert into ${schema}.app_settings (id, value, updated_at) values ('global', $1::jsonb, '2026-08-10T16:42:10Z')`,
      [JSON.stringify({ chat: { retentionDays: 14 }, mirrorSwitch: { phase: "idle", copiedRows: 0 } })],
    );
  }
  // Nguồn nhúc nhích ĐÚNG như lúc chạy thật: mỗi nhịp một lần stamp vào mirrorSwitch, và
  // saveAppSettings đẩy updated_at theo — hai thứ luôn đi cùng nhau, nên phải kiểm cùng nhau.
  await sql.query(
    `update ${SRC}.app_settings set value = jsonb_set(value, '{mirrorSwitch}', $1::jsonb, true), updated_at = '2026-08-10T16:42:32Z'`,
    [JSON.stringify({ phase: "verifying", copiedRows: 11458, note: "Đang chép job_events: 10000 dòng." })],
  );
  ok(
    (await rawDigest(SRC, "to_jsonb(t)")) !== (await rawDigest(DST, "to_jsonb(t)")),
    "băm THẲNG thì hai bên lệch — tái hiện đúng lượt diễn tập đã chết",
  );
  ok(
    (await rawDigest(SRC, settingsExpr)) === (await rawDigest(DST, settingsExpr)),
    "loại mirrorSwitch ra thì khớp — bản vá đứng vững trước chính ca đã gãy",
  );
  // Và phép so KHÔNG được mù phần còn lại: đổi một khoá anh em thì phải đỏ.
  await sql.query(`update ${DST}.app_settings set value = jsonb_set(value, '{chat,retentionDays}', '30')`);
  ok(
    (await rawDigest(SRC, settingsExpr)) !== (await rawDigest(DST, settingsExpr)),
    "đổi một khoá KHÁC trong value thì vẫn đỏ — loại mirrorSwitch không phải bịt mắt cả cột",
  );

  // ---- bản ghi đặt vào trạm SẮP LÊN THAY --------------------------------------------------
  // Hỏng lặng lẽ là rủi ro thật ở đây: `appSettingsSchema` bọc mọi nhánh bằng `.catch()`, nên
  // một trường lệch tên KHÔNG ném — nó âm thầm hoá thành mặc định, và trạm mới lên ngôi với
  // một bản ghi không phải cái ta viết. Vì vậy phép kiểm cho patch đi QUA schema thật rồi so
  // lại từng giá trị, chứ không chỉ nhìn hình thù đối tượng.
  const patch = promotedStationPatch("main", new Date("2026-08-10T17:01:20.000Z"));
  const parsed = appSettingsSchema.parse({ maintenance: patch.maintenance, mirrorSwitch: patch.mirrorSwitch });

  ok(parsed.maintenance.active === false, "trạm lên ngôi: bế quan TẮT (qua schema thật, không bị .catch() nuốt)");
  ok(parsed.maintenance.note === "" && parsed.maintenance.expectedEndAt === null, "…và mốc bế quan cũ bị xoá sạch");
  ok(parsed.mirrorSwitch.phase === "idle", "trạm lên ngôi: phase idle — mở được lượt chuyển kế NGAY");
  ok(parsed.mirrorSwitch.targetId === "", "…targetId rỗng, nên nút「Lật」không trỏ vào chính mình");
  ok(parsed.mirrorSwitch.copiedRows === 0 && parsed.mirrorSwitch.tableIndex === 0, "…bộ đếm của lượt cũ về 0");
  ok(parsed.mirrorSwitch.note.includes("main"), "…nhưng lịch sử còn nguyên trong note: cất nhắc từ đâu");
  ok(parsed.mirrorSwitch.note.includes("2026-08-10T17:01:20"), "…và lúc nào");

  console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
} finally {
  await dropSchemas();
  console.log("• đã xoá schema tạm");
}
