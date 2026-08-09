#!/usr/bin/env node
/**
 * Kiểm chứng hai phép DỌN của khôi lỗi: xoá hồ sơ Chromium cũ, và đóng trình duyệt có hạn giờ.
 *
 * Vì sao hai thứ này đáng có phép thử riêng — cả hai đều thuộc loại "sai thì không có nút hoàn
 * tác":
 *
 *   • `sweepStaleProfiles` XOÁ ĐỆ QUY. Lệch một nhịp là mất phiên đăng nhập của người khác,
 *     kèm token cf_clearance mà Cloudflare phải cấp lại từ đầu. Nên phải đóng đinh: nó xoá
 *     đúng cái cũ, CHỪA cái mới, không đụng thứ lạ, và một biến môi trường gõ sai thì nó NÉM
 *     chứ không dọn sạch.
 *   • `closeBrowserWithin` là hàng rào duy nhất giữa một `close()` treo và một khôi lỗi tê
 *     liệt vì hết ghế. Phép thử quan trọng nhất ở đây là nhánh TREO — thứ không bao giờ xảy ra
 *     trên máy lành, nên nếu không dựng ra mà thử thì vĩnh viễn không ai biết nó có chạy không.
 *
 * Chạy: node scripts/verifyProfileSweep.mjs
 */
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { profileDirForJob, sweepStaleProfiles } from "../src/lib/quest-engine/browserProfile.mjs";
import { closeBrowserWithin } from "../src/lib/quest-engine/browserShutdown.mjs";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 14 * DAY_MS;

/** Hạn trong browserShutdown.mjs là 8s; chờ tới 20s là rộng rãi mà vẫn bắt được nếu nó treo. */
const HANG_BUDGET_MS = 20_000;

