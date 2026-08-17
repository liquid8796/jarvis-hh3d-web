#!/usr/bin/env node
/**
 * ĐỔI TÊN kho khôi lỗi GitHub (và `WORKER_ID` của nó) sang tên ngẫu nhiên của luật mới.
 *
 *   npm run vm -- npm run github:rename -- --dry-run     xem kế hoạch, KHÔNG đụng gì
 *   npm run vm -- npm run github:rename -- --yes         đổi tên MỌI kho còn mang tên đời cũ
 *   npm run vm -- npm run github:rename -- --repo <tên>  đúng một kho
 *   npm run vm -- npm run github:rename -- --all         kể cả kho đã hợp luật (rút tên mới lần nữa)
 *
 * ── VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────────
 *
 * Luật đặt tên đổi ngày 17/08/2026 (xem `khoiloiNaming.mjs`): tên kho và `WORKER_ID` nay là một
 * cái tên ngẫu nhiên kiểu `cobalt-relay-4f2a`, không còn tiền tố. Nhưng luật chỉ áp cho kho DỰNG
 * TỪ ĐÓ — tám kho đang chạy vẫn mang `linh-su-…` và `khoiloi-tro-…`, tức vẫn nhận ra nhau bằng
 * mắt thường. Tệp này là lượt dọn ấy.
 *
 * ── BA ĐIỀU QUYẾT ĐỊNH HÌNH DẠNG TỆP NÀY ─────────────────────────────────────────────────────
 *
 * 1. **GitHub TRƯỚC, sổ SAU.** Đổi tên trên GitHub xong mới ghi sổ. Ngược lại thì một lượt PATCH
 *    hỏng để lại sổ trỏ vào một cái tên không tồn tại — và mọi thứ đọc sổ (deploy, nuôi kho, xoá)
 *    đều 404 từ đó. Thứ tự này thì tệ nhất là sổ CŨ hơn đời thật, mà GitHub tự chuyển hướng tên cũ
 *    sang tên mới nên mọi lời gọi vẫn tới đúng kho.
 *
 * 2. **Ghi sổ bằng MỘT câu SQL nhắm đúng một phần tử**, không đọc-cả-mảng-rồi-ghi-đè. Sổ là tài
 *    sản chung: trưởng môn có thể đang sửa một dòng khác trên tab Kho GitHub ngay lúc này, và ghi
 *    bằng ảnh chụp cũ là lặng lẽ lộn ngược việc của họ. Câu `jsonb_agg(CASE …)` dưới đây chỉ chạm
 *    đúng phần tử khớp owner+repo.
 *
 * 3. **Hỏng một kho KHÔNG chặn các kho còn lại**, y như `deployGithubKhoiloi.mts`. Nhưng bảng tổng
 *    kết phải nói thẳng kho nào giờ đang LỆCH — tên trên GitHub đã đổi mà sổ chưa kịp ghi — vì đó
 *    là trạng thái duy nhất cần người sửa tay.
 *
 * ── SAU LƯỢT NÀY CÒN HAI BƯỚC ─────────────────────────────────────────────────────────────────
 *
 * Đổi tên xong thì runner ĐANG CHẠY vẫn mang `WORKER_ID` cũ (nó đã checkout từ trước), và workflow
 * trong kho vẫn ghi id cũ. Nên:
 *
 *   npm run vm -- npm run github:deploy -- --restart   đẩy workflow mang id mới + phát lượt mới
 *   npm run vm -- npm run roster:purge                 dọn dòng id CŨ khỏi sổ điểm danh
 *
 * Script này KHÔNG tự làm hai bước ấy: bước đầu cắt runner (đàn đang cày sẽ hỏng), nên nó phải là
 * một quyết định riêng của người vận hành — cùng lẽ với `--force` bên `github:deploy`.
 */
