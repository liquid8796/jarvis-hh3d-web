/**
 * GÓI KHÔI LỖI GITHUB — một nguồn sự thật cho «kho khôi lỗi gồm những tệp nào, nội dung ra sao».
 *
 * VÌ SAO TÁCH RA: có HAI lượt đặt tệp vào một kho khôi lỗi — lượt DỰNG
 * (`newGithubKhoiloi.mjs`) và lượt PHÁT HÀNH (`deployGithubKhoiloi.mts`) — và chúng phải đồng ý
 * với nhau tới từng byte. Lệch nhau thì một kho vừa được phát hành sẽ KHÁC một kho vừa dựng, mà
 * cả hai đều báo xanh; sai lệch ấy chỉ lộ ra ở lượt chạy thật, trên máy người khác, trong nhật ký
 * của một tài khoản khác. Cùng lẽ với `githubKhoiloi.mts` (bằng chứng xoá kho) và
 * `deployTargets.mts` (sổ trạm): phần dễ sai nhất là phần thuần, nên nó sống riêng.
 *
 * PHẢI LÀ `.mjs`: `newGithubKhoiloi.mjs` chạy bằng `node` trần (nó là đầu dưới của một tệp .bat
 * bấm đúp), nên nó không nhập nổi TypeScript. Bên phát hành chạy bằng `tsx` nên nhập được cả hai
 * chiều.
 *
 * ── BYTES LẤY TỪ BLOB `HEAD`, KHÔNG LẤY TỪ CÂY LÀM VIỆC ──────────────────────────────────────
 *
 * Đây là điều đổi so với bản trước (bản ấy `cpSync` thẳng từ cây làm việc), và nó sửa một sai
 * lệch có thật:
 *
 *   • **Kết thúc dòng.** Máy Windows này có `core.autocrlf` bật, nên cây làm việc mang CRLF trong
 *     khi blob git mang LF. Lượt dựng cũ chép CRLF vào thư mục tạm rồi `git add` chuyển ngược về
 *     LF — vô hại, vì git dọn hộ. Nhưng lượt phát hành đẩy bytes THẲNG qua API GitHub, không có
 *     `git add` nào ở giữa: chép từ cây làm việc là đẩy CRLF lên, và thế thì MỌI tệp đều «đã đổi»
 *     ở lượt phát hành đầu tiên, rồi lật qua lật lại mãi mãi giữa hai lối. Đọc blob thì hai lối
 *     nói cùng một thứ tiếng.
 *   • **Việc dở của phiên khác.** Kho này thường có vài phiên cùng làm; cây làm việc có thể đang
 *     mang một nửa tính năng chưa xong. Phát hành thứ ấy lên kho CÔNG KHAI của người khác là
 *     chuyện không rút lại được. `deployAllStations.mts` đã chọn đúng lối này từ trước (điều 1
 *     của nó: phát hành từ bản `git archive`, không phải từ cây làm việc).
 *
 * Cái giá: sửa xong phải commit rồi mới dựng/phát hành được. `uncommittedPayloadPaths` có mặt để
 * chuyện ấy hiện ra thành một lời cảnh báo đọc được, chứ không thành một lượt phát hành lặng lẽ
 * thiếu bản vá người ta vừa gõ.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_NAME_PREFIX } from "./khoiloiNaming.mjs";

/**
 * Những gì được chép NGUYÊN từ kho gốc sang kho khôi lỗi, giữ nguyên bố cục thư mục.
 *
 * Giữ nguyên bố cục là cố ý: `worker.mjs` import `../src/lib/quest-engine/…`, nên chép nguyên
 * hình dạng thì không phải viết lại một đường dẫn nào.
 *
 * DANH SÁCH NÀY TỪNG SAI, và kiểu sai của nó là lý do có `assertImportsResolve`: bản đầu chỉ có
 * `worker.mjs` + `quest-engine` vì hồi ấy worker.mjs chỉ cần ngần ấy. Rồi commit「khôi lỗi đi
 * theo trạm」thêm một import thứ ba — `src/lib/worker/controlFollow.mjs` — mà không ai nghĩ tới
 * việc script phát hành phải chép thêm. Kho sinh ra chết ngay giây đầu bằng `ERR_MODULE_NOT_FOUND`.
 *
 * CHỈ `controlFollow.mjs`, không cả thư mục `src/lib/worker/`: bên ấy còn `version.ts`, thứ Node
 * không chạy được và worker.mjs cũng không cần (nó tự đọc bản qua `readOwnVersion`).
 */
export const COPIED_PATHS = Object.freeze([
  "scripts/worker.mjs",
  "src/lib/quest-engine",
  "src/lib/worker/controlFollow.mjs",
]);

