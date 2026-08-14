#!/usr/bin/env node
/**
 * DỰNG MỘT TRẠM GƯƠNG MỚI — một lượt chạy, từ tài khoản Vercel trắng tới trạm nằm trong sổ.
 *
 *   MIRROR_TOKEN=<token> npm run mirror:new -- --site auto-hh3d-3
 *   npm run mirror:new -- --site auto-hh3d-3 --dry-run      (chỉ kiểm điều kiện, không tạo gì)
 *
 * Hoặc bấm đúp `new-mirror-station.bat` — nó hỏi hai câu rồi gọi vào đây.
 *
 * `--project <tên>` khi tên project Vercel KHÁC mã trạm. Mặc định hai thứ trùng nhau và nên cứ
 * để vậy — lệ「một cái tên cho cả ba chỗ」(README §9) là thứ khiến không ai phải tra bảng đối
 * chiếu bao giờ:
 *
 *   MIRROR_TOKEN=<token> npm run mirror:new -- --site <mã> --project <tên project>
 *
 * Cờ này sinh ra ngày 12/08/2026 cho trạm GỐC, hồi nó mang mã `main` mà sống ở project
 * `auto-hh3d` — dựng tay từ trước khi có lệ đặt tên, và vì thế là trạm DUY NHẤT không dựng lại
 * được. Ca ấy nay đã hết: 13/08/2026 trạm gốc được dựng lại thành mã `auto-hh3d`, trùng tên
 * project, nên hiện KHÔNG trạm nào cần cờ này. Giữ lại vì bài học thì chưa hết hạn — ngày nào
 * còn một trạm mang tên lệch thì đây là đường về, và không có nó thì đường ấy không tồn tại.
 *
 * VÌ SAO CẦN: checklist tay ở deploy/mirror/README.md §9 là mười bước, và ba trong số đó là bẫy
 * đã trả giá thật (11/08/2026, lúc dựng trạm thứ ba):
 *   • tên gói của Neon/Atlas phải TRA bằng `--help`, đoán là hỏng;
 *   • sổ gương phải ghi ở TRẠM ĐANG HOẠT ĐỘNG — ghi vào trạm dự phòng là ghi vào thứ sẽ bị đè;
 *   • integration chưa cài trên team thì lượt dựng chết giữa chừng, sau khi project đã tạo.
 * Một lệnh làm đúng thứ tự thì ba cái bẫy ấy không còn chỗ để vấp.
 *
 * CÁI NÓ KHÔNG LÀM, và không nên làm: cài integration lần đầu lên một team trắng. Việc ấy đòi
 * chấp thuận điều khoản pháp lý, và Vercel CỐ Ý bắt buộc có người thật ngồi trước máy. Script
 * kiểm điều kiện ấy TRƯỚC KHI tạo bất cứ thứ gì, rồi dừng với lời chỉ dẫn — thay vì tạo nửa
 * chừng rồi bỏ lại rác trên tài khoản.
 *
 * KHÔNG TỰ PHÁT HÀNH. Dựng xong nó bảo chạy `deploy-all-stations.bat`. Tách đôi có chủ ý: dựng
 * là việc một lần, phát hành là việc lặp lại, và gộp chúng nghĩa là mỗi lần deploy phải mang
 * theo cả bộ mã dựng trạm.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import { resolveMongoDbName } from "../src/lib/mongo/dbName";
import {
  randomStoreName,
  sensitiveEnvKeys,
  stationUrlFor,
  STORE_REGION,
  STORE_SPECS_SHARED,
  tokenEnvNameFor,
  upsertEnvLine,
  validateSiteId,
  type Book,
  type ProjectEnvVar,
} from "./deployTargets.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
// Tắt riêng DeprecationWarning, không tắt mọi cảnh báo.
//
// Node kêu「shell: true … security vulnerabilities」mỗi lượt gọi `vercel`, mà ta BUỘC phải bật
// shell: trên Windows `vercel` là một tệp .cmd, không có shell thì execFile trả ENOENT. Đối số
// truyền vào đều là chuỗi cố định của chính script, còn token thì đi bằng biến môi trường —
// đúng cái mà cảnh báo ấy lo. Để nó in ba lần trong một công cụ bấm-đúp là dọa người dùng về
// một nguy cơ không có thật; các cảnh báo KHÁC vẫn in như thường.
process.noDeprecation = true;


const repoRoot = path.join(import.meta.dirname, "..");
const ENV_FILE = path.join(repoRoot, ".env.local");

/**
 * DẠNG BIẾN MÔI TRƯỜNG trên Vercel — `encrypted`, và TUYỆT ĐỐI KHÔNG `sensitive`.
 *
 * Vercel có ba dạng: `plain` (hiện nguyên văn trên dashboard), `encrypted` (mã hoá at-rest
 * nhưng ĐỌC LẠI ĐƯỢC bằng `vercel env pull` / API), và `sensitive` (chỉ ghi được, không đời nào
 * đọc lại). Cả `plain` lẫn `encrypted` đều là「non-sensitive」; ta chọn `encrypted`.
 *
 * VÌ SAO `sensitive` LÀ CẤM Ở ĐÂY, dù nghe có vẻ an toàn hơn: cả hệ gương trạm đứng trên việc
 * ĐỌC LẠI được env của một trạm.
 *   • `newMirrorStation` bước 5 phải `vercel env pull` để lấy chuỗi kết nối mà integration vừa
 *     tiêm — không đọc được thì không có gì để ghi vào sổ, và trạm ra đời nửa vời.
 *   • `npm run env:pull` là đường duy nhất mang bí mật của một trạm về máy vận hành khi cần dựng
 *     lại, xoay khoá, hay cứu một trạm cụt đường về.
 * Một biến `sensitive` không hỏng ngay: nó hỏng vào ĐÚNG cái ngày người ta cần đọc nó, và lúc ấy
 * không còn bản sao nào. Đo 12/08/2026: `auto-hh3d` có 18 biến sensitive và `auto-hh3d-1` có 7
 * (đúng bộ bí mật dùng chung) — cả hai đều dựng trước khi script này chốt dạng biến.
 */
