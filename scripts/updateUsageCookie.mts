#!/usr/bin/env node
/**
 * CẬP NHẬT COOKIE PHIÊN VERCEL của một trạm lên secret của workflow「Vercel usage」.
 *
 *   npm run usage:cookie -- --site auto-hh3d-1 --cookie "C:/…/cookie_vercel.json"
 *   npm run usage:cookie -- --site auto-hh3d-1 --cookie … --dry-run   (chỉ in kế hoạch)
 *   npm run usage:cookie -- --list                                     (in bảng trạm rồi thôi)
 *
 * Hoặc bấm đúp `update-usage-cookie.bat` — nó hỏi mã trạm và đường dẫn tệp (kéo-thả tệp vào
 * cửa sổ console là ra đường dẫn).
 *
 * VÌ SAO CẦN: cookie phiên Vercel HẾT HẠN, và khi nó hết thì workflow đỏ — đúng như thiết kế
 * (`vercelUsageFull.mts` từ chối in bảng thiếu). Lúc ấy phải xuất lại tệp cookie rồi thay vào
 * secret. Làm tay là: mở GitHub → Settings → Secrets → tìm ĐÚNG một trong bốn cái tên na ná
 * nhau → dán. Dán nhầm ô thì workflow mở tài khoản A bằng phiên tài khoản B, và triệu chứng
 * không phải「sai cookie」mà là「thiếu cột」sau 90 giây chờ — commit fe18d6c đã trả giá đúng
 * kiểu nhầm ấy với slug đội.
 *
 * BẢNG TRẠM ĐỌC TỪ CHÍNH WORKFLOW, không chép lại (xem `usageStations.mts`): tên secret KHÔNG
 * suy ra được từ mã trạm — trạm gốc dùng `VERCEL_COOKIE_MAIN` chứ không phải
 * `VERCEL_COOKIE_AUTO_HH3D`.
 *
 * COOKIE ĐI QUA STDIN, không qua dòng lệnh: đối số của tiến trình thì mọi tiến trình khác trên
 * máy đọc được, mà đây là chìa mở TOÀN TÀI KHOẢN Vercel (cùng quyền `vercel env pull`, tức đọc
 * được `ENCRYPTION_KEY` — thứ mở phong bì cookie game của mọi đạo hữu).
 *
 * DÙNG `gh` cho phép ghi secret: API GitHub đòi mã hoá sealed-box (X25519 + XSalsa20), thứ Node
 * không có sẵn. Cùng lối với `newGithubKhoiloi.mjs` và `newGithubStation.mts` — xem bình chú
 * đầu tệp ấy.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { daysUntilExpiry, parseUsageStations, readCookieFile } from "./usageStations.mts";

/** Chú kiểu trên BIẾN để TypeScript thu hẹp kiểu ở mọi chỗ gọi — xem bình chú cùng tên ở mirror:new. */
const die: (message: string) => never = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const listOnly = process.argv.includes("--list");

const repoRoot = path.join(import.meta.dirname, "..");
const WORKFLOW = path.join(repoRoot, ".github", "workflows", "vercel-usage.yml");
/** Trần thời gian một lệnh `gh`. Chúng đều là gọi API, phải trả lời tức thì hoặc là có chuyện. */
const GH_TIMEOUT_MS = 60_000;
/** Trên Windows `gh` là một tệp .cmd — không có shell thì spawn trả ENOENT. */
const GH_SHELL = process.platform === "win32";

// ---- 1. Bảng trạm, đọc từ chính workflow -----------------------------------------------------

let stations;
try {
  stations = parseUsageStations(readFileSync(WORKFLOW, "utf8"));
} catch (err) {
  die(`Đọc bảng trạm trong ${path.relative(repoRoot, WORKFLOW)} hỏng — ${err instanceof Error ? err.message : "lỗi lạ"}`);
}

const bang = () => {
  console.log("\n── Trạm trong workflow usage ─────────────────────────");
  for (const s of stations) console.log(`  ${s.siteId.padEnd(14)} đội ${s.team.padEnd(18)} → secret ${s.secret}`);
};

if (listOnly) {
  bang();
  process.exit(0);
}

// ---- 2. Đối số --------------------------------------------------------------------------------

const siteId = arg("site")?.trim();
if (!siteId || siteId.startsWith("--")) {
  bang();
  die("Thiếu `--site <mã trạm>`. Bảng trạm ở trên.");
}
const station = stations.find((s) => s.siteId === siteId);
if (!station) {
  bang();
  die(`Workflow không có trạm「${siteId}」. Mã trạm phải TRÙNG cột đầu ở bảng trên.`);
}

const cookiePath = arg("cookie")?.trim();
if (!cookiePath || cookiePath.startsWith("--")) {
  die(
    "Thiếu `--cookie <đường dẫn tệp>`.\n" +
      "  Xuất tệp ấy từ trình duyệt ĐANG đăng nhập Vercel bằng một tiện ích xuất cookie\n" +
      "  (dạng JSON có mảng `cookies`), rồi xoá tệp đi ngay sau khi cập nhật xong.",
  );
}

let cookieText: string;
try {
  cookieText = readFileSync(cookiePath, "utf8");
} catch (err) {
  die(`Không đọc được tệp cookie「${cookiePath}」— ${err instanceof Error ? err.message : "lỗi lạ"}`);
}

const doc = readCookieFile(cookieText);
if (!doc.ok) die(`Tệp cookie không dùng được: ${doc.message}`);
const conLai = daysUntilExpiry(doc.cookies);

