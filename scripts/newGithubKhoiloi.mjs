#!/usr/bin/env node
/**
 * DỰNG MỘT KHÔI LỖI GITHUB MỚI — một lệnh, từ repo trắng tới lượt chạy đầu tiên.
 *
 *   node scripts/newGithubKhoiloi.mjs --owner <tài-khoản> [--repo tên] [--worker-id id]
 *   node scripts/newGithubKhoiloi.mjs --owner <tài-khoản> --dry-run    # in kế hoạch, không làm gì
 *
 * VÌ SAO CÓ TỆP NÀY: mỗi tài khoản GitHub là một quỹ phút Actions riêng, nên thêm một tài khoản
 * là thêm một khôi lỗi tông môn nữa mà không tốn đồng nào. Việc dựng thì lặp đi lặp lại — tạo
 * repo, chép đúng bốn thứ, dán secret, bấm chạy — và「lặp đi lặp lại」là chỗ để quên: quên
 * `--public` thì mất quỹ phút miễn phí, quên đổi WORKER_ID thì hai tiến trình ghi đè nhau trong
 * bảng `workers`.
 *
 * KHO MỚI KHÔNG PHẢI BẢN SAO CỦA WEB REPO. Worker chỉ cần `scripts/worker.mjs`, toàn bộ
 * `src/lib/quest-engine/`, và `playwright-core`. Giữ NGUYÊN bố cục thư mục là cố ý: worker.mjs
 * import `../src/lib/quest-engine/…`, nên chép nguyên hình dạng thì không phải viết lại một
 * đường dẫn nào — đúng cái bẫy mà `buildWorkerBundle.mjs` phải chống bằng phép rewrite và một
 * lời thề「thà vỡ lúc build còn hơn phát ra một gói cài xong không chạy」.
 *
 * VÌ SAO DỰA VÀO `gh`: đặt secret qua API GitHub đòi mã hoá sealed-box (X25519 + XSalsa20), thứ
 * Node không có sẵn — làm tay thì phải kéo thêm `libsodium` vào một app web chỉ để phục vụ một
 * script phát hành. `gh` làm sẵn việc ấy, và nó cũng đã cầm sẵn phần xác thực. Cùng lối với
 * `deployAllStations.mts` gọi `vercel`.
 *
 * CẦN CÓ TRƯỚC:
 *   1. `gh` đã cài và đã đăng nhập ĐÚNG tài khoản đích: `gh auth login`
 *      (nhiều tài khoản thì `gh auth switch --user <login>` trước khi chạy).
 *   2. `.env` ở gốc repo có `WORKER_TOKEN` — lấy bằng
 *      `vercel env pull .env --environment=production --yes`.
 *      KHÔNG dùng `npm run env:pull`: lệnh ấy kéo môi trường development, nơi biến này không tồn tại.
 *
 * ĐỌC TRƯỚC KHI CHẠY: repo tạo ra là CÔNG KHAI, và nhật ký Actions của repo công khai thì ai
 * cũng đọc được, vĩnh viễn — trong khi việc của khôi lỗi là nhận cookie game đã giải mã. Đây là
 * đánh đổi đã được cân nhắc và chấp nhận; xem deploy/github-actions.md mục 6.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : fallback;
};

const owner = arg("owner");
if (!owner) {
  console.error(
    "Thiếu --owner. Ví dụ:\n" +
      "  node scripts/newGithubKhoiloi.mjs --owner zhangyu4\n" +
      "Tên tài khoản (hoặc tổ chức) GitHub sẽ giữ kho khôi lỗi mới.",
  );
  process.exit(1);
}
const repoName = arg("repo", "auto-hh3d-linh-su");
/**
 * WORKER_ID mặc định suy từ tên tài khoản, không phải một chuỗi cố định — trùng id thì hai tiến
 * trình ghi đè nhau trong bảng `workers` và mục Khôi Lỗi nói dối về việc ai đang trực. Suy ra
 * từ một thứ vốn đã duy nhất thì không có gì để quên.
 */
