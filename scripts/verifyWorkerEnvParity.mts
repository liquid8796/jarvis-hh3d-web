/**
 * Khôi lỗi MÁY NHÀ và khôi lỗi TÔNG MÔN phải khai cùng một bộ biến — hoặc phải nói ra vì sao không.
 *
 * Vì sao có lưới này: 21/08/2026 lộ ra `WORKER_SOLVE_TURNSTILE=1` chỉ được khai ở
 * `deploy/github/linh-su.yml`, còn hai bộ cài máy nhà thì không ai khai hộ. Nghĩa là cờ ấy BẬT ở
 * đúng chỗ nó ít ăn thua nhất (runner trung tâm dữ liệu) và TẮT ở đúng chỗ nó ăn thua nhất (máy
 * IP dân dụng) — ngược hoàn toàn với điều chính mã nguồn khuyên. Không lượt kiểm nào bắt được,
 * vì chưa từng có ai đối chiếu hai bên.
 *
 * Đây là lưới THUẦN: chỉ đọc tệp trong repo, không mạng, không database, không dựng trình duyệt.
 *
 * Luật: mọi biến khôi lỗi tông môn khai thì máy nhà cũng phải khai — TRỪ khi nó nằm trong một
 * trong ba danh sách miễn dưới đây, và mỗi danh sách phải mang theo lý do đọc được. Miễn trừ mà
 * không có lý do thì chính nó là lỗi.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(what: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${what}`);
  } else {
    failures.push(`${what}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const YML = "deploy/github/linh-su.yml";
const PS1 = "public/linh-su/install.ps1";
const SH = "public/linh-su/install.sh";
const WORKER = "scripts/worker.mjs";

/**
 * Miễn trừ CÓ LÝ DO. Sửa danh sách này là một quyết định, không phải một thao tác dọn dẹp: mỗi
 * dòng ở đây là một lời khẳng định về hành vi, và phần lớn được lưới bên dưới kiểm lại bằng mã.
 */
const CHI_RIENG_ACTIONS: Record<string, string> = {
  WORKER_MAX_LIFETIME_MS:
    "GitHub Actions cắt lượt chạy ở 6 giờ nên runner phải tự rút lui trước; máy nhà chạy vô hạn.",
  WORKER_DRAIN_TIMEOUT_MS: "Chỉ có nghĩa khi có hạn đời — đi kèm WORKER_MAX_LIFETIME_MS.",
};

/** Biến CHẾT: còn trong tệp cấu hình nhưng không dòng mã nào đọc. Lưới kiểm lại lời này bên dưới. */
const BIEN_CHET = ["WORKER_QUEST_TABS"];

/** Mã đã có sẵn ĐÚNG giá trị ấy làm mặc định, nên máy nhà không cần khai. Cũng được kiểm lại. */
const MAC_DINH_DA_BANG: Record<string, string> = { WORKER_MAX_JOBS: "2" };

// ── Rút tên biến từ ĐÚNG khối khai, không phải từ cả tệp ────────────────────────────────────
//
// Quét cả tệp là tự bắn vào chân: `install.ps1` nhắc `WORKER_TOKEN` trong chú thích và trong
// regex đọc .env cũ, nên lưới sẽ tưởng đã khai trong khi thật ra chưa.

