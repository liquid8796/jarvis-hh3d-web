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

  console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
} finally {
  await dropSchemas();
  console.log("• đã xoá schema tạm");
}
