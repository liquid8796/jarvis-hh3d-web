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
import { KHOILOI_ID_PREFIX, REPO_NAME_PREFIX, reviewGeneratedName } from "./khoiloiNaming.mjs";
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
const repoName = arg("repo", REPO_NAME_PREFIX);
/**
 * WORKER_ID mặc định suy từ tên tài khoản, không phải một chuỗi cố định — trùng id thì hai tiến
 * trình ghi đè nhau trong bảng `workers` và mục Khôi Lỗi nói dối về việc ai đang trực. Suy ra
 * từ một thứ vốn đã duy nhất thì không có gì để quên.
 */
const workerId = arg("worker-id", `${KHOILOI_ID_PREFIX}-${owner.toLowerCase()}`);
const slug = `${owner}/${repoName}`;

/**
 * LUẬT TỪ CẤM, đứng trước mọi thứ khác trong tệp này.
 *
 * Kiểm ở ĐÂY chứ không chỉ ở `newGithubStation.mts`, dù lượt gọi thường đi qua bên ấy: tệp này là
 * một cửa vào riêng (`node scripts/newGithubKhoiloi.mjs --owner … --repo …`), và một luật chỉ gác
 * được cửa nó đứng thì không phải luật. Đây cũng là cửa DUY NHẤT mà `--repo` gõ tay đi qua được
 * tới lệnh `gh repo create`.
 */
for (const [what, value] of [
  ["Tên kho", repoName],
  ["WORKER_ID", workerId],
]) {
  const banned = reviewGeneratedName(what, value);
  if (banned) {
    console.error(`${banned}\n\nKHÔNG tạo gì cả, nên không có kho mồ côi nào phải dọn.`);
    process.exit(1);
  }
}

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
 * cài là `gh.exe`, tệp thực thi thật (đo: `C:\Program Files\GitHub CLI\gh.exe`), nên `git` lẫn
 * `gh` đều đi thẳng. Cùng luật với `run` bên deployAllStations: bật shell là NGOẠI LỆ PHẢI CHỨNG
 * MINH, không phải mặc định — và ở tệp này đúng một lời gọi được bật, `npm` khi sinh lockfile.
 *
 * Quả mìn thứ hai cùng loại đã tháo cùng lượt này: `--description` của `gh repo create` cũng mang
 * khoảng trắng và một dấu gạch dài, nên nó sẽ vỡ y hệt ở dòng ngay sau chỗ vừa chết.
 */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    shell: options.shell ?? false,
    timeout: options.timeout ?? 120_000,
    env: options.env ?? process.env,
  });
}

/**
 * Ngủ đồng bộ. Cả tệp này chạy tuần tự bằng `execFileSync`; chen `await` vào chỉ để đợi bốn giây
 * là đổi hình dạng cả script để đổi lấy đúng một chỗ nghỉ.
 */
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Mọi cờ `gh` mà script sắp gọi có THẬT SỰ tồn tại trong bản `gh` dưới máy không.
 *
 * Sinh ra từ một lượt hỏng có giá (13/08/2026): bản trước gọi `gh secret set … --body-file -`,
 * mà `gh secret set` chưa bao giờ có cờ ấy — `--body-file` là của `gh release create`, lạc sang.
 * Nó chỉ lộ ra ở bước ngay SAU `gh repo create --push`, tức sau khi một kho công khai đã nằm trên
 * tài khoản người ta. Đó đúng là thứ mà lời thề「MỌI PHÉP KIỂM ĐỨNG TRƯỚC MỌI PHÉP TẠO」của
 * `newGithubStation.mts` sinh ra để tránh, và nó đã không với tới được vì bốn lời gọi `gh` nằm
 * ngoài tầm mọi phép kiểm.
 *
 * Hỏi thẳng `gh` thay vì ghim một số hiệu bản: cờ đến rồi đi giữa các bản, còn `--help` thì luôn
 * nói sự thật của đúng cái `gh` sắp chạy. Ranh giới `\b` là BẮT BUỘC — thiếu nó thì `--repo`
 * khớp nhầm vào `--repos` nằm ngay trên cùng trang help của `gh secret set`.
 */