const ENV_TYPE = "encrypted";

/** Bí mật DÙNG CHUNG ở mọi trạm — bảng「phải giống nhau」của README §9. */
const SHARED_SECRETS = [
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "WORKER_TOKEN",
  "CRON_SECRET",
  "GIPHY_API_KEY",
  "OCI_REGION",
  "OCI_NAMESPACE",
  "OCI_BUCKET",
  "OCI_ACCESS_KEY_ID",
  "OCI_SECRET_ACCESS_KEY",
] as const;

/**
 * Hai kho mỗi trạm phải có — định nghĩa (kèm metadata bắt buộc và region) nằm ở
 * `deployTargets.mts`, module THUẦN, để `verify:deploy-targets` đóng đinh được.
 *
 * Cố ý KHÔNG dùng `--prefix`: prefix đổi tên biến (`--prefix NEON2_` cho ra `NEON2_DATABASE_URL`)
 * và trạm gốc từng dựng tay với `hh3d_`, khiến `DATABASE_URL` phải đặt tay riêng — thứ về sau
 * nằm lại dưới dạng sensitive. Tên trần là tên mà mã nguồn đọc.
 */
const STORE_SPECS = STORE_SPECS_SHARED;

/**
 * TÊN KHO NGẪU NHIÊN HOÀN TOÀN — không mang một chữ nào của tông môn.
 *
 * Hai đời trước của chỗ này đều sai theo hai kiểu khác nhau:
 *   • hằng số (`jarvis-hh3d`, `atlas-jarvis-chat`), lệ cũ 10/08/2026 còn bắt mọi tài khoản đặt
 *     TRÙNG TÊN. Gãy đúng lúc dựng LẠI một trạm: xoá kho cũ rồi dựng kho mới cùng tên trên cùng
 *     tài khoản thì trong dashboard không phân biệt nổi cái vừa dựng với cái vừa xoá.
 *   • tiền tố + đuôi ngẫu nhiên (`jarvis-hh3d-acd9b0`). Hết trùng tên, nhưng cái tên vẫn KHAI
 *     ra nó thuộc về ai — mà mỗi trạm gương sống trên một tài khoản Vercel riêng, và một cái
 *     tên chung là sợi dây nối các tài khoản ấy lại với nhau trong mắt bất kỳ ai nhìn vào.
 *
 * Nên: mỗi kho một chuỗi ngẫu nhiên riêng, không tiền tố, không đuôi chung. Muốn biết kho nào
 * của trạm nào thì nhìn PROJECT ĐANG NỐI trong dashboard — đó mới là sợi dây thật, và nó đã
 * luôn ở đó. Tên hai kho cũng in ra ở cuối lượt dựng.
 *
 * KHÔNG có gì hạ nguồn đọc cái tên này (đo 12/08/2026): database Postgres bên trong là `neondb`
 * do Neon đặt, database Mongo là `jarvis` do `MONGO_DEFAULT_DB`, còn ứng dụng chỉ đọc
 * `DATABASE_URL`/`MONGODB_URI`. Đổi tên kho không chạm vào cái nào trong số đó.
 *
 * Phép sinh tên nằm ở `deployTargets.mts` — module THUẦN, để lời hứa「không mang chữ của tông
 * môn」có chỗ đóng đinh bằng phép thử thay vì chỉ là một bình chú.
 */
const STORES = STORE_SPECS.map((s) => ({ ...s, name: randomStoreName(randomBytes) }));

const QUICK_MS = 60_000;
const PROVISION_MS = 10 * 60_000;
const API_MS = 30_000;

