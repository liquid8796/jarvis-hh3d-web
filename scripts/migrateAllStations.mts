#!/usr/bin/env node
/**
 * ÁP MIGRATION LÊN MỌI TRẠM TRONG SỔ GƯƠNG — không chỉ trạm mà `.env.local` đang trỏ tới.
 *
 *   npm run db:migrate:all -- --dry-run    xem kế hoạch, không đụng database nào
 *   npm run db:migrate:all
 *
 * ── VÌ SAO TỆP NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 *
 * `npm run db:migrate` áp lên ĐÚNG MỘT database — cái trong `DATABASE_URL` dưới máy. Với hệ
 * gương trạm thì đó là một nửa công việc, và nửa còn lại KHÔNG kêu gì cả cho tới ngày chuyển
 * trạm. Đo ngày 14/08/2026, sau khi lượt chuyển sang `auto-hh3d-1` chết ở「workers: LỆCH NỘI
 * DUNG」: trạm đang phục vụ đã áp 28 migration, **cả bốn trạm gương còn 27** — thiếu đúng
 * `last_assigned_at` và `max_jobs` mà migration `0027` thêm vào sáng hôm ấy.
 *
 * Lượt chép vẫn báo xanh (xem `reviewColumnDrift`), nên cái sai chỉ lộ ra ở bước cuối, sau khi
 * đã đóng cửa phát việc, chờ đàn cạn, xoá sạch đích và chép xong 11 bảng. Một việc phải làm
 * bốn lần mà công cụ chỉ làm được một lần là một việc sẽ bị quên — không phải nếu, mà khi nào.
 *
 * ── CHÍNH `migrate.mjs` LÀM VIỆC, TỆP NÀY CHỈ XẾP HÀNG ────────────────────────────────────
 *
 * Mỗi trạm là một lượt gọi `node scripts/migrate.mjs` với `DATABASE_URL` riêng trong env của
 * tiến trình con (`loadEnv` chỉ điền biến CÒN THIẾU nên giá trị truyền vào thắng). Không chép
 * lại phần migrate vào đây: hai đường migrate là hai đường sẽ trôi khỏi nhau, mà thứ trôi ở
 * đây là DDL trên dữ liệu thật.
 *
 * Chuỗi kết nối KHÔNG BAO GIỜ được in ra — nó mang mật khẩu. `migrate.mjs` tự in host, và đó
 * là đúng mức chi tiết cần cho người đang bấm lệnh.
 */
import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../src/lib/crypto/secretBox";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const dryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL chưa đặt — cần nó để ĐỌC SỔ GƯƠNG, chưa nói tới việc migrate.");
  process.exit(1);
}

/** Một dòng sổ gương, rút gọn về đúng thứ tệp này cần. */
type BookEntry = { id: string; name?: string; pg: string };

const book = neon(process.env.DATABASE_URL);
const rows = (await book`select value from app_settings where id = 'global'`) as { value: unknown }[];
const value = rows[0]?.value as { mirrors?: BookEntry[] } | undefined;
const mirrors = value?.mirrors ?? [];

if (mirrors.length === 0) {
  console.error(
    "Sổ gương rỗng — không có trạm nào để migrate.\n" +
      "Sổ đọc từ DATABASE_URL dưới máy; nếu máy này trỏ vào một trạm đã nghỉ thì sổ của nó có thể\n" +
      "đã đóng băng. Chạy `npm run mirror:control status` xem trạm nào đang phục vụ.",
  );
  process.exit(1);
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "(chuỗi kết nối không đọc được)";
  }
};

/** Mở phong bì TRƯỚC, cho cả sổ, để một phong bì mục nát lộ ra ở phần kế hoạch chứ không giữa chừng. */
const targets: { id: string; conn: string | null; why?: string }[] = mirrors.map((entry) => {
  try {
    return { id: entry.id, conn: decryptSecret(entry.pg) };
  } catch (err) {
    return { id: entry.id, conn: null, why: err instanceof Error ? err.message : "lỗi lạ" };
  }
});

console.log(`\n── Kế hoạch: ${targets.length} trạm trong sổ ────────────────────────────`);
for (const t of targets) {
  console.log(
    t.conn ? `  ✔ ${t.id.padEnd(14)} → ${hostOf(t.conn)}` : `  ✗ ${t.id.padEnd(14)} → phong bì hỏng: ${t.why}`,
  );
}

if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, chưa đụng database nào.\n");
  process.exit(targets.some((t) => !t.conn) ? 1 : 0);
}

let failed = 0;
for (const target of targets) {
  console.log(`\n── ${target.id} ─────────────────────────────────`);
  if (!target.conn) {
    console.error(`  ✗ bỏ qua: phong bì hỏng (${target.why})`);
    failed += 1;
    continue;
  }
  const run = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    // `DATABASE_URL` của tiến trình con thắng mọi tệp .env — xem đầu tệp.
    env: { ...process.env, DATABASE_URL: target.conn },
    stdio: "inherit",
  });
  if (run.status === 0) continue;
  // Không dừng cả lượt: một trạm hỏng không được phép giữ ba trạm còn lại ở lại phía sau. Nhưng
  // mã thoát cuối cùng phải ĐỎ, vì "ba trên bốn" chính là cái trạng thái đã đẻ ra bản vá này.
  console.error(`  ✗ ${target.id}: migrate thoát mã ${run.status ?? "?"}${run.error ? ` (${run.error.message})` : ""}`);
  failed += 1;
}

console.log(`\n── Tổng kết ─────────────────────────────────`);
console.log(`  ${targets.length - failed}/${targets.length} trạm đã áp xong migration.`);
if (failed > 0) {
  console.error(
    `  ✗ còn ${failed} trạm CHƯA áp được. Lượt chuyển trạm sang những trạm ấy sẽ bị chặn ở hàng rào\n` +
      "    schema (reviewColumnDrift) — chữa xong rồi chạy lại lệnh này.",
  );
  process.exit(1);
}
console.log("  Mọi trạm trong sổ cùng một schema — lượt chuyển trạm sẽ không vấp vì lệch cột.\n");
