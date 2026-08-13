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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Chạy một lệnh và trả stdout. KHÔNG shell — và đây là một chỗ đã hỏng thật, 13/08/2026.
 *
 * Bản trước đặt `shell: process.platform === "win32"` cho MỌI lệnh. Với `shell: true` Node
 * **nối chuỗi** đối số thay vì escape, nên lời nhắn commit vỡ làm sáu: git nhận `feat:` làm lời
 * nhắn rồi coi năm chữ còn lại là đường dẫn —
 * `error: pathspec 'khôi' did not match any file(s) known to git`. Lượt dựng kho thật đầu tiên
 * chết ở đúng dòng ấy. Chính Node cũng kêu điều này qua DEP0190 ở cuối lượt chạy.
 *
 * Lời bình cũ biện hộ cho shell bằng câu「`gh` trên Windows là .cmd」— chép nhầm lý lẽ của
 * `deployAllStations.mts`, nơi câu ấy nói về `vercel` (một .cmd thật, do npm rải). `gh` do winget
 * cài là `gh.exe`, tệp thực thi thật (đo: `C:\Program Files\GitHub CLI\gh.exe`), nên không lệnh
 * nào ở đây cần shell. Cùng luật với `run` bên deployAllStations: bật shell là ngoại lệ phải
 * chứng minh, không phải mặc định.
 *
 * Quả mìn thứ hai cùng loại đã tháo cùng lượt này: `--description` của `gh repo create` cũng mang
 * khoảng trắng và một dấu gạch dài, nên nó sẽ vỡ y hệt ở dòng ngay sau chỗ vừa chết.
 */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
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
/**
 * Mọi đường `import` tương đối trong cây vừa dựng có trỏ vào một tệp CÓ THẬT không.
 *
 * Sinh ra vì một lỗi đã nằm sẵn trong script này: danh sách chép thiếu
 * `src/lib/worker/controlFollow.mjs`, nên kho phát ra sẽ chết ngay giây đầu bằng
 * `ERR_MODULE_NOT_FOUND` — ở một máy khác, sau khi mọi bước ở đây đều báo xanh. Không phép kiểm
 * nào bắt được vì `--dry-run` hồi ấy thoát TRƯỚC lúc dựng cây, còn đường thật thì đòi `gh`.
 *
 * Nên phép kiểm này không đi kèm một cái tên tệp: nó hỏi CÂU HỎI TỔNG QUÁT, và sẽ bắt được lần
 * sau, khi ai đó thêm một import thứ tư vào `worker.mjs` mà quên script phát hành này.
 */
function assertImportsResolve(root) {
  const missing = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|js)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      // Bắt cả `from "./x.mjs"` lẫn `import("./x.mjs")` — nhánh động cũng ném y như nhánh tĩnh.
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/g)) {
        if (!existsSync(path.resolve(path.dirname(full), match[1]))) {
          missing.push(`  ${path.relative(root, full).replace(/\\/g, "/")} → ${match[1]}`);
        }
      }
    }
  };
  walk(root);
  if (missing.length > 0) {
    throw new Error(
      `Kho sắp phát ra THIẾU TỆP — nó sẽ chết bằng ERR_MODULE_NOT_FOUND ngay lượt chạy đầu:\n` +
        `${missing.join("\n")}\n` +
        `Thêm tệp còn thiếu vào danh sách chép ở đầu khối staging.`,
    );
  }
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
if (!dryRun) {
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
}

