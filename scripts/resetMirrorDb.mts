#!/usr/bin/env node
/**
 * DỰNG LẠI DATABASE CỦA MỘT TRẠM — xoá sạch kho cũ, dựng kho mới, KHÔNG đụng tới project web.
 *
 *   npm run mirror:reset-db -- --site auto-hh3d-3            (hoặc bấm đúp reset-mirror-db.bat)
 *   npm run mirror:reset-db -- --site auto-hh3d-3 --dry-run  soi kế hoạch, không xoá gì
 *   npm run mirror:reset-db -- --site auto-hh3d-3 --store neon   chỉ dựng lại Postgres
 *   npm run mirror:reset-db -- --site auto-hh3d-3 --yes      bỏ bước gõ lại mã trạm
 *
 * VÌ SAO KHÔNG PHẢI `mirror:remove` RỒI `mirror:new`: cặp ấy xoá luôn cả project web, tức mất
 * tên miền, mất env, mất mọi deployment, và lượt dựng lại phải đi qua bước「Additional setup
 * required」có khi cần người thật bấm. Khi thứ hỏng chỉ là DATABASE — schema lệch, migration
 * thiếu, dữ liệu rác — thì phá cả cái nhà để thay một cái bể nước là đắt và rủi ro không cần
 * thiết. Tệp này thay đúng cái bể.
 *
 * ── BA HÀNG RÀO ────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **KHÔNG BAO GIỜ đụng trạm ĐANG PHỤC VỤ**, và không có cờ nào mở được hàng rào này. Xoá
 *    database của trạm ấy là xoá môn đồ, tài khoản game, đàn đang chạy — và xoá luôn CHÍNH CUỐN
 *    SỔ chứa chuỗi kết nối lẫn token của mọi trạm còn lại, tức công cụ này tự phá mất thứ nó cần
 *    để ghi kết quả về. Chuyển trạm sang chỗ khác trước đã.
 * 2. **Kho DÙNG CHUNG với project khác thì không xoá.** Sợi dây duy nhất nhận ra kho của một trạm
 *    là project đang nối (tên kho là chuỗi ngẫu nhiên, cố ý — xem `randomStoreName`), nên một kho
 *    nối hai project là một kho không quy được về ai. Chỉ báo tên rồi để yên.
 * 3. **Gõ lại mã trạm để xác nhận**, không phải「y/n」. Một cú Enter theo quán tính không được
 *    phép xoá một database. Máy móc thì dùng `--yes`.
 *
 * ── XOÁ TRƯỚC, DỰNG SAU — và đó là chiều BẮT BUỘC ──────────────────────────────────────────────
 *
 * Ngược lại nghe an toàn hơn (có kho mới rồi mới bỏ kho cũ) nhưng không chạy được: hai kho Neon
 * cùng nối một project thì cả hai cùng tiêm `DATABASE_URL`, và cái trạm đọc được là cái nào thì
 * không ai hứa. Nên phải cắt trước. Cái giá là một khoảng trạm không có database — chấp nhận
 * được vì luật số 1 đã bảo đảm trạm ấy không phục vụ ai — và lượt chạy in sẵn lệnh chữa nếu bước
 * dựng lại hỏng giữa chừng.
 *
 * ── SAU LƯỢT NÀY TRẠM RỖNG ─────────────────────────────────────────────────────────────────────
 *
 * Có bảng, không có dữ liệu. Nó CHƯA sẵn sàng để nhận lượt chuyển trạm, và script nói điều đó ra
 * ở cuối. Hai việc còn lại đều đã có công cụ riêng: phát hành lại (env mới chỉ vào deployment mới)
 * và đồng bộ dữ liệu từ trạm đang phục vụ.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { neon } from "@neondatabase/serverless";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import {
  discoverTokens,
  mergeTokenSources,
  projectNameFromUrl,
  randomStoreName,
  sensitiveEnvKeys,
  storesOfProject,
  tokenEnvNameFor,
  tokensFromBook,
  validateSiteId,
  STORE_SPECS_SHARED,
  type Book,
  type ProjectEnvVar,
  type StoreRef,
} from "./deployTargets.mts";
import { appDatabaseUrl } from "./activeStationPg.mts";
import { buildCatalog } from "./vercelCatalog.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");

/**
 * Lời từ chối của script này — NÉM chứ không `process.exit`, và mang một lớp riêng để lượt bắt ở
 * cuối phân biệt「ta chủ động dừng」với「một lỗi không ai lường」.
 *
 * VÌ SAO KHÔNG `process.exit()`: dưới `tsx` trên Windows, gọi nó sau một lượt `fetch` làm libuv
 * ném `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` và mã thoát thành 127. Đã ĐO ở
 * chính tệp này: lượt từ chối「trạm đang phục vụ」in ra lời từ chối tử tế RỒI kèm một dòng
 * assertion. Với một công cụ XOÁ DATABASE thì dòng ấy ngay sau「đã xoá kho」là đủ để người vận
 * hành tưởng mình vừa làm hỏng cái gì giữa chừng. Cùng kỷ luật với `removeGithubKhoiloi.mts`.
 */
