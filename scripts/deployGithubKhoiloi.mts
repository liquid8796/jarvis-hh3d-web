#!/usr/bin/env node
/**
 * PHÁT HÀNH CHO MỌI KHÔI LỖI GITHUB — một lượt chạy, mọi kho trong sổ nhận cùng một gói.
 *
 *   npm run github:deploy                      mọi kho đang bật trong sổ
 *   npm run github:deploy -- --dry-run          soi kế hoạch, KHÔNG đẩy gì
 *   npm run github:deploy -- --repo <tên kho>   đúng một kho (kể cả dòng đang tắt)
 *   npm run github:deploy -- --web-url <địa chỉ>  đổi luôn địa chỉ khởi động (xem dưới)
 *
 * ── VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────────
 *
 * Khôi lỗi GitHub KHÔNG tự cập nhật. Kho của nó là một BẢN ĐÔNG LẠNH của gói khôi lỗi: workflow
 * `checkout` chính kho ấy rồi chạy `node scripts/worker.mjs` từ đó, nên mã trong kho là mã sẽ
 * chạy, mãi mãi, cho tới khi có người đẩy bản mới lên. Trước 14/08/2026 chỉ có hai công cụ —
 * `github:new` (dựng) và `github:remove` (xoá) — nên một kho dựng hôm qua chạy mã của hôm qua, và
 * KHÔNG CÓ ĐƯỜNG NÀO sửa ngoài xoá đi dựng lại.
 *
 * Điều đó không hiện ra ở đâu cả, và đó mới là phần tệ: `package.json` của kho sinh ra luôn khai
 * `version: "1.0.0"`, nên `readOwnVersion` của worker khai đúng chuỗi ấy vào sổ điểm danh. Bảy kho
 * dựng ở bảy thời điểm khác nhau đều hiện `1.0.0` trên dashboard — nhìn thì đều nhau, thực thì mỗi
 * cái một đời mã. Đo 14/08/2026: VM khai `0.83.1`, `github-khoiloi` khai `0.82.6`, sáu kho trọ đều
 * khai `1.0.0`.
 *
 * ── BA ĐIỀU QUYẾT ĐỊNH HÌNH DẠNG TỆP NÀY ─────────────────────────────────────────────────────
 *
 * 1. **KHÔNG cần `git`, KHÔNG cần `gh`, KHÔNG clone.** Đẩy bằng Git Data API: tải blob lên, dựng
 *    một cây, tạo MỘT commit, rồi nhích `refs/heads/<nhánh>`. Cùng lẽ với vòng nuôi kho
 *    (`services/githubStations.ts` điều 1) — và nhờ vậy chìa duy nhất cần có là chính PAT đã nằm
 *    sẵn trong sổ, thứ `github:new` đã dán vào từ lúc dựng kho.
 *
 * 2. **Chỉ đẩy tệp ĐÃ ĐỔI.** SHA blob tính được dưới máy (`gitBlobSha`), mà cây của kho thì trả
 *    sha sẵn — nên lượt so không tốn một byte tải về. Kho đã đúng bản thì lượt chạy KHÔNG tạo
 *    commit nào. Điều này không phải để cho đẹp: mỗi commit là một dấu chân với GitHub, và cả
 *    `KEEPALIVE_INTERVAL_DAYS` sinh ra để đếm dè sẻn từng cái (xem `deploy/github-actions.md` §7).
 *
 * 3. **Hỏng một kho KHÔNG chặn các kho còn lại**, y như `deployAllStations.mts`. Nhưng bảng tổng
 *    kết phải nói thẳng kho nào giờ đang mang mã khác, và mã thoát phải khác 0.
 *
 * ── CÓ HIỆU LỰC KHI NÀO ───────────────────────────────────────────────────────────────────────
 *
 * Lượt chạy Actions ĐANG chạy vẫn dùng mã nó đã `checkout` lúc bắt đầu; bản mới có hiệu lực ở
 * lượt kế — tối đa ~4 giờ (lịch `0 *\/4 * * *`). Script này CỐ Ý không huỷ lượt đang chạy: huỷ là
 * cắt ngang đàn đang cày, nhịp tim tắt, và `reapStaleJobs` kết liễu chúng thành `failed` sau 3
 * phút — mất trọn một vòng của một đạo hữu nào đó, không phải của người đang gõ lệnh. Cùng luật
 * với hàng rào 2 của `github:remove`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import {
  DEFAULT_WORKFLOW_FILE,
  explainFailure,
  reviewStationIdentity,
  stationSlug,
} from "../src/lib/validation/githubStations";
import {
  activeRuns,
  planKhoiloiTree,
  resolveDeployWorkerId,
  reviewRestart,
  webUrlFromWorkflow,
  workerIdFromWorkflow,
} from "./githubKhoiloi.mts";
import {
  OWNED_PREFIXES,
  WORKFLOW_TARGET_PATH,
  WORKFLOW_TEMPLATE_PATH,
  buildKhoiloiPayload,
  generateLockfile,
  gitBlobSha,
  readCommittedFile,
  renderPackageJsonFor,
  renderReadme,
  renderWorkflow,
  uncommittedPayloadPaths,
} from "./khoiloiPayload.mjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  const value = argv[at + 1];
  return at > -1 && value && !value.startsWith("--") ? value : undefined;
};
const onlyRepo = arg("repo");
const forcedWebUrl = arg("web-url");
/**
 * `--restart`: huỷ lượt Actions đang chạy MÃ CŨ rồi phát một lượt mới, thay vì chờ tới 4 giờ.
 *
 * Không bật mặc định, và cũng không phải chuyện lười: huỷ một lượt đang cày là cắt ngang đàn của
 * một đạo hữu. Nhưng có đúng MỘT cảnh mà huỷ không mất gì cả, và nó là cảnh thường gặp nhất sau
 * một lượt chuyển trạm — runner đang gõ vào một trạm đã bị xoá, nhận 404 mỗi 5 giây, giữ 0 đàn.
 * Với nó thì「chờ lượt kế」nghĩa là để một khôi lỗi nằm chết thêm bốn tiếng. Hàng rào đàn-đang-giữ
 * nằm ở `reviewRestart`, không ở đây.
 */
