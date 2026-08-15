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
import {
  CHANGELOG_SEEN_KEY,
  DEFAULT_RELEASE_NOTES,
  MAX_NOTES,
  compareVersion,
  formatNotesText,
  hasUnseenNote,
  hiddenVersionsFor,
  mergeReleaseNotes,
  parseNotesText,
  reviewNotes,
  type ReleaseNote,
} from "../src/lib/changelog";

const LATEST_NOTE = DEFAULT_RELEASE_NOTES[0] ?? null;
const RELEASE_NOTES = DEFAULT_RELEASE_NOTES;

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

// ---- Luật hình dạng, dùng chung cho CẢ tệp mã lẫn bài Gia chủ gõ -------------------------
//
// `reviewNotes` là cửa duy nhất phán「danh sách này có dùng được không」, nên mỗi ngả từ chối
// của nó phải có một ca. Một ngả không ai thử là một ngả sẽ mở toang vào ngày người ta sửa nó.
{
  const good: ReleaseNote[] = [{ version: "1.2.3", date: "2026-08-14", lines: ["Một dòng đủ dài để thành câu."] }];
  ok(reviewNotes(good) === null, "danh sách hợp lệ thì im lặng cho qua");

  const bad = (notes: ReleaseNote[], what: string) => {
    const message = reviewNotes(notes);
    ok(message !== null, `chặn: ${what}`);
    return message ?? "";
  };

  bad([{ ...good[0], version: "1.2" }], "số bản thiếu một nấc");
  bad([{ ...good[0], version: "v1.2.3" }], "số bản mang chữ v");
  ok(
    bad([good[0], { ...good[0], date: "2026-08-13" }], "hai mục trùng số bản").includes("hai lần"),
    "…và nói rõ là trùng, không chỉ「không hợp lệ」",
  );
  bad([{ ...good[0], date: "14/08/2026" }], "ngày viết kiểu Việt Nam");
  bad([{ ...good[0], date: "2026-13-45" }], "ngày không có thật");
  bad([{ ...good[0], date: "2099-01-01" }], "ngày ở tương lai");
  bad([{ ...good[0], lines: [] }], "mục không có dòng nào");
  bad([{ ...good[0], lines: Array(6).fill("Một dòng đủ dài để thành câu.") }], "quá 5 dòng");
  bad([{ ...good[0], lines: ["ngắn quá"] }], "dòng ngắn hơn 15 ký tự");
  bad([{ ...good[0], lines: ["x".repeat(161)] }], "dòng dài quá 160 ký tự");
  bad([{ ...good[0], lines: ["  thừa khoảng trắng hai đầu  "] }], "dòng thừa khoảng trắng");

  const flood = Array.from({ length: MAX_NOTES + 1 }, (_, i) => ({
    version: `1.0.${i}`,
    date: "2026-08-14",
    lines: ["Một dòng đủ dài để thành câu."],
  }));
  ok(reviewNotes(flood) !== null, `chặn: quá ${MAX_NOTES} mục`);

  // Ngày HÔM NAY phải qua được — hàng rào "tương lai" mà chặt tay một chút là chặn đúng người
  // đang viết tin cho lượt phát hành hôm nay.
  const today = new Date().toISOString().slice(0, 10);
  ok(reviewNotes([{ ...good[0], date: today }]) === null, "ngày hôm nay KHÔNG bị coi là tương lai");
}