/**
 * Chú kiểu nằm trên BIẾN, không phải trên arrow — và đó là điều kiện, không phải gu.
 *
 * TypeScript chỉ dùng một hàm「không bao giờ trả về」để thu hẹp kiểu khi nó là khai báo hàm,
 * hoặc là `const` CÓ chú kiểu tường minh. Viết `const die = (m: string): never => …` thì mọi
 * `if (!x) die(…)` bên dưới KHÔNG thu hẹp `x`, và cả tệp đầy lỗi「possibly null」giả — 16 lỗi
 * đúng loại ấy, tất cả tan biến chỉ nhờ dòng này.
 */
const die: (message: string) => never = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");

// ---- 1. Đối số và điều kiện cần ---------------------------------------------------------------

const parsed = validateSiteId(arg("site") ?? "");
if (!parsed.ok) die(`${parsed.message}\n  Ví dụ: npm run mirror:new -- --site auto-hh3d-3`);
const siteId = parsed.siteId;

/**
 * TÊN PROJECT VERCEL — mặc định trùng mã trạm, và `--project` là lối thoát cho một ca CÓ THẬT.
 *
 * Lệ「một cái tên cho cả ba chỗ」(README §9) ghép mã trạm = tên project = nhãn subdomain, và nó
 * đúng cho mọi trạm sinh ra từ công cụ này. Nhưng trạm ĐẦU TIÊN thì dựng bằng tay từ trước khi
 * có lệ ấy: mã trạm là `main`, còn project và địa chỉ là `auto-hh3d`. Không có cờ này thì trạm
 * duy nhất KHÔNG dựng lại được chính là trạm gốc — phát hiện ngày 12/08/2026, khi cần dựng lại
 * nó để gột sạch mấy biến env dạng sensitive.
 *
 * Ràng buộc phải giữ: **địa chỉ trong sổ luôn là `https://<tên project>.vercel.app`**, vì
 * `deployAllStations` suy ngược tên project TỪ địa chỉ (`projectNameFromUrl`) chứ không đọc mã
 * trạm. Nên `stationUrlFor` ở đây nhận tên project, không nhận mã trạm — lệch một chỗ ấy là
 * lượt phát hành sau đi tìm một project không tồn tại.
 *
 * Tên project cũng thành nhãn hostname nên soi bằng ĐÚNG bộ luật của mã trạm.
 */
const projectParsed = validateSiteId(arg("project") ?? siteId);
if (!projectParsed.ok) die(`--project: ${projectParsed.message}`);
const projectName = projectParsed.siteId;

const stationUrl = stationUrlFor(projectName);
/**
 * Tên biến chứa token vẫn suy từ MÃ TRẠM, không từ tên project: token thuộc về TÀI KHOẢN giữ
 * trạm, và mã trạm là thứ người vận hành gọi tên nó.
 *
 * Hệ quả phải biết: một tài khoản dễ có HAI biến token. `--site auto-hh3d` cất
 * `VERCEL_TOKEN_AUTO_HH3D` bên cạnh `VERCEL_TOKEN` sẵn có, và nếu hai chuỗi ấy khác nhau thì
 * `discoverTokens` (khử trùng theo GIÁ TRỊ) không gộp được. Đo 13/08/2026: đúng ca ấy khiến mọi
 * lượt phát hành cho trạm gốc chết với câu「thấy được bằng NHIỀU token — không đoán chủ nhân」.
 * `resolveTarget` nay đếm `projectId` chứ không đếm token, nên hai biến một tài khoản là chuyện
 * bình thường — nhưng vẫn nên dọn biến thừa cho khỏi rối.
 */
const tokenEnvName = tokenEnvNameFor(siteId);

if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");
if (!process.env.ENCRYPTION_KEY) die("Thiếu ENCRYPTION_KEY — không mã hoá nổi chuỗi kết nối để ghi vào sổ.");

const missingShared = SHARED_SECRETS.filter((k) => !(process.env[k] ?? "").trim());
if (missingShared.length > 0) {
  die(`Env dưới máy thiếu ${missingShared.join(", ")} — không chép sang trạm mới được. Chạy \`npm run env:pull\`.`);
}

/**
 * Token: lần đầu truyền qua biến `MIRROR_TOKEN`, script cất luôn vào `.env.local` dưới cái tên
 * suy từ mã trạm. Chạy lại thì không cần truyền nữa — và `deploy:all` cũng nhặt được từ đó.
 *
 * KHÔNG nhận token qua đối số dòng lệnh: đối số nằm trong command line, ai mở Task Manager cũng
 * đọc được.
 */