class Stop extends Error {}

function die(message: string): never {
  console.error(`\n✗ ${message}`);
  throw new Stop(message);
}

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  const value = process.argv[at + 1];
  return at > -1 && value && !value.startsWith("--") ? value : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const skipConfirm = process.argv.includes("--yes");

const QUICK_MS = 60_000;
const API_MS = 30_000;
const PROVISION_MS = 10 * 60_000;
const REMOVE_STORE_MS = 5 * 60_000;

/** Dạng biến môi trường mà cả hệ gương đứng lên — xem khối bình chú `ENV_TYPE` ở `newMirrorStation`. */
const ENV_TYPE = "encrypted";

async function main(): Promise<void> {
  // ---- 1. Đối số ---------------------------------------------------------------------------------

  const parsed = validateSiteId(arg("site") ?? "");
  if (!parsed.ok) die(`${parsed.message}\n  Ví dụ: npm run mirror:reset-db -- --site auto-hh3d-3`);
  const siteId = parsed.siteId;

  /**
   * `--store` thu hẹp lượt dựng lại về ĐÚNG một kho, và nó có mặt vì hai kho không cùng một giá.
   *
   * Postgres dựng lại là chuyện rẻ: `migrate.mjs` dựng lại toàn bộ schema trong vài giây, và dữ liệu
   * thì lượt đồng bộ chép về từ trạm đang phục vụ. Mongo giữ ĐÀM ĐẠO — thứ không có bản sao ở đâu
   * khác và không lượt migration nào dựng lại được. Nên khi chỉ Postgres hỏng, đập luôn cả Mongo là
   * một cái giá không ai xin trả.
   */
  const onlyStore = arg("store")?.trim().toLowerCase();
  if (onlyStore && !STORE_SPECS_SHARED.some((s) => s.slug === onlyStore)) {
    die(
      `--store「${onlyStore}」không phải kho nào của trạm. Chọn một trong: ` +
        STORE_SPECS_SHARED.map((s) => `${s.slug} (${s.label})`).join(", "),
    );
  }
  const specs = STORE_SPECS_SHARED.filter((s) => !onlyStore || s.slug === onlyStore);

  if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");
  if (!process.env.ENCRYPTION_KEY) die("Thiếu ENCRYPTION_KEY — không giải nổi chuỗi kết nối để tới sổ thật.");

  // ---- 2. Sổ có thẩm quyền, và LUẬT SỐ MỘT --------------------------------------------------------

  const readBook = async (url: string): Promise<Book> => {
    const rows = (await neon(url)`select value from app_settings where id = 'global'`) as { value: unknown }[];
    return (rows[0]?.value ?? {}) as Book;
  };

  const doc = await readControlDoc();
  if (!doc) {
    die("Không đọc được bảng điều phối — chưa biết trạm nào đang phục vụ thì KHÔNG dám xoá database nào.");
  }

  if (doc.activeSiteId === siteId) {
    die(
      `Trạm「${siteId}」ĐANG PHỤC VỤ tông môn — KHÔNG dựng lại database của nó.\n` +
        "  Xoá database ấy là xoá môn đồ, tài khoản game, đàn đang chạy, và xoá luôn chính cuốn sổ\n" +
        "  giữ chuỗi kết nối lẫn token của mọi trạm còn lại.\n" +
        "  Chuyển trạm sang chỗ khác trước (trang Tông Môn → Gương Trạm → Chuyển trạm), rồi chạy lại.",
    );
  }

  /**
   * ── CÔNG CỤ NÀY ĐÃ MẤT PHẦN LỚN LÝ DO TỒN TẠI (16/08/2026) ─────────────────────────────────
   *
   * Nó sinh ra khi mỗi trạm là một bản sao đầy đủ: có project Vercel, có Neon riêng, có Atlas
   * riêng, và「dựng lại database của một trạm」là một việc có nghĩa. Cuộc dời backend về VM lấy
   * mất cái nghĩa ấy — app + Postgres + Mongo nay cùng nằm trên VM, năm vỏ Vercel chỉ còn rewrite
   * về một origin, và kho marketplace của từng trạm KHÔNG còn ai đọc.
   *
   * Nên lượt chạy này vẫn dựng lại được kho, nhưng thứ nó dựng lại là một database mà app không
   * dùng. Nói ra ngay đây, chứ đừng để ai tốn một giờ mới nhận ra.
   */
  console.warn(
    "\n⚠ TỪ 16/08/2026 KHO CỦA TRẠM KHÔNG CÒN LÀ DATABASE CỦA APP.\n" +
      "  App + Postgres + Mongo cùng nằm trên VM; năm vỏ Vercel chỉ rewrite về đó. Dựng lại kho\n" +
      "  marketplace của một trạm nay KHÔNG chạm tới dữ liệu thật — nó chỉ thay một database mà\n" +
      "  không ai đọc. Muốn đụng database thật thì: npm run vm -- <lệnh>\n",
  );

  /**
   * Sổ gương vẫn nằm trong database của APP, nên phần đọc/ghi sổ phải đứng ở đó — không phải ở
   * Neon của trạm nào cả.
   */
  const activeUrl = ((): string => {
    try {
      return appDatabaseUrl();
    } catch (err) {
      return die(err instanceof Error ? err.message : "Không tra ra database của app.");
    }
  })();
  const book = await readBook(activeUrl);
  const mirrors = book.mirrors ?? [];
  const entry = mirrors.find((m) => m.id === siteId);

  console.log(`• Bảng điều phối: trạm đang phục vụ là「${doc.activeSiteId}」`);
  console.log(`• Sổ có thẩm quyền: ${mirrors.length} trạm`);

  /**
   * KHÔNG CÓ DÒNG SỔ THÌ KHÔNG LÀM.
   *
   * Khác `mirror:remove` (bên ấy còn dọn được một trạm đã rơi khỏi sổ): lượt này KẾT bằng một phép
   * ghi ngược vào sổ. Không có dòng để ghi thì chuỗi kết nối mới chỉ nằm trong env của project, và
   * mọi công cụ đọc sổ — `deploy:all`, phép tra trạm hoạt động, lượt đồng bộ — vẫn cầm chuỗi cũ đã
   * chết. Trạm sẽ trông như còn sống mà thật ra không ai với tới được.
   */
  if (!entry) {
    die(
      `Sổ không có trạm「${siteId}」— lượt này kết bằng một phép ghi ngược vào sổ, nên không có dòng\n` +
        "  thì chuỗi kết nối mới sẽ không tới được công cụ nào.\n" +
        "  Ghi trạm vào sổ trước (trang Tông Môn → Gương Trạm →「Ghi trạm này vào sổ」trên chính trạm ấy).",
    );
  }

  // ---- 3. Project nào, tài khoản nào --------------------------------------------------------------

  const named = entry.url ? projectNameFromUrl(entry.url) : { ok: false as const, message: "dòng sổ không có địa chỉ" };
  if (!named.ok) die(`Địa chỉ trong sổ của「${siteId}」không suy ra được tên project: ${named.message}`);
  const projectName = named.name;

  const fromBook = tokensFromBook(book, decryptSecret);
  if (fromBook.broken.length > 0) {
    console.warn(
      `  ⚠ ${fromBook.broken.length} trạm có token trong sổ nhưng KHÔNG giải nổi phong bì ` +
        `(${fromBook.broken.join(", ")}) — coi như chúng không có chìa.`,
    );
  }
  const tokens = mergeTokenSources(discoverTokens(process.env), fromBook.tokens);
  if (tokens.length === 0) {
    die(
      "Không có chìa nào: env không khai VERCEL_TOKEN/VERCEL_TOKEN_<TÊN>, mà sổ cũng không giữ token của trạm nào.\n" +
        `  Thêm ${tokenEnvNameFor(siteId)}=<token> vào .env.local rồi chạy lại.`,
    );
  }

  const catalog = await buildCatalog(tokens);
  // Đếm project KHÁC NHAU chứ không đếm số lượt nhìn thấy: một tài khoản lộ ra qua cả `.env.local`
  // lẫn sổ thì cùng một project hiện hai lần, và từ chối vì thế là từ chối bằng một lý do bịa.
  const distinct = new Map(catalog.filter((p) => p.name === projectName).map((p) => [p.projectId, p]));
  if (distinct.size > 1) {
    die(
      `Tên project「${projectName}」trỏ tới ${distinct.size} project KHÁC NHAU: ` +
        [...distinct.values()].map((p) => `${p.projectId} (qua ${p.label})`).join(", ") +
        "\n  — không đoán được cái nào của tông môn. Gỡ chìa của tài khoản lạ khỏi .env.local rồi chạy lại.",
    );
  }
  const target = [...distinct.values()][0];
  if (!target) {
    die(
      `Không chìa nào nhìn thấy project「${projectName}」.\n` +
        `  Thêm ${tokenEnvNameFor(siteId)}=<token của tài khoản giữ trạm ấy> vào .env.local rồi chạy lại.`,
    );
  }
  const token = tokens.find((t) => t.label === target.label)?.token ?? "";
  if (!token) die(`Tra ra project「${projectName}」nhưng không lấy lại được chìa đã dùng — soi lại .env.local.`);

  const api = async (p: string, init?: RequestInit) => {
    const res = await fetch(`https://api.vercel.com${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(API_MS),
    });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  const teams = await api("/v2/teams");
  const team = ((teams.body?.teams ?? []) as { id: string; slug: string }[]).find((t) => t.id === target.orgId);
  if (!team) die(`Chìa ${target.label} không thấy team của project「${projectName}」— không dựng kho đúng scope được.`);
  const scope = team.slug;
  const teamQuery = `teamId=${team.id}`;

  console.log(`• Project: ${projectName} · ${target.projectId} trên team ${scope} (qua ${target.label})`);

  // ---- 4. Kho nào của trạm này --------------------------------------------------------------------

  const stores = await api(`/v1/storage/stores?${teamQuery}`);
  if (!stores.ok) die(`Không liệt kê được kho của team ${scope} (HTTP ${stores.status}).`);
  const { cuaRieng, dungChung, moCoi } = storesOfProject((stores.body?.stores ?? []) as StoreRef[], projectName);

  /**
   * Kho nào ứng với `--store`: khớp theo `name` mà lượt dựng đã đặt thì KHÔNG được (tên là chuỗi
   * ngẫu nhiên, không mang chữ nào của tông môn). Vercel không trả về slug integration trong danh
   * sách kho, nên khi lọc theo `--store` ta chỉ dựng THÊM đúng kho ấy và xoá TẤT CẢ kho của riêng
   * trạm — điều đó sai. Nên `--store` chỉ nhận khi trạm có đúng một kho, hoặc người vận hành khai
   * thẳng tên kho phải xoá bằng `--store-name`.
   */
  const storeNameArg = arg("store-name")?.trim();
  let seXoa = cuaRieng;
  if (storeNameArg) {
    seXoa = cuaRieng.filter((s) => (s.name ?? "") === storeNameArg);
    if (seXoa.length === 0) {
      die(
        `Trạm này không có kho nào tên「${storeNameArg}」. Kho của riêng nó:\n` +
          (cuaRieng.length > 0 ? cuaRieng.map((s) => `    ${s.name ?? "(không tên)"}`).join("\n") : "    (không có)"),
      );
    }
  } else if (onlyStore && cuaRieng.length > 1) {
    die(
      `--store「${onlyStore}」không đủ để chọn: trạm có ${cuaRieng.length} kho, mà Vercel không khai kho nào\n` +
        "  thuộc integration nào trong danh sách. Khai thẳng tên kho phải xoá:\n" +
        cuaRieng.map((s) => `    --store-name ${s.name ?? "(không tên)"}`).join("\n"),
    );
  }

  // ---- 5. Kế hoạch ---------------------------------------------------------------------------------

  const ten = (s: StoreRef) => `${s.name ?? "(không tên)"}${s.id ? ` · ${s.id}` : ""}`;

  console.log(`\n── Sẽ DỰNG LẠI DATABASE ──────────────────────────────`);
  console.log(`  mã trạm   : ${siteId}`);
  console.log(`  project   : ${projectName}  ← KHÔNG đụng tới (web giữ nguyên)`);
  console.log(`  xoá kho   : ${seXoa.length === 0 ? "(không có kho nào để xoá — sẽ dựng mới luôn)" : ""}`);
  for (const s of seXoa) console.log(`              ${ten(s)}`);
  console.log(`  dựng kho  : ${specs.map((s) => s.label).join(", ")}`);

  if (dungChung.length > 0) {
    console.log(`\n  ⚠ GIỮ LẠI ${dungChung.length} kho vì còn project khác đang dùng chung:`);
    for (const s of dungChung) console.log(`      ${ten(s)} ← ${(s.projectsMetadata ?? []).map((p) => p.name).join(", ")}`);
  }
  if (moCoi.length > 0) {
    console.log(`\n  ⚠ ${moCoi.length} kho MỒ CÔI trên tài khoản này (không nối project nào) — KHÔNG đụng tới.`);
  }

  console.log(
    `\n  Sau lượt này trạm「${siteId}」có BẢNG nhưng KHÔNG có dữ liệu — nó chưa nhận được lượt\n` +
      "  chuyển trạm cho tới khi được phát hành lại và đồng bộ.",
  );

  if (dryRun) {
    console.log("\n--dry-run: dừng ở đây, chưa xoá gì cả.");
    return;
  }

  // ---- 6. Xác nhận -----------------------------------------------------------------------------------

  if (!skipConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const traLoi = (await rl.question(`\nGõ lại mã trạm「${siteId}」để xác nhận XOÁ DATABASE (Enter trống là huỷ): `)).trim();
    rl.close();
    if (traLoi !== siteId) die("Không khớp — huỷ, chưa xoá gì cả.");
  }

  // ---- 7. Xoá kho cũ ---------------------------------------------------------------------------------

  /** Chuỗi kết nối TRƯỚC lượt dựng lại — dùng để chứng minh cái mới thật sự là cái khác. */
  const pgCu = entry.pg ? decryptSecret(entry.pg) : null;

  for (const store of seXoa) {
    console.log(`\n── xoá kho ${ten(store)} ──`);
    const res = spawnSync(
      "vercel",
      ["integration", "resource", "remove", store.name ?? "", "--disconnect-all", "--yes", "--scope", scope],
      { timeout: REMOVE_STORE_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: "inherit" },
    );
    if (res.status !== 0) {
      die(
        `Xoá kho「${store.name}」hỏng (mã ${res.status ?? "bị giết"}). DỪNG — chưa dựng kho mới nào.\n` +
          `  Project「${projectName}」và các kho còn lại giữ nguyên. Chữa xong chạy lại lệnh này.`,
      );
    }
  }

  // ---- 8. Dựng kho mới ------------------------------------------------------------------------------

  const stage = mkdtempSync(path.join(tmpdir(), `reset-${siteId}-`));
  try {
    // Thư mục tạm trỏ vào project ĐANG CÓ — đây là toàn bộ mẹo của lượt này: `vercel integration add`
    // nối kho vào project mà `.vercel/project.json` chỉ tới, nên không cần tạo project mới.
    mkdirSync(path.join(stage, ".vercel"), { recursive: true });
    writeFileSync(
      path.join(stage, ".vercel", "project.json"),
      JSON.stringify({ projectId: target.projectId, orgId: team.id, projectName }),
    );

    for (const spec of specs) {
      const name = randomStoreName(randomBytes);
      console.log(`\n── dựng ${spec.label} (${name}) ────────────────────`);
      const res = spawnSync(
        "vercel",
        // KHÔNG ép `--non-interactive`: dựng kho Atlas mới trên một team vừa bị xoá hết kho có thể
        // đòi một bước bấm tay. Xem bình chú cùng chỗ ở `newMirrorStation.mts`.
        ["integration", "add", spec.slug, "--plan", spec.plan, "--name", name,
         ...spec.metadata.flatMap((pair) => ["-m", pair]),
         "--no-env-pull", "--scope", scope],
        { cwd: stage, timeout: PROVISION_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: "inherit" },
      );
      if (res.status !== 0) {
        die(
          `Dựng ${spec.label} hỏng (mã ${res.status ?? "bị giết"}).\n` +
            `  TRẠM「${siteId}」ĐANG KHÔNG CÓ ${spec.label} — kho cũ đã xoá, kho mới chưa lên.\n` +
            `  Chạy lại đúng lệnh này để dựng tiếp; hoặc dựng tay:\n` +
            `    npx vercel integration add ${spec.slug} --plan ${spec.plan} --scope ${scope}`,
        );
      }
    }

    // ---- 9. Đọc lại chuỗi kết nối mới -------------------------------------------------------------
    //
    // Soi DẠNG biến trước khi đọc giá trị: một biến `sensitive` vẫn có mặt trong danh sách nhưng
    // `env pull` trả về rỗng, nên để lượt đọc phán trước là nhận đúng một câu SAI —「integration
    // không tiêm DATABASE_URL」— trong khi nó đã tiêm tử tế, chỉ là ở dạng không đọc lại được.
    const envList = await api(`/v9/projects/${target.projectId}/env?${teamQuery}`);
    if (!envList.ok) die(`Không đọc lại nổi danh sách biến của trạm (HTTP ${envList.status}).`);
    const sensitive = sensitiveEnvKeys((envList.body?.envs ?? []) as ProjectEnvVar[]);
    if (sensitive.length > 0) {
      die(
        `Trạm có ${sensitive.length} biến ở dạng SENSITIVE (${sensitive.join(", ")}) — không đọc lại được,\n` +
          `  nên không lấy được chuỗi kết nối mới để ghi vào sổ.\n` +
          `  Chữa: Vercel dashboard → team「${scope}」→ Settings → Environment Variables, tắt\n` +
          "  「Sensitive Environment Variables」, xoá mấy biến trên rồi chạy lại lệnh này.",
      );
    }

    const pulled = spawnSync(
      "vercel",
      ["env", "pull", ".env.check", "--environment=production", "--yes", "--scope", scope],
      { cwd: stage, timeout: QUICK_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (pulled.status !== 0) die("Không kéo nổi env của trạm về để đọc chuỗi kết nối mới.");

    const envText = readFileSync(path.join(stage, ".env.check"), "utf8");
    const pick = (k: string): string | null => {
      const m = envText.match(new RegExp(`^${k}="?([^"\r\n]+)`, "m"));
      return m ? m[1] : null;
    };

    const wantPg = specs.some((s) => s.slug === "neon");
    const wantMongo = specs.some((s) => s.slug === "mongodbatlas");
    const pgUrl = pick("DATABASE_URL");
    const mongoUri = pick("MONGODB_URI");
    if (wantPg && !pgUrl) die("Kho Neon dựng xong nhưng KHÔNG tiêm DATABASE_URL — dừng, đừng ghi một trạm nửa vời vào sổ.");
    if (wantMongo && !mongoUri) die("Kho Atlas dựng xong nhưng KHÔNG tiêm MONGODB_URI — dừng, đừng ghi một trạm nửa vời vào sổ.");
    if (pick("MONGODB_DB")) {
      die("Trạm có MONGODB_DB — biến này PHẢI vắng ở mọi trạm, nếu không lượt đồng bộ Mongo chép vào sai database.");
    }

    /**
     * CHUỖI MỚI PHẢI KHÁC CHUỖI CŨ — phép kiểm rẻ nhất chứng minh lượt xoá-dựng thật sự đã đổi kho.
     *
     * Ca hỏng nó bắt: `integration resource remove` báo thành công nhưng biến `DATABASE_URL` cũ vẫn
     * nằm lại trong env của project (một lượt gỡ nối không dọn hết), rồi kho mới tiêm biến của nó
     * mà không đè được. Khi ấy mọi bước sau vẫn xanh — migrate chạy trên database CŨ, sổ ghi chuỗi
     * CŨ — và người vận hành tin rằng mình vừa dựng lại một database mà thật ra không có gì đổi.
     */
    if (wantPg && pgCu && pgUrl === pgCu) {
      die(
        "Chuỗi kết nối Postgres SAU lượt dựng lại giống hệt chuỗi cũ — kho mới chưa đè được biến của\n" +
          "  kho cũ. Vào Vercel dashboard xoá tay biến DATABASE_URL của project rồi chạy lại lệnh này.",
      );
    }
    console.log("\n✔ integration đã tiêm chuỗi kết nối MỚI (khác chuỗi cũ)");

    // ---- 10. Dựng bảng ------------------------------------------------------------------------------
    let migrations = 0;
    if (wantPg && pgUrl) {
      const migrated = spawnSync("node", ["scripts/migrate.mjs"], {
        cwd: repoRoot,
        timeout: PROVISION_MS,
        env: { ...process.env, DATABASE_URL: pgUrl },
        shell: false,
        stdio: ["ignore", "inherit", "inherit"],
      });
      if (migrated.status !== 0) {
        die(
          "Migration hỏng — database mới chưa có bảng, và sổ CHƯA được cập nhật.\n" +
            `  Chuỗi kết nối mới vẫn nằm trong env của project; lấy lại bằng:\n` +
            `    npx vercel env pull --environment=production --scope ${scope}`,
        );
      }
      const fresh = neon(pgUrl);
      const counted = (await fresh`select count(*)::int n from drizzle.__drizzle_migrations`) as { n: number }[];
      migrations = counted[0].n;
      console.log(`✔ database mới: ${migrations} migration`);
    }

    // ---- 11. Ghi ngược vào sổ Ở TRẠM ĐANG HOẠT ĐỘNG --------------------------------------------------
    //
    // Chỉ vá ĐÚNG hai trường của ĐÚNG dòng ấy, và đọc lại sổ ngay trước khi ghi: lượt chạy này mất
    // vài phút, và trong quãng ấy Gia chủ có thể đã sửa một dòng khác trên tab admin. Ghi đè bằng
    // bản chụp lấy từ đầu lượt là nuốt mất lượt sửa đó.
    const nowBook = await readBook(activeUrl);
    const nowMirrors = nowBook.mirrors ?? [];
    const at = nowMirrors.findIndex((m) => m.id === siteId);
    if (at < 0) {
      die(
        `Dòng sổ của「${siteId}」biến mất giữa chừng (có ai vừa gỡ nó?). Database mới ĐÃ dựng xong —\n` +
          `  ghi tay chuỗi kết nối vào sổ, hoặc chạy: npx vercel env pull --environment=production --scope ${scope}`,
      );
    }

    const updated = nowMirrors.map((m, i) =>
      i !== at
        ? m
        : {
            ...m,
            ...(wantPg && pgUrl ? { pg: encryptSecret(pgUrl) } : {}),
            ...(wantMongo && mongoUri ? { mongo: encryptSecret(mongoUri) } : {}),
            lastProbeAt: new Date().toISOString(),
            lastProbeOk: null,
            lastProbeNote:
              `Database vừa dựng lại ${new Date().toISOString().slice(0, 16).replace("T", " ")} — ` +
              `${wantPg ? `PG ✔ ${migrations} migration, ` : ""}RỖNG, chưa đồng bộ dữ liệu.`,
          },
    );
    await neon(activeUrl).query(
      `update app_settings set value = jsonb_set(value, '{mirrors}', $1::jsonb, true), updated_at = now() where id = 'global'`,
      [JSON.stringify(updated)],
    );

    // Đọc lại rồi mới tin: một phép ghi báo thành công mà sổ vẫn mang chuỗi cũ là ca tệ nhất ở đây.
    const sau = await readBook(activeUrl);
    const dongSau = (sau.mirrors ?? []).find((m) => m.id === siteId);
    if (wantPg && pgUrl && (!dongSau?.pg || decryptSecret(dongSau.pg) !== pgUrl)) {
      die("Ghi sổ xong đọc lại VẪN là chuỗi cũ — sổ chưa nhận chuỗi mới, sửa tay trên tab Gương Trạm.");
    }
    console.log(`✔ đã ghi chuỗi kết nối mới vào sổ ở trạm hoạt động「${doc.activeSiteId}」`);
  } finally {
    // Thư mục tạm có `.env.check` chứa BÍ MẬT PRODUCTION — phải cố xoá, và không được để việc dọn
    // rác giết mất phần tổng kết (EPERM trên Windows, xem `deployAllStations.mts`).
    try {
      rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      console.warn(`\n⚠ Không xoá được ${stage} (${err instanceof Error ? err.message : "lỗi lạ"}) — trong đó CÓ BÍ MẬT, xoá tay giúp.`);
    }
  }

  // ---- 12. Còn hai việc ------------------------------------------------------------------------------

  console.log(`\n✔ Trạm「${siteId}」đã có database mới. Project web KHÔNG bị đụng tới.`);
  console.log(`\n── Còn hai việc, và thiếu việc nào thì trạm này vẫn chưa dùng được ──`);
  console.log(`  1. Phát hành lại: bấm đúp deploy-all-stations.bat`);
  console.log(`     (Vercel nướng biến môi trường vào deployment lúc build, nên deployment ĐANG chạy`);
  console.log(`      của trạm này vẫn cầm chuỗi kết nối CŨ — thứ vừa bị xoá.)`);
  console.log(`  2. Đồng bộ dữ liệu: trang Tông Môn → Gương Trạm → Đồng bộ, cho「${siteId}」.`);
  console.log(`     Trước lượt ấy trạm chỉ có bảng rỗng, và một lượt chuyển trạm sang đây là mất sạch.`);

}

try {
  await main();
} catch (err) {
  // `Stop` là lời từ chối đã in ra tử tế rồi — chỉ cần mã thoát. Mọi lỗi khác giữ NGUYÊN stack:
  // nuốt nó thành một dòng đẹp là lấy mất của người sửa thứ duy nhất chỉ đúng dòng hỏng.
  if (!(err instanceof Stop)) throw err;
  process.exitCode = 1;
}
