#!/usr/bin/env node
/**
 * PHÁT HÀNH ĐỒNG BỘ — một lượt chạy, mọi trạm trong sổ gương nhận cùng một commit.
 *
 *   npm run deploy:all              (hoặc bấm đúp deploy-all-stations.bat)
 *   npm run deploy:all -- --dry-run  chỉ tra và in kế hoạch, KHÔNG phát hành
 *
 * VÌ SAO CẦN: hai trạm lệch mã là một cái bẫy nằm im cho tới ngày chuyển trạm. Trạm gương chỉ
 * chuyển hướng nên không ai thấy nó cũ, mà đúng lúc nó lên ngôi thì nó CHÍNH LÀ nơi phát lệnh
 * cho lượt sau — mã cũ ở đó là mã cũ của cả tông môn. Trước bản này việc ấy làm bằng tay, hai
 * lượt gần giống nhau, và「gần giống」là chỗ để quên.
 *
 * BA ĐIỀU CỐT LÕI, mỗi điều là một bài học đã trả giá:
 *
 * 1. **Phát hành từ bản `git archive`, không phải từ cây làm việc.** Vercel CHẶN deploy khi
 *    email commit không khớp tài khoản GitHub nào, và nó chặn cả `vercel --prod` vì CLI đính
 *    metadata git của commit đang đứng. Bản xuất không có `.git` thì không còn gì để đối chiếu.
 *    Xem README.md, mục「Thuốc là deploy từ một bản xuất KHÔNG có .git」.
 *
 * 2. **MỘT tệp tar cho mọi trạm.** Đóng gói một lần rồi giải nén cho từng trạm, nên「đồng bộ」
 *    là đúng theo cấu trúc chứ không phải nhờ hai lượt `git archive` tình cờ giống nhau.
 *
 * 3. **Hỏng một trạm KHÔNG chặn các trạm còn lại.** Một gương trạm cấu hình sai không được
 *    phép giữ bản vá lại khỏi trạm đang phục vụ người dùng. Nhưng bảng tổng kết phải nói
 *    thẳng trạm nào giờ đang mang mã khác, và mã thoát phải khác 0.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import { chooseBook, discoverTokens, resolveTarget, type Book, type ProjectRef, type StationEntry } from "./deployTargets.mts";
import { projectsFor } from "./vercelCatalog.mts";
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
const dryRun = process.argv.includes("--dry-run");

/** Trần thời gian MỘT lượt deploy. Đo 10/08/2026: ~50 giây/trạm; 15 phút là rộng rãi có chủ ý. */
const DEPLOY_TIMEOUT_MS = 15 * 60_000;
/** Trần cho các lệnh phụ (git, vercel --version) — chúng phải trả lời tức thì hoặc là có chuyện. */
const QUICK_TIMEOUT_MS = 60_000;
/** Trần khi dò lại cửa trạm sau khi phát hành. */
const PROBE_TIMEOUT_MS = 20_000;

const die = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/**
 * Chạy một lệnh và NUỐT đầu ra (dùng cho git/tar và các phép hỏi nhanh).
 *
 * `shell` mặc định TẮT, và đó là chuyện an toàn chứ không phải gu: với `shell: true` Node nối
 * chuỗi đối số thay vì escape, nên một đường dẫn có khoảng trắng (`C:\…\Local Settings\…`) sẽ
 * vỡ làm đôi. Chỉ bật shell cho những lệnh BẮT BUỘC cần — trên Windows `vercel` là một tệp
 * `.cmd`, không có shell thì `execFile` trả ENOENT.
 */