// ---- Đọc chữ trong ô nhập của Gia chủ ------------------------------------------------------
//
// Đây là thứ đứng giữa bàn phím và trang của người lạ. Sai ở đây không kêu: nó chỉ hiện ra
// dưới dạng một bản tin trông là lạ.
{
  const text = ["0.9.0 · 2026-08-10", "- Dòng thứ nhất, đủ dài.", "- Dòng thứ hai, cũng đủ dài."].join("\n");
  const parsed = parseNotesText(text);
  ok(parsed.ok, "đọc được một mục hai dòng");
  if (parsed.ok) {
    ok(parsed.notes.length === 1 && parsed.notes[0].lines.length === 2, "đúng 1 mục, 2 dòng");
    ok(parsed.notes[0].version === "0.9.0" && parsed.notes[0].date === "2026-08-10", "số bản và ngày về đúng chỗ");
  }

  // KHỨ HỒI: chữ → danh sách → chữ phải ra đúng bản đầu. Đây là phép kiểm rẻ nhất bắt được cả
  // hai chiều cùng lúc, và nó cũng là thứ giữ cho ô nhập của Gia chủ không tự đổi bài họ viết.
  const roundTrip = parseNotesText(formatNotesText(DEFAULT_RELEASE_NOTES));
  ok(roundTrip.ok, "định dạng rồi đọc lại thì vẫn đọc được");
  if (roundTrip.ok) {
    ok(
      JSON.stringify(roundTrip.notes) === JSON.stringify(DEFAULT_RELEASE_NOTES),
      "khứ hồi KHÔNG làm đổi một ký tự nào",
    );
  }

  ok(parseNotesText("").ok, "ô rỗng là hợp lệ — nghĩa là「thôi đè, trả về danh sách gốc」");
  const empty = parseNotesText("   \n\n  ");
  ok(empty.ok && empty.notes.length === 0, "ô toàn khoảng trắng cũng vậy, không phải lỗi");

  // Ba dấu phân cách, vì cái dấu giữa là thứ đầu tiên người ta gõ khác đi.
  for (const sep of ["·", "-", "|"]) {
    const one = parseNotesText(`0.9.0 ${sep} 2026-08-10\n- Một dòng đủ dài để thành câu.`);
    ok(one.ok, `nhận dấu phân cách「${sep}」`);
  }

  // NGÀY CÓ DẤU GẠCH BÊN TRONG — ca đã suýt lọt: một mẫu chung cho cả ba dấu sẽ cắt
  // "0.9.0·2026-08-10" thành số bản "0.9.0·2026-08" và ngày "10".
  const tight = parseNotesText("0.9.0·2026-08-10\n- Một dòng đủ dài để thành câu.");
  ok(tight.ok, "dấu · không khoảng trắng vẫn đọc được");
  if (tight.ok) {
    ok(tight.notes[0].version === "0.9.0" && tight.notes[0].date === "2026-08-10", "…và KHÔNG cắt nhầm giữa cái ngày");
  }
  const spacedDash = parseNotesText("0.9.0 - 2026-08-10\n- Một dòng đủ dài để thành câu.");
  ok(spacedDash.ok, "dấu - CÓ khoảng trắng hai bên vẫn là dấu phân cách");
  if (spacedDash.ok) ok(spacedDash.notes[0].date === "2026-08-10", "…và ngày về nguyên vẹn");
  // Lỗi phải mang SỐ DÒNG: một ô bốn mươi dòng báo「sai cú pháp」trơn là bắt người ta dò bằng mắt.
  const noHead = parseNotesText("- Dòng tin đứng một mình, không có đầu mục.");
  ok(!noHead.ok && noHead.message.includes("Dòng 1"), "dòng tin không có đầu mục → báo kèm số dòng");
  const junk = parseNotesText("0.9.0 · 2026-08-10\n- Một dòng đủ dài để thành câu.\nrác không đọc được");
  ok(!junk.ok && junk.message.includes("Dòng 3"), "dòng rác → chỉ đúng dòng thứ 3");
  const emptyLine = parseNotesText("0.9.0 · 2026-08-10\n-   ");
  ok(!emptyLine.ok && emptyLine.message.includes("Dòng 2"), "gạch đầu dòng rỗng → chỉ đúng dòng");
  const headless = parseNotesText("0.9.0 · 2026-08-10\n\n0.8.0 · 2026-08-09\n- Một dòng đủ dài để thành câu.");
  ok(!headless.ok && headless.message.includes("0.9.0"), "mục không có dòng nào → gọi tên đúng mục ấy");

  // XẾP HỘ: thứ tự là luật của phép hiển thị, không phải bài tập của người gõ.
  const unsorted = parseNotesText(
    ["0.8.0 · 2026-08-09", "- Một dòng đủ dài để thành câu.", "0.10.0 · 2026-08-11", "- Một dòng khác đủ dài."].join("\n"),
  );
  ok(unsorted.ok, "gõ lộn thứ tự vẫn đọc được");
  if (unsorted.ok) {
    ok(unsorted.notes[0].version === "0.10.0", "…và được xếp lại: 0.10.0 đứng trên 0.8.0, không so bằng chuỗi");
  }
}

