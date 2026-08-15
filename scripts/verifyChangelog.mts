#!/usr/bin/env node
/**
 * Kiểm chứng BẢN TIN CẬP NHẬT (`src/lib/changelog.ts`) — thuần, không mạng, không database.
 *
 * VÌ SAO ĐÁNG KIỂM: một bản tin sai KHÔNG kêu. Trang vẫn dựng, hộp vẫn mở, chữ vẫn hiện —
 * chỉ có nội dung là nói dối, và người đọc thì không có cách nào biết. Ba kiểu nói dối, ba
 * cái giá khác nhau:
 *
 *   • Bump bản mà quên viết tin  → dấu bản khai v0.85.0, bản tin mới nhất là v0.84.0. Người
 *     dùng thấy trang vừa đổi mà bản tin im — tệ hơn hẳn việc không có bản tin nào.
 *   • Viết bằng ngôn ngữ của máy → "đã vá `reviewColumnDrift` ở `pgSync.ts`" thì đúng, và vô
 *     nghĩa với người đọc. Bản tin dành cho đạo hữu, không phải cho người sửa mã.
 *   • Trùng số bản / sai thứ tự  → hộp tin đọc từ trên xuống, nên thứ tự sai là lịch sử sai.
 *
 * Hai luật đầu là ý tông chủ, chép nguyên trong bản ghi nhớ `changelog-cho-nguoi-dung.md`.
 * Ở đây chúng thành phép đo — phần đo được của chúng.
 */