const restart = argv.includes("--restart");
const force = argv.includes("--force");

const API_ROOT = "https://api.github.com";
/** Ghim tường minh, cùng lý do với vòng nuôi kho: một API mặc định trôi sang bản sau là hỏng lặng lẽ. */
const API_VERSION = "2022-11-28";
/** GitHub TỪ CHỐI request không có User-Agent — 403 kèm một câu khó đoán nếu quên. */
const USER_AGENT = "auto-hh3d-deploy";
/** Trần một lời gọi. Rộng hơn vòng nuôi kho (10s) vì lượt tải blob mang cả tệp trong thân. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Mode của tệp thường trong cây git. Gói khôi lỗi không có tệp thực thi nào. */
const FILE_MODE = "100644";

/**
 * Tác giả commit — ĐÚNG danh tính mà `newGithubKhoiloi.mjs` đặt cho commit đầu tiên.
 *
 * Không để GitHub tự điền theo chủ PAT: tác giả hiện trên MỌI dòng lịch sử của một kho công khai,
 * nên một lượt phát hành sẽ dán tên thật của người giữ tài khoản vào giữa lịch sử một kho vốn
 * được đặt tên để không chỉ về ai. Phần `@users.noreply.github.com` là tên miền GitHub bắt buộc
 * dùng để một commit không bị nối vào hộp thư thật của ai.
 */
const COMMIT_AUTHOR = { name: "linh-su", email: "linh-su@users.noreply.github.com" };

const die = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/**
 * Hai hằng số song sinh phải khớp: chỗ gói đặt workflow, và chỗ sổ đi hỏi trạng thái lịch.
 *
 * Chúng sống ở hai tệp vì một bên là `.mjs` (chạy bằng node trần) còn bên kia là TypeScript của
 * app. Lệch nhau thì lượt phát hành ghi vào một đường dẫn mà vòng nuôi kho không ngó tới — kho
 * chạy mã mới nhưng lịch của nó chết dần mà không ai thấy. Rẻ hơn nhiều so với việc phát hiện
 * bằng mắt ba tuần sau.
 */
if (WORKFLOW_TARGET_PATH !== `.github/workflows/${DEFAULT_WORKFLOW_FILE}`) {
  die(
    `Hai hằng số workflow đã trôi khỏi nhau:\n` +
      `  khoiloiPayload.mjs   → ${WORKFLOW_TARGET_PATH}\n` +
      `  validation/githubStations.ts → .github/workflows/${DEFAULT_WORKFLOW_FILE}\n` +
      "  Sửa cho khớp rồi chạy lại.",
  );
}

// ---- 1. Điều kiện cần -----------------------------------------------------------------------

// Hứng ra một biến cục bộ CÓ KIỂU `string`: phép thu hẹp kiểu của TypeScript không đi qua được
// `process.env` cộng một hàm mũi tên trả `never`, nên `?? ""` là lối gọn nhất giữ cả phép kiểm
// lẫn kiểu — thay vì rải `!` khắp nơi.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (databaseUrl.length === 0) {
  die("Thiếu DATABASE_URL — sổ Kho GitHub nằm trong database. Chạy `npm run env:pull` trước.");
}
if (!process.env.ENCRYPTION_KEY) {
  die("Thiếu ENCRYPTION_KEY — PAT trong sổ là phong bì secretBox, không có khoá thì không mở được.");
}

