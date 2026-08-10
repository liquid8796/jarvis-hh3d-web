import { neon } from "@neondatabase/serverless";

/**
 * Engine đồng bộ Postgres giữa hai trạm — bản SẢN PHẨM HOÁ của quy trình đã chạy tay ngày
 * 10/08/2026 khi dời `jarvis-auto-hh3d` → `jarvis-hh3d` (10.900 dòng, khớp MD5 từng bảng).
 *
 * Hai điều cốt tử học được hôm ấy, cả hai đều nằm trong `copyTablePage`:
 *
 *  1. Chép qua `json_populate_recordset` chứ KHÔNG tự ghép câu INSERT. Bảng ở đây có `jsonb`,
 *     ba enum riêng và `text[]`; tự ép kiểu là tự tay dịch lại toàn bộ, sót một cột thì dữ
 *     liệu vào sai lặng lẽ. Cách này đẩy việc ép kiểu cho chính Postgres, khớp theo TÊN cột.
 *  2. JSON đi dưới dạng CHUỖI (`json_agg(...)::text`), không cho JavaScript phân tích: một
 *     `bigint` hay `numeric` đi qua `Number` của JS là mất chính xác không báo trước.
 *
 * Chia LÔ vì đây chạy trong server action: mỗi lượt gọi chép một trang rồi trả quyền điều
 * khiển về, nên không lượt nào chạm trần thời gian của function và trang admin thấy tiến độ
 * thật. Không dùng transaction — `neon-http` không có; bù lại mọi bước đều idempotent
 * (truncate rồi chép lại từ đầu), và bảng điều phối chỉ lật sau khi verify xanh nên một lượt
 * hỏng giữa chừng không ai nhìn thấy.
 */

/**
 * Thứ tự CHA TRƯỚC CON, lấy bằng sắp xếp tô-pô trên đồ thị khoá ngoại thật (10/08/2026).
 * Sai thứ tự là vi phạm khoá ngoại ngay dòng đầu tiên. Thêm bảng mới thì phải chèn đúng chỗ —
 * `assertTablesCovered` bên dưới bắt được nếu quên.
 */
export const SYNC_TABLE_ORDER = [
  "app_settings",
  "permissions",
  "roles",
  "users",
  "game_accounts",
  "role_permissions",
  "user_configs",
  "user_roles",
  "workers",
  "automation_jobs",
  "job_events",
] as const;

export type SyncTable = (typeof SYNC_TABLE_ORDER)[number];

/** Một trang mỗi lượt gọi. 1000 là con số đã chạy thật: đủ lớn để ít lượt, đủ nhỏ để payload JSON không quá khổ. */
export const SYNC_PAGE_SIZE = 1000;

/**
 * Cột nhịp tim — đổi liên tục vì khôi lỗi vẫn đập nhịp trong lúc chép, nên chúng KHÔNG được
 * tính là "lệch nội dung". Đã đo 10/08: sau khi chép xong, đúng hai cột này lệch còn 0 dòng
 * thiếu. Bỏ qua chúng lúc verify là bỏ qua tiếng ồn, không phải bỏ qua sai sót.
 */