function run(
  file: string,
  args: string[],
  opts: { cwd?: string; timeout: number; shell?: boolean },
): string {
  return execFileSync(file, args, {
    cwd: opts.cwd ?? repoRoot,
    timeout: opts.timeout,
    encoding: "utf8",
    shell: opts.shell ?? false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Chạy lệnh và ĐỔ THẲNG đầu ra ra màn hình, trả về mã thoát thay vì ném.
 *
 * Dùng cho chính lượt deploy, và lý do là trải nghiệm người bấm: một lượt deploy mất ngót một
 * phút, mà nuốt hết đầu ra thì cửa sổ .bat đứng im — không phân biệt được「đang chạy」với
 *「đã treo」. Thà để CLI kể chuyện của nó.
 */
function runLive(file: string, args: string[], opts: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }): number {
  const res = spawnSync(file, args, {
    cwd: opts.cwd,
    timeout: opts.timeout,
    env: opts.env,
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (res.error) throw res.error;
  // `status` null nghĩa là tiến trình bị tín hiệu giết — gần như luôn là do chạm trần thời gian.
  return res.status ?? 1;
}

// ---- 1. Điều kiện cần ----------------------------------------------------------------------

if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");

try {
  run("vercel", ["--version"], { timeout: QUICK_TIMEOUT_MS, shell: true });
} catch {
  die("Không gọi được `vercel`. Cài bằng `npm i -g vercel` rồi chạy lại.");
}

const tokens = discoverTokens(process.env);
if (tokens.length === 0) {
  die("Không thấy token nào trong env. Cần ít nhất VERCEL_TOKEN (và VERCEL_TOKEN_<TÊN> cho tài khoản khác).");
}
/** Tra token theo tên biến — `discoverTokens` đã bảo đảm mọi giá trị ở đây khác rỗng. */
const tokenByEnvName = new Map(tokens.map((t) => [t.envName, t.token]));
console.log(`• Token khai trong env: ${tokens.map((t) => t.envName).join(", ")}`);

// ---- 2. Sổ gương — đọc từ TRẠM ĐANG HOẠT ĐỘNG ------------------------------------------------

const readBook = async (url: string): Promise<Book> => {
  const rows = (await neon(url)`select value from app_settings where id = 'global'`) as { value: unknown }[];
  return (rows[0]?.value ?? {}) as Book;
};

// Toàn bộ luật「đọc sổ ở đâu」nằm ở chooseBook() — hàm thuần, verify:deploy-targets bao từng
// nhánh. Ở đây chỉ là chỗ nối dây, đúng lối beginSwitchAction làm với canSwitch().
const doc = await readControlDoc();
const loaded = await chooseBook({
  localBook: await readBook(process.env.DATABASE_URL!),
  activeSiteId: doc?.activeSiteId ?? null,
  readRemote: (envelope) => readBook(decryptSecret(envelope)),
});
if (loaded.warning) console.warn(`  ⚠ ${loaded.warning}`);

const stations = loaded.stations.filter((m): m is StationEntry => Boolean(m?.id && m?.url));
if (stations.length === 0) {
  die("Sổ gương chưa có trạm nào. Vào trang Tông Môn → tab Gương Trạm ghi trạm vào sổ trước.");
}
console.log(`• Sổ gương (${loaded.from}) có ${stations.length} trạm: ${stations.map((s) => s.id).join(", ")}`);

/**
 * TRẠM ĐANG PHỤC VỤ CÓ NẰM TRONG SỔ NÀY KHÔNG — câu hỏi mà lượt chạy 12/08/2026 trả lời SAI.
 *
 * Hôm ấy sổ dưới máy (của `main`, nghỉ từ 10/08) chỉ còn hai trạm; trạm đang phục vụ là
 * `auto-hh3d-2` không có trong đó, nên `chooseBook` fail-open lùi về sổ cũ và phát hành cho hai
 * trạm không ai dùng. Cảnh báo CÓ in — ngay sau `chooseBook`, rồi bốn lượt build Vercel đẩy nó
 * lên hàng trăm dòng — còn dòng cuối cùng người ta thật sự đọc lại là câu「Mọi trạm trong sổ đã
 * mang cùng một commit」, in vô điều kiện, kèm mã thoát 0. Một lời trấn an đặt đúng chỗ mắt
 * người rơi vào.
 *
 * Nên: câu hỏi ấy được hỏi ở ĐÂY và trả lời lại ở TỔNG KẾT, ngay cạnh mã thoát.
 *
 * `null` khi chưa đọc được bảng điều phối — lúc ấy không ai biết trạm nào đang phục vụ, và đoán
 * bừa còn tệ hơn im lặng; cảnh báo của `chooseBook` đã nói đúng chuyện đó rồi.
 */
const activeSiteId = doc?.activeSiteId ?? null;
const activeMissing = activeSiteId != null && !stations.some((s) => s.id === activeSiteId);

/** In lời phán về độ phủ của sổ. Trả về `true` nếu lượt chạy này phải coi là HỎNG. */
function reportBookCoverage(): boolean {
  if (activeMissing) {
    console.error(`\n  ✗ TRẠM ĐANG PHỤC VỤ「${activeSiteId}」KHÔNG có trong sổ vừa dùng — nó KHÔNG được phát hành.`);
    console.error(`    Sổ đọc từ: ${loaded.from}`);
    console.error("    Thuốc, không phải sửa tệp nào — chạy lại kèm sổ của chính trạm ấy:");
    console.error('      DATABASE_URL="<chuỗi kết nối của trạm đang phục vụ>" npm run deploy:all');
    console.error("    Lấy chuỗi ấy bằng cách giải mã `mirrors[].pg` ở một trạm ĐỌC ĐƯỢC (trạm vừa bàn giao");
    console.error("    là gần nhất), rồi đọc sổ CỦA NÓ — xem deploy/mirror/README.md.");
    return true;
  }
  if (loaded.warning) {
    console.warn(`\n  ⚠ Sổ dùng cho lượt này có cảnh báo (đọc lại dòng ⚠ ở đầu): ${loaded.from}`);
    console.warn("    Không biết chắc sổ đã đủ trạm — câu bên dưới chỉ nói về những trạm CÓ trong sổ ấy.");
  }
  return false;
}

// ---- 3. Danh mục project của từng tài khoản -------------------------------------------------

// Phép liệt kê project dời sang `vercelCatalog.mts` ngày 12/08/2026, khi công cụ XOÁ trạm cần
// đúng phép ấy. Chép sang tệp thứ hai thì hai công cụ sẽ bất đồng về việc「project này thuộc tài
// khoản nào」— mà bất đồng ở đúng câu hỏi đó nghĩa là xoá nhầm tài khoản.
const catalog: ProjectRef[] = [];
for (const source of tokens) {
  const found = await projectsFor(source);
  catalog.push(...found);
  console.log(`  ${source.envName} → ${found.length} project`);
}

// ---- 4. Tra đích TRƯỚC, phát hành SAU --------------------------------------------------------
// Tra hết rồi mới động tay: một lỗi cấu hình phải lộ ra trước khi có trạm nào bị đổi mã, và
// bảng kế hoạch bên dưới là thứ để soi trong `--dry-run`.

type Plan = { station: StationEntry; target: ProjectRef };
const plans: Plan[] = [];
const unresolved: { station: StationEntry; message: string }[] = [];

for (const station of stations) {
  const resolved = resolveTarget(station, catalog);
  if (resolved.ok) plans.push({ station, target: resolved.target });
  else unresolved.push({ station, message: resolved.message });
}

// Hai trạm trỏ về CÙNG một project là sổ khai sai (hai entry cùng `url`). Phát hành vẫn đúng —
// cùng mã lên cùng chỗ, hai lần — nhưng phải nói ra, vì nó nghĩa là một trạm nào đó trong sổ
// thật ra không tồn tại, và ngày chuyển trạm sẽ chọn phải một cái tên trỏ vào hư không.
const byProject = new Map<string, string[]>();
for (const { station, target } of plans) {
  byProject.set(target.projectId, [...(byProject.get(target.projectId) ?? []), station.id]);
}
for (const [projectId, ids] of byProject) {
  if (ids.length > 1) {
    console.warn(`  ⚠ ${ids.join(" và ")} cùng trỏ về một project (${projectId}) — sổ gương đang khai trùng.`);
  }
}

console.log("\n── Kế hoạch phát hành ───────────────────────────────");
for (const { station, target } of plans) {
  console.log(`  ✔ ${station.id.padEnd(14)} → project「${target.name}」qua ${target.envName}`);
}
for (const { station, message } of unresolved) {
  console.log(`  ✗ ${station.id.padEnd(14)} → ${message}`);
}

// ---- 5. Commit sắp phát hành -----------------------------------------------------------------

const head = run("git", ["rev-parse", "--short", "HEAD"], { timeout: QUICK_TIMEOUT_MS }).trim();
const subject = run("git", ["log", "-1", "--pretty=%s"], { timeout: QUICK_TIMEOUT_MS }).trim();
const dirty = run("git", ["status", "--porcelain"], { timeout: QUICK_TIMEOUT_MS }).trim();

console.log(`\n• Phát hành commit ${head} — ${subject}`);
if (dirty) {
  // KHÔNG chặn: cây làm việc này có nhiều phiên dùng chung, nên tệp bẩn của người khác không
  // được quyền giữ một bản vá lại. Nhưng phải kêu to, vì thứ lên trạm là HEAD chứ không phải
  // những gì đang thấy trên màn hình.
  console.warn("  ⚠ CÂY LÀM VIỆC CÓ THAY ĐỔI CHƯA COMMIT — chúng KHÔNG lên trạm nào:");
  for (const line of dirty.split(/\r?\n/)) console.warn(`      ${line}`);
}

if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, chưa phát hành gì.");
  // Kế hoạch thiếu trạm đang phục vụ thì ĐỎ ngay ở đây — soi kế hoạch trước khi phát hành đúng
  // là việc `--dry-run` sinh ra để làm; báo xanh một kế hoạch hụt là bỏ phí đúng lượt chạy ấy.
  const badBook = reportBookCoverage();
  process.exit(unresolved.length > 0 || badBook ? 1 : 0);
}
if (plans.length === 0) die("Không tra được đích cho trạm nào — không có gì để phát hành.");

// ---- 6. Đóng gói MỘT lần, giải nén cho từng trạm ---------------------------------------------

const stage = mkdtempSync(path.join(tmpdir(), "deploy-all-"));
const TAR_NAME = "bundle.tar";

type Outcome = { station: StationEntry; ok: boolean; detail: string };
const outcomes: Outcome[] = [];

try {
  // `git archive` là git (hiểu đường dẫn Windows), còn `tar` bên dưới thì KHÔNG — nên mọi lượt
  // gọi tar đều chạy với cwd và đường dẫn TƯƠNG ĐỐI. GNU tar trong Git Bash đọc「D:\…」thành
  // hostname remote; cùng cái bẫy đã ghi ở buildWorkerBundle.mjs.
  run("git", ["archive", "--format=tar", "-o", path.join(stage, TAR_NAME), "HEAD"], {
    timeout: QUICK_TIMEOUT_MS,
  });

  for (const { station, target } of plans) {
    const dir = path.join(stage, station.id);
    mkdirSync(dir, { recursive: true });
    run("tar", ["-xf", `../${TAR_NAME}`], { cwd: dir, timeout: QUICK_TIMEOUT_MS });

    mkdirSync(path.join(dir, ".vercel"), { recursive: true });
    writeFileSync(
      path.join(dir, ".vercel", "project.json"),
      JSON.stringify({ projectId: target.projectId, orgId: target.orgId, projectName: target.name }),
    );

    // node_modules KHÔNG nằm trong git archive, và cũng không cần: Vercel tự cài từ lockfile.
    const token = tokenByEnvName.get(target.envName);
    if (!token) {
      // Không thể xảy ra (envName sinh ra từ chính bảng token này), nhưng nếu nó xảy ra thì
      // `{...process.env}` bên dưới sẽ lặng lẽ để lại VERCEL_TOKEN của trạm chính — tức phát
      // hành bằng nhầm tài khoản. Chặn thẳng thay vì tin vào một bất biến.
      console.error(`  ✗ ${station.id}: mất token ${target.envName} giữa chừng — bỏ qua trạm này.`);
      outcomes.push({ station, ok: false, detail: `mất token ${target.envName}` });
      continue;
    }

    console.log(`\n── ${station.id} → ${target.name} (${target.envName}) ─────────────`);
    const started = Date.now();
    let code: number;
    try {
      // Token đi bằng BIẾN MÔI TRƯỜNG, không phải `--token` trên dòng lệnh. Hai cái lợi: nó
      // không nằm trong command line để ai mở Task Manager cũng đọc được, và nó không phải đi
      // qua phép nối chuỗi của `shell: true`.
      code = runLive("vercel", ["--prod", "--yes"], {
        cwd: dir,
        timeout: DEPLOY_TIMEOUT_MS,
        env: { ...process.env, VERCEL_TOKEN: token },
      });
    } catch (err) {
      // Không ném ra ngoài: các trạm SAU vẫn phải được thử.
      console.error(`  ✗ không chạy nổi vercel: ${err instanceof Error ? err.message : "lỗi lạ"}`);
      outcomes.push({ station, ok: false, detail: "không chạy nổi vercel" });
      continue;
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (code === 0) {
      console.log(`  ✔ xong sau ${secs}s`);
      outcomes.push({ station, ok: true, detail: `${secs}s` });
    } else {
      console.error(`  ✗ HỎNG (mã ${code} sau ${secs}s) — lý do nằm trong nhật ký CLI ngay trên.`);
      outcomes.push({ station, ok: false, detail: `vercel trả mã ${code}` });
    }
  }
} finally {
  // Dọn thư mục tạm KHÔNG được phép giết lượt chạy — đo được ngay lượt chạy thật đầu tiên:
  // cả hai trạm đã phát hành xong, rồi `rmSync` ném EPERM và cuốn theo cả bảng tổng kết. Trên
  // Windows tệp còn bị giữ handle một nhịp sau khi CLI thoát, mà `force: true` chỉ bỏ qua
  // ENOENT chứ không bỏ qua EPERM.
  //
  // Hai lớp: `maxRetries` lo cái handle chưa kịp nhả, còn `try` lo mọi thứ còn lại. Bỏ quên
  // một thư mục tạm là chuyện vặt; bỏ mất bảng tổng kết của một lượt phát hành thì không.
  try {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(
      `\n⚠ Không xoá được thư mục tạm ${stage} (${err instanceof Error ? err.message : "lỗi lạ"}).` +
        " Phát hành KHÔNG bị ảnh hưởng — xoá tay lúc rảnh.",
    );
  }
}

// ---- 7. Dò lại hai cửa và tổng kết -----------------------------------------------------------

console.log("\n── Dò lại từng trạm ─────────────────────────────────");
for (const { station, ok } of outcomes) {
  if (!ok) continue;
  try {
    const res = await fetch(station.url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    // 200 = trạm đang phục vụ; 307 = trạm dự phòng đang chuyển hướng về trạm hoạt động. Cả hai
    // đều LÀNH — script không phán trạm nào đáng hoạt động, đó là việc của bảng điều phối.
    const where = res.headers.get("location");
    console.log(`  ${station.id.padEnd(14)} ${res.status}${where ? ` → ${where}` : ""}`);
  } catch (err) {
    console.warn(`  ${station.id.padEnd(14)} không nối được: ${err instanceof Error ? err.message : "lỗi lạ"}`);
  }
}

const failed = outcomes.filter((o) => !o.ok);
console.log("\n── Tổng kết ─────────────────────────────────────────");
console.log(`  commit  : ${head} — ${subject}`);
console.log(`  thành   : ${outcomes.filter((o) => o.ok).map((o) => o.station.id).join(", ") || "(không trạm nào)"}`);
if (failed.length > 0 || unresolved.length > 0) {
  const lagging = [...failed.map((f) => f.station.id), ...unresolved.map((u) => u.station.id)];
  console.log(`  LỆCH MÃ : ${lagging.join(", ")} — vẫn đang chạy bản CŨ`);
  console.log("\n  Trạm lệch mã là một cái bẫy nằm im: nó chỉ chuyển hướng nên không ai thấy nó cũ,");
  console.log("  cho tới ngày nó lên ngôi và trở thành nơi phát lệnh. Chữa xong thì chạy lại lệnh này.");
  reportBookCoverage();
  process.exit(1);
}

// Mọi trạm TRONG SỔ đã xong — nhưng cái sổ ấy có đủ trạm không lại là câu khác, và nó phải được
// trả lời TRƯỚC câu trấn an, không phải cách đó hàng trăm dòng.
if (reportBookCoverage()) process.exit(1);

console.log("  Mọi trạm trong sổ đã mang cùng một commit.");
console.log("\n  Nhắc: bản vá đụng khôi lỗi (scripts/worker.mjs, src/lib/worker, src/lib/quest-engine,");
console.log("  scripts/buildWorkerBundle.mjs) thì VM còn phải cài đè — xem deploy/oracle/README.md.");