// ---- 2. Sổ Kho GitHub -----------------------------------------------------------------------

/**
 * Đọc THẲNG JSONB thay vì gọi `getAppSettings()`.
 *
 * `services/settings.ts` nhập `cache` của React và `db/client`; kéo cả hai vào một script dòng
 * lệnh là kéo theo cả một cây phụ thuộc chỉ để đọc một mảng. Cùng lối với `deployAllStations.mts`
 * (nó cũng hỏi neon thẳng). Cái giá là phải tự soát hình dạng — làm ngay dưới đây, và soát bằng
 * `reviewStationIdentity`, tức ĐÚNG luật mà form admin dùng.
 */
type Station = {
  owner: string;
  repo: string;
  workflowFile: string;
  workerId: string;
  pat: string;
  enabled: boolean;
};

// pg thay neon-http (16/08/2026 — DB nay là Postgres local trên VM; neon() gặp 127.0.0.1
// là chế ra https://api.0.0.1/sql rồi chết). Adapter giữ nguyên bề mặt tagged-template mà
// hai chỗ gọi bên dưới đang dùng; allowExitOnIdle để script vẫn tự thoát như trước.
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, allowExitOnIdle: true });
const sql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  const text = strings.reduce((acc, part, i) => `${acc}$${i}${part}`);
  const result = await pool.query(text, values as unknown[]);
  return result.rows;
};

const settingsRows = (await sql`
  SELECT value -> 'githubStations' AS stations FROM app_settings WHERE id = 'global'
`) as Array<{ stations: unknown }>;

const rawStations = settingsRows[0]?.stations;
if (rawStations != null && !Array.isArray(rawStations)) {
  die("Sổ Kho GitHub trong app_settings không phải một mảng — sửa tay JSONB hỏng? Soi tab Kho GitHub.");
}

const stations: Station[] = [];
const rejected: string[] = [];
for (const row of (rawStations ?? []) as Array<Record<string, unknown>>) {
  const owner = String(row?.owner ?? "");
  const repo = String(row?.repo ?? "");
  const workflowFile = String(row?.workflowFile ?? DEFAULT_WORKFLOW_FILE) || DEFAULT_WORKFLOW_FILE;
  const complaint = reviewStationIdentity(owner, repo, workflowFile);
  if (complaint) {
    rejected.push(`${owner || "?"}/${repo || "?"} — ${complaint}`);
    continue;
  }
  stations.push({
    owner,
    repo,
    workflowFile,
    workerId: String(row?.workerId ?? ""),
    pat: String(row?.pat ?? ""),
    enabled: row?.enabled !== false,
  });
}

if (stations.length === 0) {
  console.log("Sổ Kho GitHub trống — không có kho khôi lỗi nào để phát hành.");
  if (rejected.length > 0) {
    console.log(`\n${rejected.length} dòng sổ có hình dạng sai, đã bỏ qua:`);
    for (const line of rejected) console.log(`  · ${line}`);
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Chọn kho phải đụng tới. `--repo` nhận cả `owner/repo` lẫn tên kho trần, và nó ĐỌC ĐƯỢC CẢ DÒNG
 * ĐANG TẮT: cờ `enabled` là để vòng nuôi kho tự động đứng ngoài, không phải để chặn một con người
 * vừa gõ đúng tên kho ra. Cùng lẽ với luật「không gác tay người」của nút Nuôi Ngay.
 */
const targets = onlyRepo
  ? stations.filter(
      (s) => s.repo.toLowerCase() === onlyRepo.toLowerCase() ||
        stationSlug(s).toLowerCase() === onlyRepo.toLowerCase(),
    )
  : stations.filter((s) => s.enabled);

if (targets.length === 0) {
  if (onlyRepo) {
    die(
      `Sổ không có kho nào tên「${onlyRepo}」. Những kho đang có:\n` +
        stations.map((s) => `  · ${stationSlug(s)}${s.enabled ? "" : " (đang tắt)"}`).join("\n"),
    );
  }
  die(
    `Cả ${stations.length} kho trong sổ đều đang TẮT — không kho nào vào lượt phát hành tự động.\n` +
      "  Bật lại ở tab Kho GitHub, hoặc chỉ đích danh bằng --repo <tên kho>.",
  );
}

const skipped = stations.length - targets.length;

// ---- 3. Gói sắp phát hành --------------------------------------------------------------------

const chuaCommit = uncommittedPayloadPaths(repoRoot);
if (chuaCommit.length > 0) {
  console.warn(
    `⚠ ${chuaCommit.length} tệp trong phạm vi gói đang có thay đổi CHƯA COMMIT. Lượt này phát ` +
      "hành bản đã commit (HEAD), KHÔNG mang những sửa đổi này:\n" +
      chuaCommit.map((f) => `    ${f}`).join("\n") +
      "\n",
  );
}

/** Commit của kho gốc mà gói này dựng từ đó — đi vào lời nhắn commit để còn lần ngược được. */
const headSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  timeout: 30_000,
}).trim();

