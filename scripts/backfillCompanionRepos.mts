#!/usr/bin/env node
/**
 * BÙ KHO PHỤ CHO CÁC KHÔI LỖI CHƯA CÓ ĐỦ HAI — đọc sổ, tạo phần còn thiếu, ghi sổ lại.
 *
 *   npm run github:companions:backfill                       mọi kho thiếu kho phụ trong sổ
 *   npm run github:companions:backfill -- --dry-run          soi kế hoạch: KHÔNG tạo repo, KHÔNG ghi sổ
 *   npm run github:companions:backfill -- --repo <tên kho>   đúng một kho
 *   (hoặc bấm đúp backfill-companion-repos.bat)
 *
 * VÌ SAO CẦN: tính năng「hai kho phần mềm đi kèm」ra đời 19/08/2026. Mọi khôi lỗi dựng TRƯỚC nó
 * mang `companionRepos: []` — không kho phụ nào cho vòng nuôi đẩy quota vào, tức nửa「giả trang
 * một tài khoản dev bình thường」của hệ mỏng đi ở đúng những kho cũ nhất. Tệp này lấp phần thiếu ấy
 * mà không phải dựng lại cả bundle ba repo.
 *
 * KHÁC `github:new`: `new` dựng một khôi lỗi HOÀN TOÀN MỚI (kho chính + secret WORKER_TOKEN +
 * workflow + hai kho phụ) và hỏi một PAT mới ở dấu nhắc. Tệp này KHÔNG hỏi gì — nó đọc PAT ĐÃ CÓ
 * của TỪNG trạm trong sổ, giải mã, rồi chỉ tạo phần kho phụ CÒN THIẾU (0, 1 hay 2 tuỳ trạm). Kho
 * đã đủ hai thì không đụng tới, cũng không tạo secret hay bấm workflow nào — kho phụ chỉ là một app
 * TypeScript mà vòng nuôi đẩy commit vào `src/generated/revision-ledger.ts` mỗi ngày.
 *
 * KHÁC bản builder tách rời: tệp này dựng và phát hành kho phụ NGAY TRONG TIẾN TRÌNH bằng chính
 * các khối đã committed của repo (`buildCompanionProjects` + `publishConfirmedRepository`), thay vì
 * đẻ một tiến trình con rồi đọc lại「CREATED …」từ stdout. PAT không lọt ra dòng lệnh vì nó chỉ
 * sống trong `env.GH_TOKEN` của TỪNG lời gọi `gh`/`git` — mỗi trạm chỉ thấy chìa của chính nó, và
 * không có chuỗi PAT nào nằm lại trong env của tiến trình cha.
 *
 * KIẾN TRÚC, đi theo `newGithubStation.mts` vì cùng loại việc (đọc/ghi sổ + dựng repo):
 *   • Sổ có thẩm quyền nằm ở DATABASE CỦA APP (Postgres trên VM từ 16/08/2026) — `appDatabaseUrl()`
 *     từ chối thẳng khi đứng ở máy nhà (nơi mọi đường vòng dẫn về một Neon đông cứng), kèm lệnh
 *     phải gõ lại. Ghi sổ vào bản đóng băng thì mọi bước báo xanh mà không ai đọc được kết quả.
 *   • Đọc-LẠI-rồi-ghi NGAY sau mỗi trạm, không gom tới cuối: cửa sổ ghi đè co về vài mili giây,
 *     đúng bằng cửa của form admin. Một cú tạo-xong-mà-ghi-sổ-hỏng bị chặn ở đúng một trạm.
 *
 * KHÔNG `process.exit()` giữa chừng: dưới `tsx` gọi `process.exit` ngay sau một `fetch` làm libuv
 * ném assertion và trả mã 127 thay vì 0 (đo 12/08/2026, xem newGithubStation.mts). Mọi ngả kết
 * thúc đi qua `process.exitCode` rồi để tiến trình tự tắt.
 *
 * ĐỌC TRƯỚC KHI CHẠY: mỗi kho phụ là một repo CÔNG KHAI. Đánh đổi này đã cân — deploy/github-actions.md
 * mục 6 và mục「Bundle 3 repo」.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readControlDoc } from "../src/lib/control/read";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import { explainFailure, stationSlug } from "../src/lib/validation/githubStations";
import { appDatabaseUrl } from "./activeStationPg.mts";
import { buildCompanionProjects } from "./companionProject.mjs";
import { planStations, withCreatedCompanions, COMPANION_REPO_COUNT } from "./companionBackfillPlan.mjs";
import { publishConfirmedRepository, repoProbeResultFromFailure, reviewBundlePatScopes } from "./githubBundleSafety.mjs";
import { looksTransient } from "./githubTransient.mjs";
import { randomDistinctSoftwareNames, reviewGeneratedName } from "./khoiloiNaming.mjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : undefined;
};
const onlyRepo = arg("repo") ?? null;

/** Dừng có chủ đích — phân biệt với lỗi không lường (song sinh với `Stop` của newGithubStation.mts). */
class Stop extends Error {}
function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  throw new Stop(message);
}