function bienCuaTongMon(src: string): string[] {
  const start = src.indexOf("\n        env:");
  if (start < 0) throw new Error(`${YML}: không thấy khối env: của bước chạy`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n\s{8}run:/);
  const block = end < 0 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

function bienCuaPs1(src: string): string[] {
  const start = src.indexOf("@(\n  \"WEB_URL=");
  if (start < 0) throw new Error(`${PS1}: không thấy khối ghi .env`);
  const block = src.slice(start, src.indexOf(") -join", start));
  return [...block.matchAll(/"([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]);
}

function bienCuaSh(src: string): string[] {
  const start = src.indexOf('cat > "$DIR/.env" <<ENV');
  if (start < 0) throw new Error(`${SH}: không thấy khối ghi .env`);
  const block = src.slice(start, src.indexOf("\nENV", start));
  return [...block.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
}

const ymlSrc = read(YML);
const ps1Src = read(PS1);
const shSrc = read(SH);
const workerSrc = read(WORKER);

const tongMon = bienCuaTongMon(ymlSrc);
const ps1 = bienCuaPs1(ps1Src);
const sh = bienCuaSh(shSrc);

console.log("Đọc được gì ở mỗi bên");
check("tông môn khai được ít nhất WEB_URL + token + id", tongMon.length >= 3, tongMon.join(", "));
check("install.ps1 đọc được khối .env", ps1.length >= 3, ps1.join(", "));
check("install.sh đọc được khối .env", sh.length >= 3, sh.join(", "));

console.log("\nHai bộ cài máy nhà phải KHỚP NHAU");
// Bộ cài Windows và bộ cài Unix lệch nhau thì cùng một người dùng nhận hai hành vi khác nhau
// tuỳ máy họ ngồi — thứ không ai nghĩ tới lúc sửa một trong hai.
check(
  "install.ps1 và install.sh khai đúng cùng một bộ biến",
  JSON.stringify([...ps1].sort()) === JSON.stringify([...sh].sort()),
  `ps1=[${ps1.join(",")}] sh=[${sh.join(",")}]`,
);

console.log("\nMọi biến tông môn khai thì máy nhà cũng phải khai — hoặc phải có lý do");
const nhaCo = new Set(ps1);
for (const bien of tongMon) {
  if (nhaCo.has(bien)) {
    check(`${bien}: cả hai bên cùng khai`, true);
    continue;
  }
  const lyDo = CHI_RIENG_ACTIONS[bien]
    ?? (BIEN_CHET.includes(bien) ? "biến chết — không mã nào đọc" : null)
    ?? (MAC_DINH_DA_BANG[bien] ? "mặc định của mã đã bằng" : null);
  check(
    `${bien}: máy nhà không khai, nhưng có lý do ghi sẵn`,
    lyDo !== null,
    "thiếu ở cả hai bộ cài máy nhà và KHÔNG nằm trong danh sách miễn nào — hoặc khai thêm, hoặc ghi lý do vào verifyWorkerEnvParity.mts",
  );
}

console.log("\nLý do miễn trừ phải ĐÚNG, không phải lời hứa suông");
// Đây là phần khiến lưới này khác một cái danh sách cho qua: mỗi lời miễn trừ kiểm được thì phải
// được kiểm. Một biến 「chết」 sống lại, hay một mặc định bị đổi, là lúc miễn trừ thành nói dối.
for (const bien of BIEN_CHET) {
  const doc = new RegExp(`process\\.env\\.${bien}\\b`).test(workerSrc);
  check(`${bien} vẫn thật sự là biến chết — worker.mjs không đọc`, !doc, doc ? "worker.mjs ĐÃ đọc biến này: miễn trừ hết hiệu lực, phải khai ở bộ cài máy nhà" : undefined);
}
for (const [bien, giaTri] of Object.entries(MAC_DINH_DA_BANG)) {
  const m = workerSrc.match(new RegExp(`process\\.env\\.${bien}\\s*\\?\\?\\s*([0-9]+)`));
  check(
    `${bien}: mặc định trong worker.mjs vẫn là ${giaTri}`,
    m?.[1] === giaTri,
    m ? `mã đang để ${m[1]}` : "không đọc được mặc định trong worker.mjs",
  );
  const ymlGiaTri = ymlSrc.match(new RegExp(`${bien}:\\s*"?([0-9]+)"?`))?.[1];
  check(
    `${bien}: tông môn khai đúng ${giaTri}, tức hai bên vẫn bằng nhau`,
    ymlGiaTri === giaTri,
    `linh-su.yml đang để ${ymlGiaTri}`,
  );
}

console.log("\nCờ Turnstile: bật ở máy nhà là CÓ CHỦ Ý, không phải chép nhầm");
// Cờ này là lý do lưới ra đời, nên nó được ghim riêng: mã đọc đúng chuỗi "1", và máy nhà khai
// đúng chuỗi ấy. Ghim cả hai vế vì một vế đúng mà vế kia lệch thì cờ nằm im mà không ai biết.
check(
  "runCycle chỉ coi là bật khi giá trị đúng bằng \"1\"",
  /WORKER_SOLVE_TURNSTILE === "1"/.test(read("src/lib/quest-engine/runCycle.mjs")),
);
check(
  "install.ps1 khai WORKER_SOLVE_TURNSTILE=1",
  /"WORKER_SOLVE_TURNSTILE=1"/.test(ps1Src),
);
check(
  "install.sh khai WORKER_SOLVE_TURNSTILE=1",
  /^WORKER_SOLVE_TURNSTILE=1$/m.test(shSrc),
);
check(
  "vòng nuôi Windows đọc nổi tên biến ấy từ .env",
  // run.ps1 lọc theo `^([A-Z_]+)=` — tên có CHỮ SỐ sẽ rơi lặng lẽ. Tên này không có, nhưng phép
  // kiểm phải ghim lại kẻo lần sau ai đó thêm `WORKER_X2` rồi ngồi đoán vì sao nó không có tác dụng.
  /\^\(\[A-Z_\]\+\)=/.test(ps1Src) && /^[A-Z_]+$/.test("WORKER_SOLVE_TURNSTILE"),
);

console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