import { sqlTag } from "./pgTag.mjs";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import { explainFailure, reviewStationIdentity } from "../src/lib/validation/githubStations";
import { randomSoftwareName, reviewGeneratedName, GENERATED_NAME_SHAPE } from "./khoiloiNaming.mjs";
import { appDatabaseUrl } from "./activeStationPg.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const dryRun = argv.includes("--dry-run");
const yes = argv.includes("--yes");
const renameAll = argv.includes("--all");
const onlyRepo = arg("repo");

const die = (message: string): never => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "scheduled-tasks-ops";
const REQUEST_TIMEOUT_MS = 30_000;

type Station = { owner: string; repo: string; workerId: string; pat: string; enabled: boolean };

async function callGithub(
  pat: string,
  method: "GET" | "PATCH",
  path: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_ROOT}${path}`, {
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
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* GitHub trả HTML ở vài cảnh lỗi — giữ nguyên chuỗi để câu báo lỗi còn đọc được */
  }
  return { status: response.status, body };
}

const databaseUrl = appDatabaseUrl();
const sql = sqlTag(databaseUrl);

const rows = (await sql`
  SELECT value -> 'githubStations' AS stations FROM app_settings WHERE id = 'global'
`) as Array<{ stations: unknown }>;

const raw = rows[0]?.stations;
if (raw != null && !Array.isArray(raw)) {
  die("Sổ Kho GitHub trong app_settings không phải một mảng — soi tab Kho GitHub.");
}

const stations: Station[] = [];
for (const row of (raw ?? []) as Array<Record<string, unknown>>) {
  const owner = String(row?.owner ?? "");
  const repo = String(row?.repo ?? "");
  if (reviewStationIdentity(owner, repo, String(row?.workflowFile ?? "x.yml"))) continue;
  stations.push({
    owner,
    repo,
    workerId: String(row?.workerId ?? ""),
    pat: String(row?.pat ?? ""),
    enabled: row?.enabled !== false,
  });
}

if (stations.length === 0) die("Sổ Kho GitHub trống — không có gì để đổi tên.");

/** Kho đã hợp luật mới thì bỏ qua, trừ khi `--all`: đổi tên một kho đang yên là tốn công vô ích. */
const needsRename = (s: Station) =>
  renameAll || !GENERATED_NAME_SHAPE.test(s.repo.toLowerCase()) || !GENERATED_NAME_SHAPE.test(s.workerId.toLowerCase());

const picked = stations.filter(
  (s) => (onlyRepo ? s.repo.toLowerCase() === onlyRepo.toLowerCase() : needsRename(s)),
);

if (picked.length === 0) {
  console.log("\n✔ Mọi kho trong sổ đã mang tên hợp luật mới — không có gì để làm.");
  process.exit(0);
}

/**
 * Rút tên cho CẢ LƯỢT trước khi đụng vào GitHub, và soát trùng với mọi tên đang có trong sổ lẫn
 * mọi tên vừa rút. Rút sẵn cũng là thứ cho phép `--dry-run` in ra đúng những cái tên sẽ dùng.
 */
const taken = new Set(stations.flatMap((s) => [s.repo.toLowerCase(), s.workerId.toLowerCase()]));
const plan = picked.map((station) => {
  let name = randomSoftwareName();
  for (let attempt = 0; taken.has(name) && attempt < 50; attempt++) name = randomSoftwareName();
  if (taken.has(name)) die("Rút năm chục lần vẫn trùng tên đã có — hai rổ từ quá hẹp so với số kho.");
  const complaint = reviewGeneratedName("Tên mới", name);
  if (complaint) die(complaint);
  taken.add(name);
  return { station, name };
});

console.log(`\nĐổi tên kho khôi lỗi — ${plan.length}/${stations.length} kho\n`);
for (const { station, name } of plan) {
  console.log(`  ${station.owner}/${station.repo}`);
  console.log(`    → kho      : ${name}`);
  console.log(`    → WORKER_ID: ${station.workerId} → ${name}`);
}

if (dryRun) {
  console.log("\n--dry-run: KHÔNG đụng gì cả. Bỏ cờ ấy (và thêm --yes) để đổi thật.");
  process.exit(0);
}

if (!yes) {
  die(
    "Thiếu --yes. Lượt này đổi tên kho CÔNG KHAI và đổi luôn danh tính khôi lỗi trong sổ.\n" +
      "  Xem trước bằng --dry-run, rồi chạy lại kèm --yes.",
  );
}

type Outcome = { slug: string; state: "đã đổi" | "HỎNG" | "LỆCH SỔ"; detail: string };
const outcomes: Outcome[] = [];

for (const { station, name } of plan) {
  const slug = `${station.owner}/${station.repo}`;
  try {
    const pat = isEncrypted(station.pat) ? decryptSecret(station.pat) : station.pat;
    if (pat.trim().length === 0) throw new Error("dòng sổ không có PAT — sửa ở tab Kho GitHub");

    // 1. Đổi tên trên GitHub. 200 = xong; GitHub tự chuyển hướng tên cũ sang tên mới.
    const renamed = await callGithub(pat, "PATCH", `/repos/${station.owner}/${station.repo}`, { name });
    if (renamed.status !== 200) {
      throw new Error(explainFailure(renamed.status, renamed.body, `đổi tên kho thành「${name}」`));
    }

    // 2. Nghiệm thu: hỏi lại bằng TÊN MỚI. „200" của lượt PATCH mới là lời hứa; lượt GET này mới
    //    là bằng chứng — cùng kỷ luật với lượt `github:remove` đòi một GET trả 404 sau khi xoá.
    const after = await callGithub(pat, "GET", `/repos/${station.owner}/${name}`);
    if (after.status !== 200) {
      throw new Error(`GitHub nhận lệnh đổi tên nhưng hỏi lại「${name}」vẫn trả ${after.status}`);
    }

    // 3. Ghi sổ — một câu, nhắm đúng phần tử khớp owner+repo cũ (xem điều 2 ở đầu tệp).
    try {
      await sql`
        UPDATE app_settings
           SET value = jsonb_set(
                 value,
                 '{githubStations}',
                 (SELECT jsonb_agg(
                           CASE WHEN s->>'owner' = ${station.owner} AND s->>'repo' = ${station.repo}
                                THEN s || jsonb_build_object('repo', ${name}::text, 'workerId', ${name}::text)
                                ELSE s END)
                    FROM jsonb_array_elements(value -> 'githubStations') s))
         WHERE id = 'global'
      `;
    } catch (err) {
      outcomes.push({
        slug,
        state: "LỆCH SỔ",
        detail:
          `kho trên GitHub ĐÃ thành「${name}」nhưng ghi sổ hỏng: ${err instanceof Error ? err.message : String(err)}.\n` +
          `      Sửa TAY ở tab Kho GitHub: đổi repo và WORKER_ID của dòng「${slug}」thành「${name}」.`,
      });
      continue;
    }

    outcomes.push({ slug, state: "đã đổi", detail: `→ ${station.owner}/${name} · WORKER_ID ${name}` });
  } catch (err) {
    outcomes.push({ slug, state: "HỎNG", detail: err instanceof Error ? err.message : String(err) });
  }
}

console.log("\n── Tổng kết ─────────────────────────────────────────");
for (const o of outcomes) console.log(`  ${o.state === "đã đổi" ? "✔" : "✗"} ${o.slug} ${o.state}  ${o.detail}`);

const broken = outcomes.filter((o) => o.state !== "đã đổi");
if (outcomes.some((o) => o.state === "đã đổi")) {
  console.log(
    "\n  CÒN HAI BƯỚC, và cả hai đều cắt runner nên phải do người vận hành bấm:\n" +
      "    npm run vm -- npm run github:deploy -- --restart   đẩy workflow mang WORKER_ID mới\n" +
      "    npm run vm -- npm run roster:purge                 dọn dòng id CŨ khỏi sổ điểm danh",
  );
}
process.exit(broken.length > 0 ? 1 : 0);