// ---- Gộp hai nguồn -------------------------------------------------------------------------
//
// Luật một câu: cùng số bản thì SỔ thắng, số bản chỉ có trong tệp mã thì lấy nguyên. Cái nó
// chống là một lượt sửa tay hôm nay chôn sống mọi mục của những lượt phát hành sau.
{
  const defaults: ReleaseNote[] = [
    { version: "0.9.0", date: "2026-08-10", lines: ["Bản gốc của mục 0.9.0 này."] },
    { version: "0.8.0", date: "2026-08-09", lines: ["Bản gốc của mục 0.8.0 này."] },
  ];
  const overrides: ReleaseNote[] = [
    { version: "0.8.0", date: "2026-08-09", lines: ["Lời đã được Gia chủ sửa lại."] },
    { version: "0.7.0", date: "2026-08-08", lines: ["Mục chỉ có trong sổ, không có trong mã."] },
  ];

  const merged = mergeReleaseNotes(defaults, overrides);
  ok(merged.length === 3, "gộp ra đủ ba mục: hai của mã, một của sổ");
  ok(merged[0].version === "0.9.0", "xếp giảm dần theo số bản");
  ok(
    merged.find((n) => n.version === "0.8.0")!.lines[0] === "Lời đã được Gia chủ sửa lại.",
    "cùng số bản thì SỔ thắng",
  );
  ok(
    merged.find((n) => n.version === "0.9.0")!.lines[0] === "Bản gốc của mục 0.9.0 này.",
    "số bản chỉ có trong mã thì giữ nguyên — mục của lượt phát hành sau KHÔNG bị chôn",
  );
  ok(merged.find((n) => n.version === "0.7.0") !== undefined, "mục chỉ có trong sổ vẫn hiện");

  ok(
    JSON.stringify(mergeReleaseNotes(defaults, [])) === JSON.stringify(defaults),
    "sổ rỗng → đúng bằng danh sách trong mã",
  );
  ok(compareVersion("0.10.0", "0.9.0") > 0, "so số bản bằng SỐ: 0.10.0 mới hơn 0.9.0");
}

// ---- BIA MỘ: xoá là xoá thật, mà mục của bản sau vẫn tự hiện ------------------------------
//
// Hai điều này kéo ngược nhau, và bia mộ là chỗ chúng cùng đúng. Luật: mục nào của TỆP MÃ mà
// bài vừa gõ không nhắc tới thì bị chôn; số bản ra đời SAU lượt lưu ấy không nằm trong phép
// tính nên nó vẫn mọc lên bình thường.
{
  const defaults: ReleaseNote[] = [
    { version: "0.9.0", date: "2026-08-10", lines: ["Mục 0.9.0 của bản phát hành."] },
    { version: "0.8.0", date: "2026-08-09", lines: ["Mục 0.8.0 của bản phát hành."] },
  ];

  // Gia chủ gõ lại, BỎ mục 0.8.0 đi.
  const kept: ReleaseNote[] = [defaults[0]];
  const hidden = hiddenVersionsFor(defaults, kept);
  ok(hidden.length === 1 && hidden[0] === "0.8.0", "mục bị gỡ khỏi ô được ghi bia mộ đúng số bản");
  ok(!hidden.includes("0.9.0"), "…mục còn giữ thì KHÔNG bị chôn");

  const shown = mergeReleaseNotes(defaults, kept, hidden);
  ok(shown.length === 1 && shown[0].version === "0.9.0", "xoá là XOÁ THẬT — mục đã gỡ không mọc lại");

  // Lượt phát hành SAU thêm 0.10.0 vào tệp mã. Bia mộ cũ không được phép chôn nó.
  const laterDefaults: ReleaseNote[] = [
    { version: "0.10.0", date: "2026-08-12", lines: ["Mục mới của lượt phát hành sau."] },
    ...defaults,
  ];
  const afterRelease = mergeReleaseNotes(laterDefaults, kept, hidden);
  ok(
    afterRelease.some((n) => n.version === "0.10.0"),
    "…nhưng mục của lượt phát hành SAU vẫn tự hiện, dù sổ đã có người sửa",
  );
  ok(
    !afterRelease.some((n) => n.version === "0.8.0"),
    "…và mục đã gỡ vẫn nằm im, không sống lại theo lượt phát hành mới",
  );

  // LẤY LẠI một mục đã gỡ: gõ lại số bản ấy vào ô. Bia mộ tự rụng vì phép tính chỉ nhìn những
  // gì đang vắng mặt — không có danh sách tích luỹ nào để đi dọn bằng tay.
  const restored = hiddenVersionsFor(defaults, defaults);
  ok(restored.length === 0, "gõ lại số bản đã gỡ → bia mộ tự rụng ở lượt lưu kế");
  ok(
    mergeReleaseNotes(defaults, defaults, restored).length === 2,
    "…và mục ấy trở lại đầy đủ",
  );

  // Bia mộ KHÔNG được chặn phần ghi đè: nếu chặn thì cách lấy lại ở trên im lặng không ăn.
  const overrideOverGrave = mergeReleaseNotes(
    defaults,
    [{ version: "0.8.0", date: "2026-08-09", lines: ["Lời mới cho mục từng bị gỡ."] }],
    ["0.8.0"],
  );
  ok(
    overrideOverGrave.some((n) => n.version === "0.8.0"),
    "ghi đè THẮNG bia mộ — bằng không cách lấy lại một mục sẽ câm",
  );
}


console.log(`\n✔ Bản tin cập nhật: ${passed} phép kiểm, tất cả đứng vững.`);