const HEARTBEAT_COLUMNS: Partial<Record<SyncTable, readonly string[]>> = {
  workers: ["last_seen"],
  automation_jobs: ["last_heartbeat"],
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
type Sql = ReturnType<typeof neon>;
const one = <T>(rows: unknown): T => (Array.isArray(rows) ? rows[0] : (rows as { rows: T[] }).rows[0]) as T;

export function connect(url: string): Sql {
  return neon(url);
}

/**
 * Bảng ở ĐÍCH phải trùng đúng danh sách ta biết chép. Thừa một bảng nghĩa là schema đích lạ;
 * thiếu một bảng nghĩa là chưa migrate đủ. Cả hai đều phải chặn TRƯỚC khi xoá bất cứ thứ gì.
 */
export async function assertTablesCovered(sql: Sql): Promise<void> {
  const rows = await sql`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `;
  const actual = new Set((rows as { table_name: string }[]).map((r) => r.table_name));
  const known = new Set<string>(SYNC_TABLE_ORDER);
  const missing = [...known].filter((t) => !actual.has(t));
  const extra = [...actual].filter((t) => !known.has(t));
  if (missing.length || extra.length) {
    throw new Error(
      `Danh sách bảng không khớp schema đích` +
        (missing.length ? ` · thiếu ở đích: ${missing.join(", ")}` : "") +
        (extra.length ? ` · đích có thêm: ${extra.join(", ")} (chưa khai trong SYNC_TABLE_ORDER)` : ""),
    );
  }
}

export async function countRows(sql: Sql, table: string): Promise<number> {
  return one<{ n: number }>(await sql.query(`select count(*)::int as n from ${q(table)}`)).n;
}

/** Khoá chính, dùng làm thứ tự phân trang. Không có khoá chính thì OFFSET là thứ tự không xác định. */
export async function primaryKeyColumns(sql: Sql, table: string): Promise<string[]> {
  const rows = await sql`
    select a.attname from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary
     order by a.attnum
  `;
  return (rows as { attname: string }[]).map((r) => r.attname);
}

/**
 * Dọn ĐÍCH. Chạy một lần ở đầu lượt đồng bộ: migration tự gieo sẵn roles/permissions, mà ta
 * muốn đích khớp nguồn TỪNG DÒNG chứ không chèn chồng lên phần gieo ấy.
 */
export async function truncateAll(dest: Sql): Promise<void> {
  await assertTablesCovered(dest);
  await dest.query(`truncate table ${SYNC_TABLE_ORDER.map(q).join(", ")} restart identity cascade`);
}

/** Chép một trang. Trả về số dòng thực chép — 0 nghĩa là trang này rỗng, bảng đã hết. */
export async function copyTablePage(
  src: Sql,
  dest: Sql,
  table: SyncTable,
  offset: number,
  limit: number = SYNC_PAGE_SIZE,
): Promise<number> {
  const pk = await primaryKeyColumns(src, table);
  if (pk.length === 0) throw new Error(`${table} không có khoá chính — không phân trang an toàn được.`);
  const order = pk.map(q).join(", ");

  const page = `select * from ${q(table)} order by ${order} limit ${limit} offset ${offset}`;
  const json = one<{ j: string }>(
    await src.query(`select coalesce(json_agg(t)::text, '[]') as j from (${page}) t`),
  ).j;

  const rows = JSON.parse(json) as unknown[];
  if (rows.length === 0) return 0;

  await dest.query(
    `insert into ${q(table)} select * from json_populate_recordset(null::${q(table)}, $1::json)`,
    [json],
  );
  return rows.length;
}

/**
 * Đặt lại sequence theo dữ liệu vừa chép. Bỏ bước này thì lần GHI tiếp theo đâm vào khoá
 * chính đã tồn tại — hỏng ở tận lúc chạy thật, không phải lúc chép.
 *
 * CHỈ schema `public`: không lọc thì câu này vớ luôn sequence của `drizzle.__drizzle_migrations`
 * rồi đi tra một bảng ở schema khác mà không kèm tên schema (đã ngã thật 10/08).
 */
export async function resetSequences(src: Sql, dest: Sql): Promise<string[]> {
  const seqs = (await src`
    select s.relname as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_namespace ns on ns.oid = s.relnamespace and ns.nspname = 'public'
      join pg_depend d on d.objid = s.oid and d.deptype = 'a'
      join pg_class t on t.oid = d.refobjid
      join pg_namespace nt on nt.oid = t.relnamespace and nt.nspname = 'public'
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S'
  `) as { seq: string; tbl: string; col: string }[];

  const notes: string[] = [];
  for (const { seq, tbl, col } of seqs) {
    const max = one<{ m: string }>(
      await dest.query(`select coalesce(max(${q(col)}), 0)::bigint as m from ${q(tbl)}`),
    ).m;
    // `setval(..., true)` nghĩa là giá trị KẾ TIẾP sẽ là max+1. Sàn 1 vì setval không nhận 0.
    const value = String(Math.max(Number(max), 1));
    await dest.query(`select setval($1, $2::bigint, true)`, [seq, value]);
    notes.push(`${seq}=${value}`);
  }
  return notes;
}

export type TableVerdict = {
  table: SyncTable;
  srcRows: number;
  destRows: number;
  /** Khớp cả số dòng lẫn nội dung (đã bỏ qua cột nhịp tim). */
  ok: boolean;
  detail: string;
};

/**
 * So NỘI DUNG, không chỉ đếm dòng: một cột jsonb vào sai kiểu hay một phần tử mảng rơi mất
 * đều giữ nguyên số dòng. MD5 của cả bảng, hàng sắp theo khoá chính, cột nhịp tim bị loại
 * khỏi phép băm ở CẢ HAI phía để tiếng ồn không bị đọc thành sai sót.
 */
export async function verifyTable(src: Sql, dest: Sql, table: SyncTable): Promise<TableVerdict> {
  const [srcRows, destRows] = [await countRows(src, table), await countRows(dest, table)];
  const pk = await primaryKeyColumns(src, table);
  const order = pk.map(q).join(", ");
  const skip = HEARTBEAT_COLUMNS[table] ?? [];
  // `- 'cột'` trên jsonb bỏ khoá khỏi từng hàng trước khi băm; không cột nào bỏ thì băm thẳng.
  const strip = skip.length ? skip.map((c) => `- '${c.replace(/'/g, "''")}'`).join(" ") : "";
  const expr = strip ? `to_jsonb(t) ${strip}` : `to_jsonb(t)`;

  const digest = async (sql: Sql) =>
    one<{ h: string }>(
      await sql.query(
        `select md5(coalesce(json_agg(${expr} order by ${order})::text, '[]')) as h from ${q(table)} t`,
      ),
    ).h;

  if (srcRows !== destRows) {
    return { table, srcRows, destRows, ok: false, detail: `lệch số dòng (nguồn ${srcRows}, đích ${destRows})` };
  }
  const [a, b] = [await digest(src), await digest(dest)];
  return {
    table,
    srcRows,
    destRows,
    ok: a === b,
    detail: a === b ? `khớp ${srcRows} dòng${skip.length ? ` (bỏ qua ${skip.join(", ")})` : ""}` : "LỆCH NỘI DUNG",
  };
}