console.log(`Phát hành gói khôi lỗi từ commit ${headSha}`);
console.log(`  kho trong sổ : ${stations.length}${skipped > 0 ? ` (bỏ qua ${skipped} dòng đang tắt)` : ""}`);
console.log(`  sẽ đụng tới  : ${targets.length}`);
if (rejected.length > 0) {
  console.log(`  dòng hỏng    : ${rejected.length} — ${rejected.join(" · ")}`);
}
console.log("\n── Giải cây phụ thuộc một lần cho mọi kho…");

/**
 * Lockfile giải MỘT LẦN rồi dùng lại: nó chỉ phụ thuộc bản `playwright-core`, giống hệt nhau ở
 * mọi kho, mà mỗi lượt gọi npm là vài giây.
 */
const lockfile = generateLockfile(renderPackageJsonFor(repoRoot));

/**
 * Gói NỀN dựng một lần với một `workerId` giả. Hai tệp mang danh tính riêng của từng kho —
 * workflow và README — được vẽ đè lên bản sao ở mỗi vòng, nên phần đọc blob (18 lượt gọi `git`)
 * chỉ chạy đúng một lần thay vì một lần cho mỗi kho.
 */
const basePayload = buildKhoiloiPayload({
  repoRoot,
  workerId: "khoiloi-mau",
  webUrl: "https://mau.invalid",
  lockfile,
});
const workflowTemplate = readCommittedFile(repoRoot, WORKFLOW_TEMPLATE_PATH).toString("utf8");

function payloadFor(workerId: string, webUrl: string): Map<string, Buffer> {
  const files = new Map(basePayload);
  files.set(
    WORKFLOW_TARGET_PATH,
    Buffer.from(renderWorkflow({ template: workflowTemplate, workerId, webUrl }), "utf8"),
  );
  files.set("README.md", Buffer.from(renderReadme({ workerId, webUrl }), "utf8"));
  return files;
}

// ---- 4. Cửa gọi GitHub ------------------------------------------------------------------------

class RepoError extends Error {}

type Reply = { status: number; body: unknown };

async function callGithub(
  pat: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: Record<string, unknown>,
): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": USER_AGENT,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `quá ${REQUEST_TIMEOUT_MS / 1000}s không trả lời`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "lỗi lạ";
    throw new RepoError(`${method} ${path} không tới được GitHub (${reason})`);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

/** Gọi và ĐÒI đúng mã mong đợi — mọi thứ khác thành một câu đọc được rồi ném. */
async function demand(
  pat: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  what: string,
  expect: readonly number[],
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const reply = await callGithub(pat, method, path, payload);
  if (!expect.includes(reply.status)) {
    throw new RepoError(explainFailure(reply.status, reply.body, what));
  }
  return reply.body;
}

const seg = (value: string) => encodeURIComponent(value);

/**
 * Tên nhánh đi vào đường dẫn `/git/ref/heads/<nhánh>` mà KHÔNG được `encodeURIComponent`.
 *
 * Nhánh được phép mang dấu `/` (`feature/x`), và GitHub đọc phần sau `heads/` như một đường dẫn
 * nhiều đoạn — mã hoá nó thành `%2F` là hỏi một ref không tồn tại rồi nhận 404 khó hiểu. Nên
 * thay vì mã hoá, ta SOÁT: chỉ chữ-số và bốn ký tự lành mới được ghép thẳng vào URL, mọi thứ khác
 * (khoảng trắng, `?`, `#`, `..`) bị chặn ngay tại đây thay vì thành một lời gọi méo.
 */
const SAFE_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

// ---- 5. Một kho ------------------------------------------------------------------------------

type Outcome = {
  slug: string;
  state: "đã đẩy" | "đã đúng bản" | "kế hoạch" | "HỎNG";
  detail: string;
  /** Lượt khởi động lại đã làm gì — `null` khi không bật `--restart`. */
  restart?: string;
};

/**
 * Đàn mà từng khôi lỗi đang giữ — hỏi MỘT LẦN cho cả vòng, ngay trước khi bắt đầu.
 *
 * Một câu hỏi cho mỗi kho thì rẻ hơn về mặt gõ, nhưng nó mở một khe đua dài bằng cả vòng chạy:
 * kho thứ sáu sẽ đọc một con số của mười phút sau kho thứ nhất. Ảnh chụp một lần thì mọi phán
 * quyết trong lượt này đứng trên cùng một sự thật — và nếu ảnh ấy đã cũ vài phút thì phán quyết
 * chỉ sai theo hướng THẬN TRỌNG (từ chối huỷ một khôi lỗi vừa nhả đàn), không sai theo hướng
 * giết nhầm.
 */
