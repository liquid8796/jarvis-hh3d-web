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
 *   1. `gh` đã cài, và có ĐÚNG MỘT cái chìa dùng được — hoặc biến `GH_TOKEN` (lối mà
 *      `newGithubStation.mts` đi: nó dán PAT vào biến ấy rồi gọi xuống đây), hoặc một lượt
 *      `gh auth login` đúng tài khoản đích (nhiều tài khoản thì `gh auth switch --user <login>`
 *      trước khi chạy). Một dòng keyring cũ đã hỏng KHÔNG cản — xem `assertGhCanAuthenticate`.
 *   2. `.env` ở gốc repo có `WORKER_TOKEN` — lấy bằng
 *      `vercel env pull .env --environment=production --yes`.
 *      KHÔNG dùng `npm run env:pull`: lệnh ấy kéo môi trường development, nơi biến này không tồn tại.
 *
 * ĐỌC TRƯỚC KHI CHẠY: repo tạo ra là CÔNG KHAI, và nhật ký Actions của repo công khai thì ai
 * cũng đọc được, vĩnh viễn — trong khi việc của khôi lỗi là nhận cookie game đã giải mã. Đây là
 * đánh đổi đã được cân nhắc và chấp nhận; xem deploy/github-actions.md mục 6.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomSoftwareName, reviewGeneratedName } from "./khoiloiNaming.mjs";
import {
  buildKhoiloiPayload,
  playwrightVersionOf,
  uncommittedPayloadPaths,
} from "./khoiloiPayload.mjs";
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
/**
 * Không truyền `--repo` thì tự rút một cái tên ngẫu nhiên, và `--worker-id` mặc định lấy ĐÚNG cái
 * tên ấy — xem `randomSoftwareName`. Bản trước lấy tên tài khoản làm id ("…-<owner>"), tức dán
 * tên người ta lên một thứ công khai mà chẳng được gì thêm về mặt duy nhất.
 */
const generatedName = randomSoftwareName();
const repoName = arg("repo", generatedName);
/**
 * WORKER_ID mặc định suy từ tên tài khoản, không phải một chuỗi cố định — trùng id thì hai tiến
 * trình ghi đè nhau trong bảng `workers` và mục Khôi Lỗi nói dối về việc ai đang trực. Suy ra
 * từ một thứ vốn đã duy nhất thì không có gì để quên.
 */
const workerId = arg("worker-id", repoName === generatedName ? generatedName : repoName);
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

/**
 * `gh` có xác thực được NGAY BÂY GIỜ không — hỏi bằng ĐÚNG cái chìa mà lượt chạy thật sẽ cầm.
 *
 * KHÔNG hỏi `gh auth status`, và đây là một chỗ đã hỏng thật (13/08/2026, 15:31): `auth status`
 * chấm điểm MỌI tài khoản `gh` từng cất, rồi trả mã 1 nếu BẤT CỨ cái nào hỏng — kể cả một dòng
 * keyring cũ đã bị thu hồi, thứ đứng hoàn toàn ngoài lượt chạy này. Máy dựng kho hôm ấy đúng cảnh
 * đó: PAT trong `GH_TOKEN` hoàn toàn tốt — `newGithubStation.mts` vừa suy ra tên tài khoản từ
 * chính nó bằng `GET /user`, và tên ấy đã in ra trong kế hoạch — nhưng keyring còn một dòng chết
 * mang cùng tên tài khoản, nên cổng đóng sập trước khi có gì được tạo. Một lượt chạy đúng bị từ
 * chối vì một thứ không liên quan, và câu chỉ dẫn còn bảo người ta đi `gh auth login` — đúng lối
 * mà thiết kế này cố ý không dùng.
 *
 * `gh api user` hỏi đúng một câu, và là câu duy nhất đáng hỏi: cái chìa `gh` sắp cầm — `GH_TOKEN`,
 * `GITHUB_TOKEN`, hay dòng keyring đang hoạt động, theo đúng thứ tự ưu tiên của `gh` — có mở được
 * cửa không. Nó phủ CẢ HAI cửa vào: qua `newGithubStation.mts` (có PAT) lẫn gọi tay (dùng keyring).
 *
 * Không kèm cờ nào: mỗi cờ là một thứ có thể không tồn tại trong bản `gh` dưới máy — đúng loại
 * hỏng mà `assertGhSupportsPlannedCalls` sinh ra để bắt. `quiet` đã nuốt phần thân trả lời rồi.
 */
