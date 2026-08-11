#!/usr/bin/env node
/**
 * DỰNG MỘT TRẠM GƯƠNG MỚI — một lượt chạy, từ tài khoản Vercel trắng tới trạm nằm trong sổ.
 *
 *   MIRROR_TOKEN=<token> npm run mirror:new -- --site auto-hh3d-3
 *   npm run mirror:new -- --site auto-hh3d-3 --dry-run      (chỉ kiểm điều kiện, không tạo gì)
 *
 * Hoặc bấm đúp `new-mirror-station.bat` — nó hỏi hai câu rồi gọi vào đây.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import { resolveMongoDbName } from "../src/lib/mongo/dbName";
import { stationUrlFor, tokenEnvNameFor, validateSiteId, type Book } from "./deployTargets.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");
const ENV_FILE = path.join(repoRoot, ".env.local");

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

/** Hai integration bắt buộc, và tên gói MIỄN PHÍ của chúng — tra bằng `integration add <tên> --help`. */
const STORES = [
  { slug: "neon", plan: "free_v3", name: "jarvis-hh3d", label: "Neon Postgres" },
  { slug: "mongodbatlas", plan: "FREE", name: "atlas-jarvis-chat", label: "MongoDB Atlas" },
] as const;

const QUICK_MS = 60_000;
const PROVISION_MS = 10 * 60_000;
const API_MS = 30_000;

const die = (message: string): never => {
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
const stationUrl = stationUrlFor(siteId);
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
    let text = readFileSync(ENV_FILE, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    writeFileSync(ENV_FILE, `${text}${tokenEnvName}=${fresh}\n`);
    console.log(`• Đã cất token vào .env.local dưới tên ${tokenEnvName}`);
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

const existing = await api(`/v9/projects/${siteId}?${teamQuery}`);
if (existing.ok) die(`Team này đã có project「${siteId}」. Chọn mã khác, hoặc xoá project cũ trước (README §9 bẫy 3).`);

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
console.log(`  project   : ${siteId} trên team ${scope}`);
console.log(`  kho       : ${STORES.map((s) => `${s.name} (${s.label}, gói ${s.plan})`).join(" · ")}`);
console.log(`  token env : ${tokenEnvName}`);

if (dryRun) {
  console.log("\n--dry-run: mọi điều kiện đều đạt, chưa tạo gì cả.");
  process.exit(0);
}

// ---- 4. Tạo project + hai kho -------------------------------------------------------------------

const created = await api(`/v9/projects?${teamQuery}`, {
  method: "POST",
  body: JSON.stringify({ name: siteId, framework: "nextjs" }),
});
if (!created.ok) die(`Tạo project hỏng (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 200)}`);
const projectId = String(created.body?.id);
console.log(`\n✔ project ${siteId} · ${projectId}`);

const stage = mkdtempSync(path.join(tmpdir(), `mirror-${siteId}-`));
try {
  mkdirSync(path.join(stage, ".vercel"), { recursive: true });
  writeFileSync(
    path.join(stage, ".vercel", "project.json"),
    JSON.stringify({ projectId, orgId: team.id, projectName: siteId }),
  );

  for (const store of STORES) {
    console.log(`\n── dựng ${store.label} ────────────────────────────`);
    const res = spawnSync(
      "vercel",
      ["integration", "add", store.slug, "--plan", store.plan, "--name", store.name,
       "--non-interactive", "--no-env-pull", "--scope", scope],
      { cwd: stage, timeout: PROVISION_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: ["ignore", "inherit", "inherit"] },
    );
    if (res.status !== 0) {
      die(
        `Dựng ${store.label} hỏng (mã ${res.status ?? "bị giết"}). Project「${siteId}」ĐÃ TẠO và đang nằm lại trên tài khoản —\n` +
          `  xoá bằng: curl -X DELETE "https://api.vercel.com/v9/projects/${siteId}?${teamQuery}" -H "Authorization: Bearer <token>"`,
      );
    }
  }

  // ---- 5. Đọc lại env integration vừa tiêm ------------------------------------------------------
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
      body: JSON.stringify({ key, value, type: "encrypted", target: ["production"] }),
    });
    if (!r.ok) die(`Đặt biến ${key} hỏng (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 160)}`);
  };
  await putEnv("SITE_ID", siteId);
  for (const key of SHARED_SECRETS) await putEnv(key, process.env[key]!);
  console.log(`✔ đã đặt SITE_ID + ${SHARED_SECRETS.length} bí mật dùng chung (chỉ môi trường production)`);

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
} finally {
  // Thư mục tạm có .env.check chứa BÍ MẬT PRODUCTION — phải cố xoá, và không được để việc dọn
  // rác giết mất phần tổng kết (EPERM trên Windows, xem deployAllStations.mts).
  try {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`\n⚠ Không xoá được ${stage} (${err instanceof Error ? err.message : "lỗi lạ"}) — trong đó CÓ BÍ MẬT, xoá tay giúp.`);
  }
}

console.log(`\n── Còn hai việc, làm bằng tay ────────────────────────`);
console.log(`  1. Phát hành: bấm đúp deploy-all-stations.bat (trạm mới nằm trong sổ nên nó tự lo).`);
console.log(`  2. Xác nhận: trang Tông Môn → Gương Trạm → bấm「Kiểm mạch」cho「${siteId}」.`);
console.log(`     Dòng cần đọc: db「jarvis」— khác chữ ấy là có chuyện.`);
console.log(`\n  Dấu hiệu trạm sống đúng sau khi phát hành: curl ${stationUrl}/ trả 307.`);
