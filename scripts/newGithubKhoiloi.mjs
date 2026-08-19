#!/usr/bin/env node
/**
 * DỰNG BUNDLE GITHUB MỚI — một khôi lỗi và hai software repo, từ repo trắng tới lượt chạy đầu.
 *
 *   node scripts/newGithubKhoiloi.mjs --owner <tài-khoản> [--repo tên] [--worker-id id]
 *     [--companion-repo tên-1 --companion-repo tên-2]
 *   node scripts/newGithubKhoiloi.mjs --owner <tài-khoản> --dry-run    # in kế hoạch, không làm gì
 *
 * VÌ SAO CÓ TỆP NÀY: mỗi tài khoản GitHub là một quỹ phút Actions riêng, nên thêm một tài khoản
 * là thêm một khôi lỗi tông môn nữa mà không tốn đồng nào. Mỗi lượt còn cần hai repo software
 * có source thật để vòng nuôi duy trì hằng ngày. Việc dựng thì lặp đi lặp lại — tạo ba repo,
 * chép đúng payload, dán secret, bấm chạy — và「lặp đi lặp lại」là chỗ để quên: quên
 * `--public` thì mất quỹ phút miễn phí, quên đổi WORKER_ID thì hai tiến trình ghi đè nhau trong
 * bảng `workers`.
 *
 * KHO KHÔI LỖI KHÔNG PHẢI BẢN SAO CỦA WEB REPO. Worker chỉ cần `scripts/worker.mjs`, toàn bộ
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
 *      trước khi chạy). Token phải là classic PAT có `repo` + `workflow` + `delete_repo`; scope
 *      cuối là điều kiện để rollback bundle hỏng. Fine-grained bị từ chối vì không chứng minh
 *      được quyền xoá trước khi repo mới tồn tại. Xem `assertGhCanAuthenticate`/`assertGhCanRollback`.
 *   2. `.env` ở gốc repo có `WORKER_TOKEN` — lấy bằng
 *      `vercel env pull .env --environment=production --yes`.
 *      KHÔNG dùng `npm run env:pull`: lệnh ấy kéo môi trường development, nơi biến này không tồn tại.
 *
 * ĐỌC TRƯỚC KHI CHẠY: cả ba repo tạo ra là CÔNG KHAI, và nhật ký Actions của repo chính thì ai
 * cũng đọc được, vĩnh viễn — trong khi việc của khôi lỗi là nhận cookie game đã giải mã. Đây là
 * đánh đổi đã được cân nhắc và chấp nhận; xem deploy/github-actions.md mục 6.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  randomDistinctSoftwareNames,
  randomSoftwareName,
  reviewGeneratedName,
} from "./khoiloiNaming.mjs";
import { buildCompanionProjects, COMPANION_REPO_COUNT } from "./companionProject.mjs";
import {
  oauthScopesFromGhApiOutput,
  publishConfirmedRepository,
  repoProbeResultFromFailure,
  reviewBundlePatScopes,
} from "./githubBundleSafety.mjs";
import { looksTransient } from "./githubTransient.mjs";
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
const args = (name) => argv.flatMap((value, index) =>
  value === `--${name}` && argv[index + 1] && !argv[index + 1].startsWith("--") ? [argv[index + 1]] : []);

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
const companionFlagCount = argv.filter((value) => value === "--companion-repo").length;
const suppliedCompanionRepos = args("companion-repo");
if (companionFlagCount !== suppliedCompanionRepos.length) {
  console.error("Mỗi cờ --companion-repo phải có một tên ngay sau nó.\nKHÔNG tạo gì cả.");
  process.exit(1);
}
if (suppliedCompanionRepos.length !== 0 && suppliedCompanionRepos.length !== COMPANION_REPO_COUNT) {
  console.error(
    `Cần đúng ${COMPANION_REPO_COUNT} cờ --companion-repo, hoặc không truyền cờ nào để script tự sinh.\n` +
      `  Đã nhận ${suppliedCompanionRepos.length}: ${suppliedCompanionRepos.join(", ") || "(trống)"}\n` +
      "KHÔNG tạo gì cả.",
  );
  process.exit(1);
}
const companionRepoNames = suppliedCompanionRepos.length === COMPANION_REPO_COUNT
  ? suppliedCompanionRepos
  : randomDistinctSoftwareNames(COMPANION_REPO_COUNT, [repoName, workerId]);
const bundleRepoNames = [repoName, ...companionRepoNames];
if (new Set(bundleRepoNames.map((name) => name.toLowerCase())).size !== bundleRepoNames.length) {
  console.error(`Ba tên repo trong bundle phải khác nhau: ${bundleRepoNames.join(", ")}\nKHÔNG tạo gì cả.`);
  process.exit(1);
}

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
  ...companionRepoNames.map((name, index) => [`Tên kho phụ ${index + 1}`, name]),
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

/** Song sinh với `IDENTITY_ATTEMPTS`/`IDENTITY_BACKOFF_MS` của `newGithubStation.mts`. */
const GH_ATTEMPTS = 3;
const GH_BACKOFF_MS = 2_000;

