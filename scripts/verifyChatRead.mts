#!/usr/bin/env node
/**
 * Kiểm chứng LUẬT MỐC ĐÃ-ĐỌC của Phòng Chat (`src/lib/validation/chatRead.ts`) —
 * `npm run verify:chat-read`. Thuần, không Mongo, không trình duyệt, dưới một giây.
 *
 * Thứ đáng kiểm nhất ở đây là SỰ ĐỒNG THANH: `firstUnreadIndex` (chỗ đặt vạch trong sảnh) và
 * `countUnread` phía server (con số trên icon nổi) phải cùng một định nghĩa「chưa đọc」— không
 * tính tin của chính mình, không tính tin đã thu hồi, so bằng `>` chứ không `>=`. Hai phía mà
 * lệch một vế là huy hiệu nói「3 tin」rồi mở sảnh ra lại thấy vạch nằm chỗ khác. Phía server
 * nằm trong Mongo nên đo ở `verify:chat` (chạy trên VM); phía client đo tại đây, và bình chú
 * hai bên trỏ vào nhau.
 */
import { clampReadAt, fabBadge, firstUnreadIndex, parseMarkMs } from "../src/lib/validation/chatRead";

class Failed extends Error {}

let passed = 0;
function ok(condition: boolean, label: string, got?: unknown): void {
  if (!condition) throw new Failed(label + (got === undefined ? "" : `  → nhận ${JSON.stringify(got)}`));
  passed += 1;
  console.log(`  ✔ ${label}`);
}

const ME = "toi";
const HO = "nguoi-khac";
const at = (ms: number) => new Date(ms).toISOString();
const msg = (ms: number, userId = HO, deleted = false) => ({ createdAt: at(ms), userId, deleted });

function main(): void {
  console.log("── parseMarkMs: mốc từ API về ms ─────────────────────────────");
  ok(parseMarkMs(null) === null, "null → chưa có mốc");
  ok(parseMarkMs(undefined) === null, "vắng trường → chưa có mốc");
  ok(parseMarkMs("") === null, "chuỗi rỗng → chưa có mốc");
  ok(parseMarkMs("khong-phai-ngay") === null, "chuỗi hỏng → chưa có mốc, KHÔNG ném");
  ok(parseMarkMs(at(5000)) === 5000, "ISO tròn trịa → đúng ms");

  console.log("\n── firstUnreadIndex: chỗ đặt vạch ────────────────────────────");
  ok(firstUnreadIndex([], 1000, ME) === -1, "trang rỗng → không vạch");
  ok(firstUnreadIndex([msg(500), msg(900)], 1000, ME) === -1, "đọc hết rồi → không vạch");
  ok(firstUnreadIndex([msg(500), msg(1500)], 1000, ME) === 1, "một tin sau mốc → vạch đúng chỗ");
  ok(firstUnreadIndex([msg(1500), msg(1600)], 1000, ME) === 0, "cả trang chưa đọc → vạch ở đầu (tín hiệu lật thêm trang)");
  ok(
    firstUnreadIndex([msg(1500, ME), msg(1600)], 1000, ME) === 1,
    "tin của CHÍNH MÌNH sau mốc không tính — gửi là đã đọc, cùng luật với countUnread",
  );
  ok(
    firstUnreadIndex([msg(1500, HO, true), msg(1600)], 1000, ME) === 1,
    "tin đã thu hồi không tính — một tấm bia không đáng một cái vạch",
  );
  ok(
    firstUnreadIndex([msg(1000)], 1000, ME) === -1,
    "tin TRÙNG mốc là tin đã đọc — mốc chính là tin mới nhất đã thấy, so bằng > chứ không >=",
  );
  ok(
    firstUnreadIndex([msg(1500, ME), msg(1600, ME, true)], 1000, ME) === -1,
    "toàn tin mình + tin thu hồi → không vạch, khớp countUnread = 0",
  );

  console.log("\n── fabBadge: nhãn trên huy hiệu ──────────────────────────────");
  ok(fabBadge(0) === null, "0 tin → không đeo huy hiệu");
  ok(fabBadge(-3) === null, "số âm (server hỏng) → không đeo, không vẽ「-3」");
  ok(fabBadge(Number.NaN) === null, "NaN → không đeo");
  ok(fabBadge(1) === "1", "1 tin → 「1」");
  ok(fabBadge(99) === "99", "99 → 「99」");
  ok(fabBadge(100) === "99+", "100 → 「99+」— bốn chữ số trên vòng tròn 3rem chỉ là vệt mực");

  console.log("\n── clampReadAt: biên tin cậy của op read ─────────────────────");
  const NOW = 1_000_000;
  ok(clampReadAt(at(500_000), NOW) === 500_000, "mốc quá khứ hợp lệ → giữ nguyên");
  ok(clampReadAt(at(2_000_000), NOW) === NOW, "mốc TƯƠNG LAI → kẹp về hiện tại, không đánh dấu trước được tin chưa tồn tại");
  ok(clampReadAt("rac", NOW) === null, "chuỗi hỏng → bỏ qua");
  ok(clampReadAt(12345, NOW) === null, "số trần (không phải ISO) → bỏ qua — client chỉ được vọng lại createdAt");
  ok(clampReadAt(null, NOW) === null, "null → bỏ qua");
  ok(clampReadAt(at(0), NOW) === null, "epoch 0 → bỏ qua, một mốc vô nghĩa không đáng một lượt ghi");
}

try {
  main();
  console.log(`\n✔ ${passed} phép kiểm — luật mốc đã-đọc của sảnh và icon nổi cùng một giọng.`);
} catch (err) {
  console.error(err instanceof Failed ? `\n✗ ${err.message}` : `\n✖ ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
}
