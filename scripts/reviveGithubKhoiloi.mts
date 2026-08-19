#!/usr/bin/env node
/**
 * HỒI SINH KHÔI LỖI GITHUB ĐÃ CHẾT ĐỨNG — cắt lượt Actions đang treo rồi phát lượt mới.
 *
 *   npm run github:revive                       mọi kho đang bật trong sổ
 *   npm run github:revive -- --dry-run          soi danh sách, KHÔNG cắt gì
 *   npm run github:revive -- --repo <tên kho>   đúng một kho
 *   npm run github:revive -- --away 30          đổi ngưỡng im lặng (phút, mặc định 10)
 *
 * ── VÌ SAO CẦN, KHI ĐÃ CÓ `github:deploy --restart` ──────────────────────────────────────────
 *
 * Hai lệnh trả lời hai câu hỏi khác nhau, bằng hai loại bằng chứng khác nhau (lý lẽ đầy đủ ở
 * `reviewRevive` trong githubKhoiloi.mts):
 *
 *   `--restart` hỏi「lượt đang chạy có mang MÃ CŨ không」— bằng chứng là `head_sha` — và nó CHỪA
 *   khôi lỗi đang giữ đàn, đúng như phải thế: cắt một runner đang cày là cắt vòng chạy của một
 *   đạo hữu.
 *
 *   Lệnh này hỏi「khôi lỗi còn SỐNG không」— bằng chứng là sổ điểm danh. Một runner đã ngừng gõ
 *   cửa hàng giờ là một cái xác còn chiếm ghế: tab Khôi Lỗi hiện nó xám kèm「vắng 1 giờ 37 phút」,
 *   và cái ghế ấy không nhận đàn nào nữa cho tới lượt Actions kế — tối đa bốn giờ. Cắt nó không
 *   mất gì, vì `reapStaleJobs` đã tước sạch đàn của nó từ phút thứ ba.
 *
 * Đó cũng là lý do lệnh này KHÔNG đẩy mã: nó không sửa một byte nào trong kho, chỉ dựng lại tiến
 * trình. Muốn vừa hồi sinh vừa nâng bản thì chạy `github:deploy --restart` trước, lệnh này sau.
 *
 * ── HÀNG RÀO ─────────────────────────────────────────────────────────────────────────────────
 *
 * NGƯỠNG là hàng rào duy nhất, và vì thế nó phải rộng: mặc định 10 phút = 20 lần cửa sổ「vắng
 * mặt」của sổ điểm danh. Khôi lỗi đang khoẻ gõ cửa mỗi 5 giây nên không đời nào lọt vào danh
 * sách; một lượt bàn giao giữa hai lượt Actions cũng không bị hiểu nhầm là cái chết.
 *
 * Lượt ĐANG XẾP HÀNG thì KHÔNG bị cắt — nó chính là thứ sắp hồi sinh khôi lỗi ấy.
 */
import { sqlTag } from "./pgTag.mjs";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import {
  DEFAULT_WORKFLOW_FILE,
  explainFailure,
  reviewStationIdentity,
  stationSlug,
} from "../src/lib/validation/githubStations";
import {
  REVIVE_AWAY_MS,
  activeRuns,
  resolveDeployWorkerId,
  reviewRevive,
  workerIdFromWorkflow,
} from "./githubKhoiloi.mts";
import { appDatabaseUrl } from "./activeStationPg.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  const value = argv[at + 1];
  return at > -1 && value && !value.startsWith("--") ? value : undefined;
};
const onlyRepo = arg("repo");

const die = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/** `--away <phút>`. Phải là số dương: ngưỡng 0 biến lệnh này thành một cái máy cắt bừa. */
const awayMs = ((): number => {
  const raw = arg("away");
  if (raw === undefined) return REVIVE_AWAY_MS;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    die(`--away phải là số phút dương, nhận「${raw}」.`);
  }
  return minutes * 60_000;
})();

const API_ROOT = "https://api.github.com";
/** Ghim tường minh, cùng lẽ với vòng nuôi kho: một API mặc định trôi sang bản sau là hỏng lặng lẽ. */
const API_VERSION = "2022-11-28";
/** GitHub TỪ CHỐI request không có User-Agent — 403 kèm một câu khó đoán nếu quên. */
const USER_AGENT = "auto-hh3d-revive";
const REQUEST_TIMEOUT_MS = 30_000;

const seg = (value: string): string => encodeURIComponent(value);

/**
 * Chỉ chữ-số và bốn ký tự lành mới được ghép thẳng vào `ref` — bản sao đúng của phép soát bên
 * `deployGithubKhoiloi.mts`. Nhánh được phép mang `/`, và mã hoá nó thành `%2F` là hỏi một ref
 * không tồn tại rồi nhận 404 khó hiểu; nên soát chứ không mã hoá.
 */
const SAFE_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/**
 * Nhánh mặc định của kho — HỎI GitHub chứ không đoán là `main`.
 *
 * Chỉ gọi khi sắp phát lượt mới, nên kho nào chỉ bị cắt (đã có lượt xếp hàng) không phải trả
 * thêm một vòng đi-về. Đoán bừa ở đây là một `dispatches` trả 422 kèm câu khó hiểu, đúng vào
 * lúc người vận hành đang chữa cháy.
 */