/**
 * Những THƯ MỤC mà gói này làm chủ hoàn toàn.
 *
 * Chỉ lượt PHÁT HÀNH đọc tới, và nó đọc để trả lời đúng một câu: «tệp nào trong kho phải bị XOÁ».
 * Một tệp nằm dưới các tiền tố này mà không có trong gói nghĩa là kho gốc đã bỏ nó đi (một module
 * quest-engine bị gộp, chẳng hạn) — bỏ lại thì kho khôi lỗi mang một tệp không ai còn sửa nữa.
 *
 * Ranh giới này hẹp CÓ CHỦ Ý. `.github/heartbeat.txt` là của vòng nuôi kho (`githubStations.ts`),
 * không phải của gói này; xoá nó là phá đúng thứ giữ cho lịch `schedule` khỏi bị GitHub tắt. Mọi
 * thứ ngoài hai tiền tố dưới đây và ngoài `FIXED_FILES` đều KHÔNG bị đụng tới.
 */
export const OWNED_PREFIXES = Object.freeze(["scripts/", "src/"]);

/** Bản mẫu workflow trong kho gốc — NGOÀI `.github/workflows/`, xem `deploy/github-actions.md` §4. */
export const WORKFLOW_TEMPLATE_PATH = "deploy/github/linh-su.yml";

/**
 * Chỗ workflow nằm trong kho khôi lỗi.
 *
 * Song sinh với `DEFAULT_WORKFLOW_FILE` bên `src/lib/validation/githubStations.ts` — sổ Kho GitHub
 * dùng hằng số bên ấy để hỏi trạng thái lịch. Không nhập được (bên ấy là TypeScript), nên bên phát
 * hành đối chiếu hai giá trị lúc chạy; xem `assertWorkflowPathAgrees`.
 */
export const WORKFLOW_TARGET_PATH = ".github/workflows/linh-su.yml";

/** Tệp SINH RA (không chép từ kho gốc) — cũng là ranh giới xoá cho lượt phát hành. */
export const FIXED_FILES = Object.freeze([
  WORKFLOW_TARGET_PATH,
  "package.json",
  "package-lock.json",
  "README.md",
  ".gitignore",
]);

/** Trần thời gian cho một lời gọi `git`. Chúng đều là phép đọc cục bộ — chậm hơn thế là có chuyện. */
const GIT_TIMEOUT_MS = 30_000;

/** Giải cây phụ thuộc mất vài giây; ba phút là rộng rãi cho một máy đang tải mạng. */
const NPM_TIMEOUT_MS = 180_000;

function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Bytes của một tệp ĐÃ COMMIT, đúng như git giữ nó.
 *
 * `encoding: "buffer"` chứ không phải chuỗi: `profile.json` mang CRLF trong blob (nó do
 * System.Text.Json xuất ra) trong khi mọi tệp .mjs mang LF. Đọc thành chuỗi rồi ghi lại là mời
 * một phép chuẩn hoá không ai gọi đến chen vào giữa.
 */
export function readCommittedFile(repoRoot, relPath) {
  try {
    return git(repoRoot, ["show", `HEAD:${relPath}`], "buffer");
  } catch (err) {
    throw new Error(
      `Không đọc được \`${relPath}\` từ HEAD — tệp chưa commit, vừa bị đổi tên, hoặc đã bị xoá.\n` +
        `  (${err instanceof Error ? err.message.split("\n")[0] : "lỗi lạ"})`,
    );
  }
}

/** Mọi tệp đã commit dưới một đường dẫn (tệp thì trả về chính nó, thư mục thì trả cả cây). */
function committedPathsUnder(repoRoot, prefix) {
  const out = git(repoRoot, ["ls-tree", "-r", "--name-only", "HEAD", "--", prefix]);
  return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/**
 * Tệp nào trong phạm vi gói đang có thay đổi CHƯA COMMIT.
 *
 * Không phải một hàng rào — là một lời cảnh báo. Người vận hành có quyền phát hành đúng HEAD
 * trong lúc cây làm việc còn dở; thứ họ không được phép là KHÔNG BIẾT điều đó.
 */
export function uncommittedPayloadPaths(repoRoot) {
  const out = git(repoRoot, [
    "status", "--porcelain", "--", ...COPIED_PATHS, WORKFLOW_TEMPLATE_PATH,
  ]);
  return out
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0);
}

/**
 * Workflow của kho khôi lỗi = bản mẫu của kho gốc, thay ĐÚNG hai dòng.
 *
 * Chép tay một bản thứ hai là hẹn ngày hai bản trôi khỏi nhau — mà bộ số 290/50/350/360
 * (`deploy/github-actions.md` §3) thì không được phép lệch. Hai phép khẳng định bên dưới là vì
 * phép thay bằng biểu thức chính quy hỏng LẶNG LẼ khi hình dạng bản mẫu đổi: nó chỉ đơn giản là
 * không thay gì cả, và kho phát ra mang `WORKER_ID` của bản mẫu — tức trùng id với một kho khác.
 */
