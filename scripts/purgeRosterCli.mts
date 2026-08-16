#!/usr/bin/env node
/**
 * DỌN SỔ ĐIỂM DANH — gỡ những dòng khôi lỗi tông môn đã chết hẳn.
 *
 *   npm run roster:purge                     (hoặc bấm đúp purge-roster.bat)
 *   npm run roster:purge -- --dry-run        soi danh sách, KHÔNG gỡ gì
 *   npm run roster:purge -- --older-than 6   đổi ngưỡng im lặng (giờ, mặc định 24)
 *   npm run roster:purge -- --force          gỡ cả dòng có trong sổ Kho GitHub
 *
 * VÌ SAO CẦN: sổ điểm danh là sổ ĐĂNG KÝ, không phải danh sách tiến trình — `recordWorkerSeen`
 * chỉ biết thêm và cập nhật, nên một cái tên vào rồi ở lại vĩnh viễn. `forgetWorker` chỉ gỡ được
 * khôi lỗi RIÊNG (nó lọc theo `userId`), nên dòng của khôi lỗi TÔNG MÔN đã chết thì không cửa nào
 * dọn. Đo 14/08/2026: `github-khoiloi` im 4 giờ và `github-khoiloi-20260813-101341` im 12,7 giờ,
 * cả hai vẫn nằm trong tab Khôi Lỗi như thể đang trực.
 *
 * ── PHẢI CHẠY TRÊN VM (16/08/2026) ────────────────────────────────────────────────────────────
 *
 * Bản trước leo ba nấc thang để tìm「database của trạm đang hoạt động」— bảng điều phối, rồi sổ
 * gương, rồi hỏi thẳng Vercel. Cuộc dời backend về VM xoá sổ chính CÂU HỎI ấy: mỗi trạm không
 * còn database riêng, và những Neon cũ vẫn nối được nhưng đã đóng băng từ giây cắt chuyển. Leo
 * thang bây giờ chỉ dẫn tới một bản sao sai — dọn sổ điểm danh của một database bỏ hoang, rồi
 * báo xanh.
 *
 * Nên nay chỉ còn một câu hỏi (`appDatabaseUrl`) và một lời từ chối chỉ đúng lệnh phải gõ lại:
 *
 *     npm run vm -- npm run roster:purge -- --dry-run
 *
 * Phép GỠ thì dùng lại `purgeRosterRow` của lượt xoá kho: nó không xoá một phát rồi đi, nó canh
 * cho tới khi dòng chịu nằm im — vì một runner vừa mất kho còn thoi thóp thêm ~52 giây và sẽ tự
 * ghi lại tên. Nhờ vậy, nếu phép phân loại ở đây có lỡ nhắm vào một dòng CÒN SỐNG thì vòng canh
 * phát hiện ra và kêu lên, thay vì lặng lẽ đánh nhau với nó.
 */
import { sqlTag } from "./pgTag.mjs";
import { reviewRosterRow, type RosterRow } from "./githubKhoiloi.mts";
import { appDatabaseUrl } from "./activeStationPg.mts";
import { purgeRosterRow } from "./rosterPurge.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const force = argv.includes("--force");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  const value = argv[at + 1];
  return at > -1 && value && !value.startsWith("--") ? value : undefined;
};

/**
 * Ngưỡng im lặng mặc định: MỘT NGÀY.
 *
 * Rộng hơn hẳn mức cần thiết về mặt kỹ thuật (khôi lỗi sống gõ cửa mỗi 5 giây), và đó là chủ ý —
 * hai cái giá không cân nhau. Gỡ nhầm một dòng còn dùng thì mở đường cho một khôi lỗi trùng id,
 * thứ làm dashboard nói dối về việc ai đang trực. Để một dòng ma nằm thêm một ngày thì tốn đúng
 * một dòng thừa trong tab Khôi Lỗi.
 */
const DEFAULT_QUIET_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

const rawHours = arg("older-than");
const quietHours = rawHours === undefined ? DEFAULT_QUIET_HOURS : Number(rawHours);
if (!Number.isFinite(quietHours) || quietHours <= 0) {
  console.error(`\n✗ --older-than phải là số giờ dương, nhận được「${rawHours}」.`);
  process.exit(1);
}
const quietThresholdMs = quietHours * HOUR_MS;

/**
 * Khai bằng `function`, không phải hàm mũi tên gán vào `const`: phép phân tích「biến này đã được
 * gán chưa」của TypeScript chỉ đi qua được dạng khai báo. Với hàm mũi tên thì mọi nhánh `catch`
 * kết bằng `die(...)` vẫn bị coi là có thể chạy tiếp, và cả khối dưới đỏ vì「dùng trước khi gán」.
 */