// ---- Hỏi danh tính PAT (đọc, thử lại đúng hai ngả đáng thử) -------------------------------------

const IDENTITY_ATTEMPTS = 3;
const IDENTITY_BACKOFF_MS = 2_000;

type Identity = { ok: true; login: string; scopes: string | null } | { ok: false; message: string };

/**
 * PAT này của ai, mở được gì. Trả về kết quả CÓ THẺ thay vì ném: một PAT hỏng của MỘT trạm không
 * được giết cả lượt — nó chỉ làm trạm ấy bị bỏ qua với một lý do rõ. Thử lại chỉ khi mạng ném hoặc
 * 5xx; 4xx thì một PAT sai không tự đúng lên. Cùng luật với `whoami` của newGithubStation.mts, chỉ
 * khác ở chỗ nó KHÔNG `die`.
 */
async function identify(token: string): Promise<Identity> {
  let res: Response | null = null;
  let lastError = "";
  for (let attempt = 1; attempt <= IDENTITY_ATTEMPTS; attempt++) {
    try {
      res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          // Không mang tên trò lẫn tên công cụ — cùng luật với tên kho (khoiloiNaming.mjs).
          "User-Agent": "linh-su-station-setup",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status < 500) break;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      res = null;
      lastError = err instanceof Error ? err.message : "lỗi lạ";
    }
    if (attempt < IDENTITY_ATTEMPTS) await new Promise((wake) => setTimeout(wake, IDENTITY_BACKOFF_MS));
  }

  if (!res) return { ok: false, message: `không gọi được api.github.com (${lastError})` };
  if (!res.ok) return { ok: false, message: explainFailure(res.status, await res.json().catch(() => null), "hỏi danh tính") };
  const body = (await res.json()) as { login?: string };
  if (!body.login) return { ok: false, message: "GitHub trả lời không có tên tài khoản" };
  return { ok: true, login: body.login, scopes: res.headers.get("x-oauth-scopes") };
}

// ---- `gh`/`git` — không shell, PAT trong env của TỪNG lời gọi --------------------------------------

const GH_ATTEMPTS = 3;
const GH_BACKOFF_MS = 2_000;
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * `execFileSync`, KHÔNG shell — cùng luật với newGithubKhoiloi.mjs (shell gỡ 13/08/2026 vì nó bẻ
 * mọi đối số có khoảng trắng như `--description`). `env` truyền vào từng lời gọi để chỉ đúng lượt
 * ấy thấy `GH_TOKEN` của trạm đang xử lý.
 */
function run(cmd: string, cmdArgs: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  return execFileSync(cmd, cmdArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 120_000,
    env: options.env ?? process.env,
  });
}

/** Thử lại chỉ khi GitHub đang nấc (`looksTransient`) — cho những bước để lại rác ngoài đời thật. */
function runWithRetry(
  label: string,
  cmd: string,
  cmdArgs: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): string {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync(cmd, cmdArgs, {
        cwd: options.cwd ?? repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeout ?? 60_000,
        env: options.env ?? process.env,
      });
    } catch (err) {
      const detail = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
      const why = [detail.stderr, detail.stdout, detail.message].map((p) => String(p ?? "").trim()).filter(Boolean).join("\n");
      if (why) console.error(why);
      if (attempt >= GH_ATTEMPTS || !looksTransient(why)) throw err;
      console.error(`  … ${label}: GitHub đang nấc, thử lại lần ${attempt + 1}/${GH_ATTEMPTS} sau ${GH_BACKOFF_MS / 1000}s`);
      sleepSync(GH_BACKOFF_MS);
    }
  }
}