const workerId = arg("worker-id", `github-${owner.toLowerCase()}`);
const slug = `${owner}/${repoName}`;

const token = process.env.WORKER_TOKEN;
if (!token) {
  console.error(
    "Thiếu WORKER_TOKEN trong .env — khôi lỗi mới sẽ không xác thực được với /api/worker.\n" +
      "Lấy về bằng: vercel env pull .env --environment=production --yes",
  );
  process.exit(1);
}

const DEFAULT_WEB_URL = "https://auto-hh3d.vercel.app";

/**
 * `.env` KHÔNG phải nguồn đáng tin cho `WEB_URL`, và đây là một bẫy đã bắt được ngay lượt chạy
 * khô đầu tiên: biến ấy nằm trong nhóm「sensitive」của Vercel, nên `vercel env pull` trả về đúng
 * chuỗi `"[SENSITIVE]"` chứ không trả giá trị. Nướng chuỗi ấy vào workflow của kho mới là phát
 * ra một khôi lỗi gọi về một địa chỉ không tồn tại — và nó sẽ hỏng lặng lẽ, ở một kho khác, sau
 * khi mọi bước ở đây đều báo xanh.
 *
 * Nên phép kiểm là「có phải một URL http(s) thật không」, không phải「có rỗng không」.
 */
function resolveWebUrl(raw) {
  if (!raw) return DEFAULT_WEB_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("sai giao thức");
    return raw.replace(/\/$/, "");
  } catch {
    console.warn(
      `WEB_URL trong .env không phải URL dùng được (${JSON.stringify(raw)}) — dùng ${DEFAULT_WEB_URL}.\n` +
        "  Biến này bị Vercel che nên `env pull` trả về [SENSITIVE]; truyền --web-url nếu cần địa chỉ khác.",
    );
    return DEFAULT_WEB_URL;
  }
}

const webUrl = resolveWebUrl(arg("web-url", process.env.WEB_URL));

/** Chạy một lệnh và trả stdout. `gh` trên Windows là .cmd nên cần shell — xem ghi chú ở deployAllStations. */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
    timeout: options.timeout ?? 120_000,
    env: options.env ?? process.env,
  });
}

const playwrightVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).dependencies["playwright-core"];

console.log(
  `Sắp dựng khôi lỗi GitHub:\n` +
    `  kho        ${slug} (CÔNG KHAI)\n` +
    `  worker id  ${workerId}\n` +
    `  web        ${webUrl}\n` +
    `  engine     playwright-core ${playwrightVersion}\n`,
);
if (dryRun) {
  console.log("--dry-run: dừng ở đây, không tạo gì cả.");
  process.exit(0);
}

/**
 * Phép kiểm `gh` đứng SAU lượt chạy khô, không đứng trước.
 *
 * `--dry-run` sinh ra để soi kế hoạch — trên một máy chưa cài `gh`, trong lúc còn đang cân nhắc
 * có làm hay không. Chặn nó bằng một điều kiện tiên quyết của bước THỰC THI là lấy mất đúng
 * công dụng của nó. Lượt chạy thật thì vẫn hỏng sớm, ngay đây, trước khi tạo bất cứ thứ gì.
 *
 * Kiểm `auth status` chứ không kiểm `--version`: có `gh` mà chưa đăng nhập là ca hay gặp hơn
 * hẳn, và nó hỏng ở tận bước tạo repo — sau khi đã dựng xong thư mục tạm.
 */
try {
  run("gh", ["auth", "status"], { quiet: true });
} catch {
  console.error(
    "`gh` chưa cài hoặc chưa đăng nhập.\n" +
      "  Cài: https://cli.github.com  ·  Đăng nhập: gh auth login\n" +
      "  Nhiều tài khoản: gh auth switch --user <login> — nhớ đúng tài khoản sẽ giữ kho này.",
  );
  process.exit(1);
}