// ---- 3. Kho GitHub nào ------------------------------------------------------------------------
//
// Nói TÊN KHO ra trước khi ghi: đây là thao tác ghi vào một kho từ xa, và một công cụ ghi bí mật
// mà không cho người ta thấy nó ghi vào đâu là một công cụ đáng ngờ.
const repoArg = arg("repo")?.trim();
let repo = repoArg && !repoArg.startsWith("--") ? repoArg : "";
if (!repo) {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: GH_TIMEOUT_MS,
  });
  if (remote.status !== 0) die("Không đọc được remote `origin` — truyền tay bằng `--repo <chủ>/<kho>`.");
  const m = remote.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) die(`Remote origin không phải kho GitHub: ${remote.stdout.trim()}`);
  repo = `${m[1]}/${m[2]}`;
}

// ---- 4. Kế hoạch ------------------------------------------------------------------------------

console.log("\n── Sẽ cập nhật ───────────────────────────────────────");
console.log(`  trạm      : ${station.siteId} (đội Vercel「${station.team}」)`);
console.log(`  secret    : ${station.secret}`);
console.log(`  kho GitHub: ${repo}`);
console.log(`  tệp cookie: ${cookiePath}`);
console.log(
  `  nội dung  : ${doc.cookies.length} cookie, ${cookieText.length} ký tự` +
    (doc.boQua > 0 ? `  ⚠ bỏ qua ${doc.boQua} mục thiếu name/value` : ""),
);
console.log(
  `  hạn phiên : ${
    conLai === null
      ? "tệp không khai hạn (cookie phiên thuần) — dùng tới khi Vercel huỷ"
      : conLai <= 0
        ? `ĐÃ HẾT HẠN ${-conLai} ngày trước — xuất lại tệp mới trước khi cập nhật`
        : `còn ~${conLai} ngày`
  }`,
);

// Hết hạn rồi mà vẫn đẩy lên thì chỉ là dời lượt CI đỏ sang sáu tiếng nữa.
if (conLai !== null && conLai <= 0) {
  die("Cookie trong tệp đã hết hạn — đẩy lên cũng vô ích. Xuất lại từ trình duyệt rồi chạy lại.");
}

if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, chưa ghi secret nào.");
  process.exit(0);
}

// ---- 5. `gh` có sẵn và đã đăng nhập chưa ------------------------------------------------------

const ghVersion = spawnSync("gh", ["--version"], { stdio: "ignore", shell: GH_SHELL, timeout: GH_TIMEOUT_MS });
if (ghVersion.error || ghVersion.status !== 0) {
  die(
    "Chưa có `gh` (GitHub CLI) — nó là thứ ghi được secret (API GitHub đòi mã hoá sealed-box,\n" +
      "  thứ Node không có sẵn).\n" +
      "  Cài: winget install --id GitHub.cli    (hoặc https://cli.github.com)\n" +
      "  Rồi: gh auth login",
  );
}

const ghAuth = spawnSync("gh", ["auth", "status"], { stdio: "ignore", shell: GH_SHELL, timeout: GH_TIMEOUT_MS });
if (ghAuth.status !== 0) {
  die("`gh` chưa đăng nhập. Chạy `gh auth login` (chọn tài khoản có quyền ghi secret của kho trên) rồi chạy lại.");
}

// ---- 6. Ghi secret ----------------------------------------------------------------------------
//
// Giá trị đi qua STDIN. `--body` sẽ đặt cả tệp cookie lên dòng lệnh, nơi mọi tiến trình khác trên
// máy đọc được — với một chiếc chìa mở toàn tài khoản thì đó là cái giá không đáng.
const set = spawnSync("gh", ["secret", "set", station.secret, "--repo", repo], {
  input: cookieText,
  encoding: "utf8",
  shell: GH_SHELL,
  timeout: GH_TIMEOUT_MS,
});
if (set.status !== 0) {
  die(
    `Ghi secret ${station.secret} hỏng (mã ${set.status ?? "bị giết"}).\n` +
      `  ${(set.stderr || set.stdout || "").trim().slice(0, 300)}`,
  );
}
console.log(`\n✔ đã ghi secret ${station.secret} vào ${repo}`);

// ---- 7. Đọc lại rồi mới tin -------------------------------------------------------------------
//
// `gh secret set` im lặng khi thuận, nên không đọc lại thì không có gì chứng minh giá trị đã tới
// nơi. Không đọc được NỘI DUNG secret (GitHub không cho, và đó là điều đúng đắn) — thứ kiểm được
// là MỐC CẬP NHẬT.
const list = spawnSync("gh", ["secret", "list", "--repo", repo, "--json", "name,updatedAt"], {
  encoding: "utf8",
  shell: GH_SHELL,
  timeout: GH_TIMEOUT_MS,
});
if (list.status !== 0) {
  console.warn(`  ⚠ Không đọc lại được danh sách secret để xác nhận (mã ${list.status}). Soi tay trên GitHub.`);
} else {
  const rows = JSON.parse(list.stdout || "[]") as { name: string; updatedAt: string }[];
  const row = rows.find((r) => r.name === station.secret);
  if (!row) die(`Ghi xong nhưng secret ${station.secret} KHÔNG có trong danh sách — soi lại trên GitHub.`);
  const tuoi = Math.round((Date.now() - new Date(row.updatedAt).getTime()) / 1000);
  console.log(`✔ xác nhận: ${row.name} vừa cập nhật ${tuoi} giây trước`);
}

console.log("\n── Còn hai việc ──────────────────────────────────────");
console.log(`  1. XOÁ tệp ${cookiePath} — nó là chìa mở toàn tài khoản Vercel.`);
console.log("  2. Chạy thử: Actions → Vercel usage → Run workflow. Cookie sai thì lượt ấy ĐỎ,");
console.log("     không im lặng — script từ chối in bảng thiếu.");