function assertGhSupportsPlannedCalls() {
  const planned = [
    { cmd: ["repo", "create"], flags: ["--public", "--source", "--push", "--description"] },
    { cmd: ["secret", "set"], flags: ["--repo"] },
    { cmd: ["workflow", "run"], flags: ["--repo"] },
  ];

  const missing = [];
  for (const { cmd, flags } of planned) {
    let help;
    try {
      help = run("gh", [...cmd, "--help"], { quiet: true });
    } catch {
      missing.push(`  gh ${cmd.join(" ")} — bản gh này không có lệnh ấy`);
      continue;
    }
    for (const flag of flags) {
      if (!new RegExp(`${flag}\\b`).test(help)) {
        missing.push(`  gh ${cmd.join(" ")} ${flag}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      "`gh` dưới máy không hiểu những thứ script sắp gọi:\n" +
        missing.join("\n") +
        "\n\nNâng cấp: winget upgrade --id GitHub.cli — hoặc sửa lời gọi cho khớp.\n" +
        "KHÔNG tạo gì cả, nên không có kho mồ côi nào phải dọn.",
    );
    process.exit(1);
  }
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
  // Đứng ngay sau phép hỏi danh tính và TRƯỚC mọi thứ được tạo ra ở bất cứ đâu.
  assertGhSupportsPlannedCalls();
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
        // Tên gói đi theo tên kho: cả hai đều là thứ người lạ đọc được, và cả hai đều nghe luật
        // ở `khoiloiNaming.mjs`. `name` của npm bắt buộc chữ thường không khoảng trắng — `linh-su`
        // hợp lệ sẵn, nên không cần phép chuẩn hoá nào ở đây.
        name: REPO_NAME_PREFIX,
        private: true,
        version: "1.0.0",
        type: "module",
        description: "Tiến trình nền của tông môn — chạy theo lịch.",
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
    // README nằm ngay trang đầu của một kho CÔNG KHAI, nên nó là chỗ dễ nói hớ nhất. Giữ đúng
    // một việc nó phải làm — dặn người mở kho đừng sửa tay — và bỏ mọi thứ chỉ đường về tông môn:
    // tên script phát hành, và cả cái tên nền tảng đang chạy nó.
    `# Tông môn — ${workerId}\n\n` +
      `Một tiến trình nền nhận việc theo lịch từ ${webUrl}.\n` +
      `Kho này được SINH TỰ ĐỘNG từ kho gốc — **đừng sửa tay ở đây**, sửa ở kho gốc rồi dựng lại,\n` +
      `bằng không hai bản sẽ trôi khỏi nhau.\n`,
  );

  writeFileSync(path.join(staging, ".gitignore"), "node_modules/\n.env\n");

  /**
   * SINH `package-lock.json`. Thiếu nó thì kho phát ra chết ở bước THỨ HAI, trước khi worker kịp
   * chạy một dòng — và chết hai lần khác nhau, nên bỏ một chỗ là vẫn hỏng ở chỗ kia:
   *
   *   • `actions/setup-node@v4` với `cache: npm` →
   *     „##[error]Dependencies lock file is not found … Supported file patterns:
   *      package-lock.json,npm-shrinkwrap.json,yarn.lock"
   *   • `npm ci` → từ chối chạy khi không có lockfile, theo thiết kế của chính nó.
   *
   * Đo 13/08/2026 trên kho `…-100055-69a9`: lượt chạy đầu đỏ ở đúng dòng ấy sau 6 giây, dù kho,
   * secret và dòng sổ đều đã xong xuôi.
   *
   * Vá bằng cách SINH LOCKFILE, không phải bằng cách sửa workflow (bỏ `cache: npm`, đổi `npm ci`
   * thành `npm install`). Hai lẽ: workflow phải giữ NGUYÊN bản của repo web — mỗi phép thay thêm
   * là thêm một đường cho hai bản trôi khỏi nhau, đúng điều đã thề ở chỗ vá WORKER_ID; và `npm ci`
   * có lý của nó, kho phát ra phải cài đúng một bản playwright-core mỗi lượt thay vì trôi theo `^`.
   *
   * `--package-lock-only` chỉ GIẢI cây phụ thuộc rồi ghi lockfile, không tải `node_modules` —
   * vài giây, không phải vài phút.
   *
   * Đây là lời gọi DUY NHẤT trong tệp còn bật shell, và nó bắt buộc: trên Windows `npm` là một
   * tệp `.cmd`, mà từ Node 20 (CVE-2024-27980) `spawn` từ chối chạy .cmd nếu không qua shell. An
   * toàn ở đây vì mọi đối số là chuỗi cố định không khoảng trắng; thứ duy nhất thay đổi giữa các
   * lượt — `cwd` — đi bằng tuỳ chọn của spawn chứ không nằm trên dòng lệnh.
   */
  console.log("── Giải cây phụ thuộc (package-lock.json)…");
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
    cwd: staging,
    quiet: true,
    shell: true,
    timeout: 180_000,
  });
  if (!existsSync(path.join(staging, "package-lock.json"))) {
    throw new Error(
      "npm không sinh ra package-lock.json — kho phát ra sẽ chết ở bước setup-node. Dừng ở đây,\n" +
        "trên máy này, thay vì bỏ lại một kho công khai không dựng nổi.",
    );
  }

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
  // Tác giả commit hiện trên MỌI dòng lịch sử của kho công khai — cùng luật với tên kho. Phần
  // `@users.noreply.github.com` thì giữ: đó là tên miền GitHub bắt buộc dùng để một commit không
  // bị nối vào hộp thư thật của ai, không phải một cái tên ta chọn.
  run("git", ["-c", "user.name=linh-su", "-c", "user.email=linh-su@users.noreply.github.com",
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
    "--description", `Tiến trình nền theo lịch — ${workerId}`], { cwd: staging });

  console.log("── Dán secret WORKER_TOKEN…");
  // Token đi qua STDIN, không qua đối số: đối số nằm trong command line mà ai mở Task Manager
  // cũng đọc được. (Vế thứ hai của lời bình cũ — „còn phải đi qua phép nối chuỗi của
  // `shell: true`" — đã hết đúng từ 13/08/2026, xem `run`. Lý do thứ nhất tự nó đã đủ.)
  //
  // KHÔNG có `--body-file`: `gh secret set` đọc THẲNG stdin khi vắng `--body` — help của nó nói
  // „reads from standard input if not specified", và nêu ví dụ `gh secret set MYSECRET < file`.
  // Bản trước gọi `--body-file -`, một cờ của `gh release create` lạc sang đây; nó chết ở đúng
  // bước SAU `gh repo create --push`, bỏ lại một kho công khai không secret. Xem
  // `assertGhSupportsPlannedCalls`, thứ sinh ra từ chính lượt hỏng ấy.
  execFileSync("gh", ["secret", "set", "WORKER_TOKEN", "--repo", slug], {
    input: token,
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 60_000,
  });

  console.log("── Bấm chạy lượt đầu…");
  /**
   * Cú bấm này KHÔNG được phép giết cả lượt dựng.
   *
   * Tới dòng này kho đã có mã và đã có secret — tức khôi lỗi SẼ lên ca, muộn nhất ở mốc
   * `schedule` kế (4 giờ một lần). Ném ở đây nghĩa là vứt cả lượt chạy, bỏ lại một kho công khai
   * ĐANG DÙNG ĐƯỢC và không ghi được dòng sổ nào — trả một cái giá lớn cho một cú bấm cho nhanh.
   * Nên nó hạ xuống thành cảnh báo, và dòng tổng kết ở dưới nói thật là đã bấm được hay chưa.
   *
   * Có thử lại vì GitHub cần một nhịp để đăng ký workflow của kho vừa sinh: gọi ngay sau `--push`
   * hay trả „could not find any workflows named linh-su.yml".
   */
  let dispatched = false;
  for (let attempt = 1; attempt <= 3 && !dispatched; attempt += 1) {
    try {
      run("gh", ["workflow", "run", "linh-su.yml", "--repo", slug], { cwd: staging, quiet: true });
      dispatched = true;
    } catch (err) {
      if (attempt < 3) {
        sleepSync(4_000);
        continue;
      }
      const why = String(err.stderr || err.message).trim().split("\n")[0];
      console.warn(
        `\n⚠ Không bấm chạy được lượt đầu: ${why}\n` +
          `  Kho và secret ĐÃ XONG, nên đây không phải hỏng — chỉ là chưa chạy ngay.\n` +
          `  Muốn chạy ngay: https://github.com/${slug}/actions → „Khôi lỗi tông môn (GitHub)" → Run workflow.`,
      );
    }
  }

  console.log(
    `\n✔ Xong. ${workerId} ${dispatched ? "đang lên ca" : "sẽ lên ca ở mốc schedule kế (≤ 4 giờ)"}.\n` +
      `  Theo dõi: https://github.com/${slug}/actions\n` +
      `  Nghiệm thu: mở Hàng Đợi → tab Khôi Lỗi, phải thấy ${workerId} điểm danh trong ~4 phút.\n`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