const staging = mkdtempSync(path.join(tmpdir(), "khoiloi-"));
try {
  // Giữ nguyên bố cục để đường import của worker.mjs còn đúng.
  //
  // Danh sách này TỪNG SAI, và kiểu sai của nó là lý do có `assertImportsResolve` ở dưới: bản
  // đầu chỉ chép `worker.mjs` + `quest-engine` vì hồi viết script, worker.mjs chỉ cần ngần ấy.
  // Nhưng commit「khôi lỗi đi theo trạm」đã thêm một import thứ ba —
  // `../src/lib/worker/controlFollow.mjs` — mà không ai nghĩ tới việc script phát hành phải chép
  // thêm nó. Kho sinh ra sẽ chết ngay giây đầu bằng `ERR_MODULE_NOT_FOUND`, ở một máy khác, sau
  // khi mọi bước ở đây đều báo xanh. Chưa ai vấp chỉ vì script này chưa từng chạy thật.
  mkdirSync(path.join(staging, "scripts"), { recursive: true });
  cpSync(path.join(repoRoot, "scripts", "worker.mjs"), path.join(staging, "scripts", "worker.mjs"));
  cpSync(
    path.join(repoRoot, "src", "lib", "quest-engine"),
    path.join(staging, "src", "lib", "quest-engine"),
    { recursive: true },
  );
  // CHỈ `controlFollow.mjs`, không chép cả thư mục: `src/lib/worker/` còn có `version.ts`, thứ
  // Node không chạy được và worker.mjs cũng không cần (nó tự đọc bản qua `readOwnVersion`).
  mkdirSync(path.join(staging, "src", "lib", "worker"), { recursive: true });
  cpSync(
    path.join(repoRoot, "src", "lib", "worker", "controlFollow.mjs"),
    path.join(staging, "src", "lib", "worker", "controlFollow.mjs"),
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

  /**
   * Soi cây vừa dựng TRƯỚC khi nó rời khỏi máy này. Đây là hàng rào cuối cùng còn đứng trên
   * lãnh thổ ta kiểm soát được — sau dòng `gh repo create` thì mọi sai sót đều biểu hiện ở một
   * kho của người khác, trong nhật ký Actions của một tài khoản khác.
   */
  assertImportsResolve(staging);

  /**
   * Lượt commit đầu nằm TRƯỚC cửa `--dry-run`, không sau — và chỗ này đổi vì đúng một lần hỏng.
   *
   * Ba lời gọi `git` không cần mạng, không cần `gh`, không đụng tài khoản ai: chúng chạy trọn
   * trong thư mục tạm sắp bị xoá. Tức chúng thuộc về đúng cái phần mà chạy khô đã hứa sẽ soi —
   * „mọi việc KHÔNG cần `gh`". Để chúng sau cửa thoát là để nguyên một khoảng mù ngay giữa
   * đường, và ngày 13/08/2026 lỗi đã nằm đúng trong khoảng mù ấy: lời nhắn commit vỡ vì
   * `shell: true` (xem `run`), lượt chạy khô báo xanh, lượt chạy thật chết.
   */
  run("git", ["init", "-q", "-b", "main"], { cwd: staging });
  run("git", ["add", "-A"], { cwd: staging });
  run("git", ["-c", "user.name=auto-hh3d", "-c", "user.email=auto-hh3d@users.noreply.github.com",
    "commit", "-q", "-m", `feat: khôi lỗi tông môn ${workerId}`], { cwd: staging });

  /**
   * `--dry-run` dừng ở ĐÂY, không dừng ở đầu.
   *
   * Bản trước thoát ngay sau khi in kế hoạch, nên nó soi được đúng mấy con số mà người ta vốn đã
   * gõ ra — còn phần duy nhất thật sự có thể sai, danh sách tệp phải chép, thì không lượt chạy
   * khô nào chạm tới. Và đúng chỗ ấy đã sai thật. Giờ chạy khô làm trọn phần dựng: chép, thay
   * WORKER_ID trong workflow, soi đường import, RỒI COMMIT THẬT vào thư mục tạm — tức mọi việc
   * KHÔNG cần `gh`, đúng thứ máy phát triển kiểm được. Chỉ bốn lời gọi `gh` là còn chưa có
   * bằng chứng.
   */
  if (dryRun) {
    const files = [];
    const list = (dir, prefix = "") => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".git") continue;
        const rel = `${prefix}${entry.name}`;
        if (entry.isDirectory()) list(path.join(dir, entry.name), `${rel}/`);
        else files.push(rel);
      }
    };
    list(staging);
    const subject = run("git", ["log", "-1", "--pretty=%s"], { cwd: staging, quiet: true }).trim();
    console.log(`--dry-run: đã dựng thử ${files.length} tệp, soi xong đường import, và commit thử.\n`);
    console.log(files.map((f) => `  ${f}`).join("\n"));
    // In lại lời nhắn ĐỌC TỪ GIT, không in lại chuỗi ta vừa gõ: chỉ bản git đọc ra mới chứng minh
    // được đối số đi qua nguyên vẹn. Đây chính là phép đo mà lỗi 13/08 đã lọt qua vì thiếu.
    console.log(`\n  commit  ${subject}`);
    console.log(`\nKhông tạo kho, không đụng GitHub. Bỏ --dry-run để làm thật.`);
    // Dọn TẠI ĐÂY: `process.exit` không chạy khối `finally` ở cuối tệp, nên mỗi lượt chạy khô sẽ
    // để lại một thư mục tạm vài trăm KB nếu tin vào nó.
    rmSync(staging, { recursive: true, force: true });
    process.exit(0);
  }

  console.log(`\n── Tạo kho ${slug}…`);
  run("gh", ["repo", "create", slug, "--public", "--source", ".", "--push",
    "--description", `Khôi lỗi tông môn ${workerId} — Auto HH3D`], { cwd: staging });

  console.log("── Dán secret WORKER_TOKEN…");
  // Token đi qua STDIN, không qua đối số: đối số nằm trong command line mà ai mở Task Manager
  // cũng đọc được, và trên Windows nó còn phải đi qua phép nối chuỗi của `shell: true`.
  execFileSync("gh", ["secret", "set", "WORKER_TOKEN", "--repo", slug, "--body-file", "-"], {
    input: token,
    stdio: ["pipe", "inherit", "inherit"],
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