import pkg from "../package.json" with { type: "json" };
import { CHANGELOG_SEEN_KEY, LATEST_NOTE, RELEASE_NOTES, hasUnseenNote } from "../src/lib/changelog";

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✔ ${label}`);
}

/** `0.84.0` → `[0, 84, 0]`. Trả `null` khi chuỗi không phải ba số. */
function semver(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Âm khi `a` cũ hơn `b`. */
function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Chữ của MÁY, không được xuất hiện trong bản tin.
 *
 * Danh sách này cố ý NGẮN và cụ thể — nó bắt đúng loại rò rỉ hay gặp nhất: chép thẳng một
 * dòng `CHANGELOG.md` sang. Nó KHÔNG phải trọng tài văn phong; đọc lại bằng mắt vẫn là bước
 * cuối. Thêm từ vào đây thì thêm có chủ ý, đừng nới cho tiện.
 */
const MACHINE_WORDS = [
  "database", "postgres", "neon", "vercel", "sql", "migration", "schema", "commit", "deploy",
  "api", "endpoint", "worker", "cron", "snapshot", "json", "cookie", "token", "cache",
  "component", "function", "selector", "repository", "workflow", "runner",
];

/**
 * Giọng MÁY MÓC — mấy khuôn câu khiến người đọc nghĩ tin này do một cái máy viết ra.
 *
 * Cũng ngắn có chủ ý, và cũng chỉ là lưới thô: nó bắt khuôn sáo rõ rệt, không bắt được một
 * câu nhạt. Câu nhạt là việc của người viết.
 */
const ROBOT_PHRASES = [
  "chúng tôi rất vui mừng",
  "chúng tôi xin thông báo",
  "trải nghiệm người dùng",
  "tối ưu hoá hiệu suất",
  "nâng cao trải nghiệm",
  "cải thiện đáng kể",
];

// ---- Hình dạng danh sách -----------------------------------------------------------------
{
  ok(RELEASE_NOTES.length > 0, `bản tin có ${RELEASE_NOTES.length} mục`);
  ok(LATEST_NOTE !== null, "mục mới nhất đọc được, không phải undefined");

  const versions = RELEASE_NOTES.map((n) => n.version);
  ok(new Set(versions).size === versions.length, "không mục nào trùng số bản");

  for (const note of RELEASE_NOTES) {
    ok(semver(note.version) !== null, `số bản「${note.version}」đúng dạng x.y.z`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(note.date), `ngày của v${note.version} đúng dạng YYYY-MM-DD`);
    const parsed = new Date(`${note.date}T00:00:00Z`);
    ok(!Number.isNaN(parsed.getTime()), `ngày của v${note.version} là một ngày có thật`);
    // Ngày ở TƯƠNG LAI gần như luôn là gõ nhầm tháng. Cho dư một ngày vì máy người viết có
    // thể lệch múi giờ với máy chạy lưới kiểm.
    ok(
      parsed.getTime() <= Date.now() + 36 * 3600 * 1000,
      `ngày của v${note.version} không nằm ở tương lai`,
    );
  }

  // Thứ tự GIẢM DẦN, so bằng số chứ không bằng chuỗi: "0.9.0" > "0.10.0" theo chuỗi, mà sai.
  for (let i = 1; i < RELEASE_NOTES.length; i += 1) {
    const older = semver(RELEASE_NOTES[i].version)!;
    const newer = semver(RELEASE_NOTES[i - 1].version)!;
    ok(compare(newer, older) > 0, `v${RELEASE_NOTES[i - 1].version} đứng trên v${RELEASE_NOTES[i].version}`);
  }
}

// ---- Ràng buộc CHÍNH: bump bản là phải có tin ---------------------------------------------
//
// Đây là lý do cả tệp này tồn tại. Mọi luật khác chỉ dọn dẹp; luật này mới là thứ giữ lời hứa
// "mỗi lượt phát hành có một mục tin".
{
  ok(
    LATEST_NOTE!.version === pkg.version,
    `mục mới nhất (v${LATEST_NOTE!.version}) trùng package.json (v${pkg.version}) — bump bản thì phải viết tin`,
  );
}

// ---- Lối viết ------------------------------------------------------------------------------
{
  for (const note of RELEASE_NOTES) {
    ok(note.lines.length > 0, `v${note.version} có ít nhất một dòng`);
    ok(note.lines.length <= 5, `v${note.version} không quá 5 dòng — dài quá thì không ai đọc`);

    for (const line of note.lines) {
      const label = `v${note.version}: "${line.slice(0, 40)}…"`;
      ok(line === line.trim(), `${label} không thừa khoảng trắng hai đầu`);
      ok(line.length >= 15, `${label} đủ dài để thành một câu`);
      ok(line.length <= 160, `${label} đủ ngắn để đọc một hơi`);
      ok(!line.includes("`"), `${label} không có dấu nháy ngược — đó là dấu của mã, không phải của tin`);

      const lower = line.toLowerCase();
      const machine = MACHINE_WORDS.find((word) => new RegExp(`\\b${word}\\b`).test(lower));
      ok(machine === undefined, `${label} không gọi tên thành phần bên dưới${machine ? ` (thấy「${machine}」)` : ""}`);

      const robot = ROBOT_PHRASES.find((phrase) => lower.includes(phrase));
      ok(robot === undefined, `${label} không mang giọng máy móc${robot ? ` (thấy「${robot}」)` : ""}`);
    }
  }
}

// ---- Chấm báo tin --------------------------------------------------------------------------
//
// Ba trạng thái của `seen`, và cái thứ ba là cái hay bị bỏ quên: localStorage KHÔNG ĐỌC ĐƯỢC.
{
  const latest = LATEST_NOTE!.version;
  ok(hasUnseenNote(null, latest), "chưa từng mở bản tin → có chấm");
  ok(hasUnseenNote("0.0.1", latest), "đã đọc bản cũ hơn → có chấm");
  ok(!hasUnseenNote(latest, latest), "đã đọc đúng bản này → hết chấm");
  ok(!hasUnseenNote(undefined, latest), "không đọc nổi localStorage → KHÔNG chấm, đừng nhá mãi thứ tắt không được");
  ok(!hasUnseenNote(null, null), "chưa có tin nào thì không có gì để báo");
  // Bản LÙI cũng phải kêu: hạ bản là một lượt phát hành thật, và người dùng vẫn cần biết.
  ok(hasUnseenNote("9.9.9", latest), "đã đọc một bản mới hơn (lượt lùi bản) → vẫn có chấm");

  ok(CHANGELOG_SEEN_KEY.startsWith("jvz."), "khoá localStorage mang tiền tố riêng, không giẫm chân ai");
}

console.log(`\n✔ Bản tin cập nhật: ${passed} phép kiểm, tất cả đứng vững.`);