async function defaultBranchOf(pat: string, base: string): Promise<string> {
  const info = (await demand(pat, "GET", base, "hỏi nhánh mặc định của kho", [200])) as {
    default_branch?: unknown;
  } | null;
  const branch = typeof info?.default_branch === "string" ? info.default_branch : "";
  if (branch.length === 0) {
    throw new RepoError("GitHub không khai `default_branch` cho kho này — không biết phát lượt vào nhánh nào.");
  }
  if (!SAFE_BRANCH_RE.test(branch)) {
    throw new RepoError(`Tên nhánh mặc định「${branch}」mang ký tự lạ — không ghép an toàn vào URL được.`);
  }
  return branch;
}

type Station = {
  owner: string;
  repo: string;
  workflowFile: string;
  workerId: string;
  pat: string;
  enabled: boolean;
};

type Reply = { status: number; body: unknown };

/** Lỗi của MỘT kho — bắt ở vòng ngoài, để một kho hỏng không chặn các kho còn lại. */
class RepoError extends Error {}

async function callGithub(
  pat: string,
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>,
): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Quá hạn chờ ném `TimeoutError`, đứt mạng ném `TypeError` — cả hai đều phải nói ra ĐANG GỌI
    // GÌ, bằng không một dòng「fetch failed」trần trụi chẳng chỉ được ai về đâu.
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `quá ${REQUEST_TIMEOUT_MS / 1000}s không trả lời`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "lỗi lạ";
    throw new RepoError(`${method} ${path} không tới được GitHub (${reason})`);
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* GitHub trả HTML ở vài cảnh lỗi — giữ nguyên chuỗi để câu báo lỗi còn đọc được */
  }
  return { status: response.status, body };
}

