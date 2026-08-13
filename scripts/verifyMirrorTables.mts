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
import { SYNC_TABLE_ORDER, UNSYNCED_TABLES, reviewColumnDrift, reviewTableCoverage } from "../src/lib/mirror/pgSync";

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

// ---- HÀNG RÀO CỘT (reviewColumnDrift) --------------------------------------------------------
//
// Ra đời 14/08/2026 từ một lượt chuyển đã chết thật: nguồn `auto-hh3d-2` đã áp migration 0027
// (bảng `workers` 7 cột), cả bốn trạm gương còn 27 migration (5 cột). Lượt chép báo XANH — vì
// `json_populate_recordset` bỏ qua khoá JSON không có cột tương ứng — rồi `verifyTable` mới
// tuyên bố「LỆCH NỘI DUNG」, sau khi đã truncate đích và chép xong 11 bảng.
//
// Nên mọi ca dưới đây đo đúng một câu hỏi: hàng rào có GỌI TÊN được thủ phạm không.

/** Cột `workers` đo được trên trạm NGUỒN ngày 14/08/2026 (28 migration). */
const WORKERS_SRC = {
  id: "text",
  user_id: "uuid",
  first_seen: "timestamp with time zone",
  last_seen: "timestamp with time zone",
  version: "text",
  last_assigned_at: "timestamp with time zone",
  max_jobs: "integer",
};
/** Và trên cả BỐN trạm gương cùng lúc ấy (27 migration) — thiếu đúng hai cột của 0027. */
const WORKERS_DEST_CU = {
  id: "text",
  user_id: "uuid",
  first_seen: "timestamp with time zone",
  last_seen: "timestamp with time zone",
  version: "text",
};

const schemaOf = (workers: Record<string, string>) =>
  Object.fromEntries(
    SYNC_TABLE_ORDER.map((t) => [t, t === "workers" ? workers : { id: "text" }]),
  ) as Record<string, Record<string, string>>;

{
  ok(
    reviewColumnDrift(schemaOf(WORKERS_SRC), schemaOf(WORKERS_SRC)) === null,
    "Hai bên cùng schema thì im lặng cho qua",
  );

  const real = reviewColumnDrift(schemaOf(WORKERS_SRC), schemaOf(WORKERS_DEST_CU));
  ok(real !== null, "CẢNH THẬT 14/08: đích thiếu hai cột của migration 0027 phải bị chặn");
  ok(
    real!.includes("last_assigned_at") && real!.includes("max_jobs"),
    "…và phải GỌI TÊN đúng hai cột ấy, không chỉ nói『lệch schema』",
  );
  ok(real!.includes("workers"), "…kèm tên bảng, vì 11 bảng thì phải biết soi bảng nào");
  ok(real!.toLowerCase().includes("migration"), "…và nói ra việc phải làm: chạy migration lên đích");

  // Chiều NGƯỢC LẠI cũng phải chặn: đích migrate trước nguồn. Ca này có thật mỗi khi người ta
  // migrate trạm gương trước rồi mới tới trạm đang phục vụ — và nó cũng đẻ ra LỆCH NỘI DUNG.
  const nguoc = reviewColumnDrift(schemaOf(WORKERS_DEST_CU), schemaOf(WORKERS_SRC));
  ok(nguoc !== null && nguoc.includes("đích có thêm"), "Đích migrate TRƯỚC nguồn cũng bị chặn, và nói đúng chiều");

  // Lệch KIỂU: cùng tên, khác kiểu. `to_jsonb` in `2` cho integer và `"2"` cho text, nên đối
  // chiếu vẫn đỏ — mà không cột nào thiếu để mà nhìn ra.
  const kieu = reviewColumnDrift(
    schemaOf(WORKERS_SRC),
    schemaOf({ ...WORKERS_SRC, max_jobs: "text" }),
  );
  ok(
    kieu !== null && kieu.includes("lệch kiểu") && kieu.includes("max_jobs"),
    "Cùng tên khác KIỂU cũng là lệch, và phải nói rõ hai kiểu",
  );

  // THỨ TỰ cột không phải lệch — `to_jsonb` sinh jsonb, mà jsonb tự chuẩn hoá thứ tự khoá. Chặn
  // theo thứ tự là chặn oan một lượt chuyển hoàn toàn lành.
  const daoThuTu = Object.fromEntries(Object.entries(WORKERS_SRC).reverse());
  ok(
    reviewColumnDrift(schemaOf(WORKERS_SRC), schemaOf(daoThuTu)) === null,
    "Đảo THỨ TỰ cột thì KHÔNG phải lệch — jsonb tự chuẩn hoá khoá",
  );

  // Bảng vắng hẳn ở đích: `reviewTableCoverage` mới là hàng rào của ca này, nhưng hàm này cũng
  // không được NÉM — hai hàng rào chạy nối nhau, cái sau vỡ thì cái trước hết đường nói.
  const thieuBang = { ...schemaOf(WORKERS_SRC) };
  delete thieuBang.workers;
  const vangBang = reviewColumnDrift(schemaOf(WORKERS_SRC), thieuBang);
  ok(vangBang !== null && vangBang.includes("workers"), "Bảng vắng hẳn ở đích thì kể là thiếu TRỌN cột, không ném");

  // Bảng ngoài sổ chép (notices) lệch bao nhiêu cũng KHÔNG phải việc của hàng rào này.
  const ngoaiSo = reviewColumnDrift(
    { ...schemaOf(WORKERS_SRC), notices: { id: "text", body: "text" } },
    { ...schemaOf(WORKERS_SRC), notices: { id: "text" } },
  );
  ok(ngoaiSo === null, "Bảng KHÔNG chép (notices) lệch cột thì bỏ qua — nó đâu có được chép");
}

console.log(`\n✔ Hàng rào bảng chuyển trạm: ${passed} khẳng định, tất cả đứng vững.`);
