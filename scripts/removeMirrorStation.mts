#!/usr/bin/env node
/**
 * XOÁ MỘT TRẠM GƯƠNG — sổ, project Vercel, và MỌI kho của nó. Nửa đối xứng của `mirror:new`.
 *
 *   npm run mirror:remove -- --site auto-hh3d-1
 *   npm run mirror:remove -- --site main --project auto-hh3d
 *   npm run mirror:remove -- --site auto-hh3d-1 --dry-run   (chỉ in kế hoạch, không xoá gì)
 *   npm run mirror:remove -- --site auto-hh3d-1 --yes       (bỏ câu xác nhận gõ tay)
 *
 * Hoặc bấm đúp `remove-mirror-station.bat`.
 *
 * VÌ SAO CẦN, và vì sao nó phải là MỘT CÔNG CỤ chứ không phải mấy dòng curl chép trong README:
 * ngày 12/08/2026 phải xoá hai trạm để gột sạch mấy biến env dạng sensitive, và việc ấy làm tay
 * mất bốn lượt lệnh cho mỗi trạm — gỡ sổ, xoá hai kho, xoá project — mỗi lượt một token khác
 * nhau, một scope khác nhau. Sai một lượt là xoá nhầm tài khoản.
 *
 * ── BỐN LUẬT AN TOÀN, mỗi luật chặn một kiểu mất dữ liệu ────────────────────────────────────
 *
 * 1. **KHÔNG BAO GIỜ xoá trạm ĐANG PHỤC VỤ.** Hỏi bảng điều phối trước mọi thứ khác. Xoá trạm
 *    đang phục vụ là tắt cả tông môn, và không có nút hoàn tác nào.
 *
 * 2. **Nhận kho bằng PROJECT ĐANG NỐI, không bằng tên.** Từ 12/08/2026 tên kho là chuỗi ngẫu
 *    nhiên không mang chữ nào của tông môn, nên tên không còn nói được kho ấy của ai. Luật chia
 *    nhóm nằm ở `storesOfProject` — hàm thuần, `verify:deploy-targets` bao từng nhánh.
 *
 * 3. **Kho dùng chung với project khác thì KHÔNG đụng vào**, chỉ báo tên. Kho mồ côi (không nối
 *    project nào) cũng vậy: nó có thể là rác của một lượt dựng chết giữa chừng, nhưng không quy
 *    được cho ai, mà xoá hộ một thứ không quy được chủ là đúng cái kiểu「dọn dẹp」đã xoá nhầm dữ
 *    liệu ở khắp nơi.
 *
 * 4. **Xoá kho hỏng thì DỪNG, không xoá project.** Project là sợi dây duy nhất nhận ra kho
 *    (luật 2) — cắt dây trước khi dọn xong là biến một lượt xoá dở thành một kho mồ côi vĩnh
 *    viễn, tính tiền hằng tháng mà không ai biết nó của cái gì.
 *
 * Dòng sổ được LƯU RA TỆP trước khi gỡ. Trong đó có hai phong bì `pg`/`mongo` đã mã hoá — bản
 * duy nhất còn lại của chuỗi kết nối trạm ấy, và là đường ghi trả lại vào sổ nếu đổi ý giữa chừng.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import {
  discoverTokens,
  projectNameFromUrl,
  storesOfProject,
  validateSiteId,
  type Book,
  type StoreRef,
} from "./deployTargets.mts";
import { buildCatalog } from "./vercelCatalog.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
process.noDeprecation = true;

const QUICK_MS = 60_000;
const API_MS = 30_000;
/** Xoá một kho phải gỡ nối rồi gọi sang nhà cung cấp — chậm hơn hẳn một lượt gọi API thường. */
const REMOVE_STORE_MS = 5 * 60_000;