/**
 * Gọi `gh` và THỬ LẠI khi GitHub chỉ đang nấc — dành cho những bước mà một cú hỏng để lại rác
 * ngoài đời thật.
 *
 * VÌ SAO CÓ NÓ (đo 17/08/2026, log của tông chủ): `gh secret set` trúng một cú
 * `HTTP 503: No server is currently available…` và cả lượt dựng chết — bỏ lại một kho CÔNG KHAI
 * đã có mã, đã push, mà KHÔNG có secret, tức một khôi lỗi không bao giờ xác thực nổi. Bước ngay
 * dưới (`gh workflow run`) đã có vòng thử lại từ trước; bước dán secret thì không, dù nó mới là
 * bước mà một cú hỏng phải trả giá đắt nhất.
 *
 * Bắt stderr về (`pipe`) thay vì để nó chảy thẳng ra màn hình: không có văn bản thì không phân
 * loại được thoáng-qua với hỏng-thật — đúng chỗ log hôm ấy chỉ còn `stderr: null`. Bù lại, phải
 * TỰ IN nó ra, và in ở MỌI lượt hỏng, để người đọc không mất một dòng nào so với trước.
 */
function runWithRetry(label, cmd, args, options = {}) {
  const decide = options.shouldRetry ?? ((why) => looksTransient(why));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync(cmd, args, {
        cwd: options.cwd ?? repoRoot,
        encoding: "utf8",
        input: options.input,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        timeout: options.timeout ?? 60_000,
        env: options.env ?? process.env,
      });
    } catch (err) {
      const why = [err.stderr, err.stdout, err.message].map((p) => String(p ?? "").trim()).filter(Boolean).join("\n");
      if (why) console.error(why);
      if (attempt >= GH_ATTEMPTS || !decide(why)) throw err;
      console.error(
        `  … ${label}: GitHub đang nấc, thử lại lần ${attempt + 1}/${GH_ATTEMPTS} sau ${GH_BACKOFF_MS / 1000}s`,
      );
      sleepSync(GH_BACKOFF_MS);
    }
  }
}

/**
 * Kho ấy đã nằm trên GitHub chưa: `"yes"` · `"no"` · `"unknown"`.
 *
 * Ba trạng thái chứ không phải hai, và trạng thái thứ ba là lý do tồn tại của hàm này: giữa một
 * cơn sự cố của GitHub thì chính LỜI HỎI cũng có thể trả 5xx, mà đọc「hỏi không được」thành
 *「chưa có」là cách người ta tạo ra hai kho trong một lượt chạy. `gh repo view` thoát khác 0 ở cả
 * hai ca ấy, nên phải đọc CHỮ mới phân biệt được.
 */