/**
 * Kho ấy đã trên GitHub chưa: yes / no / unknown. `unknown` (mạng, auth, 5xx) thì DỪNG — đọc nó
 * thành「chưa có」là cách vô tình tạo đè hoặc rollback nhầm tài sản có sẵn của người dùng.
 */
function probeRepoExistence(slug: string, env: NodeJS.ProcessEnv): "yes" | "no" | "unknown" {
  try {
    execFileSync("gh", ["repo", "view", slug, "--json", "name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      env,
    });
    return "yes";
  } catch (err) {
    const detail = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const why = [detail.stderr, detail.stdout, detail.message].map((p) => String(p ?? "").trim()).filter(Boolean).join("\n");
    return repoProbeResultFromFailure(why);
  }
}

// ---- Kết cục mỗi trạm ---------------------------------------------------------------------------

type Outcome =
  | { slug: string; kind: "done"; created: string[] }
  | { slug: string; kind: "fail"; reason: string };

/** Một kho phụ đã dựng xong cây tệp và commit, chờ tạo + đẩy lên GitHub. */
type StagedRepo = { repoName: string; slug: string; cwd: string; description: string };

/** Hình dạng `buildCompanionProjects` trả về — khai tay vì nó là `.mjs`, không mang type. */
type CompanionProject = { repoName: string; theme: { product: string; tagline: string }; files: Map<string, Buffer> };

/**
 * Dựng cây tệp của các kho phụ vào một thư mục tạm rồi commit — không mạng, không `gh`. Trả về
 * danh sách「repo đã sẵn sàng đẩy」kèm thư mục, slug, mô tả và lời commit.
 */