/**
 * DỪNG CÓ LỜI — ném chứ KHÔNG `process.exit()`, và đây là kết luận của một phép đo.
 *
 * Đọc bảng điều phối để lại một socket của SDK OCI đang đóng dở. Gọi `process.exit()` đúng lúc
 * ấy thì libuv trên Windows nổ「Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)」và mã
 * thoát thành 127. Đo ngày 12/08/2026, hai cách cạnh nhau trên cùng một tiến trình:
 *
 *     process.exit(1) ngay sau readControlDoc   → Assertion failed, mã thoát 127
 *     đặt exitCode rồi để vòng lặp cạn          → sạch, mã thoát 1, xong sau 2 giây
 *
 * Với một công cụ XOÁ thì dòng「Assertion failed」in ra ngay sau「đã gỡ khỏi sổ」là đủ để người
 * vận hành tưởng mình vừa làm hỏng cái gì giữa chừng. Nên: ném một lỗi riêng, để bộ bắt bên dưới
 * đặt mã thoát, rồi tiến trình tự kết thúc.
 *
 * Chú kiểu nằm trên BIẾN để TypeScript thu hẹp kiểu ở mọi chỗ gọi — xem bình chú cùng tên ở
 * `mirror:new`.
 */
class DungLai extends Error {}

const die: (message: string) => never = (message) => {
  throw new DungLai(message);
};