let passed = 0;
const check = (name, condition, detail = "") => {
  assert(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✔ ${name}`);
  passed++;
};

/** Dựng một hồ sơ giả và đặt tuổi cho nó bằng cách lùi mtime. */
async function makeProfile(root, owner, account, ageMs) {
  const dir = path.join(root, `user-${owner}`, `account-${account}`);
  await mkdir(dir, { recursive: true });
  // Một tệp bên trong, để phép xoá phải thật sự đệ quy mới thành công.
  await writeFile(path.join(dir, "Cookies"), "giả vờ là cookie");
  const when = new Date(Date.now() - ageMs);
  await utimes(dir, when, when);
  return dir;
}

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const log = {
  info: () => {},
  warning: () => {},
  debug: () => {},
};

// ---------------------------------------------------------------------------------------
// 1. sweepStaleProfiles
// ---------------------------------------------------------------------------------------
const root = await mkdtemp(path.join(tmpdir(), "profile-sweep-"));

const stale = await makeProfile(root, "aaa", "old", 30 * DAY_MS);
const fresh = await makeProfile(root, "aaa", "new", 1 * DAY_MS);
const loneStale = await makeProfile(root, "bbb", "old", 30 * DAY_MS);
// Thứ KHÔNG phải hồ sơ, nằm ngay trong gốc: phép dọn không được đụng vào.
const stranger = path.join(root, "ghi-chu-cua-ai-do.txt");
await writeFile(stranger, "đừng xoá tôi");
const strangeDir = path.join(root, "thu-muc-la");
await mkdir(strangeDir, { recursive: true });

const swept = await sweepStaleProfiles(root, { maxAgeMs: MAX_AGE_MS });

check("hồ sơ quá hạn bị xoá", !(await exists(stale)));
check("hồ sơ còn mới được giữ", await exists(fresh));
check("hồ sơ quá hạn của người khác cũng bị xoá", !(await exists(loneStale)));
check(
  "thư mục người dùng RỖNG được dọn nốt",
  !(await exists(path.join(root, "user-bbb"))),
);
check(
  "thư mục người dùng CÒN hồ sơ thì giữ nguyên",
  await exists(path.join(root, "user-aaa")),
);
check("tệp lạ trong gốc không bị đụng", await exists(stranger));
check("thư mục lạ trong gốc không bị đụng", await exists(strangeDir));
check(
  "số đếm trả về khớp thực tế",
  swept.removed === 2 && swept.kept === 1 && swept.failed === 0,
  `nhận ${JSON.stringify(swept)}`,
);

// Gốc không tồn tại — máy chưa từng chạy job nào. Không được ném.
const missing = await sweepStaleProfiles(path.join(root, "khong-he-co"), { maxAgeMs: MAX_AGE_MS });
check(
  "gốc không tồn tại thì trả 0, không ném",
  missing.removed === 0 && missing.kept === 0 && missing.failed === 0,
  `nhận ${JSON.stringify(missing)}`,
);

// Biến môi trường gõ sai KHÔNG được biến phép dọn thành phép xoá sạch.
for (const bad of [0, -1, Number.NaN, Infinity]) {
  let threw = false;
  try {
    await sweepStaleProfiles(root, { maxAgeMs: bad });
  } catch {
    threw = true;
  }
  check(`maxAgeMs=${String(bad)} bị từ chối`, threw);
}
check("hồ sơ mới vẫn còn sau mọi lượt gọi hỏng", await exists(fresh));

// Thư mục người dùng còn TỆP lạ thì không được xoá, và cũng không được ném.
const messyOwner = path.join(root, "user-ccc");
await mkdir(messyOwner, { recursive: true });
await makeProfile(root, "ccc", "old", 30 * DAY_MS);
await writeFile(path.join(messyOwner, "ghi-chu.txt"), "tệp lạ");
const messy = await sweepStaleProfiles(root, { maxAgeMs: MAX_AGE_MS });
check("hồ sơ cũ trong thư mục lộn xộn vẫn bị xoá", !(await exists(path.join(messyOwner, "account-old"))));
check("thư mục người dùng còn tệp lạ thì được giữ", await exists(messyOwner));
check("lượt dọn lộn xộn không báo hụt", messy.failed === 0, `nhận ${JSON.stringify(messy)}`);

// Tên thư mục do profileDirForJob sinh ra phải ĐÚNG hình dạng mà phép dọn đi tìm — hai bên
// lệch tiền tố thì phép dọn im lặng ngừng dọn, đúng thứ khó phát hiện nhất.
const realDir = profileDirForJob(root, { userId: "u1", gameCookie: "c=1" });
await mkdir(realDir, { recursive: true });
const old = new Date(Date.now() - 30 * DAY_MS);
await utimes(realDir, old, old);
const real = await sweepStaleProfiles(root, { maxAgeMs: MAX_AGE_MS });
check(
  "hồ sơ do profileDirForJob sinh ra nằm trong tầm dọn",
  !(await exists(realDir)) && real.removed >= 1,
  `nhận ${JSON.stringify(real)}`,
);

// ---------------------------------------------------------------------------------------
// 2. closeBrowserWithin — nhánh TREO là lý do tệp này tồn tại
// ---------------------------------------------------------------------------------------
const started = Date.now();
await closeBrowserWithin({
  context: { close: () => new Promise(() => {}) }, // không bao giờ ngã ngũ
  browser: null,
  profileDir: "",
  log,
});
const spent = Date.now() - started;
check(
  "close() treo vẫn trả quyền điều khiển về (không kẹt ghế worker)",
  spent < HANG_BUDGET_MS,
  `mất ${spent}ms`,
);
check("và nó có CHỜ hết hạn chứ không bỏ qua ngay", spent >= 7_000, `mất ${spent}ms`);

let closed = false;
await closeBrowserWithin({
  context: { close: async () => { closed = true; } },
  browser: null,
  profileDir: "",
  log,
});
check("close() bình thường vẫn được gọi", closed);

await closeBrowserWithin({
  context: { close: async () => { throw new Error("đóng hỏng"); } },
  browser: null,
  profileDir: "",
  log,
});
check("close() ném thì nuốt, không dội lên lượt chạy", true);

let browserClosed = false;
await closeBrowserWithin({
  context: { close: async () => {} },
  browser: { close: async () => { browserClosed = true; } },
  profileDir: "",
  log,
});
check("nhánh không-hồ-sơ đóng cả browser", browserClosed);

// Gốc tạm còn lại gì thì kệ — hệ điều hành dọn tmp. Không tự xoá để nếu một phép kiểm đỏ thì
// còn hiện trường mà soi.
console.log(`\nTất cả ${passed} phép kiểm đều thuận. Hiện trường: ${root}`);
console.log(`(còn lại trong gốc: ${(await readdir(root)).join(", ")})`);