const staging = mkdtempSync(path.join(tmpdir(), "khoiloi-"));
try {
  // Bốn thứ, không hơn. Giữ nguyên bố cục để đường import của worker.mjs còn đúng.
  mkdirSync(path.join(staging, "scripts"), { recursive: true });
  cpSync(path.join(repoRoot, "scripts", "worker.mjs"), path.join(staging, "scripts", "worker.mjs"));
  cpSync(
    path.join(repoRoot, "src", "lib", "quest-engine"),
    path.join(staging, "src", "lib", "quest-engine"),
    { recursive: true },
  );

  writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(
      {
        name: "auto-hh3d-linh-su",
        private: true,
        version: "1.0.0",
        type: "module",
        description: "Khôi lỗi tông môn — chỉ chạy trên GitHub Actions.",
        scripts: { worker: "node scripts/worker.mjs" },
        dependencies: { "playwright-core": playwrightVersion },
      },
      null,
      2,
    ) + "\n",
  );

  // Workflow lấy NGUYÊN bản của web repo rồi chỉ thay đúng hai dòng: id khôi lỗi và địa chỉ web.
  // Chép tay một bản thứ hai là hẹn ngày hai bản trôi khỏi nhau — mà bộ số 290/50/350/360 thì
  // không được phép lệch.
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "linh-su.yml"), "utf8")
    .replace(/^(\s*WORKER_ID:\s*).*$/m, `$1${workerId}`)
    .replace(/\$\{\{ vars\.WEB_URL \|\| '[^']*' \}\}/, `\${{ vars.WEB_URL || '${webUrl}' }}`);
  if (!workflow.includes(`WORKER_ID: ${workerId}`)) {
    throw new Error(
      "Không thay được WORKER_ID trong workflow — hình dạng tệp đã đổi. " +
        "Sửa phép thay ở đây cho khớp, đừng phát ra một kho mang id trùng VM.",
    );
  }
  mkdirSync(path.join(staging, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(staging, ".github", "workflows", "linh-su.yml"), workflow);

  writeFileSync(
    path.join(staging, "README.md"),
    `# Khôi lỗi tông môn — ${workerId}\n\n` +
      `Một tiến trình \`worker.mjs\` nhận việc từ ${webUrl}, chạy trên GitHub Actions.\n` +
      `Kho này được sinh ra bằng \`scripts/newGithubKhoiloi.mjs\` từ repo web — **đừng sửa tay ở đây**,\n` +
      `sửa ở repo gốc rồi dựng lại, bằng không hai bản sẽ trôi khỏi nhau.\n`,
  );

  writeFileSync(path.join(staging, ".gitignore"), "node_modules/\n.env\n");

  run("git", ["init", "-q", "-b", "main"], { cwd: staging });
  run("git", ["add", "-A"], { cwd: staging });
  run("git", ["-c", "user.name=auto-hh3d", "-c", "user.email=auto-hh3d@users.noreply.github.com",
    "commit", "-q", "-m", `feat: khôi lỗi tông môn ${workerId}`], { cwd: staging });

  console.log(`\n── Tạo kho ${slug}…`);
  run("gh", ["repo", "create", slug, "--public", "--source", ".", "--push",
    "--description", `Khôi lỗi tông môn ${workerId} — Auto HH3D`], { cwd: staging });

  console.log("── Dán secret WORKER_TOKEN…");
  // Token đi qua STDIN, không qua đối số: đối số nằm trong command line mà ai mở Task Manager
  // cũng đọc được, và trên Windows nó còn phải đi qua phép nối chuỗi của `shell: true`.
  execFileSync("gh", ["secret", "set", "WORKER_TOKEN", "--repo", slug, "--body-file", "-"], {
    input: token,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
    timeout: 60_000,
  });

  console.log("── Bấm chạy lượt đầu…");
  run("gh", ["workflow", "run", "linh-su.yml", "--repo", slug], { cwd: staging });

  console.log(
    `\n✔ Xong. ${workerId} đang lên ca.\n` +
      `  Theo dõi: https://github.com/${slug}/actions\n` +
      `  Nghiệm thu: mở Hàng Đợi → tab Khôi Lỗi, phải thấy ${workerId} điểm danh trong ~4 phút.\n`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