// Module này chạy bằng top-level await, nên một lần ném sẽ nổi lên thành `uncaughtException`
// hoặc `unhandledRejection` tuỳ chỗ ném — bắt cả hai, và cả hai chỉ ĐẶT mã thoát chứ không gọi
// `process.exit()`, để vòng lặp cạn tự nhiên (xem bình chú của `die`).
const ketThuc = (err: unknown): void => {
  if (err instanceof DungLai) console.error(`\n✗ ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
};
process.on("uncaughtException", ketThuc);
process.on("unhandledRejection", ketThuc);

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const skipConfirm = process.argv.includes("--yes");

// ---- 1. Đối số ------------------------------------------------------------------------------

const parsed = validateSiteId(arg("site") ?? "");
if (!parsed.ok) die(`${parsed.message}\n  Ví dụ: npm run mirror:remove -- --site auto-hh3d-1`);
const siteId = parsed.siteId;

if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");
if (!process.env.ENCRYPTION_KEY) die("Thiếu ENCRYPTION_KEY — không giải nổi chuỗi kết nối để tới sổ thật.");

const tokens = discoverTokens(process.env);
if (tokens.length === 0) die("Không thấy token Vercel nào trong env (VERCEL_TOKEN, VERCEL_TOKEN_<TÊN>).");

// ---- 2. Sổ có thẩm quyền, và LUẬT SỐ MỘT -----------------------------------------------------

const readBook = async (url: string): Promise<Book> => {
  const rows = (await neon(url)`select value from app_settings where id = 'global'`) as { value: unknown }[];
  return (rows[0]?.value ?? {}) as Book;
};

const doc = await readControlDoc();
if (!doc) die("Không đọc được bảng điều phối — chưa biết trạm nào đang phục vụ thì KHÔNG dám xoá gì.");

if (doc.activeSiteId === siteId) {
  die(
    `Trạm「${siteId}」ĐANG PHỤC VỤ tông môn — không xoá.\n` +
      "  Chuyển trạm sang chỗ khác trước (trang Tông Môn → Gương Trạm → Chuyển trạm), rồi chạy lại.",
  );
}

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
const mirrors = book.mirrors ?? [];
const entry = mirrors.find((m) => m.id === siteId);
console.log(`• Bảng điều phối: trạm đang phục vụ là「${doc.activeSiteId}」`);
console.log(`• Sổ có thẩm quyền: ${mirrors.length} trạm — trạm「${siteId}」${entry ? "CÓ trong sổ" : "không có trong sổ"}`);

// ---- 3. Project nào, tài khoản nào -----------------------------------------------------------
//
// Địa chỉ trong sổ là nguồn có thẩm quyền cho tên project (`https://<project>.vercel.app`), đúng
// phép suy mà `deployAllStations` dùng. Trạm đã gỡ khỏi sổ rồi thì phải khai `--project`, vì mã
// trạm KHÔNG luôn trùng tên project — trạm gốc mang mã `main` mà sống ở project `auto-hh3d`.
let projectName = arg("project")?.trim() || "";
if (entry?.url) {
  const named = projectNameFromUrl(entry.url);
  if (!named.ok) die(`Địa chỉ trong sổ của「${siteId}」không suy ra được tên project: ${named.message}`);
  if (projectName && projectName !== named.name) {
    die(`--project「${projectName}」lệch với địa chỉ trong sổ (project「${named.name}」). Bỏ cờ ấy đi, hoặc sửa sổ.`);
  }
  projectName = named.name;
}
if (!projectName) projectName = siteId;

const catalog = await buildCatalog(tokens);
const found = catalog.filter((p) => p.name === projectName);
if (found.length > 1) {
  die(
    `Project「${projectName}」thấy được bằng NHIỀU token (${found.map((f) => f.envName).join(", ")}) — ` +
      "không đoán tài khoản nào để xoá. Gỡ token thừa khỏi .env.local rồi chạy lại.",
  );
}
const target = found[0];
if (!target && !entry) {
  die(`Không thấy project「${projectName}」ở tài khoản nào, mà sổ cũng không có trạm「${siteId}」— không còn gì để xoá.`);
}

const token = target ? (tokens.find((t) => t.envName === target.envName)?.token ?? "") : "";

// ---- 4. Kho nào của trạm này -----------------------------------------------------------------

const api = async (p: string) => {
  const res = await fetch(`https://api.vercel.com${p}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(API_MS),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

let scope = "";
let cuaRieng: StoreRef[] = [];
let dungChung: StoreRef[] = [];
let moCoi: StoreRef[] = [];

if (target) {
  const teams = await api("/v2/teams");
  const team = ((teams.body?.teams ?? []) as { id: string; slug: string }[]).find((t) => t.id === target.orgId);
  if (!team) die(`Token ${target.envName} không thấy team của project「${projectName}」— không xoá được kho đúng scope.`);
  scope = team.slug;

  const stores = await api(`/v1/storage/stores?teamId=${team.id}`);
  if (!stores.ok) die(`Không liệt kê được kho của team ${scope} (HTTP ${stores.status}).`);
  ({ cuaRieng, dungChung, moCoi } = storesOfProject((stores.body?.stores ?? []) as StoreRef[], projectName));
}

// ---- 5. Kế hoạch ------------------------------------------------------------------------------

const ten = (s: StoreRef) => `${s.name ?? "(không tên)"}${s.id ? ` · ${s.id}` : ""}`;

console.log(`\n── Sẽ XOÁ ────────────────────────────────────────────`);
console.log(`  mã trạm   : ${siteId}`);
console.log(`  dòng sổ   : ${entry ? `có —「${entry.name ?? siteId}」${entry.url ?? ""}` : "không có (đã gỡ trước đó)"}`);
console.log(`  project   : ${target ? `${projectName} trên team ${scope} (qua ${target.envName})` : "không tồn tại"}`);
console.log(`  kho       : ${cuaRieng.length === 0 ? "(không có kho nào của riêng trạm này)" : ""}`);
for (const s of cuaRieng) console.log(`              ${ten(s)}`);

if (dungChung.length > 0) {
  console.log(`\n  ⚠ GIỮ LẠI ${dungChung.length} kho vì còn project khác đang dùng chung:`);
  for (const s of dungChung) console.log(`      ${ten(s)} ← ${(s.projectsMetadata ?? []).map((p) => p.name).join(", ")}`);
  console.log("    Muốn xoá thật thì gỡ nối project kia trước, rồi chạy lại.");
}
if (moCoi.length > 0) {
  console.log(`\n  ⚠ ${moCoi.length} kho MỒ CÔI trên tài khoản này (không nối project nào) — KHÔNG đụng tới:`);
  for (const s of moCoi) console.log(`      ${ten(s)}`);
  console.log("    Thường là rác của một lượt dựng chết giữa chừng. Soi rồi xoá tay nếu chắc chắn.");
}

if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, chưa xoá gì cả.");
  process.exit(0);
}

// ---- 6. Xác nhận ------------------------------------------------------------------------------
//
// Gõ lại đúng mã trạm, không phải「y/n」: một cú Enter theo quán tính không được phép xoá một
// database. Ai chạy trong máy móc thì dùng --yes.
if (!skipConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const traLoi = (await rl.question(`\nGõ lại mã trạm「${siteId}」để xác nhận XOÁ (Enter trống là huỷ): `)).trim();
  rl.close();
  if (traLoi !== siteId) die("Không khớp — huỷ, chưa xoá gì cả.");
}

// ---- 7. Xoá, đúng thứ tự ----------------------------------------------------------------------

if (entry) {
  const backup = path.join(tmpdir(), `dong-so-${siteId}-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(entry, null, 2));
  console.log(`\n✔ đã lưu dòng sổ ra ${backup}`);

  const conLai = mirrors.filter((m) => m.id !== siteId);
  await neon(activeUrl).query(
    `update app_settings set value = jsonb_set(value, '{mirrors}', $1::jsonb, true), updated_at = now() where id = 'global'`,
    [JSON.stringify(conLai)],
  );
  const sau = await readBook(activeUrl);
  if ((sau.mirrors ?? []).some((m) => m.id === siteId)) die("Gỡ khỏi sổ xong đọc lại VẪN còn — dừng, chưa xoá gì thêm.");
  console.log(`✔ đã gỡ khỏi sổ — còn ${(sau.mirrors ?? []).length} trạm`);
}

for (const store of cuaRieng) {
  console.log(`\n── xoá kho ${ten(store)} ──`);
  const res = spawnSync(
    "vercel",
    ["integration", "resource", "remove", store.name ?? "", "--disconnect-all", "--yes", "--scope", scope],
    { timeout: REMOVE_STORE_MS, env: { ...process.env, VERCEL_TOKEN: token }, shell: true, stdio: "inherit" },
  );
  // LUẬT 4: dừng trước khi xoá project. Project là sợi dây duy nhất nhận ra kho — cắt nó khi
  // còn kho chưa dọn là để lại một kho mồ côi vĩnh viễn, tính tiền mà không ai biết của cái gì.
  if (res.status !== 0) {
    die(
      `Xoá kho「${store.name}」hỏng (mã ${res.status ?? "bị giết"}). DỪNG — project「${projectName}」giữ nguyên,\n` +
        "  vì nó là sợi dây duy nhất còn nhận ra mấy kho chưa dọn. Chữa xong chạy lại lệnh này.",
    );
  }
}

if (target) {
  const res = await fetch(`https://api.vercel.com/v9/projects/${projectName}?teamId=${target.orgId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(QUICK_MS),
  });
  if (!res.ok && res.status !== 404) die(`Xoá project「${projectName}」hỏng — HTTP ${res.status}.`);
  const lai = await api(`/v9/projects/${projectName}?teamId=${target.orgId}`);
  if (lai.status !== 404) die(`Xoá xong nhưng project「${projectName}」vẫn còn (HTTP ${lai.status}) — soi lại trên dashboard.`);
  console.log(`\n✔ đã xoá project ${projectName}`);
}

console.log(`\n✔ Trạm「${siteId}」đã xoá sạch: sổ, project, và ${cuaRieng.length} kho.`);
if (dungChung.length > 0 || moCoi.length > 0) {
  console.log(`  (còn ${dungChung.length} kho dùng chung và ${moCoi.length} kho mồ côi — cố ý giữ, xem ở trên)`);
}
console.log(`\n  Dựng lại: npm run mirror:new -- --site ${siteId}${projectName !== siteId ? ` --project ${projectName}` : ""}`);