function assertGhCanAuthenticate() {
  try {
    run("gh", ["api", "user"], { quiet: true });
  } catch (err) {
    // `stderr` là câu của chính `gh` (401, hết hạn, thiếu quyền); vắng nó thì lỗi nằm ở lượt gọi
    // — `gh` chưa cài sẽ về đây dưới dạng ENOENT trong `message`. Giữ cả hai, đừng nuốt.
    const detail = String(err?.stderr || err?.message || "").trim();
    console.error(
      "`gh` không xác thực được với GitHub.\n" +
        (detail.length > 0 ? `\n${detail}\n` : "") +
        "\n  Qua npm run github:new — PAT vừa dán sai, đã bị thu hồi, hoặc không đọc nổi tài khoản.\n" +
        "  Gọi tay tệp này — đặt biến GH_TOKEN, hoặc `gh auth login` đúng tài khoản đích\n" +
        "  (nhiều tài khoản: `gh auth switch --user <login>` — nhớ đúng tài khoản sẽ giữ kho này).\n" +
        "  Chưa cài `gh`: https://cli.github.com  ·  winget install --id GitHub.cli\n" +
        "\n  Một dòng keyring cũ đã hỏng KHÔNG còn chặn được lượt chạy này — chỉ cái chìa thật sự\n" +
        "  dùng mới tính. Dọn dòng chết ấy (không bắt buộc): gh auth logout -h github.com -u <login>\n" +
        "\nKHÔNG tạo gì cả, nên không có kho mồ côi nào phải dọn.",
    );
    process.exit(1);
  }
}

const playwrightVersion = playwrightVersionOf(repoRoot);

console.log(
  `Sắp dựng khôi lỗi GitHub:\n` +
    `  kho        ${slug} (CÔNG KHAI)\n` +
    `  worker id  ${workerId}\n` +
    `  web        ${webUrl}\n` +
    `  engine     playwright-core ${playwrightVersion}\n`,
);

/**
 * Phép kiểm `gh` đứng SAU lượt chạy khô, không đứng trước.
 *
 * `--dry-run` sinh ra để soi kế hoạch — trên một máy chưa cài `gh`, trong lúc còn đang cân nhắc
 * có làm hay không. Chặn nó bằng một điều kiện tiên quyết của bước THỰC THI là lấy mất đúng
 * công dụng của nó. Lượt chạy thật thì vẫn hỏng sớm, ngay đây, trước khi tạo bất cứ thứ gì.
 *
 * Kiểm xác thực chứ không kiểm `--version`: có `gh` mà không có chìa dùng được là ca hay gặp hơn
 * hẳn, và nó hỏng ở tận bước tạo repo — sau khi đã dựng xong thư mục tạm.
 */
if (!dryRun) {
  // Cả hai đứng TRƯỚC mọi thứ được tạo ra ở bất cứ đâu: chìa có mở được cửa không, rồi `gh` có
  // hiểu những lời sắp gọi không.
  assertGhCanAuthenticate();
  assertGhSupportsPlannedCalls();
}

const staging = mkdtempSync(path.join(tmpdir(), "khoiloi-"));
try {
  /**
   * Cây tệp của kho mới do `khoiloiPayload.mjs` dựng — MỘT nguồn sự thật, dùng chung với lượt
   * PHÁT HÀNH (`deployGithubKhoiloi.mts`). Trước 14/08/2026 danh sách tệp nằm ngay đây, và thế là
   * đủ vì chỉ có MỘT lối đặt tệp vào một kho khôi lỗi. Nay có hai, và hai bản chép của cùng một
   * danh sách là hẹn ngày một kho vừa phát hành khác một kho vừa dựng — trong khi cả hai lượt
   * đều báo xanh.
   *
   * Bytes lấy từ blob HEAD chứ không từ cây làm việc (lý do đầy đủ ở đầu `khoiloiPayload.mjs`).
   * Nên việc dở CHƯA COMMIT không lên kho — và điều đó phải được NÓI RA, chứ không để người vừa
   * gõ xong một bản vá tự đoán vì sao kho mới không có nó.
   */
  const chuaCommit = uncommittedPayloadPaths(repoRoot);
  if (chuaCommit.length > 0) {
    console.warn(
      `⚠ ${chuaCommit.length} tệp trong phạm vi gói đang có thay đổi CHƯA COMMIT. Kho mới sẽ mang ` +
        "bản đã commit (HEAD), KHÔNG mang những sửa đổi này:\n" +
        chuaCommit.map((f) => `    ${f}`).join("\n") +
        "\n",
    );
  }

  // Lượt giải cây phụ thuộc nằm bên trong `buildKhoiloiPayload`; báo trước vì nó là bước lâu nhất
  // của cả lượt dựng — npm phải hỏi registry.
  console.log("── Dựng gói + giải cây phụ thuộc (package-lock.json)…");
  const payload = buildKhoiloiPayload({ repoRoot, workerId, webUrl });

  for (const [rel, bytes] of payload) {
    const full = path.join(staging, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }

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
