#!/usr/bin/env node
/**
 * Dọn dấu vết của Jarvis khỏi database DÙNG CHUNG (`neondb`), sau khi đã chuyển sang
 * database riêng.
 *
 * Cẩn trọng có chủ ý — script này XOÁ BẢNG, nên nó:
 *   1. chỉ đụng đúng 4 bảng + 3 enum của Jarvis, liệt kê tường minh, không quét theo mẫu;
 *   2. từ chối chạy nếu database đang trỏ tới KHÔNG chứa bảng của project phim (dấu hiệu
 *      chuỗi kết nối bị nhầm — thà không làm gì còn hơn xoá nhầm chỗ);
 *   3. in ra những gì sắp xoá và đòi biến DELETE_YES=1 mới thực thi.
 *
 *   DATABASE_URL="<chuỗi tới neondb>" DELETE_YES=1 node scripts/cleanupSharedDb.mjs
 */
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL chưa được đặt.");
  process.exit(1);
}

const sql = neon(url);
const dbName = (await sql`select current_database() as db`)[0].db;

// Bảng của Jarvis, và bảng làm CHỨNG CỨ rằng đây đúng là database dùng chung.
const JARVIS_TABLES = ["job_events", "automation_jobs", "user_configs", "users"];
const JARVIS_ENUMS = ["job_status", "user_status", "user_role"];
const WITNESS = ["movies", "episodes"];

const present = new Set(
  (await sql`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename),
);

const witnessed = WITNESS.filter((t) => present.has(t));
if (witnessed.length === 0) {
  console.error(
    `✗ Database「${dbName}」không có bảng của project phim (${WITNESS.join(", ")}).\n` +
      `  Đây có vẻ KHÔNG phải database dùng chung — không xoá gì cả.`,
  );
  process.exit(1);
}

const toDrop = JARVIS_TABLES.filter((t) => present.has(t));
if (toDrop.length === 0) {
  console.log(`• Database「${dbName}」không còn bảng nào của Jarvis — không cần làm gì.`);
  process.exit(0);
}

console.log(`Database   : ${dbName}`);
console.log(`Chứng cứ   : có ${witnessed.join(", ")} → đúng là DB dùng chung`);
console.log(`Sẽ xoá bảng: ${toDrop.join(", ")}`);
console.log(`Sẽ xoá enum: ${JARVIS_ENUMS.join(", ")}`);

for (const t of toDrop) {
  const n = (await sql.query(`select count(*)::int as n from "${t}"`))[0].n;
  if (n > 0) console.log(`  ! ${t} còn ${n} dòng dữ liệu`);
}

if (process.env.DELETE_YES !== "1") {
  console.log("\nChưa xoá gì. Chạy lại với DELETE_YES=1 nếu chắc chắn.");
  process.exit(0);
}

// Thứ tự: bảng con trước (khoá ngoại), rồi enum. CASCADE cố ý KHÔNG dùng — nếu còn ràng
// buộc ngoài dự kiến thì nên dừng lại và xem, chứ không cuốn theo thứ mình chưa biết.
for (const t of JARVIS_TABLES) {
  if (present.has(t)) {
    await sql.query(`drop table if exists "${t}"`);
    console.log(`  ✔ đã xoá bảng ${t}`);
  }
}

for (const e of JARVIS_ENUMS) {
  await sql.query(`drop type if exists "${e}"`);
  console.log(`  ✔ đã xoá enum ${e}`);
}

console.log("\n✔ Database dùng chung đã sạch dấu vết Jarvis.");