function probeRepoExistence(slug) {
  try {
    execFileSync("gh", ["repo", "view", slug, "--json", "name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return "yes";
  } catch (err) {
    const why = [err.stderr, err.stdout, err.message].map((p) => String(p ?? "").trim()).filter(Boolean).join("\n");
    return repoProbeResultFromFailure(why);
  }
}

/**
 * Mọi cờ `gh` mà script sắp gọi có THẬT SỰ tồn tại trong bản `gh` dưới máy không.
 *
 * Sinh ra từ một lượt hỏng có giá (13/08/2026): bản trước gọi `gh secret set … --body-file -`,
 * mà `gh secret set` chưa bao giờ có cờ ấy — `--body-file` là của `gh release create`, lạc sang.
 * Nó chỉ lộ ra ở bước ngay SAU `gh repo create --push`, tức sau khi một kho công khai đã nằm trên
 * tài khoản người ta. Đó đúng là thứ mà lời thề「MỌI PHÉP KIỂM ĐỨNG TRƯỚC MỌI PHÉP TẠO」của
 * `newGithubStation.mts` sinh ra để tránh, và nó đã không với tới được vì các lời gọi `gh` nằm
 * ngoài tầm mọi phép kiểm.
 *
 * Hỏi thẳng `gh` thay vì ghim một số hiệu bản: cờ đến rồi đi giữa các bản, còn `--help` thì luôn
 * nói sự thật của đúng cái `gh` sắp chạy. Ranh giới `\b` là BẮT BUỘC — thiếu nó thì `--repo`
 * khớp nhầm vào `--repos` nằm ngay trên cùng trang help của `gh secret set`.
 */
function assertGhSupportsPlannedCalls() {
  const planned = [
    { cmd: ["repo", "create"], flags: ["--public", "--description"] },
    { cmd: ["repo", "delete"], flags: ["--yes"] },
    { cmd: ["secret", "set"], flags: ["--repo"] },
    { cmd: ["workflow", "run"], flags: ["--repo"] },
    { cmd: ["auth", "git-credential"], flags: [] },
    { cmd: ["api"], flags: ["--include"] },
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

/** Direct callers must prove rollback permission too; the TypeScript wrapper is not a trust wall. */
function assertGhCanRollback() {
  let response;
  try {
    response = run("gh", ["api", "--include", "user"], { quiet: true });
  } catch (err) {
    const detail = String(err?.stderr || err?.message || "").trim();
    console.error(
      "Không đọc được scope của PAT để chứng minh quyền rollback.\n" +
        (detail ? `\n${detail}\n` : "") +
        "\nKHÔNG tạo gì cả.",
    );
    process.exit(1);
  }
  const review = reviewBundlePatScopes(oauthScopesFromGhApiOutput(response));
  if (!review.ok) {
    console.error(
      `${review.message}\n` +
        "  Dùng token classic có repo + workflow + delete_repo rồi chạy lại.\n" +
        "  KHÔNG tạo gì cả; script không bắt đầu một transaction mà nó chưa chắc rollback được.",
    );
    process.exit(1);
  }
}

const playwrightVersion = playwrightVersionOf(repoRoot);

console.log(
  `Sắp dựng bundle GitHub gồm 3 kho CÔNG KHAI:\n` +
    `  khôi lỗi   ${slug}\n` +
    `  software 1 ${owner}/${companionRepoNames[0]}\n` +
    `  software 2 ${owner}/${companionRepoNames[1]}\n` +
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
  assertGhCanRollback();
}

const stagingRoot = mkdtempSync(path.join(tmpdir(), "khoiloi-bundle-"));
const staging = path.join(stagingRoot, "worker");
mkdirSync(staging, { recursive: true });
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

  console.log("── Dựng hai ứng dụng TypeScript độc lập…");
  const companionProjects = buildCompanionProjects({ repoNames: companionRepoNames });
  const stagedRepos = [
    {
      kind: "worker",
      repoName,
      slug,
      cwd: staging,
      description: `Scheduled background task runner — ${workerId}`,
      commit: "feat: initialize scheduled task runner",
    },
    ...companionProjects.map((project, index) => {
      const cwd = path.join(stagingRoot, `software-${index + 1}`);
      mkdirSync(cwd, { recursive: true });
      for (const [rel, bytes] of project.files) {
        const full = path.join(cwd, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, bytes);
      }
      return {
        kind: "companion",
        repoName: project.repoName,
        slug: `${owner}/${project.repoName}`,
        cwd,
        description: project.theme.tagline,
        commit: `feat: launch ${project.theme.product}`,
        theme: project.theme,
      };
    }),
  ];

  /**
   * Lượt commit đầu nằm TRƯỚC cửa `--dry-run`, không sau — và chỗ này đổi vì đúng một lần hỏng.
   *
   * Ba lời gọi `git` không cần mạng, không cần `gh`, không đụng tài khoản ai: chúng chạy trọn
   * trong thư mục tạm sắp bị xoá. Tức chúng thuộc về đúng cái phần mà chạy khô đã hứa sẽ soi —
   * „mọi việc KHÔNG cần `gh`". Để chúng sau cửa thoát là để nguyên một khoảng mù ngay giữa
   * đường, và ngày 13/08/2026 lỗi đã nằm đúng trong khoảng mù ấy: lời nhắn commit vỡ vì
   * `shell: true` (xem `run`), lượt chạy khô báo xanh, lượt chạy thật chết.
   */
  for (const repo of stagedRepos) {
    run("git", ["init", "-q", "-b", "main"], { cwd: repo.cwd });
    run("git", ["add", "-A"], { cwd: repo.cwd });
    // Use a neutral public identity and English commit messages in all three repositories.
    run("git", ["-c", "user.name=project-maintainer", "-c", "user.email=project-maintainer@users.noreply.github.com",
      "commit", "-q", "-m", repo.commit], { cwd: repo.cwd });
  }

  /**
   * `--dry-run` dừng ở ĐÂY, không dừng ở đầu.
   *
   * Bản trước thoát ngay sau khi in kế hoạch, nên nó soi được đúng mấy con số mà người ta vốn đã
   * gõ ra — còn phần duy nhất thật sự có thể sai, danh sách tệp phải chép, thì không lượt chạy
   * khô nào chạm tới. Và đúng chỗ ấy đã sai thật. Giờ chạy khô làm trọn phần dựng: chép, thay
   * WORKER_ID trong workflow, soi đường import, RỒI COMMIT THẬT vào thư mục tạm — tức mọi việc
   * KHÔNG cần `gh`, đúng thứ máy phát triển kiểm được. Chỉ các bước mạng qua `gh` là còn chưa có
   * bằng chứng.
   */
  if (dryRun) {
    const list = (dir, prefix = "") => {
      const files = [];
      const walk = (current, currentPrefix = "") => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name === ".git") continue;
          const rel = `${currentPrefix}${entry.name}`;
          if (entry.isDirectory()) walk(path.join(current, entry.name), `${rel}/`);
          else files.push(rel);
        }
      };
      walk(dir, prefix);
      return files;
    };
    console.log("--dry-run: đã dựng và commit thử trọn bundle:\n");
    for (const repo of stagedRepos) {
      const files = list(repo.cwd);
      const subject = run("git", ["log", "-1", "--pretty=%s"], { cwd: repo.cwd, quiet: true }).trim();
      console.log(`  ${repo.slug} — ${files.length} files — ${subject}`);
      console.log(files.map((file) => `    ${file}`).join("\n"));
      console.log("");
    }
    console.log(`\nKhông tạo kho, không đụng GitHub. Bỏ --dry-run để làm thật.`);
    // Dọn TẠI ĐÂY: `process.exit` không chạy khối `finally` ở cuối tệp, nên mỗi lượt chạy khô sẽ
    // để lại một thư mục tạm vài trăm KB nếu tin vào nó.
    rmSync(stagingRoot, { recursive: true, force: true });
    process.exit(0);
  }

  // Soi cả ba tên trước khi tạo cái đầu tiên. Nếu một tên đã tồn tại, tuyệt đối không được để
  // nhánh cleanup hiểu nhầm nó là repo vừa sinh rồi xoá tài sản có sẵn của người dùng.
  for (const repo of stagedRepos) {
    const existence = probeRepoExistence(repo.slug);
    if (existence === "yes") {
      throw new Error(`Repo ${repo.slug} đã tồn tại trước lượt dựng — dừng trước khi tạo bundle.`);
    }
    if (existence === "unknown") {
      throw new Error(`Không xác định được ${repo.slug} đã tồn tại hay chưa — dừng để tránh tạo/xoá nhầm.`);
    }
  }

  const createdSlugs = [];
  const rememberCreated = (createdSlug) => {
    if (!createdSlugs.includes(createdSlug)) createdSlugs.push(createdSlug);
  };
  const cleanupBundle = () => {
    if (createdSlugs.length === 0) return;
    console.error(`\n✖ Bundle hỏng giữa chừng — dọn ${createdSlugs.length} repo do chính lượt này tạo…`);
    for (const createdSlug of [...createdSlugs].reverse()) {
      try {
        runWithRetry("xoá repo dở", "gh", ["repo", "delete", createdSlug, "--yes"], { timeout: 60_000 });
        console.error(`  đã xoá ${createdSlug}`);
      } catch {
        console.error(
          `  KHÔNG xoá được ${createdSlug} dù preflight đã thấy delete_repo (quyền vừa đổi hoặc GitHub lỗi) — xoá tay:\n` +
            `    https://github.com/${createdSlug}/settings`,
        );
      }
    }
  };

  try {
    // Tạo hai software repo trước. Repo khôi lỗi chỉ xuất hiện khi đủ nền nuôi; vậy một lỗi sớm
    // không để lại một worker đã chạy nhưng sổ chưa có đủ hai repo phụ.
    const creationOrder = [...stagedRepos.filter((repo) => repo.kind === "companion"), stagedRepos[0]];
    for (const repo of creationOrder) {
      console.log(`\n── Tạo kho ${repo.slug}…`);
      try {
        publishConfirmedRepository({
          repository: repo,
          // CREATE KHÔNG retry: đây là lời gọi không idempotent. Nếu kết nối rơi sau khi GitHub
          // nhận lệnh nhưng trước khi trả lời, ta không thể chứng minh repo ấy do lượt này tạo.
          create: (candidate) => run("gh", ["repo", "create", candidate.slug, "--public",
            "--description", candidate.description], { cwd: candidate.cwd }),
          // Chỉ dòng này trao quyền cleanup, và nó chỉ chạy sau mã thoát thành công của CREATE.
          remember: rememberCreated,
          // PUSH tách riêng và có thể retry: đẩy cùng commit vào cùng ref là idempotent. Credential
          // helper gọi `gh`, nên PAT vẫn nằm trong GH_TOKEN chứ không rơi vào command line.
          push: (candidate) => runWithRetry("đẩy source", "git", [
            "-c", "credential.helper=",
            "-c", "credential.https://github.com.helper=!gh auth git-credential",
            "push", `https://github.com/${candidate.slug}.git`, "main:main",
          ], {
            cwd: candidate.cwd,
            timeout: 120_000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          }),
        });
      } catch (err) {
        if (!createdSlugs.includes(repo.slug)) {
          console.error(
            `\n⚠ Lệnh create cho ${repo.slug} không trả thành công. KHÔNG tự probe-rồi-xoá tên ấy: ` +
              "kết quả đang mơ hồ và một repo cùng tên có thể thuộc về lượt khác.\n" +
              `  Sau khi GitHub ổn định, tự kiểm tra: https://github.com/${repo.slug}`,
          );
        }
        throw err;
      }
    }

    console.log("── Dán secret WORKER_TOKEN vào kho khôi lỗi…");
    // Token đi qua STDIN, không qua đối số: đối số nằm trong command line mà ai mở Task Manager
    // cũng đọc được. `gh secret set` đọc thẳng stdin khi vắng `--body`; không có `--body-file`.
    // Một lỗi hết retry ở đây rollback cả bundle để không giữ lại repo chính thiếu secret.
    runWithRetry("dán secret", "gh", ["secret", "set", "WORKER_TOKEN", "--repo", slug], {
      input: token,
      timeout: 60_000,
    });
  } catch (err) {
    cleanupBundle();
    throw err;
  }

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
    `\n✔ Xong bundle 3 repo. ${workerId} ${dispatched ? "đang lên ca" : "sẽ lên ca ở mốc schedule kế (≤ 4 giờ)"}.\n` +
      `  Theo dõi: https://github.com/${slug}/actions\n` +
      `  Software: https://github.com/${owner}/${companionRepoNames[0]}\n` +
      `  Software: https://github.com/${owner}/${companionRepoNames[1]}\n` +
      `  Nghiệm thu: mở Hàng Đợi → tab Khôi Lỗi, phải thấy ${workerId} điểm danh trong ~4 phút.\n`,
  );
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