function die(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---- 1. Database mà APP đang dùng ------------------------------------------------------------
//
// Xem khối bình chú đầu tệp: chỉ còn một câu hỏi, và một lời từ chối chỉ đúng lệnh phải gõ lại.
const activePg = ((): string => {
  try {
    return appDatabaseUrl();
  } catch (err) {
    return die(err instanceof Error ? err.message : "Không tra ra database của app.");
  }
})();
const via = "database của app (Postgres trên VM)";

console.log(`Dọn sổ điểm danh — ${via}`);
console.log(`  ngưỡng im lặng: ${quietHours} giờ${force ? "   ·   --force: gỡ cả dòng có trong sổ Kho GitHub" : ""}`);

// ---- 2. Ảnh chụp: dòng điểm danh, đàn đang giữ, và sổ Kho GitHub -------------------------------

const sql = sqlTag(activePg);

/**
 * BA phép đọc trong MỘT lượt, và cả ba phải kể về cùng một khoảnh khắc: một dòng vừa nhận đàn
 * giữa hai lượt đọc sẽ bị phán là xác. Neon over HTTP không có transaction, nên cách rẻ nhất để
 * thu hẹp khe ấy là hỏi cả ba trong một câu — `quiet_s` và `held` đọc cùng một ảnh chụp của
 * Postgres, và sổ Kho GitHub thì gần như không đổi.
 */
const rows = (await sql`
  select
    w.id,
    w.user_id,
    round(extract(epoch from (now() - w.last_seen)))::int as quiet_s,
    (select count(*)::int from automation_jobs j
      where j.worker_id = w.id and j.status in ('running', 'stopping')) as held,
    (select coalesce(jsonb_agg(s.value ->> 'workerId'), '[]'::jsonb)
       from app_settings a, jsonb_array_elements(coalesce(a.value -> 'githubStations', '[]'::jsonb)) s
      where a.id = 'global') as book
  from workers w
  order by w.last_seen desc
`) as Array<{ id: string; user_id: string | null; quiet_s: number | null; held: number; book: unknown }>;

if (rows.length === 0) {
  console.log("\nSổ điểm danh trống — không có gì để dọn.");
  process.exit(0);
}

const bookWorkerIds = new Set(
  (Array.isArray(rows[0]?.book) ? rows[0].book : [])
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim()),
);

// ---- 3. Phân loại -----------------------------------------------------------------------------

type Judged = { row: RosterRow; purge: boolean; why: string };

const judged: Judged[] = rows.map((raw) => {
  const row: RosterRow = {
    id: String(raw.id),
    userId: raw.user_id === null ? null : String(raw.user_id),
    quietMs: (raw.quiet_s ?? 0) * 1000,
    heldJobs: Number(raw.held) || 0,
  };
  const verdict = reviewRosterRow({ row, bookWorkerIds, quietThresholdMs, force });
  return { row, ...verdict };
});

const doomed = judged.filter((j) => j.purge);
const kept = judged.filter((j) => !j.purge);

const gio = (ms: number) => (ms >= HOUR_MS ? `${Math.round(ms / HOUR_MS)}g` : `${Math.round(ms / 60_000)}p`);

console.log(`\n── Sổ điểm danh: ${judged.length} dòng ─────────────────────────`);
for (const j of judged) {
  const mark = j.purge ? "✗" : "·";
  console.log(`  ${mark} ${j.row.id.padEnd(34)} im ${gio(j.row.quietMs).padEnd(5)} ${j.why}`);
}

if (doomed.length === 0) {
  console.log("\n✔ Không dòng nào đủ điều kiện gỡ — sổ đang sạch.");
  process.exit(0);
}

console.log(`\n── Sẽ GỠ ${doomed.length} dòng ─────────────────────────────`);
for (const j of doomed) console.log(`  ${j.row.id}`);

if (dryRun) {
  console.log("\n  --dry-run: KHÔNG gỡ gì cả. Bỏ cờ ấy để dọn thật.");
  process.exit(0);
}

// ---- 4. Gỡ, rồi canh cho tới khi dòng chịu nằm im ---------------------------------------------

let settled = 0;
let troubled = 0;
for (const j of doomed) {
  const report = await purgeRosterRow({ activePg, workerId: j.row.id });
  if (report.outcome === "settled") settled += 1;
  else troubled += 1;
}

console.log("\n── Tổng kết ─────────────────────────────────────────");
console.log(`  đã gỡ sạch : ${settled}/${doomed.length}`);
console.log(`  giữ nguyên : ${kept.length} dòng (lý do in ở bảng trên)`);
if (troubled > 0) {
  console.log(
    `\n  ⚠ ${troubled} dòng KHÔNG yên: hoặc database không trả lời, hoặc có thứ vẫn đang gõ cửa bằng\n` +
      "  id ấy. Trường hợp sau nghĩa là một tiến trình còn sống mang đúng tên đó — đi tắt nó,\n" +
      "  đừng chạy lại lệnh này.",
  );
  process.exit(1);
}