export function renderWorkflow({ template, workerId, webUrl }) {
  const workflow = template
    .replace(/^(\s*WORKER_ID:\s*).*$/m, `$1${workerId}`)
    .replace(/\$\{\{ vars\.WEB_URL \|\| '[^']*' \}\}/, `\${{ vars.WEB_URL || '${webUrl}' }}`);

  if (!workflow.includes(`WORKER_ID: ${workerId}`)) {
    throw new Error(
      "Không thay được WORKER_ID trong workflow — hình dạng bản mẫu đã đổi. Sửa phép thay ở " +
        "`renderWorkflow`, đừng phát ra một kho mang id trùng máy khác.",
    );
  }
  if (!workflow.includes(`vars.WEB_URL || '${webUrl}'`)) {
    throw new Error(
      `Không thay được WEB_URL trong workflow — hình dạng bản mẫu đã đổi. Kho sẽ gọi về địa chỉ ` +
        `mặc định của bản mẫu thay vì ${webUrl}.`,
    );
  }
  return workflow;
}

/**
 * README nằm ngay trang đầu của một kho CÔNG KHAI, nên nó là chỗ dễ nói hớ nhất. Giữ đúng một
 * việc nó phải làm — dặn người mở kho đừng sửa tay — và bỏ mọi thứ chỉ đường về tông môn.
 */
export function renderReadme({ workerId, webUrl }) {
  return (
    `# Tông môn — ${workerId}\n\n` +
    `Một tiến trình nền nhận việc theo lịch từ ${webUrl}.\n` +
    `Kho này được SINH TỰ ĐỘNG từ kho gốc — **đừng sửa tay ở đây**, sửa ở kho gốc rồi dựng lại,\n` +
    `bằng không hai bản sẽ trôi khỏi nhau.\n`
  );
}

export function renderPackageJson({ playwrightVersion }) {
  return (
    JSON.stringify(
      {
        // Tên gói đi theo tên kho: cả hai đều là thứ người lạ đọc được, và cả hai đều nghe luật
        // ở `khoiloiNaming.mjs`.
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
    ) + "\n"
  );
}

/** Bản `playwright-core` mà kho gốc đang ghim — kho khôi lỗi phải cài đúng bản ấy. */
export function playwrightVersionOf(repoRoot) {
  const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    .dependencies?.["playwright-core"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json của kho gốc không khai `playwright-core` — không dựng gói được.");
  }
  return version;
}

/**
 * SINH `package-lock.json`. Thiếu nó thì kho phát ra chết ở bước THỨ HAI, trước khi worker kịp
 * chạy một dòng — và chết hai lần khác nhau, nên bỏ một chỗ là vẫn hỏng ở chỗ kia:
 *
 *   • `actions/setup-node@v4` với `cache: npm` → „Dependencies lock file is not found"
 *   • `npm ci` → từ chối chạy khi không có lockfile, theo thiết kế của chính nó.
 *
 * Đo 13/08/2026 trên kho `…-100055-69a9`: lượt chạy đầu đỏ ở đúng dòng ấy sau 6 giây, dù kho,
 * secret và dòng sổ đều đã xong xuôi.
 *
 * `--package-lock-only` chỉ GIẢI cây phụ thuộc rồi ghi lockfile, không tải `node_modules`.
 *
 * `shell: true` bắt buộc: trên Windows `npm` là một tệp `.cmd`, mà từ Node 20 (CVE-2024-27980)
 * `spawn` từ chối chạy .cmd nếu không qua shell. An toàn ở đây vì mọi đối số là chuỗi cố định
 * không khoảng trắng; thứ duy nhất đổi giữa các lượt — `cwd` — đi bằng tuỳ chọn của spawn.
 */
export function generateLockfile(packageJson) {
  const dir = mkdtempSync(path.join(tmpdir(), "khoiloi-lock-"));
  try {
    writeFileSync(path.join(dir, "package.json"), packageJson);
    execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
      cwd: dir,
      timeout: NPM_TIMEOUT_MS,
      encoding: "utf8",
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(path.join(dir, "package-lock.json"));
  } catch (err) {
    throw new Error(
      "npm không sinh ra package-lock.json — kho phát ra sẽ chết ở bước setup-node. Dừng ở đây,\n" +
        `  trên máy này, thay vì bỏ lại một kho không dựng nổi. (${err instanceof Error ? err.message.split("\n")[0] : "lỗi lạ"})`,
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Bỏ quên một thư mục tạm vài chục KB là chuyện vặt; đánh sập lượt chạy vì nó thì không.
    }
  }
}

/**
 * Mọi đường `import` tương đối trong gói có trỏ vào một tệp CÓ THẬT trong chính gói ấy không.
 *
 * Hỏi CÂU HỎI TỔNG QUÁT chứ không đi kèm một cái tên tệp, nên nó sẽ bắt được lần sau — khi ai đó
 * thêm một import thứ tư vào `worker.mjs` mà quên `COPIED_PATHS`. Chạy trên chính bản đồ tệp
 * (không phải trên đĩa) nên cả lượt dựng lẫn lượt phát hành đều đi qua nó.
 */
export function assertImportsResolve(files) {
  const missing = [];
  for (const [relPath, bytes] of files) {
    if (!/\.(mjs|js)$/.test(relPath)) continue;
    const source = bytes.toString("utf8");
    const dir = path.posix.dirname(relPath);
    /**
     * Ba hình dạng, và hình dạng thứ ba là lỗ hổng của bản cũ (bắt được 14/08/2026 bởi chính
     * `verify:github-deploy`):
     *
     *   from "./x.mjs"      — import có tên, và cả `export … from`
     *   import("./x.mjs")   — nhánh động; nó ném y như nhánh tĩnh
     *   import "./x.mjs"    — import CHỈ ĐỂ CHẠY, không lấy tên nào
     *
     * Cái thứ ba không hiếm chút nào (một module chỉ gắn side effect), và bản cũ không thấy nó —
     * tức đúng loại tệp thiếu mà phép kiểm này sinh ra để bắt thì nó lại để lọt.
     *
     * Thứ tự trong nhóm chọn CÓ Ý NGHĨA: `import\s*\(` phải đứng trước `import\s*` để `import(`
     * không bị nhánh cuối nuốt trước.
     */
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']*)["']/g)) {
      const target = path.posix.normalize(path.posix.join(dir, match[1]));
      if (!files.has(target)) missing.push(`  ${relPath} → ${match[1]}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      "Gói khôi lỗi THIẾU TỆP — kho sẽ chết bằng ERR_MODULE_NOT_FOUND ngay lượt chạy đầu:\n" +
        `${missing.join("\n")}\n` +
        "Thêm tệp còn thiếu vào `COPIED_PATHS` của khoiloiPayload.mjs.",
    );
  }
}

/**
 * Dựng trọn gói của MỘT kho khôi lỗi: `Map<đường dẫn, Buffer>`, đường dẫn kiểu POSIX.
 *
 * `lockfile` truyền vào được để lượt phát hành giải cây phụ thuộc ĐÚNG MỘT LẦN rồi dùng lại cho
 * mọi kho — nó giống nhau ở mọi kho (chỉ phụ thuộc bản `playwright-core`), mà mỗi lượt gọi npm là
 * vài giây.
 */
export function buildKhoiloiPayload({ repoRoot, workerId, webUrl, lockfile }) {
  const files = new Map();

  for (const prefix of COPIED_PATHS) {
    const paths = committedPathsUnder(repoRoot, prefix);
    if (paths.length === 0) {
      throw new Error(
        `\`${prefix}\` không có tệp nào đã commit trong HEAD — danh sách COPIED_PATHS đã lạc hậu ` +
          "so với kho gốc (tệp vừa bị dời hay đổi tên?).",
      );
    }
    for (const relPath of paths) files.set(relPath, readCommittedFile(repoRoot, relPath));
  }

  const packageJson = renderPackageJson({ playwrightVersion: playwrightVersionOf(repoRoot) });
  const template = readCommittedFile(repoRoot, WORKFLOW_TEMPLATE_PATH).toString("utf8");

  files.set(WORKFLOW_TARGET_PATH, Buffer.from(renderWorkflow({ template, workerId, webUrl }), "utf8"));
  files.set("package.json", Buffer.from(packageJson, "utf8"));
  files.set("package-lock.json", lockfile ?? generateLockfile(packageJson));
  files.set("README.md", Buffer.from(renderReadme({ workerId, webUrl }), "utf8"));
  files.set(".gitignore", Buffer.from("node_modules/\n.env\n", "utf8"));

  assertImportsResolve(files);
  return files;
}

/**
 * Băm một tệp ĐÚNG THEO LỐI CỦA GIT: `sha1("blob <số byte>\0" + nội dung)`.
 *
 * Nhờ nó mà lượt phát hành biết tệp nào đã đổi mà KHÔNG phải tải nội dung cũ về: cây của kho
 * (`GET /git/trees?recursive=1`) đã kèm sẵn sha của từng blob, so tại chỗ là xong. Tám kho × 20
 * tệp thành 8 lời gọi thay vì 160.
 */
export function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}