function stageProjects(owner: string, repoNames: string[], stagingRoot: string): StagedRepo[] {
  const projects = buildCompanionProjects({ repoNames }) as CompanionProject[];
  return projects.map((project, index): StagedRepo => {
    const cwd = path.join(stagingRoot, `${project.repoName}-${index}`);
    mkdirSync(cwd, { recursive: true });
    for (const [rel, bytes] of project.files) {
      const full = path.join(cwd, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    }
    // Commit ngay trong thư mục tạm: đây là phần chạy khô kiểm được, và là chỗ một lời commit vỡ
    // từng lọt lưới (13/08/2026). Không cần GH_TOKEN — toàn bộ là git cục bộ.
    run("git", ["init", "-q", "-b", "main"], { cwd });
    run("git", ["add", "-A"], { cwd });
    run(
      "git",
      ["-c", "user.name=project-maintainer", "-c", "user.email=project-maintainer@users.noreply.github.com",
        "commit", "-q", "-m", `feat: launch ${project.theme.product}`],
      { cwd },
    );
    return { repoName: project.repoName, slug: `${owner}/${project.repoName}`, cwd, description: project.theme.tagline };
  });
}

async function main(): Promise<void> {
  if (!process.env.ENCRYPTION_KEY) die("Thiếu ENCRYPTION_KEY — không giải mã nổi PAT trong sổ.");
  if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL — không có đường nào tới sổ.");

  // readControlDoc chỉ để lời chào kể đúng trạm nào giữ sổ. KHÁC `github:new`, tệp này KHÔNG chặn
  // khi thiếu control doc: nó chỉ đọc/ghi sổ ở DB của app, không nướng activeUrl vào workflow nào.
  const doc = await readControlDoc();

  // Từ 16/08/2026 chỉ còn một DB thật — Postgres trên VM. Đổi DATABASE_URL TRƯỚC khi import
  // services/settings: `db()` đọc biến này lười rồi nhớ mãi (db/client.ts), nên nhập muộn là thứ
  // giữ cho sổ không bị ghi nhầm vào một trạm đã nghỉ.
  const activePg = ((): string => {
    try {
      return appDatabaseUrl();
    } catch (err) {
      return die(err instanceof Error ? err.message : "Không tra ra database của app.");
    }
  })();
  process.env.DATABASE_URL = activePg;
  const { getAppSettings, saveAppSettings } = await import("../src/lib/services/settings");

  const settings = await getAppSettings();
  const plan = planStations(settings.githubStations, onlyRepo);
  if (plan.error) die(plan.error);

  const heldAt = doc?.activeSiteId ? `trạm「${doc.activeSiteId}」` : "database của app";
  console.log(
    `\n── Bù kho phụ ${dryRun ? "· XEM TRƯỚC " : ""}────────────────────────────\n` +
      `  sổ ở      ${heldAt} (${settings.githubStations.length} kho)\n` +
      `  phải bù   ${plan.targets.length} kho\n` +
      `  bỏ qua    ${plan.skipped.length} kho\n`,
  );
  for (const target of plan.targets) {
    console.log(`  ↻ ${target.slug.padEnd(46)} thiếu ${target.need} — sẽ tạo ${target.need} kho phụ`);
  }
  for (const skip of plan.skipped) {
    if (skip.reason === "đã đủ hai kho phụ") console.log(`  = ${skip.slug.padEnd(46)} ${skip.reason}`);
  }

  if (plan.targets.length === 0) {
    console.log(`\n✔ Không kho nào thiếu kho phụ. Không có gì để làm.\n`);
    return;
  }

  // `gh` là thứ tạo được repo (create) — kiểm MỘT LẦN, chỉ ở lượt thật. Dry-run không chạm `gh`.
  // KHÔNG qua shell: phép kiểm phải đi đúng con đường lượt gọi thật đi (shell đã gỡ 13/08/2026).
  if (!dryRun) {
    try {
      execFileSync("gh", ["--version"], { stdio: "ignore" });
    } catch {
      die(
        "Chưa có `gh` (GitHub CLI) — nó là thứ tạo được repo kho phụ.\n" +
          "  Cài: winget install --id GitHub.cli    (hoặc https://cli.github.com)\n" +
          "  KHÔNG cần `gh auth login`: script này đưa PAT của từng trạm qua biến GH_TOKEN.",
      );
    }
  }

  const outcomes: Outcome[] = [];
  const stagingRoot = mkdtempSync(path.join(tmpdir(), "companion-backfill-"));

  try {
    for (const target of plan.targets) {
      const { station, slug, need, avoid } = target;

      // 1. PAT của CHÍNH trạm này.
      let pat: string;
      try {
        pat = isEncrypted(station.pat) ? decryptSecret(station.pat) : station.pat;
      } catch (err) {
        outcomes.push({ slug, kind: "fail", reason: `giải mã PAT hỏng: ${err instanceof Error ? err.message : "lỗi lạ"}` });
        continue;
      }
      pat = pat.trim();
      if (!pat) {
        outcomes.push({ slug, kind: "fail", reason: "PAT rỗng trong sổ" });
        continue;
      }

      // 2. PAT còn sống, đúng owner, đủ quyền rollback?
      const identity = await identify(pat);
      if (!identity.ok) {
        outcomes.push({ slug, kind: "fail", reason: identity.message });
        continue;
      }
      if (identity.login.toLowerCase() !== String(station.owner).toLowerCase()) {
        outcomes.push({
          slug,
          kind: "fail",
          reason: `PAT thuộc「${identity.login}」nhưng sổ ghi owner「${station.owner}」— không tạo repo dưới nhầm tài khoản`,
        });
        continue;
      }
      // Kho phụ cũng là giao dịch create-rồi-có-thể-rollback, nên đòi ĐÚNG bộ scope của bundle:
      // classic + repo + workflow + delete_repo. Thiếu delete_repo thì một cú push hỏng để lại kho
      // mồ côi không xoá được — fail-closed, đúng luật `reviewBundlePatScopes`.
      const policy = reviewBundlePatScopes(identity.scopes);
      if (!policy.ok) {
        outcomes.push({ slug, kind: "fail", reason: policy.message });
        continue;
      }

      // 3. Rút `need` tên mới, tránh mọi tên của chính trạm này.
      let repoNames: string[];
      try {
        repoNames = randomDistinctSoftwareNames(need, avoid);
      } catch (err) {
        outcomes.push({ slug, kind: "fail", reason: err instanceof Error ? err.message : "không rút được tên" });
        continue;
      }
      // Từ cấm đứng TRƯỚC mọi lời gọi `gh`: tên do script SINH RA phải qua cửa này (khoiloiNaming.mjs).
      const banned = repoNames.map((name, i) => reviewGeneratedName(`Tên kho phụ ${i + 1}`, name)).find(Boolean);
      if (banned) {
        outcomes.push({ slug, kind: "fail", reason: banned });
        continue;
      }

      // 4. Dựng cây tệp + commit trong thư mục tạm (không mạng).
      let staged: ReturnType<typeof stageProjects>;
      try {
        staged = stageProjects(String(station.owner), repoNames, stagingRoot);
      } catch (err) {
        outcomes.push({ slug, kind: "fail", reason: `dựng payload hỏng: ${err instanceof Error ? err.message : "lỗi lạ"}` });
        continue;
      }

      if (dryRun) {
        console.log(`  · ${slug}: sẽ tạo ${staged.map((s) => s.repoName).join(", ")}`);
        outcomes.push({ slug, kind: "done", created: staged.map((s) => s.slug) });
        continue;
      }

      // 5. Probe CẢ MẺ trước khi tạo cái đầu tiên: một tên đã tồn tại thì tuyệt đối không để nhánh
      //    rollback hiểu nhầm nó là repo vừa sinh rồi xoá tài sản có sẵn.
      const patEnv: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: pat, GIT_TERMINAL_PROMPT: "0" };
      let clashOrUnknown: string | null = null;
      for (const repo of staged) {
        const existence = probeRepoExistence(repo.slug, patEnv);
        if (existence === "yes") { clashOrUnknown = `repo ${repo.slug} đã tồn tại — dừng, không đụng gì`; break; }
        if (existence === "unknown") { clashOrUnknown = `không xác định được ${repo.slug} đã tồn tại chưa — dừng để tránh tạo/xoá nhầm`; break; }
      }
      if (clashOrUnknown) {
        outcomes.push({ slug, kind: "fail", reason: clashOrUnknown });
        continue;
      }

      // 6. Tạo → nhớ → push từng repo. Nguyên tử theo TRẠM: cả mẻ cùng lên hoặc cùng bị dọn, để
      //    bước ghi sổ chỉ chạy khi mọi kho phụ chắc chắn đã ở trên GitHub.
      const createdSlugs: string[] = [];
      const rollback = () => {
        if (createdSlugs.length === 0) return;
        console.error(`\n✖ ${slug}: hỏng giữa mẻ — dọn ${createdSlugs.length} repo do lượt này tạo…`);
        for (const created of [...createdSlugs].reverse()) {
          try {
            runWithRetry("xoá repo dở", "gh", ["repo", "delete", created, "--yes"], { env: patEnv, timeout: 60_000 });
            console.error(`  đã xoá ${created}`);
          } catch {
            console.error(`  KHÔNG xoá được ${created} (quyền vừa đổi hoặc GitHub lỗi) — xoá tay:\n    https://github.com/${created}/settings`);
          }
        }
      };

      let built = true;
      try {
        for (const repo of staged) {
          console.log(`\n── ${slug}: tạo kho ${repo.slug}…`);
          try {
            publishConfirmedRepository({
              repository: repo,
              // CREATE không retry (không idempotent): rơi mạng sau khi GitHub nhận lệnh thì không
              // chứng minh được repo ấy do lượt này tạo — remember chỉ chạy SAU khi create thành công.
              create: (r: { slug: string; cwd: string; description: string }) =>
                run("gh", ["repo", "create", r.slug, "--public", "--description", r.description], { cwd: r.cwd, env: patEnv }),
              remember: (createdSlug: string) => { if (!createdSlugs.includes(createdSlug)) createdSlugs.push(createdSlug); },
              // PUSH tách riêng, retry được. Credential helper gọi `gh`, nên PAT nằm trong GH_TOKEN
              // qua env chứ không rơi vào command line.
              push: (r: { slug: string; cwd: string }) =>
                runWithRetry("đẩy source", "git", [
                  "-c", "credential.helper=",
                  "-c", "credential.https://github.com.helper=!gh auth git-credential",
                  "push", `https://github.com/${r.slug}.git`, "main:main",
                ], { cwd: r.cwd, env: patEnv, timeout: 120_000 }),
            });
          } catch (err) {
            if (!createdSlugs.includes(repo.slug)) {
              console.error(
                `\n⚠ Lệnh create cho ${repo.slug} không trả thành công. KHÔNG tự probe-rồi-xoá tên ấy: ` +
                  `kết quả mơ hồ và một repo cùng tên có thể thuộc lượt khác.\n  Kiểm tay khi GitHub ổn: https://github.com/${repo.slug}`,
              );
            }
            throw err;
          }
        }
      } catch (err) {
        rollback();
        built = false;
        outcomes.push({ slug, kind: "fail", reason: `tạo/đẩy hỏng: ${err instanceof Error ? err.message : "lỗi lạ"} — đã rollback` });
      }
      if (!built) continue;

      const created = staged.map((s) => s.slug);
      const createdRepoNames = staged.map((s) => s.repoName);

      // 7. Ghi sổ NGAY, đọc-lại-rồi-ghi. Cửa ghi đè co về vài mili giây — đúng bằng cửa form admin.
      const fresh = await getAppSettings();
      const row = fresh.githubStations.find((s) => stationSlug(s) === slug);
      if (!row) {
        // Trạm biến mất giữa chừng (phiên khác xoá?). Repo ĐÃ ở trên GitHub — nói thẳng, đừng để nó
        // thành kho mồ côi im lặng, và DỪNG để không bù nhầm các trạm sau.
        die(
          `Kho phụ ĐÃ TẠO cho「${slug}」nhưng trạm không còn trong sổ (phiên khác vừa xoá?).\n` +
            `  Đã tạo: ${created.join(", ")}\n  Ghi tay hoặc xoá trên GitHub, rồi mới chạy lại.`,
        );
      }
      // Trạm được bù đủ trong lúc ta chạy (phiên khác)? Đừng nhét thành ba — schema sẽ nuốt cả sổ.
      if (row.companionRepos.length >= COMPANION_REPO_COUNT) {
        outcomes.push({
          slug,
          kind: "fail",
          reason: `trạm đã đủ ${row.companionRepos.length} kho phụ trong lúc chạy — repo vừa tạo (${created.join(", ")}) cần xoá tay hoặc ghi tay`,
        });
        continue;
      }
      row.companionRepos = withCreatedCompanions(row.companionRepos, createdRepoNames);

      try {
        await saveAppSettings(fresh);
      } catch (err) {
        die(
          `Kho phụ ĐÃ TẠO cho「${slug}」nhưng ghi sổ hỏng: ${err instanceof Error ? err.message : "lỗi lạ"}\n` +
            `  Đã tạo: ${created.join(", ")}\n` +
            `  Ghi tay ở Tông Môn → Kho GitHub (thêm hai kho phụ ấy vào trạm) TRƯỚC khi chạy lại —\n` +
            `  chạy lại ngay sẽ tạo THÊM một cặp nữa vì sổ vẫn khai thiếu. DỪNG ở đây.`,
        );
      }
      outcomes.push({ slug, kind: "done", created });
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }

  // ---- Tổng kết ---------------------------------------------------------------------------------
  const done = outcomes.filter((o) => o.kind === "done");
  const failed = outcomes.filter((o) => o.kind === "fail");
  console.log(`\n── Tổng kết ─────────────────────────────────────────`);
  for (const o of outcomes) {
    if (o.kind === "done") console.log(`  ✔ ${o.slug.padEnd(46)} ${dryRun ? "sẽ tạo" : "đã tạo"}: ${o.created.join(", ")}`);
    else console.log(`  ✖ ${o.slug.padEnd(46)} ${o.reason}`);
  }
  console.log(
    `\n  ${dryRun ? "sẽ bù" : "đã bù"}: ${done.length} kho · hỏng: ${failed.length} kho` +
      (dryRun ? `\n\n  --dry-run: KHÔNG tạo repo, KHÔNG ghi sổ. Bỏ cờ ấy để làm thật.` : ""),
  );

  // Hỏng một trạm là mã thoát khác 0 — các trạm còn lại vẫn được bù xong (trừ khi một cú ghi-sổ-hỏng
  // đã `die` và dừng hẳn để không bù nhầm phần sau).
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  if (!(err instanceof Stop)) {
    console.error("\n✖ Lỗi không lường:");
    console.error(err);
  }
  process.exitCode = 1;
});