function resolveToken(): string {
  const fresh = (process.env.MIRROR_TOKEN ?? "").trim();
  const stored = (process.env[tokenEnvName] ?? "").trim();
  if (!fresh) {
    if (stored) return stored;
    die(
      `Chưa có token cho trạm này.\n` +
        `  Cách 1: bấm đúp new-mirror-station.bat (nó hỏi và cất hộ).\n` +
        `  Cách 2: thêm dòng ${tokenEnvName}=<token> vào .env.local rồi chạy lại.`,
    );
  }
  if (stored && stored !== fresh) {
    die(`.env.local đã có ${tokenEnvName} với giá trị KHÁC. Sửa hoặc xoá dòng ấy rồi chạy lại — không ghi đè im lặng.`);
  }
  if (!stored && !dryRun) {
    /**
     * `.env.local` có thể CHƯA tồn tại — máy mới, hoặc người vận hành mới chỉ chạy
     * `vercel env pull .env` (không có `.local`). Bản trước gọi thẳng `readFileSync` nên ca ấy
     * chết bằng một stack ENOENT trần, ở một script mà phần lớn người dùng khởi động bằng cách
     * bấm đúp một tệp .bat. Coi như tệp rỗng và tạo mới; mọi lỗi đọc KHÁC vẫn ném nguyên.
     */
    let text = "";
    try {
      text = readFileSync(ENV_FILE, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const next = upsertEnvLine(text, tokenEnvName, fresh);
    writeFileSync(ENV_FILE, next.text);
    // `replaced` ở đây chỉ có một nghĩa: đã có sẵn một dòng cùng khoá nhưng GIÁ TRỊ RỖNG (giá trị
    // khác rỗng đã bị chặn ở nhánh `stored !== fresh` bên trên). Nói ra để người đọc log biết tệp
    // vừa bị sửa chứ không chỉ được nối thêm.
    console.log(
      `• Đã cất token vào .env.local dưới tên ${tokenEnvName}` +
        (next.replaced ? " (thay một dòng cùng tên đang bỏ trống)" : ""),
    );
  }
  return fresh;
}
const token = resolveToken();

function run(file: string, args: string[], opts: { cwd?: string; timeout: number; shell?: boolean }): string {
  return execFileSync(file, args, {
    cwd: opts.cwd ?? repoRoot,
    timeout: opts.timeout,
    encoding: "utf8",
    shell: opts.shell ?? false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  run("vercel", ["--version"], { timeout: QUICK_MS, shell: true });
} catch {
  die("Không gọi được `vercel`. Cài bằng `npm i -g vercel` rồi chạy lại.");
}

// ---- 2. Tài khoản, team, và hai integration bắt buộc -------------------------------------------

const api = async (p: string, init?: RequestInit) => {
  const res = await fetch(`https://api.vercel.com${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(API_MS),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

const who = await api("/v2/user");
if (!who.ok) die(`Token không dùng được (HTTP ${who.status}). Kiểm lại rồi sửa ${tokenEnvName} trong .env.local.`);
const username = ((who.body?.user as { username?: string } | undefined)?.username ?? "?").trim();

const teamsRes = await api("/v2/teams");
const teams = ((teamsRes.body?.teams ?? []) as { id: string; slug: string }[]) ?? [];
const wantTeam = arg("team");
if (wantTeam && !teams.some((t) => t.slug === wantTeam)) {
  die(`Token này không thấy team「${wantTeam}」. Team nhìn thấy được: ${teams.map((t) => t.slug).join(", ") || "(không có)"}`);
}
if (!wantTeam && teams.length > 1) {
  die(`Tài khoản có ${teams.length} team (${teams.map((t) => t.slug).join(", ")}) — chọn một bằng --team <slug>.`);
}
const team = wantTeam ? teams.find((t) => t.slug === wantTeam)! : teams[0];
if (!team) {
  die(
    "Token không thuộc team nào. Đường tài khoản cá nhân CHƯA được kiểm chứng bao giờ — " +
      "tạo một team trên Vercel rồi chạy lại, hoặc dựng tay theo README §9.",
  );
}
const scope = team.slug;
const teamQuery = `teamId=${team.id}`;
console.log(`• Tài khoản: ${username} · team ${scope}`);

const cfg = await api(`/v1/integrations/configurations?view=account&${teamQuery}`);
const installed = new Set(
  ((Array.isArray(cfg.body) ? cfg.body : ((cfg.body?.configurations ?? []) as unknown[])) as { slug?: string }[])
    .map((c) => c.slug)
    .filter((s): s is string => Boolean(s)),
);
const notInstalled = STORES.filter((s) => !installed.has(s.slug));
if (notInstalled.length > 0) {
  die(
    `Team「${scope}」chưa cài: ${notInstalled.map((s) => s.label).join(", ")}.\n` +
      "  Lần đầu cài một integration đòi CHẤP THUẬN ĐIỀU KHOẢN, và Vercel cố ý bắt buộc có người thật —\n" +
      "  không script nào vượt được, và cũng không nên. Mở terminal của chính đạo hữu rồi chạy:\n" +
      notInstalled.map((s) => `    vercel integration accept-terms ${s.slug} --scope ${scope}`).join("\n") +
      "\n  Xong thì chạy lại lệnh này. (Kiểm TRƯỚC khi tạo gì để không bỏ lại rác trên tài khoản.)",
  );
}
console.log(`• Integration đã cài đủ: ${STORES.map((s) => s.label).join(", ")}`);

// ---- 3. Trùng tên? ------------------------------------------------------------------------------

const existing = await api(`/v9/projects/${projectName}?${teamQuery}`);
if (existing.ok) die(`Team này đã có project「${projectName}」. Chọn tên khác, hoặc xoá project cũ trước (README §9 bẫy 3).`);

const readBook = async (url: string): Promise<Book> => {
  const rows = (await neon(url)`select value from app_settings where id = 'global'`) as { value: unknown }[];
  return (rows[0]?.value ?? {}) as Book;
};

/** Sổ có thẩm quyền nằm ở TRẠM ĐANG HOẠT ĐỘNG — xem chú thích của `chooseBook`. */
const doc = await readControlDoc();
if (!doc) die("Không đọc được bảng điều phối — chưa biết trạm nào đang hoạt động thì không dám ghi sổ.");
const localBook = await readBook(process.env.DATABASE_URL);
const activeEntry = (localBook.mirrors ?? []).find((m) => m.id === doc.activeSiteId);
if (!activeEntry?.pg) {
  die(
    `Sổ dưới máy không có chuỗi kết nối của trạm hoạt động「${doc.activeSiteId}」— không tới được sổ thật.\n` +
      "  Vào trang Tông Môn → Gương Trạm, bấm「Ghi trạm này vào sổ」trên trạm ấy rồi chạy lại.",
  );
}
const activeUrl = decryptSecret(activeEntry.pg);
const book = await readBook(activeUrl);
if ((book.mirrors ?? []).some((m) => m.id === siteId)) {
  die(`Sổ ở trạm hoạt động「${doc.activeSiteId}」đã có trạm「${siteId}」. Xoá entry cũ trên trang admin trước.`);
}

console.log(`• Sổ có thẩm quyền: trạm hoạt động「${doc.activeSiteId}」(${(book.mirrors ?? []).length} trạm)`);
console.log(`\n── Sẽ dựng ──────────────────────────────────────────`);
console.log(`  mã trạm   : ${siteId}`);
console.log(`  địa chỉ   : ${stationUrl}`);
console.log(`  project   : ${projectName} trên team ${scope}`);
console.log(
  `  kho       : ${STORES.map(
    (s) => `${s.name} (${s.label}, gói ${s.plan}${s.metadata.length > 0 ? `, ${s.metadata.join(", ")}` : ""})`,
  ).join(" · ")}`,
);
console.log(`  token env : ${tokenEnvName}`);

if (dryRun) {
  console.log("\n--dry-run: mọi điều kiện đều đạt, chưa tạo gì cả.");
  process.exit(0);
}

// ---- 4. Tạo project + hai kho -------------------------------------------------------------------

const created = await api(`/v9/projects?${teamQuery}`, {
  method: "POST",
  body: JSON.stringify({ name: projectName, framework: "nextjs" }),
});
if (!created.ok) die(`Tạo project hỏng (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 200)}`);
const projectId = String(created.body?.id);
console.log(`\n✔ project ${projectName} · ${projectId}`);

const stage = mkdtempSync(path.join(tmpdir(), `mirror-${siteId}-`));
try {
  mkdirSync(path.join(stage, ".vercel"), { recursive: true });
  writeFileSync(
    path.join(stage, ".vercel", "project.json"),
    JSON.stringify({ projectId, orgId: team.id, projectName }),
  );

  for (const store of STORES) {
    console.log(`\n── dựng ${store.label} ────────────────────────────`);
    const res = spawnSync(
      "vercel",
      // KHÔNG ép `--non-interactive`, và đây là chuyện đã trả giá ngày 12/08/2026: dựng kho
      // Atlas MỚI trên một team vừa bị xoá hết kho thì Vercel trả「Additional setup required.
      // Opening browser…」— một bước phải có người thật bấm. Ép cờ ấy là bịt luôn đường bấm,
      // nên lượt dựng chết ở đúng chỗ mà một người ngồi trước máy giải được trong mười giây.
      // Bỏ cờ đi thì CLI tự phân biệt: người thật thì mở trình duyệt và chờ, còn agent thì nó
      // TỰ chuyển sang không-tương-tác (đúng như `--help` của nó khai) và vẫn hỏng thẳng thắn.
      // Hệ quả phải nhớ: lượt dựng có thể CẦN chạy từ terminal của người vận hành, không phải
      // từ một tiến trình nền.
      ["integration", "add", store.slug, "--plan", store.plan, "--name", store.name,
       ...store.metadata.flatMap((pair) => ["-m", pair]),
       "--no-env-pull", "--scope", scope],
      { cwd: stage, timeout: PROVISION_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: "inherit" },
    );
    if (res.status !== 0) {
      die(
        `Dựng ${store.label} hỏng (mã ${res.status ?? "bị giết"}). Project「${projectName}」ĐÃ TẠO và đang nằm lại trên tài khoản —\n` +
          `  xoá bằng: curl -X DELETE "https://api.vercel.com/v9/projects/${projectName}?${teamQuery}" -H "Authorization: Bearer <token>"`,
      );
    }
  }

  /**
   * ĐỌC LẠI RỒI MỚI TIN — biến nào của trạm mới cũng phải NON-SENSITIVE.
   *
   * Xin `encrypted` là một chuyện; được cấp đúng thứ ấy là chuyện khác. Vercel có công tắc
   *「Sensitive Environment Variables」ở cấp team ép MỌI biến thành `sensitive` bất kể thân yêu
   * cầu, và một integration cũng có thể tự tiêm biến của nó ở dạng ấy. Cả hai đường đều trả
   * HTTP 2xx, nên `r.ok` của `putEnv` KHÔNG chứng minh được gì.
   *
   * Bắt ở đây, lúc trạm còn chưa vào sổ, là lúc rẻ nhất: hỏng thì chỉ mất một project trống.
   * Bắt vào ngày cần `env:pull` để cứu trạm thì đã không còn bản sao nào để đọc.
   *
   * Soi TOÀN BỘ biến production chứ không riêng mấy biến ta vừa ghi — biến do integration tiêm
   * (DATABASE_URL, MONGODB_URI) mới là thứ không thể dựng lại từ máy vận hành.
   */
  const assertNoSensitiveEnv = async (luc: string) => {
    const r = await api(`/v9/projects/${projectId}/env?${teamQuery}`);
    if (!r.ok) {
      die(
        `Không đọc lại nổi danh sách biến của trạm mới (HTTP ${r.status}) — chưa xác nhận được ` +
          "rằng không biến nào ở dạng sensitive, mà đó là điều kiện để sau này còn `env:pull` được.",
      );
    }
    const envs = (r.body?.envs ?? []) as ProjectEnvVar[];
    const sensitive = sensitiveEnvKeys(envs);
    if (sensitive.length > 0) {
      die(
        `Trạm mới có ${sensitive.length} biến ở dạng SENSITIVE (${luc}): ${sensitive.join(", ")}.\n` +
          "  Sensitive nghĩa là KHÔNG BAO GIỜ đọc lại được — `vercel env pull` trả về rỗng, và ngày\n" +
          "  cần dựng lại hay cứu trạm này thì không còn bản sao nào.\n" +
          `  Chữa: Vercel dashboard → team「${scope}」→ Settings → Environment Variables, tắt\n` +
          "  「Sensitive Environment Variables」; xoá mấy biến trên rồi chạy lại lệnh này.\n" +
          `  (Project ${projectName} đã dựng — xoá bằng:\n` +
          `   curl -X DELETE "https://api.vercel.com/v9/projects/${projectName}?${teamQuery}" -H "Authorization: Bearer <token>")`,
      );
    }
    console.log(`✔ ${envs.length} biến (${luc}) đều non-sensitive — sau này còn env:pull được`);
  };

  // ---- 5. Đọc lại env integration vừa tiêm ------------------------------------------------------
  //
  // Soi DẠNG biến TRƯỚC khi đọc giá trị, và thứ tự ấy là cả ý nghĩa của phép kiểm này: một biến
  // `sensitive` vẫn có mặt trong danh sách nhưng `env:pull` trả về rỗng, nên nếu để lượt `pick`
  // bên dưới phán trước thì người dùng nhận đúng một câu SAI —「Kho Neon dựng xong nhưng KHÔNG
  // tiêm DATABASE_URL」— trong khi integration đã tiêm tử tế, chỉ là tiêm ở dạng không đọc được.
  await assertNoSensitiveEnv("integration vừa tiêm");

  const pulled = spawnSync(
    "vercel",
    ["env", "pull", ".env.check", "--environment=production", "--yes", "--scope", scope],
    { cwd: stage, timeout: QUICK_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (pulled.status !== 0) die("Không kéo nổi env của trạm mới về để đọc chuỗi kết nối.");

  const envText = readFileSync(path.join(stage, ".env.check"), "utf8");
  const pick = (k: string): string | null => {
    const m = envText.match(new RegExp(`^${k}="?([^"\r\n]+)`, "m"));
    return m ? m[1] : null;
  };
  const pgUrl = pick("DATABASE_URL");
  const mongoUri = pick("MONGODB_URI");
  if (!pgUrl) die("Kho Neon dựng xong nhưng KHÔNG tiêm DATABASE_URL — dừng, đừng ghi một trạm nửa vời vào sổ.");
  if (!mongoUri) die("Kho Atlas dựng xong nhưng KHÔNG tiêm MONGODB_URI — dừng, đừng ghi một trạm nửa vời vào sổ.");
  if (pick("MONGODB_DB")) {
    die("Trạm mới có MONGODB_DB — biến này PHẢI vắng ở mọi trạm, nếu không lượt đồng bộ Mongo chép vào sai database.");
  }
  console.log(`\n✔ integration đã tiêm sẵn DATABASE_URL + MONGODB_URI, và MONGODB_DB vắng mặt (đúng)`);

  // ---- 6. SITE_ID + bí mật dùng chung -----------------------------------------------------------
  const putEnv = async (key: string, value: string) => {
    const r = await api(`/v10/projects/${projectId}/env?${teamQuery}&upsert=true`, {
      method: "POST",
      body: JSON.stringify({ key, value, type: ENV_TYPE, target: ["production"] }),
    });
    if (!r.ok) die(`Đặt biến ${key} hỏng (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 160)}`);
  };
  await putEnv("SITE_ID", siteId);
  for (const key of SHARED_SECRETS) await putEnv(key, process.env[key]!);
  console.log(`✔ đã đặt SITE_ID + ${SHARED_SECRETS.length} bí mật dùng chung (chỉ môi trường production)`);

  // Lượt hai: mấy biến TA vừa ghi có bị ép sang sensitive không. Lượt một ở bước 5 chỉ nói được
  // về những biến integration tiêm — công tắc cấp team có thể bật giữa hai lượt, và dù không,
  // xác nhận cái mình vừa ghi vẫn rẻ hơn phát hiện ra nó vào ngày cần đọc.
  await assertNoSensitiveEnv("sau khi ghi SITE_ID + bí mật dùng chung");

  // ---- 7. Dựng bảng ------------------------------------------------------------------------------
  const migrated = spawnSync("node", ["scripts/migrate.mjs"], {
    cwd: repoRoot,
    timeout: PROVISION_MS,
    env: { ...process.env, DATABASE_URL: pgUrl },
    shell: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (migrated.status !== 0) die("Migration hỏng — trạm mới chưa có bảng, chưa ghi vào sổ.");

  const fresh = neon(pgUrl);
  const counted = (await fresh`select count(*)::int n from drizzle.__drizzle_migrations`) as { n: number }[];
  console.log(`✔ database trạm mới: ${counted[0].n} migration`);

  // ---- 8. Ghi vào sổ Ở TRẠM ĐANG HOẠT ĐỘNG ------------------------------------------------------
  // Mongo thường KHÔNG kiểm được từ máy dev (bệnh DNS SRV đã biết), nên ghi chú kể đúng sự thật
  // thay vì đoán — người sau bấm「Kiểm mạch」trên admin là có câu trả lời thật.
  let mongoNote: string;
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 12_000 });
    const dbName = resolveMongoDbName(mongoUri, process.env.MONGODB_DB);
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    await client.close();
    mongoNote = `Mongo ✔ (db「${dbName}」)`;
  } catch (err) {
    mongoNote = `Mongo CHƯA kiểm được từ máy dev (${(err as Error).message.slice(0, 50)}) — bấm Kiểm mạch trên admin`;
  }

  const active = neon(activeUrl);
  const mirrors = [
    ...(book.mirrors ?? []).filter((m) => m.id !== siteId),
    {
      id: siteId,
      name: arg("name") ?? `Trạm gương ${siteId} — tài khoản ${username}`,
      url: stationUrl,
      pg: encryptSecret(pgUrl),
      mongo: encryptSecret(mongoUri),
      /**
       * TOKEN CỦA TÀI KHOẢN GIỮ TRẠM NÀY, phong bì secretBox — cùng dạng `pg`/`mongo`, và cùng
       * dạng mà form Gương Trạm ghi (`actions/mirrors.ts`: `vercelToken ? encryptSecret(…) : ""`).
       *
       * Thiếu dòng này cho tới 13/08/2026, và cái giá thì đo được: bốn trong năm trạm không có
       * token ở đâu cả. Token chỉ nằm trong `.env.local` của MỘT cái máy — máy nào vừa chạy
       * `mirror:new` cho trạm ấy. Đổi máy, cài lại Windows, hay đơn giản là dựng trạm thứ hai từ
       * một máy khác, thì trạm cũ thành trạm không còn chìa: `deploy:all` báo「Không tài khoản nào
       * có project…」và không có đường nào lấy lại ngoài việc vào Vercel tạo token mới.
       *
       * Sổ là đúng chỗ cho nó, và schema đã lập luận sẵn (`services/settings.ts`): token thuộc về
       * một TÀI KHOẢN VERCEL KHÁC, nên rải vào env của deployment nghĩa là mỗi trạm phải ôm token
       * của mọi trạm còn lại. Sổ thì đã mã hoá, và đã đi theo mọi lượt đồng bộ — nên đây cũng
       * chính là đường token về tới database của CHÍNH trạm này: qua lượt sync, không phải bằng
       * một lượt ghi thẳng vào trạm dự phòng (thứ sẽ bị đè ở lượt chuyển trạm kế tiếp).
       *
       * Ai đọc: tab Gương Trạm dùng nó gọi `/v2/usage`; `mirrorsForAdmin` chỉ phơi ra
       * `hasVercelToken` chứ không bao giờ trả giá trị về trình duyệt.
       */
      vercelToken: encryptSecret(token),
      lastProbeAt: new Date().toISOString(),
      lastProbeOk: null,
      lastProbeNote: `PG ✔ (${counted[0].n} migration) · ${mongoNote}`,
    },
  ];
  await active.query(
    `update app_settings set value = jsonb_set(value, '{mirrors}', $1::jsonb, true), updated_at = now() where id = 'global'`,
    [JSON.stringify(mirrors)],
  );
  console.log(`✔ đã ghi vào sổ ở trạm hoạt động「${doc.activeSiteId}」— sổ giờ ${mirrors.length} trạm`);
  console.log(`  ${mongoNote}`);
  // Nói đúng ai đọc được nó, không hứa quá: `deployAllStations` hiện chỉ nhặt token từ env, nên
  // đường phát hành vẫn dựa vào dòng trong `.env.local` — sổ là bản sao sống sót khi máy này mất.
  console.log(`  token đã vào sổ (phong bì secretBox) — tab Gương Trạm đọc được usage của trạm này`);
} finally {
  // Thư mục tạm có .env.check chứa BÍ MẬT PRODUCTION — phải cố xoá, và không được để việc dọn
  // rác giết mất phần tổng kết (EPERM trên Windows, xem deployAllStations.mts).
  try {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`\n⚠ Không xoá được ${stage} (${err instanceof Error ? err.message : "lỗi lạ"}) — trong đó CÓ BÍ MẬT, xoá tay giúp.`);
  }
}

// Tên kho nay mang đuôi ngẫu nhiên, nên phải NÓI RA ở đây: đó là thứ người vận hành cần khi
// muốn soi hay xoá kho về sau, và dashboard thì có thể có nhiều kho cùng tiền tố.
console.log(`\n── Hai kho vừa dựng ──────────────────────────────────`);
for (const store of STORES) console.log(`  ${store.label.padEnd(16)} ${store.name}`);
console.log(`  Xoá một kho: npx vercel integration resource remove <tên kho> -a -y --scope ${scope}`);

console.log(`\n── Còn ba việc, làm bằng tay ─────────────────────────`);
console.log(`  1. Phát hành: bấm đúp deploy-all-stations.bat (trạm mới nằm trong sổ nên nó tự lo).`);
console.log(`  2. Xác nhận: trang Tông Môn → Gương Trạm → bấm「Kiểm mạch」cho「${siteId}」.`);
console.log(`     Dòng cần đọc: db「jarvis」— khác chữ ấy là có chuyện.`);

/**
 * VIỆC 3 SINH RA TỪ MỘT LƯỢT HỎNG THẬT (14/08/2026, trạm `auto-hh3d-4`).
 *
 * Sổ gương và bảng trạm trong `.github/workflows/vercel-usage.yml` là HAI danh sách rời nhau, và
 * `mirror:new` chỉ ghi vào cái thứ nhất. Trạm mới vì thế sống đủ đường — deploy được, kiểm mạch
 * xanh — mà lượt cào usage KHÔNG BAO GIỜ chạm tới nó, lặng lẽ: vòng lặp trong workflow chỉ đi hết
 * những dòng nó có, nên một trạm vắng mặt không tạo ra dòng log nào. Triệu chứng chỉ lộ ra rất
 * muộn, ở `npm run usage:cookie`, dưới dạng「Workflow không có trạm ...」— đúng lúc người ta đang
 * cầm tệp cookie và tưởng mình chỉ còn một bước.
 *
 * In sẵn HAI DÒNG để dán, không bắt đi tra lại, vì `scope` ở đây CHÍNH LÀ slug đội — thứ mà bình
 * chú trong workflow ghi là「đã đoán sai ba trên bốn lần」: nó không suy ra được từ tên tài khoản
 * (`nampro8796-9036` → `kakak328r2y3h8`). Chỗ duy nhất biết chắc giá trị ấy là đây, ngay sau khi
 * vừa hỏi API xong.
 */
const cookieSecret = `VERCEL_COOKIE_${siteId.toUpperCase().replace(/-/g, "_")}`;
console.log(`  3. Cho trạm này vào lượt cào usage — nếu bỏ qua, nó vĩnh viễn không có số liệu`);
console.log(`     mà KHÔNG có lỗi nào báo. Sửa .github/workflows/vercel-usage.yml, thêm hai dòng:`);
console.log(`       vào khối \`env:\`      ${cookieSecret}: \${{ secrets.${cookieSecret} }}`);
console.log(`       vào khối \`stations=\` ${siteId}|${scope}|${cookieSecret}`);
console.log(`     Rồi dán cookie: npm run usage:cookie -- --site ${siteId} --cookie <tệp.json>`);
console.log(`\n  Dấu hiệu trạm sống đúng sau khi phát hành: curl ${stationUrl}/ trả 307.`);
