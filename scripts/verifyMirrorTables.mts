#!/usr/bin/env node
/**
 * Kiểm chứng HÀNG RÀO BẢNG của lượt chuyển trạm (`reviewTableCoverage` trong
 * src/lib/mirror/pgSync.ts) — thuần, không database, không mạng.
 *
 * Tách khỏi `verify:mirror-sync` vì tệp ấy đòi `DATABASE_URL` thật, và ĐÓ CHÍNH LÀ lý do luật
 * này sai suốt một tuần mà không ai biết: phép kiểm duy nhất canh nó chỉ chạy được khi người ta
 * có một database trong tay, nên phần lớn thời gian nó không chạy.
 *
 * Chuyện đã xảy ra (đo 12/08/2026): `notices` và `notice_reads` ra đời 11/08, cố ý không nằm
 * trong `SYNC_TABLE_ORDER`, nhưng `assertTablesCovered` thì ném với mọi bảng lạ. Một database
 * đã migrate đủ có 13 bảng trong khi sổ chỉ khai 11 — tức lượt chuyển trạm kế tiếp chết ngay ở
 * `truncateAll`, dòng đầu tiên. Lần diễn tập gần nhất là 10/08, trước khi hai bảng ấy tồn tại.
 *
 * Nên ca đầu tiên dưới đây là ĐÚNG CẢNH ẤY, viết bằng đúng 13 cái tên đã đếm được trên database
 * thật — không phải một cảnh giả định.
 */
import { SYNC_TABLE_ORDER, UNSYNCED_TABLES, reviewTableCoverage } from "../src/lib/mirror/pgSync";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let passed = 0;
const ok = (condition: boolean, label: string) => {
  assert(condition, label);
  passed++;
  console.log(`✔ ${label}`);
};

/** 13 bảng đếm được trên một database đã áp đủ 26 migration, ngày 12/08/2026. */
const SCHEMA_THAT_12_08 = [
  "app_settings", "automation_jobs", "game_accounts", "job_events", "notice_reads",
  "notices", "permissions", "role_permissions", "roles", "user_configs", "user_roles",
  "users", "workers",
];

ok(
  reviewTableCoverage(SCHEMA_THAT_12_08) === null,
  "Schema THẬT ngày 12/08 (13 bảng) phải qua cửa — đây đúng là cảnh đã làm lượt chuyển trạm chết",
);

ok(
  reviewTableCoverage([...SYNC_TABLE_ORDER]) === null,
  "Đích chỉ có 11 bảng cần chép, chưa migrate tới notices: vẫn hợp lệ",
);

// Bảng lạ THẬT vẫn phải bị chặn — nới hàng rào không được biến nó thành cái cổng mở toang.
{
  const complaint = reviewTableCoverage([...SCHEMA_THAT_12_08, "bang_la_cua_ai_do"]);
  ok(complaint !== null, "Một bảng ngoài cả hai sổ vẫn phải bị chặn");
  ok(complaint!.includes("bang_la_cua_ai_do"), "Lời từ chối phải gọi đích danh bảng lạ");
  ok(
    !complaint!.includes("notices"),
    "Và KHÔNG được lôi notices/notice_reads vào — chúng đã khai là cố ý bỏ qua",
  );
}

// Thiếu một bảng cần chép = đích chưa migrate đủ. Phải chết TRƯỚC khi truncate bất cứ thứ gì.
{
  const complaint = reviewTableCoverage(SCHEMA_THAT_12_08.filter((t) => t !== "job_events"));
  ok(complaint !== null, "Đích thiếu một bảng cần chép phải bị chặn");
  ok(complaint!.includes("job_events"), "Lời từ chối phải gọi đích danh bảng còn thiếu");
}

// Hai lỗi cùng lúc thì nói cả hai — bắt người ta chạy lại để nghe nốt lỗi thứ hai là một
// vòng lặp mà mỗi vòng tốn một lượt kết nối tới trạm bên kia.
{
  const complaint = reviewTableCoverage([
    ...SCHEMA_THAT_12_08.filter((t) => t !== "workers"),
    "bang_la",
  ]);
  ok(complaint!.includes("workers") && complaint!.includes("bang_la"), "Thiếu và thừa cùng lúc thì nói cả hai");
}

// Đích TRỐNG TRƠN: chưa migrate lần nào. Phải liệt kê đủ 11 bảng còn thiếu.
{
  const complaint = reviewTableCoverage([]);
  ok(complaint !== null, "Đích chưa migrate lần nào phải bị chặn");
  ok(
    SYNC_TABLE_ORDER.every((t) => complaint!.includes(t)),
    "Đích trống thì phải kể đủ tên 11 bảng còn thiếu, đừng bắt người ta đoán",
  );
}

// Hai sổ KHÔNG được giao nhau: một cái tên nằm cả hai chỗ nghĩa là「vừa chép vừa không chép」.
ok(
  UNSYNCED_TABLES.every((t) => !(SYNC_TABLE_ORDER as readonly string[]).includes(t)),
  "UNSYNCED_TABLES và SYNC_TABLE_ORDER không được có tên chung",
);

console.log(`\n✔ Hàng rào bảng chuyển trạm: ${passed} khẳng định, tất cả đứng vững.`);