async function demand(
  pat: string,
  method: "GET" | "POST",
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

// ---- Sổ Kho GitHub + sổ điểm danh -----------------------------------------------------------

const sql = sqlTag(appDatabaseUrl());

const settingsRows = (await sql`
  SELECT value -> 'githubStations' AS stations FROM app_settings WHERE id = 'global'
`) as Array<{ stations: unknown }>;

const raw = settingsRows[0]?.stations;
if (raw != null && !Array.isArray(raw)) {
  die("Sổ Kho GitHub trong app_settings không phải một mảng — sửa tay JSONB hỏng? Soi tab Kho GitHub.");
}

const stations: Station[] = [];
for (const row of (raw ?? []) as Array<Record<string, unknown>>) {
  const owner = String(row?.owner ?? "");
  const repo = String(row?.repo ?? "");
  const workflowFile = String(row?.workflowFile ?? DEFAULT_WORKFLOW_FILE) || DEFAULT_WORKFLOW_FILE;
  if (reviewStationIdentity(owner, repo, workflowFile)) continue;
  stations.push({
    owner,
    repo,
    workflowFile,
    workerId: String(row?.workerId ?? ""),
    pat: String(row?.pat ?? ""),
    enabled: row?.enabled !== false,
  });
}

if (stations.length === 0) die("Sổ Kho GitHub trống — không có khôi lỗi nào để hồi sinh.");

/**
 * Sổ điểm danh, CHỈ khôi lỗi tông môn (`user_id is null`).
 *
 * Không đụng tới khôi lỗi riêng: máy ở nhà đạo hữu không do lệnh này dựng lên, và một dòng trùng
 * tên bên ấy không được phép quyết định số phận một lượt Actions của tông môn.
 */
const seenRows = (await sql`
  SELECT id, last_seen FROM workers WHERE user_id IS NULL
`) as Array<{ id: string; last_seen: Date | string }>;

const lastSeenById = new Map<string, Date>();
for (const row of seenRows) {
  lastSeenById.set(row.id, row.last_seen instanceof Date ? row.last_seen : new Date(row.last_seen));
}

/** `--repo` chạm được cả dòng đang TẮT (cùng lối `github:deploy`): tắt là đứng ngoài vòng chạy
 *  hàng loạt, không phải bị cấm sờ tới khi người vận hành gọi đích danh. */
const picked = stations.filter((station) =>
  onlyRepo ? station.repo.toLowerCase() === onlyRepo.toLowerCase() : station.enabled,
);

if (picked.length === 0) {
  die(onlyRepo ? `Sổ không có kho nào tên「${onlyRepo}」.` : "Sổ không có kho nào đang bật.");
}

// ---- Soi từng kho ---------------------------------------------------------------------------

type Outcome = { slug: string; state: "đã hồi sinh" | "còn trực" | "HỎNG"; detail: string };

const outcomes: Outcome[] = [];
const now = new Date();

console.log("");
console.log(
  `Soi ${picked.length} kho · ngưỡng im lặng ${Math.round(awayMs / 60_000)} phút${dryRun ? " · XEM TRƯỚC" : ""}`,
);
console.log("");

for (const station of picked) {
  const slug = stationSlug(station);
  const base = `/repos/${seg(station.owner)}/${seg(station.repo)}`;

  try {
    if (station.pat.length === 0) {
      throw new RepoError("Dòng sổ không có PAT — mở tab Kho GitHub dán lại chìa rồi chạy lại.");
    }
    const pat = isEncrypted(station.pat) ? decryptSecret(station.pat) : station.pat;

    /**
     * WORKER_ID: sổ trước, tệp workflow sau — cùng luật (và cùng hàm) với lượt phát hành.
     *
     * Đoán bừa ở đây tốn hơn bên ấy một bậc: một id sai nghĩa là đọc sổ điểm danh của một khôi
     * lỗi KHÁC, rồi cắt lượt Actions của kho này vì cái xác của kho kia.
     */
    let workerId = station.workerId.trim();
    if (workerId.length === 0) {
      const file = (await demand(
        pat,
        "GET",
        `${base}/contents/.github/workflows/${seg(station.workflowFile)}`,
        `đọc ${station.workflowFile} để tìm WORKER_ID`,
        [200],
      )) as { content?: unknown; encoding?: unknown } | null;
      const yaml =
        typeof file?.content === "string" && file.encoding === "base64"
          ? Buffer.from(file.content, "base64").toString("utf8")
          : "";
      const chosen = resolveDeployWorkerId({ fromBook: "", fromWorkflow: workerIdFromWorkflow(yaml) });
      if (!chosen.ok) throw new RepoError(chosen.message);
      workerId = chosen.workerId;
    }

    const lastSeen = lastSeenById.get(workerId) ?? null;
    const runsBody = await demand(
      pat,
      "GET",
      `${base}/actions/workflows/${seg(station.workflowFile)}/runs?per_page=20`,
      "hỏi danh sách lượt chạy Actions",
      [200],
    );
    const verdict = reviewRevive({ lastSeen, now, awayMs, runs: activeRuns(runsBody) });

    if (!verdict.go) {
      outcomes.push({ slug, state: "còn trực", detail: verdict.message });
      console.log(`  = ${slug.padEnd(36)} ${workerId.padEnd(30)} ${verdict.message}`);
      continue;
    }

    const away =
      lastSeen == null
        ? "chưa từng điểm danh"
        : `vắng ${Math.round((now.getTime() - lastSeen.getTime()) / 60_000)} phút`;

    if (dryRun) {
      outcomes.push({ slug, state: "đã hồi sinh", detail: `(sẽ) ${verdict.message}` });
      console.log(`  ↻ ${slug.padEnd(36)} ${workerId.padEnd(30)} ${away} → SẼ ${verdict.message}`);
      continue;
    }

    for (const run of verdict.cancel) {
      // 202 = đã nhận lệnh huỷ; 409 = lượt ấy vừa tự kết thúc trong lúc ta đọc. Cả hai đều nghĩa
      // là「không còn lượt treo nào nữa」, tức đúng thứ đang muốn — cùng cách đọc với lượt phát hành.
      const reply = await callGithub(pat, "POST", `${base}/actions/runs/${run.id}/cancel`);
      if (reply.status !== 202 && reply.status !== 409) {
        throw new RepoError(explainFailure(reply.status, reply.body, `huỷ lượt chạy #${run.number ?? run.id}`));
      }
    }

    if (verdict.dispatch) {
      const branch = await defaultBranchOf(pat, base);
      await demand(
        pat,
        "POST",
        `${base}/actions/workflows/${seg(station.workflowFile)}/dispatches`,
        "phát một lượt chạy mới",
        [204],
        { ref: branch },
      );
    }

    outcomes.push({ slug, state: "đã hồi sinh", detail: verdict.message });
    console.log(`  ↻ ${slug.padEnd(36)} ${workerId.padEnd(30)} ${away} → ${verdict.message}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    outcomes.push({ slug, state: "HỎNG", detail });
    console.log(`  ✗ ${slug.padEnd(36)} ${detail.split("\n")[0]}`);
  }
}

// ---- Tổng kết -------------------------------------------------------------------------------

const alive = outcomes.filter((o) => o.state === "còn trực");
const revived = outcomes.filter((o) => o.state === "đã hồi sinh");
const broken = outcomes.filter((o) => o.state === "HỎNG");

console.log("");
console.log("── Tổng kết ─────────────────────────────────────────");
console.log(`  còn trực    : ${alive.length}`);
console.log(`  ${dryRun ? "sẽ hồi sinh " : "đã hồi sinh "}: ${revived.length}`);
if (broken.length > 0) {
  console.log(`  HỎNG        : ${broken.length}`);
  for (const row of broken) {
    console.log("");
    console.log(`  ✗ ${row.slug}`);
    for (const line of row.detail.split("\n")) console.log(`    ${line}`);
  }
}

if (dryRun) {
  console.log("");
  console.log("  --dry-run: KHÔNG cắt và KHÔNG phát lượt nào. Bỏ cờ ấy để làm thật.");
} else if (revived.length > 0) {
  console.log("");
  console.log("  Lượt Actions mới cần ~30 giây để lên ca — xem lại tab Khôi Lỗi để chắc chúng đã trực.");
}

process.exit(broken.length > 0 ? 1 : 0);