const heldByWorker = new Map<string, number>();
if (restart) {
  const rows = (await sql`
    SELECT worker_id, count(*)::int AS n FROM automation_jobs
    WHERE status IN ('running', 'stopping') AND worker_id IS NOT NULL
    GROUP BY worker_id
  `) as Array<{ worker_id: string; n: number }>;
  for (const row of rows) heldByWorker.set(row.worker_id, Number(row.n) || 0);
}

/**
 * Huỷ lượt chạy mang mã cũ rồi phát một lượt mới. Trả về câu kể, hoặc ném `RepoError`.
 *
 * Đứng SAU lượt đẩy và dùng chính `headSha` vừa tạo ra, nên nó không bao giờ huỷ nhầm một lượt
 * chạy đã mang mã mới.
 */
async function restartRuns(input: {
  pat: string;
  base: string;
  branch: string;
  workflowFile: string;
  workerId: string;
  headSha: string;
}): Promise<string> {
  const { pat, base, branch, workflowFile, workerId, headSha } = input;

  const runsBody = await demand(
    pat,
    "GET",
    `${base}/actions/workflows/${seg(workflowFile)}/runs?per_page=20`,
    "hỏi danh sách lượt chạy Actions",
    [200],
  );
  const runs = activeRuns(runsBody);
  const verdict = reviewRestart({
    runs,
    headSha,
    heldJobs: heldByWorker.get(workerId) ?? 0,
    force,
    workerId,
  });

  if (!verdict.go) return `khởi động lại: BỎ QUA — ${verdict.message}`;
  if (verdict.cancel.length === 0 && !verdict.dispatch) {
    return "khởi động lại: không cần — đã có lượt chạy mang đúng mã này";
  }

  // Lượt chạy khô đi được tới TẬN ĐÂY vì mọi thứ trên đều là phép ĐỌC — nên nó soi được cả phán
  // quyết khởi động lại, chứ không chỉ soi phần đẩy tệp. Chỉ hai lời gọi ghi bên dưới là bị chặn.
  if (dryRun) {
    const se: string[] = [];
    if (verdict.cancel.length > 0) se.push(`huỷ ${verdict.cancel.length} lượt mã cũ`);
    if (verdict.dispatch) se.push("phát lượt mới");
    return `khởi động lại (sẽ): ${se.join(", ")}`;
  }

  for (const run of verdict.cancel) {
    // 202 = đã nhận lệnh huỷ; 409 = lượt ấy vừa tự kết thúc trong lúc ta đọc — cả hai đều là
    // "không còn lượt cũ nào chạy nữa", tức đúng thứ ta muốn.
    const reply = await callGithub(pat, "POST", `${base}/actions/runs/${run.id}/cancel`);
    if (reply.status !== 202 && reply.status !== 409) {
      throw new RepoError(explainFailure(reply.status, reply.body, `huỷ lượt chạy #${run.number ?? run.id}`));
    }
  }

  let dispatched = false;
  if (verdict.dispatch) {
    await demand(
      pat,
      "POST",
      `${base}/actions/workflows/${seg(workflowFile)}/dispatches`,
      "phát một lượt chạy mới",
      [204],
      { ref: branch },
    );
    dispatched = true;
  }

  const parts: string[] = [];
  if (verdict.cancel.length > 0) {
    parts.push(`huỷ ${verdict.cancel.length} lượt mã cũ (${verdict.cancel.map((r) => `#${r.number ?? r.id}`).join(", ")})`);
  }
  parts.push(dispatched ? "đã phát lượt mới" : "lượt mang mã mới đã nằm chờ sẵn");
  return `khởi động lại: ${parts.join(", ")}`;
}

async function deployOne(station: Station): Promise<Outcome> {
  const slug = stationSlug(station);
  const base = `/repos/${seg(station.owner)}/${seg(station.repo)}`;

  if (!isEncrypted(station.pat)) {
    return { slug, state: "HỎNG", detail: "Phong bì PAT hỏng hoặc trống — dán lại PAT ở form Sửa kho." };
  }
  let pat: string;
  try {
    pat = decryptSecret(station.pat);
  } catch {
    return {
      slug,
      state: "HỎNG",
      detail: "Không giải mã được PAT — ENCRYPTION_KEY của trạm này khác lúc PAT được ghi. Dán lại PAT.",
    };
  }

  try {
    // 5.1 — Kho còn sống không, và nhánh mặc định tên gì. Ghim "main" là hẹn ngày hỏng với một
    // kho trót đặt tên nhánh khác; GitHub thì đã biết sẵn.
    const repoInfo = (await demand(pat, "GET", base, "hỏi thông tin kho", [200])) as {
      default_branch?: unknown;
    };
    const branch = typeof repoInfo?.default_branch === "string" ? repoInfo.default_branch : "";
    if (branch.length === 0) {
      throw new RepoError("GitHub không khai `default_branch` cho kho này — không biết đẩy vào nhánh nào.");
    }
    if (!SAFE_BRANCH_RE.test(branch)) {
      throw new RepoError(`Tên nhánh mặc định「${branch}」mang ký tự lạ — không ghép an toàn vào URL được.`);
    }

    // 5.2 — Workflow hiện có: nguồn của WEB_URL đang dùng, và là lối suy WORKER_ID khi sổ trống.
    // Vắng nó thì kho này KHÔNG phải một khôi lỗi (hoặc là một kho dựng dở) — đừng biến một lượt
    // phát hành thành một lượt dựng lén.
    const workflowPath = `${base}/contents/.github/workflows/${seg(station.workflowFile)}`;
    const existing = (await demand(
      pat,
      "GET",
      workflowPath,
      `đọc .github/workflows/${station.workflowFile}`,
      [200],
    )) as { content?: unknown; encoding?: unknown };
    if (typeof existing?.content !== "string" || existing.encoding !== "base64") {
      throw new RepoError(
        `Đọc được ${station.workflowFile} nhưng GitHub không trả nội dung base64 — tệp quá lớn hay là một thư mục?`,
      );
    }
    const currentYaml = Buffer.from(existing.content, "base64").toString("utf8");

    const inRepoWorkerId = workerIdFromWorkflow(currentYaml);
    const chosen = resolveDeployWorkerId({ fromBook: station.workerId, fromWorkflow: inRepoWorkerId });
    if (!chosen.ok) return { slug, state: "HỎNG", detail: chosen.message };
    const workerId = chosen.workerId;

    /**
     * Sổ và kho khai hai id khác nhau là chuyện PHẢI NÓI RA, không phải chuyện lặng lẽ chọn một
     * bên: lượt phát hành này sẽ ĐỔI danh tính của khôi lỗi ấy trong bảng `workers` kể từ lượt
     * chạy kế, và cái tên cũ sẽ nằm lại sổ điểm danh như một cái xác không ai dọn.
     */
    const idNote =
      inRepoWorkerId && station.workerId && inRepoWorkerId !== station.workerId
        ? ` ⚠ sổ ghi「${station.workerId}」còn kho đang mang「${inRepoWorkerId}」— lượt này ghi theo SỔ`
        : "";

    const webUrl = forcedWebUrl ?? webUrlFromWorkflow(currentYaml);
    if (!webUrl) {
      throw new RepoError(
        `Không đọc được WEB_URL trong ${station.workflowFile} của kho, mà lượt chạy cũng không truyền --web-url.\n` +
          "  Phát hành lúc này là đổi địa chỉ khởi động của kho một cách tình cờ — dừng lại.",
      );
    }

    // 5.3 — Cây hiện có của kho. Ref → commit → tree, ba lượt gọi có tài liệu; `trees/{sha ref}`
    // thì GitHub có nhận nhưng không hứa, và một API không hứa là một API sẽ đổi.
    const ref = (await demand(pat, "GET", `${base}/git/ref/heads/${branch}`, `đọc nhánh ${branch}`, [200])) as {
      object?: { sha?: unknown };
    };
    const parentSha = typeof ref?.object?.sha === "string" ? ref.object.sha : "";
    if (parentSha.length === 0) throw new RepoError(`Không đọc được sha của nhánh ${branch}.`);

    const parentCommit = (await demand(
      pat,
      "GET",
      `${base}/git/commits/${seg(parentSha)}`,
      "đọc commit đầu nhánh",
      [200],
    )) as { tree?: { sha?: unknown } };
    const baseTree = typeof parentCommit?.tree?.sha === "string" ? parentCommit.tree.sha : "";
    if (baseTree.length === 0) throw new RepoError("Commit đầu nhánh không kèm sha của cây.");

    const treeBody = (await demand(
      pat,
      "GET",
      `${base}/git/trees/${seg(baseTree)}?recursive=1`,
      "đọc cây tệp của kho",
      [200],
    )) as { tree?: unknown; truncated?: unknown };

    /**
     * `truncated` là chỗ phải DỪNG chứ không phải chỗ cố tiếp.
     *
     * GitHub cắt bớt cây khi nó quá lớn, và một cây cắt dở làm phép so ra kết quả SAI theo hướng
     * tệ nhất: tệp không thấy trong danh sách trông y như tệp chưa có, nên lượt phát hành sẽ ghi
     * đè bừa và (tệ hơn) phép tính XOÁ đọc thiếu. Gói khôi lỗi có 20 tệp nên chuyện này gần như
     * không thể xảy ra — mà "gần như" thì vẫn phải có nhánh, vì hậu quả là xoá nhầm tệp.
     */
    if (treeBody?.truncated === true) {
      throw new RepoError(
        "GitHub cắt bớt cây tệp của kho (truncated) — phép so sẽ sai, và phép XOÁ sẽ sai theo hướng nguy hiểm. Dừng.",
      );
    }

    const remote = new Map<string, string>();
    for (const entry of Array.isArray(treeBody?.tree) ? treeBody.tree : []) {
      const item = entry as { path?: unknown; type?: unknown; sha?: unknown };
      if (item?.type !== "blob") continue;
      if (typeof item.path !== "string" || typeof item.sha !== "string") continue;
      remote.set(item.path, item.sha);
    }

    // 5.4 — Kế hoạch.
    const files = payloadFor(workerId, webUrl);
    const localShas = new Map<string, string>();
    for (const [path, bytes] of files) localShas.set(path, gitBlobSha(bytes));

    const plan = planKhoiloiTree({ payload: localShas, remote, ownedPrefixes: OWNED_PREFIXES });

    if (plan.changed.length === 0 && plan.removed.length === 0) {
      // Kho đã đúng bản VẪN có thể đang chạy mã cũ: mã trong kho là một chuyện, mã mà lượt Actions
      // đang chạy đã checkout từ trước lại là chuyện khác. Đây chính là cảnh sau một lượt phát
      // hành — và là lý do `--restart` phải chạy được cả trên nhánh này.
      const note = restart
        ? await restartRuns({ pat, base, branch, workflowFile: station.workflowFile, workerId, headSha: parentSha })
        : undefined;
      return {
        slug,
        state: "đã đúng bản",
        detail: `${workerId} · ${plan.unchanged} tệp khớp${idNote}`,
        restart: note,
      };
    }

    const summary =
      `${workerId} · ${plan.changed.length} tệp đổi` +
      (plan.removed.length > 0 ? `, ${plan.removed.length} xoá` : "") +
      `, ${plan.unchanged} giữ nguyên${idNote}`;

    console.log(`\n── ${slug} ─────────────────────────────`);
    console.log(`   worker id ${workerId}   ·   web ${webUrl}   ·   nhánh ${branch}`);
    for (const path of plan.changed) console.log(`   ~ ${path}`);
    for (const path of plan.removed) console.log(`   - ${path} (XOÁ)`);

    if (dryRun) {
      const note = restart
        ? await restartRuns({ pat, base, branch, workflowFile: station.workflowFile, workerId, headSha: parentSha })
        : undefined;
      return { slug, state: "kế hoạch", detail: summary, restart: note };
    }

    // 5.5 — Tải blob. Sha GitHub trả về phải khớp sha tính dưới máy: hai phép băm độc lập trên
    // cùng một nội dung, nên lệch nhau nghĩa là nội dung đã bị méo trên đường đi (base64 hỏng,
    // hay một phép chuẩn hoá kết thúc dòng chen vào). Bắt ở đây, đừng để nó thành một kho chạy
    // mã lạ.
    const treeEntries: Array<Record<string, unknown>> = [];
    for (const path of plan.changed) {
      const bytes = files.get(path)!;
      const blob = (await demand(pat, "POST", `${base}/git/blobs`, `tải blob ${path}`, [201], {
        content: bytes.toString("base64"),
        encoding: "base64",
      })) as { sha?: unknown };
      const sha = typeof blob?.sha === "string" ? blob.sha : "";
      if (sha !== localShas.get(path)) {
        throw new RepoError(
          `Sha của ${path} lệch nhau: dưới máy ${localShas.get(path)}, GitHub trả ${sha || "(không có)"} — nội dung bị méo trên đường đi.`,
        );
      }
      treeEntries.push({ path, mode: FILE_MODE, type: "blob", sha });
    }
    // `sha: null` là cách Git Data API diễn đạt "xoá khỏi cây" khi có `base_tree`.
    for (const path of plan.removed) {
      treeEntries.push({ path, mode: FILE_MODE, type: "blob", sha: null });
    }

    const tree = (await demand(pat, "POST", `${base}/git/trees`, "dựng cây mới", [201], {
      base_tree: baseTree,
      tree: treeEntries,
    })) as { sha?: unknown };
    const treeSha = typeof tree?.sha === "string" ? tree.sha : "";
    if (treeSha.length === 0) throw new RepoError("GitHub không trả sha của cây vừa dựng.");
    if (treeSha === baseTree) {
      throw new RepoError(
        "Cây mới trùng cây cũ dù kế hoạch nói có tệp đổi — đừng tạo một commit rỗng; soi lại phép so sha.",
      );
    }

    const commit = (await demand(pat, "POST", `${base}/git/commits`, "tạo commit", [201], {
      message: `chore(khoiloi): cập nhật gói (${headSha})`,
      tree: treeSha,
      parents: [parentSha],
      author: COMMIT_AUTHOR,
      committer: COMMIT_AUTHOR,
    })) as { sha?: unknown };
    const commitSha = typeof commit?.sha === "string" ? commit.sha : "";
    if (commitSha.length === 0) throw new RepoError("GitHub không trả sha của commit vừa tạo.");

    // Không `force`: nhánh nhích dưới chân lượt này thì phải HỎNG chứ không được đè.
    await demand(pat, "PATCH", `${base}/git/refs/heads/${branch}`, `nhích nhánh ${branch}`, [200], {
      sha: commitSha,
    });

    // 5.6 — Nghiệm thu. „200" mới chỉ là lời hứa; đọc lại ref mới là bằng chứng. Cùng kỷ luật với
    // lượt `github:remove` đòi một `GET` trả 404 sau khi xoá kho.
    const after = (await demand(
      pat,
      "GET",
      `${base}/git/ref/heads/${branch}`,
      "đọc lại nhánh để nghiệm thu",
      [200],
    )) as { object?: { sha?: unknown } };
    if (after?.object?.sha !== commitSha) {
      throw new RepoError(
        `Đẩy xong mà nhánh ${branch} không trỏ vào commit vừa tạo (${commitSha.slice(0, 7)}) — có lượt đẩy khác chen vào?`,
      );
    }

    // Khởi động lại đứng SAU phép nghiệm thu và dùng chính commit vừa tạo làm mốc「mã mới」, nên
    // nó không bao giờ huỷ nhầm một lượt chạy đã mang bản này.
    const note = restart
      ? await restartRuns({ pat, base, branch, workflowFile: station.workflowFile, workerId, headSha: commitSha })
      : undefined;

    return { slug, state: "đã đẩy", detail: `${summary} → ${commitSha.slice(0, 7)}`, restart: note };
  } catch (err) {
    if (err instanceof RepoError) return { slug, state: "HỎNG", detail: err.message };
    const detail = err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "không có câu chữ";
    return { slug, state: "HỎNG", detail: `Lỗi không lường trước (${detail})` };
  }
}

// ---- 6. Vòng qua từng kho ---------------------------------------------------------------------

const outcomes: Outcome[] = [];
for (const station of targets) {
  outcomes.push(await deployOne(station));
}

// ---- 7. Tổng kết ------------------------------------------------------------------------------

const broken = outcomes.filter((o) => o.state === "HỎNG");
const pushed = outcomes.filter((o) => o.state === "đã đẩy");
const already = outcomes.filter((o) => o.state === "đã đúng bản");

console.log("\n── Tổng kết ─────────────────────────────────────────");
console.log(`  gói     : commit ${headSha}`);
for (const o of outcomes) {
  const mark = o.state === "HỎNG" ? "✗" : o.state === "đã đúng bản" ? "=" : dryRun ? "·" : "✔";
  console.log(`  ${mark} ${o.slug.padEnd(34)} ${o.state.padEnd(12)} ${o.detail}`);
  if (o.restart) console.log(`      ↻ ${o.restart}`);
}

if (dryRun) {
  console.log("\n  --dry-run: KHÔNG đẩy gì cả. Bỏ cờ ấy để phát hành thật.");
} else if (pushed.length > 0 && !restart) {
  console.log(
    `\n  ${pushed.length} kho đã nhận gói mới. Lượt chạy Actions ĐANG chạy vẫn dùng mã cũ của nó —\n` +
      "  bản mới có hiệu lực ở lượt kế, tối đa ~4 giờ (lịch 0 */4 * * *). Cần ngay thì thêm\n" +
      "  --restart: nó huỷ lượt mang mã cũ, nhưng CHỪA khôi lỗi đang giữ đàn.",
  );
}
if (already.length > 0 && pushed.length === 0 && !dryRun) {
  console.log("\n  Mọi kho đã mang đúng gói này — không commit nào được tạo ra.");
}

if (broken.length > 0) {
  console.log(`\n  ${broken.length} kho LỆCH MÃ — vẫn đang chạy bản cũ. Chữa xong thì chạy lại lệnh này.`);
  process.exit(1);
}
if (rejected.length > 0) process.exit(1);
