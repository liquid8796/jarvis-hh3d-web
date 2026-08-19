#!/usr/bin/env node
/**
 * Kiểm chứng MỌI tệp `.bat`/`.cmd` TRONG CÂY LÀM VIỆC đều kết dòng CRLF — thuần đĩa, không mạng,
 * không database, chạy trong vài mili giây.
 *
 * VÌ SAO CẦN THÊM MỘT LƯỚI khi `.gitattributes` đã có `*.bat text eol=crlf`: luật ấy là bộ lọc
 * lúc CHECKOUT. Tệp được ghi THẲNG xuống đĩa — bởi một trình soạn thảo, một script sinh mã, hay
 * một công cụ ghi tệp mặc định LF — không đi qua lượt checkout nào, nên nó nằm đó với LF trần
 * trong khi `git status` vẫn sạch bong: bộ lọc `clean` chuẩn hoá CRLF→LF trước khi so với blob,
 * nên LF-trên-đĩa và CRLF-trên-đĩa trông GIỐNG HỆT NHAU với git. Không có phép đo nào khác nhìn
 * thấy chuyện này.
 *
 * CÁI GIÁ, đã trả HAI LẦN:
 *   · 11/08/2026 — `new-mirror-station.bat` (lời kể còn nguyên trong `.gitattributes`).
 *   · 15/08/2026 — BỐN tệp cùng lúc: `reset-mirror-db.bat`, `deploy-github-khoiloi.bat`,
 *     `purge-roster.bat`, `sync-db-env.bat`.
 *
 * Vì sao nó hỏng: cmd.exe định vị trong tệp batch theo BYTE OFFSET và tính offset ấy theo giả
 * định mỗi dòng kết bằng hai byte CRLF. Thiếu `\r`, con trỏ trôi dần một byte mỗi dòng, và tới
 * một cú `goto` thì nó rơi vào GIỮA một dòng. Người dùng thấy đúng cái màn hình này:
 *
 *     'M' is not recognized as an internal or external command,      ← mảnh của REM
 *     '/d' is not recognized as an internal or external command,     ← mảnh của cd /d
 *     'ho' is not recognized as an internal or external command,     ← mảnh của echo
 *
 * Đo 15/08/2026 trên chính `reset-mirror-db.bat`: bản LF cho đúng năm mảnh trên; cùng tệp ấy đổi
 * sang CRLF thì in ra thông điệp「Thieu --site」đúng như thiết kế. Một byte mỗi dòng, không hơn.
 *
 * ĐỌC TỪ ĐĨA, KHÔNG ĐỌC TỪ BLOB — và đó là toàn bộ giá trị của tệp này. Blob luôn đúng (git
 * chuẩn hoá về LF rồi bung ra CRLF lúc checkout); thứ người dùng bấm đúp là tệp trên đĩa.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let count = 0;
const assert = (condition, message) => {
  count += 1;
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`✔ ${message}`);
  return true;
};

/** Đếm kết dòng của một buffer. Bất kỳ CR/LF đứng một mình nào cũng làm tệp không còn CRLF thuần. */
const countEol = (buf) => {
  const text = buf.toString("latin1");
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1;
  const cr = text.split("\r").length - 1;
  return { crlf, bareLf: lf - crlf, bareCr: cr - crlf };
};

// ---- 1. Chính phép đo phải bắt được LF trần -----------------------------------------------------
//
// Lật ngược trước khi tin: một hàm đếm hỏng sẽ khiến mọi ca dưới xanh mướt mà chẳng canh gì.

assert(countEol(Buffer.from("a\r\nb\r\n")).bareLf === 0, "phép đo: CRLF thuần → 0 LF trần");
assert(countEol(Buffer.from("a\nb\n")).bareLf === 2, "phép đo: LF thuần → đếm đủ LF trần");
assert(countEol(Buffer.from("a\r\nb\nc\r\n")).bareLf === 1, "phép đo: pha trộn → bắt đúng dòng lạc");
assert(countEol(Buffer.from("a\rb\r\n")).bareCr === 1, "phép đo: CR đứng một mình cũng bị bắt");
assert(countEol(Buffer.from("")).bareLf === 0, "phép đo: tệp rỗng không phải lỗi");

// ---- 2. Luật lúc checkout còn nguyên ------------------------------------------------------------
//
// Lưới này KHÔNG thay `.gitattributes` mà đứng cạnh: bỏ dòng kia đi thì mọi lượt clone mới lại
// sinh ra LF, và lưới này chỉ biết kêu sau khi việc đã rồi.

const attrs = existsSync(".gitattributes") ? readFileSync(".gitattributes", "utf8") : "";
for (const glob of ["*.bat", "*.cmd"]) {
  assert(
    new RegExp(`^\\s*\\${glob}\\s+.*eol=crlf`, "m").test(attrs.replaceAll("*", "\\*")) ||
      attrs.includes(`${glob} text eol=crlf`),
    `.gitattributes vẫn ép \`${glob} text eol=crlf\` cho lượt checkout`,
  );
}

// ---- 3. Mọi tệp batch trên ĐĨA ------------------------------------------------------------------

const tracked = execFileSync("git", ["ls-files", "-z", "*.bat", "*.cmd"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

assert(tracked.length > 0, `git đang theo dõi ${tracked.length} tệp batch`);

const missing = [];
for (const file of tracked) {
  if (!existsSync(file)) {
    missing.push(file);
    continue;
  }
  const { crlf, bareLf, bareCr } = countEol(readFileSync(file));
  assert(
    bareLf === 0 && bareCr === 0,
    bareLf === 0 && bareCr === 0
      ? `${file} — ${crlf} dòng CRLF, không CR/LF nào đứng một mình`
      : `${file} — ${bareLf} LF trần + ${bareCr} CR trần: tệp không còn CRLF thuần. ` +
        `Chữa: xoá tệp rồi \`git checkout -- ${file}\` để bộ lọc eol=crlf dựng lại.`,
  );
}

// Tệp được theo dõi mà vắng trên đĩa là chuyện khác hẳn (ai đó vừa xoá) — kể ra chứ không nuốt.
if (missing.length > 0) {
  console.log(`\n… ${missing.length} tệp có trong git nhưng vắng trên đĩa, bỏ qua: ${missing.join(", ")}`);
}

if (process.exitCode === 1) {
  console.error(`\n✗ ${count} phép kiểm — có tệp batch sẽ vỡ khi bấm đúp.`);
} else {
  console.log(`\n✔ ${count} phép kiểm — mọi tệp batch trên đĩa đều kết dòng CRLF.`);
}
