#!/usr/bin/env node
/**
 * Kiểm chứng PHÉP CẮT CHỮ và PHÉP CHỌN CỘT của lượt cào Usage (`scripts/usageMeters.mts`).
 *
 * Thuần: không mạng, không database, không Chromium, không cookie.
 *
 * VÌ SAO ĐÁNG KIỂM: đây là chỗ DUY NHẤT quyết định con số nào được ghi vào sổ, và cái sai của nó
 * KHÔNG kêu. Một cột lấy nhầm dòng của thanh điều hướng vẫn là một con số trông y như thật; một
 * cột thiếu vì Vercel đổi glyph gạch nối thì lượt cào đỏ mỗi nửa giờ cho tới khi có người đọc log.
 * Cả hai đều không có tầng nào ở hạ nguồn bắt được: `/api/usage-report` chỉ soát hình dạng, còn
 * popup thì vẽ đúng những gì nó nhận.
 *
 * Trước 13/08/2026 phép cắt chữ sống trong `vercelUsageFull.mts`, tệp gọi `chromium.launch()`
 * ngay ở thân module — nhập vào để thử là mở một trình duyệt. Nên nó chưa từng được kiểm.
 */
import {
  nearMisses,
  normalizeTitle,
  parseUsageText,
  selectWanted,
  WANTED_TITLES,
} from "./usageMeters.mts";

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✔ ${label}`);
}

/**
 * Chữ đã render của trang Usage, dựng theo ĐÚNG ảnh chụp bảng thật (13/08/2026) — mười thẻ, đúng
 * thứ tự ấy, kèm ba thứ nhiễu có thật trên trang:
 *
 *   • THANH ĐIỀU HƯỚNG bên trái lặp lại tên meter (đây là thứ từng làm phép chờ「thấy chữ Fluid
 *     Active CPU」thoả mãn tức thì khi trang còn trống).
 *   • NẤC KẾ của gói trả tiền (`1 TB` sau `100 GB`) — dòng số thứ ba của một thẻ.
 *   • PHẦN ĐUÔI toàn số 0 (Queue, Sandbox, AI Gateway) render lúc có lúc không.
 */
const PAGE = `
Usage
Overview
Fluid Active CPU
Fluid Provisioned Memory
Edge Requests
Image Optimization - Cache Reads
Fluid Active CPU
2h 3m
/
4h
Fluid Provisioned Memory
95.9 GB-Hrs
/
360 GB-Hrs
Function Invocations
244K
/
1M
Edge Requests
123K
/
1M
Fast Origin Transfer
158.34 MB
/
10 GB
1 TB
Edge Request CPU Duration
45s
/
1h
Fast Data Transfer
624.17 MB
/
100 GB
1 TB
Image Optimization - Transformations
4
/
5K
Image Optimization - Cache Writes
5
/
100K
Image Optimization - Cache Reads
7
/
300K
Queue Messages
0
Sandbox Active CPU
0
AI Gateway Requests
0
`;

// ---- Cắt chữ --------------------------------------------------------------------------------
{
  const rows = parseUsageText(PAGE);
  const byTitle = (title: string) => rows.filter((r) => r.title === title);

  ok(rows.length > 0, `cắt được ${rows.length} meter từ trang mẫu`);

  const cpu = byTitle("Fluid Active CPU").find((m) => m.limit != null);
  ok(cpu?.used === "2h 3m" && cpu.limit === "4h", "đọc đúng cặp giờ-phút「2h 3m / 4h」");

  const fdt = byTitle("Fast Data Transfer")[0];
  ok(fdt?.used === "624.17 MB" && fdt.limit === "100 GB", "đọc đúng dạng byte có dấu chấm thập phân");
  ok(fdt?.limit !== "1 TB", "NẤC KẾ của gói trả tiền không bị nhận nhầm thành hạn mức");

  const transforms = byTitle("Image Optimization - Transformations")[0];
  ok(transforms?.used === "4" && transforms.limit === "5K", "số trần trụi「4 / 5K」vẫn ra đúng hai vế");

  ok(
    byTitle("Queue Messages")[0]?.used === "0" && byTitle("Queue Messages")[0]?.limit === null,
    "meter không có hạn thì `limit` là null, không phải chuỗi rỗng",
  );

  // Thanh điều hướng: bốn cái tên đứng liền nhau, không cái nào có số ngay sau — kể cả cái cuối,
  // vì ngay sau nó là TÊN của thẻ đầu tiên. `flush` bỏ sạch cả bốn. Ca dòng-ma (tên dính một con
  // số không phải của nó) không dựng được từ trang mẫu này nên nó được thử thẳng ở nhóm dưới.
  ok(
    byTitle("Fluid Provisioned Memory").length + byTitle("Edge Requests").length === 2,
    "tên lặp trong thanh điều hướng không đẻ thêm dòng (không số thì bị bỏ)",
  );
}

// ---- Chọn cột -------------------------------------------------------------------------------
{
  const { picked, missing } = selectWanted(parseUsageText(PAGE));

  ok(missing.length === 0, "trang đủ tám cột thì không thiếu gì");
  ok(picked.length === WANTED_TITLES.length, `chọn đúng ${WANTED_TITLES.length} cột, không hơn`);
  ok(
    picked.map((m) => m.title).join("|") === WANTED_TITLES.join("|"),
    "thứ tự đầu ra theo WANTED_TITLES, không theo thứ tự trang render",
  );
  ok(
    !picked.some((m) => ["Queue Messages", "Sandbox Active CPU", "AI Gateway Requests"].includes(m.title)),
    "phần đuôi toàn số 0 không lọt vào bảng đẩy đi",
  );
  ok(
    picked.find((m) => m.title === "Fluid Active CPU")?.used === "2h 3m",
    "cột đầu mang đúng số của THẺ, không phải của thanh điều hướng",
  );
  ok(
    picked.every((m) => m.limit != null),
    "cả tám cột đều có hạn mức — nhưng CÓ HẠN không còn là luật chọn, xem WANTED_TITLES",
  );

  // HAI CỘT TRUYỀN TẢI bỏ theo yêu cầu tông chủ. Trang mẫu VẪN render chúng và `parseUsageText`
  // vẫn cắt ra được (nhóm trên đọc đúng「624.17 MB / 100 GB」của `Fast Data Transfer`), nên đây là
  // chỗ đúng để đóng đinh: đọc được mà KHÔNG đẩy đi.
  ok(
    !picked.some((m) => ["Fast Origin Transfer", "Fast Data Transfer"].includes(m.title)),
    "hai cột truyền tải đã bỏ thì không lọt vào bảng đẩy đi, dù trang vẫn render chúng",
  );
  ok(
    !["Fast Origin Transfer", "Fast Data Transfer"].some((t) => missing.includes(t)),
    "…và cũng KHÔNG bị kể là thiếu — bỏ hẳn chứ không bỏ nửa vời, kẻo lượt cào đỏ vĩnh viễn",
  );
  ok(
    !["Fast Origin Transfer", "Fast Data Transfer"].some((t) => (WANTED_TITLES as readonly string[]).includes(t)),
    "…và không ai lặng lẽ thêm chúng lại vì thấy chúng có hạn mức",
  );

  /**
   * ĐỘT BIẾN 1 — thanh điều hướng đứng NGAY TRƯỚC một con số lạc.
   *
   * Dựng lại đúng cảnh `pickBest` sinh ra để chống: cùng một tên xuất hiện hai lần, lần đầu dính
   * một con số không phải của nó (không có hạn), lần sau mới là thẻ thật. Lấy bừa dòng đầu là ghi
   * vào sổ「Fluid Active CPU = 3」và không ai nhận ra.
   */
  const withGhost = selectWanted([
    { title: "Fluid Active CPU", used: "3", limit: null },
    { title: "Fluid Active CPU", used: "2h 3m", limit: "4h" },
  ]);
  ok(
    withGhost.picked[0]?.used === "2h 3m",
    "hai dòng trùng tên thì lấy dòng CÓ HẠN MỨC, không lấy dòng đầu",
  );

  // Và chiều ngược lại: thẻ thật đứng trước, dòng ma đứng sau — kết quả phải y hệt.
  const ghostAfter = selectWanted([
    { title: "Fluid Active CPU", used: "2h 3m", limit: "4h" },
    { title: "Fluid Active CPU", used: "3", limit: null },
  ]);
  ok(ghostAfter.picked[0]?.used === "2h 3m", "…và dòng ma đứng SAU cũng không cướp được chỗ");
}

// ---- Gạch nối và khoảng trắng ----------------------------------------------------------------
//
// Vercel đổi glyph lúc nào cũng được. Cột thiếu vì lệch một ký tự nghĩa là mất số liệu vì một
// chuyện thuần trình bày — mà lượt cào thì chạy nửa giờ một lần, tức đỏ 48 lần một ngày.
{
  const variants = [
    ["Image Optimization – Transformations", "en dash"],
    ["Image Optimization — Transformations", "em dash"],
    ["Image Optimization − Transformations", "dấu trừ toán học"],
    ["Image  Optimization  -  Transformations", "khoảng trắng đôi"],
    ["image optimization - transformations", "chữ thường"],
    ["  Image Optimization - Transformations  ", "thừa khoảng trắng hai đầu"],
  ] as const;

  for (const [rendered, what] of variants) {
    const { picked, missing } = selectWanted([{ title: rendered, used: "4", limit: "5K" }]);
    ok(
      !missing.includes("Image Optimization - Transformations"),
      `khớp được「${what}」`,
    );
    ok(
      picked[0]?.title === "Image Optimization - Transformations",
      `…và ghi vào sổ bằng TÊN CHUẨN, không bằng chữ vừa đọc (${what})`,
    );
  }

  // NBSP dựng bằng MÃ, không dán ký tự thật: một khoảng trắng vô hình khác loại nằm giữa dòng mã
  // là thứ người sửa sau sẽ "dọn" mất mà không biết mình vừa gỡ một phép kiểm.
  const NBSP = String.fromCharCode(0xa0);
  ok(
    normalizeTitle(`Fluid${NBSP}Provisioned${NBSP}Memory`) === "fluid provisioned memory",
    "nbsp cũng được coi là khoảng trắng — HTML render ra nó nhiều hơn người ta tưởng",
  );
  ok(
    selectWanted([{ title: `Fluid${NBSP}Provisioned Memory`, used: "95.9 GB-Hrs", limit: "360 GB-Hrs" }]).picked[0]
      ?.title === "Fluid Provisioned Memory",
    "…và một cột mang nbsp vẫn khớp, vẫn được ghi bằng tên chuẩn",
  );

  // ĐỘT BIẾN 2: chuẩn hoá KHÔNG được nuốt mọi khác biệt. Một cái tên khác thật thì phải trượt.
  ok(
    selectWanted([{ title: "Image Optimization - Cache Read", used: "7", limit: "300K" }]).missing.includes(
      "Image Optimization - Cache Reads",
    ),
    "thiếu đúng một chữ cái thì KHÔNG khớp — chuẩn hoá không được nới thành đoán mò",
  );
}

// ---- Thiếu cột thì phải khai ra tên thật ------------------------------------------------------
{
  const rows = parseUsageText(PAGE).filter((m) => !m.title.startsWith("Image Optimization"));
  const renamed = [...rows, { title: "Image Optimization Requests", used: "9", limit: "5K" }];
  const { missing } = selectWanted(renamed);

  ok(missing.length === 3, "ba cột Image Optimization biến mất thì báo thiếu đúng ba");

  const near = nearMisses(renamed, missing);
  ok(
    near.includes("Image Optimization Requests"),
    "lượt đỏ khai ra tên MỚI đã thấy trên trang, để lượt sửa chỉ còn là chép một dòng",
  );
  ok(
    !near.includes("Fast Data Transfer"),
    "…và không lôi vào những cột chẳng liên quan",
  );
  ok(
    nearMisses(parseUsageText(PAGE), []).length === 0,
    "không thiếu gì thì không có tên nào để mà gợi ý",
  );

  /**
   * CA THẬT, đo trên trạm `auto-hh3d-3` lúc 18:08 ngày 13/08/2026: thiếu `Fast Origin Transfer` và
   * `Fast Data Transfer` giữa 51 meter đọc được, mà bản gợi ý ĐẦU TIÊN — chỉ so từ ĐẦU — in ra
   *「không thấy tên nào gần giống」. Một cái tên rút gọn kiểu `Data Transfer` không chia từ đầu với
   * nó, nên phép gợi ý câm ở đúng lần đầu được gọi thật.
   *
   * Hai cột ấy nay đã BỎ khỏi `WANTED_TITLES`, nên từ đây xuống chúng chỉ còn là DỮ LIỆU MẪU: cả
   * ba phép kiểm dưới đều truyền thẳng danh sách「đang thiếu」vào `nearMisses`, không đi qua danh
   * sách cột thật, nên chúng đo đúng thuật toán xếp hạng chứ không đo cấu hình. Giữ nguyên tên cũ
   * vì đây là ca ĐÃ XẢY RA — đổi sang một cái tên bịa là vứt mất bằng chứng.
   */
  const shortened = nearMisses(
    [
      { title: "Data Transfer", used: "1.2 GB", limit: "100 GB" },
      { title: "Origin Transfer", used: "58 MB", limit: "10 GB" },
      { title: "Blob Stored Data", used: "0 B", limit: "1 GB" },
    ],
    ["Fast Data Transfer", "Fast Origin Transfer"],
  );
  ok(shortened[0] === "Data Transfer" || shortened[0] === "Origin Transfer", "tên RÚT GỌN vẫn bị nêu tên");
  ok(
    shortened.indexOf("Blob Stored Data") === 2,
    "…và `Blob Stored Data` (chỉ chung mỗi chữ `data`) bị xếp SAU, không bị giấu đi",
  );

  // Nhiều từ chung hơn thì đứng trước — người đọc chỉ liếc dòng đầu.
  const ranked = nearMisses(
    [
      { title: "Transfer Something Else", used: "1", limit: null },
      { title: "Fast Data Transfer Total", used: "1", limit: null },
    ],
    ["Fast Data Transfer"],
  );
  ok(ranked[0] === "Fast Data Transfer Total", "tên chia NHIỀU từ nhất đứng đầu danh sách gợi ý");

  // Trần 8: một danh sách 30 dòng thì không còn là gợi ý.
  const flood = nearMisses(
    Array.from({ length: 30 }, (_, i) => ({ title: `Transfer loai ${i}`, used: "1", limit: null })),
    ["Fast Data Transfer"],
  );
  ok(flood.length === 8, "danh sách gợi ý bị chặn ở 8 dòng, không đổ cả trang ra log");
}

// ---- Trang trống / rác -----------------------------------------------------------------------
{
  ok(parseUsageText("").length === 0, "chữ rỗng trả bảng rỗng, không ném");
  ok(selectWanted([]).missing.length === WANTED_TITLES.length, "bảng rỗng thì thiếu trọn tám cột");
  ok(
    parseUsageText("123\n456\n/\n789\n").length === 0,
    "toàn số không có tên thì không đẻ ra meter nào",
  );
  ok(
    parseUsageText("Fluid Active CPU\n").length === 0,
    "có tên mà chưa có số (thẻ đang render dở) thì CHƯA tính là một meter",
  );
}

console.log(`\n✔ ${passed} phép kiểm — phép cắt chữ và phép chọn cột Usage còn nguyên.`);
