#!/usr/bin/env node
/**
 * DỰNG MỘT KHÔI LỖI GITHUB VÀ GHI THẲNG NÓ VÀO SỔ — dán đúng một PAT, không gõ gì thêm.
 *
 *   npm run github:new                          (hoặc bấm đúp new-github-khoiloi.bat)
 *   npm run github:new -- --dry-run --owner ai  soi kế hoạch: không đụng GitHub, không ghi sổ
 *
 * KHÁC GÌ `newGithubKhoiloi.mjs`: script ấy dựng KHO, và vẫn là nơi duy nhất làm việc đó — tệp
 * này GỌI nó chứ không chép lại, vì phần dễ sai nhất (danh sách tệp phải chép) đã có
 * `assertImportsResolve` canh ở bên ấy, và một bản sao thứ hai là hẹn ngày hai bản trôi khỏi
 * nhau. Tệp này thêm ba thứ mà bên ấy không làm được vì nó là Node thuần, không chạm database:
 *
 *   1. Suy tài khoản GitHub TỪ CHÍNH PAT (`GET /user`) — người dùng chỉ phải dán một thứ, và
 *      không thể gõ nhầm tên tài khoản thành một cái không khớp với token.
 *   2. Đặt tên: kho ngẫu nhiên, `WORKER_ID` theo khuôn `github-khoiloi-<mốc thời gian>`. Mốc ấy
 *      đi vào CẢ HAI cái tên nên nhìn một cái là biết cái kia.
 *   3. Ghi kho vừa dựng vào sổ Kho GitHub của TRẠM ĐANG HOẠT ĐỘNG — đúng hình dạng mà
 *      `saveGithubStationAction` ghi, rồi ngó một lượt để chứng minh PAT thật sự push được.
 *
 * PAT ĐI BẰNG BIẾN MÔI TRƯỜNG `GITHUB_PAT`, không bao giờ qua đối số: dòng lệnh thì ai mở Task
 * Manager cũng đọc được. Nó không bao giờ được in ra và không ghi xuống đĩa — chỗ duy nhất nó
 * nằm lại là phong bì secretBox trong sổ, và biến môi trường của `gh` trong đúng lượt chạy này.
 *
 * MỌI PHÉP KIỂM ĐỨNG TRƯỚC MỌI PHÉP TẠO. Thứ tự ấy là cả thiết kế: tạo kho xong mới phát hiện sổ
 * đầy, hay mới phát hiện không tra ra trạm hoạt động, là bỏ lại một kho công khai mồ côi trên tài
 * khoản người ta — thứ phải vào GitHub xoá tay.
 *
 * KHÔNG DÙNG `process.exit()` — ĐO ĐƯỢC 12/08/2026: dưới `tsx` trên Windows, gọi `process.exit`
 * sau một lượt `fetch` làm libuv ném `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` và
 * tiến trình trả về mã 127 THAY VÌ 0. Tức một lượt chạy hoàn hảo vẫn khiến tệp .bat in「Ket thuc
 * voi loi」. Nên mọi ngả kết thúc ở đây đều đi qua `process.exitCode` rồi để tiến trình tự tắt.
 *
 * ĐỌC TRƯỚC KHI CHẠY: kho tạo ra là CÔNG KHAI và nhật ký Actions của nó ai cũng đọc được, vĩnh
 * viễn, trong khi việc của khôi lỗi là nhận cookie game đã giải mã. Đánh đổi này đã được cân nhắc
 * và chấp nhận — deploy/github-actions.md §6.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { readControlDoc } from "../src/lib/control/read";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/secretBox";
import {
  DEFAULT_WORKFLOW_FILE,
  GITHUB_STATION_LIMIT,
  reviewStationIdentity,
  stationSlug,
} from "../src/lib/validation/githubStations";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const repoRoot = path.join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : undefined;
};

/**
 * Lời từ chối của script này. Ném chứ không `process.exit` (xem ghi chú đầu tệp), và mang một
 * lớp riêng để lượt bắt ở cuối phân biệt được「ta chủ động dừng」với「một lỗi không ai lường」—
 * cái sau phải giữ nguyên stack cho người sửa, không được nuốt thành một dòng đẹp đẽ.
 */
class Stop extends Error {}

function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  throw new Stop(message);
}

/**
 * Tiền tố tên kho. Nói ra nó là cái gì thay vì cố giấu: một cái tên vô nghĩa không làm kho khó
 * tìm hơn (nhật ký Actions vẫn công khai) mà lại làm chính người vận hành không nhận ra kho của
 * mình giữa danh sách. Hậu tố ngẫu nhiên ở dưới mới là thứ bảo đảm không trùng.
 */
const REPO_PREFIX = "auto-hh3d-linh-su";

/** Việt Nam là UTC+7 quanh năm — cùng hằng số với `vietnamDayKey` bên services/jobs.ts. */
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Mốc thời gian trong tên: `YYYYMMDD-HHmmss` theo giờ Việt Nam.
 *
 * Giây có mặt trong mốc là CÓ CHỦ Ý, không phải cho đẹp: `WORKER_ID` là khoá chính của bảng
 * `workers`, hai tiến trình trùng id thì ghi đè nhau và dashboard nói dối về việc ai đang trực.
 * Phút thôi thì hai lượt chạy liền nhau trong cùng một phút sẽ đụng — mà bấm đúp hai lần là
 * chuyện người ta làm thật. Vẫn còn một phép kiểm nữa ở dưới hỏi thẳng database.
 */
function vietnamStamp(at: Date): string {
  const iso = new Date(at.getTime() + VIETNAM_UTC_OFFSET_MS).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

/**
 * Hỏi GitHub xem PAT này là của ai, và nó mở được những gì.
 *
 * Đây cũng là phép thử token RẺ NHẤT và SỚM NHẤT: sai chìa thì hỏng ngay ở đây, trước khi có bất
 * cứ thứ gì được tạo ra ở bất cứ đâu.
 */
async function whoami(token: string): Promise<{ login: string; scopes: string | null }> {
  let res: Response;
  try {
    res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "auto-hh3d-new-github-station",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    die(`Không gọi được api.github.com (${err instanceof Error ? err.message : "lỗi lạ"}). Mạng có chặn không?`);
  }
  if (res.status === 401) die("PAT sai hoặc đã bị thu hồi — GitHub trả 401. Tạo lại token rồi chạy lại.");
  if (!res.ok) die(`GitHub từ chối lượt hỏi danh tính (HTTP ${res.status}). Kiểm lại PAT.`);

  const body = (await res.json()) as { login?: string };
  if (!body.login) die("GitHub trả lời không có tên tài khoản — không rõ PAT này thuộc về ai, dừng cho chắc.");
  // Token classic khai scope ở header này; token fine-grained thì KHÔNG có nó (quyền của chúng
  // nằm ở dạng khác, không đọc được qua đây). Vắng ≠ thiếu quyền — xem chỗ dùng ở dưới.
  return { login: body.login, scopes: res.headers.get("x-oauth-scopes") };
}

type Mirror = { id: string; pg?: string };

const readMirrors = async (url: string): Promise<Mirror[]> => {
  const rows = (await neon(url)`select value->'mirrors' as mirrors from app_settings where id = 'global'`) as {
    mirrors: Mirror[] | null;
  }[];
  return rows[0]?.mirrors ?? [];
};

/**
 * Tra chuỗi kết nối của trạm đang hoạt động, và CHỊU ĐƯỢC chuyện sổ dưới máy đã cũ.
 *
 * `newMirrorStation.mts` dừng hẳn khi sổ dưới máy thiếu trạm hoạt động. Ở đây đi thêm một bước,
 * vì cảnh ấy là cảnh THƯỜNG chứ không hiếm: `.env.local` trỏ vào `main` — trạm đã nghỉ từ
 * 10/08/2026 — nên sổ của nó đóng băng đúng ngày ấy và không bao giờ biết những trạm sinh sau.
 * Đo 12/08/2026: sổ dưới máy có 2 trạm, sổ ở trạm hoạt động có 4. Sổ đi theo mọi lượt đồng bộ nên
 * trạm nào còn sống cũng biết đường chỉ tiếp — hỏi lần lượt tới khi ra.
 */
async function resolveActivePg(activeSiteId: string): Promise<string> {
  const local = await readMirrors(process.env.DATABASE_URL!);
  const direct = local.find((m) => m.id === activeSiteId);
  if (direct?.pg) return decryptSecret(direct.pg);

  for (const station of local) {
    if (!station.pg) continue;
    try {
      const found = (await readMirrors(decryptSecret(station.pg))).find((m) => m.id === activeSiteId);
      if (found?.pg) {
        console.log(`• Sổ dưới máy đã cũ — lấy đường tới「${activeSiteId}」qua sổ của「${station.id}」.`);
        return decryptSecret(found.pg);
      }
    } catch {
      // Trạm không nối được thì hỏi trạm kế. Một trạm chết không được phép chặn cả lượt chạy.
    }
  }
  die(
    `Không tra ra chuỗi kết nối của trạm đang hoạt động「${activeSiteId}」.\n` +
      "  Vào trang Tông Môn → Gương Trạm trên trạm ấy, bấm「Ghi trạm này vào sổ」rồi chạy lại.",
  );
}

async function main(): Promise<void> {
  // ---- 1. PAT, và tài khoản suy ra từ nó --------------------------------------------------------

  const pat = (process.env.GITHUB_PAT ?? "").trim();

  // Cùng luật với `saveGithubStationAction`: khoảng trắng trong PAT gần như luôn là lỗi chép-dán
  // (nuốt cả dấu xuống dòng), và nó sẽ đi thẳng vào một header HTTP rồi trả về 401 khó hiểu.
  if (pat.length > 0 && /\s/.test(pat)) {
    die("PAT có khoảng trắng — chép lại, đừng kèm dấu xuống dòng hay dấu cách.");
  }
  // Lượt chạy THẬT bắt buộc có PAT: thiếu nó thì `gh` bên trong sẽ hỏng ở tận bước tạo kho, với
  // một câu nói về `gh auth login` — lối mà script này cố ý không dùng.
  if (!dryRun && !pat) {
    die(
      "Chưa có PAT. Bấm đúp new-github-khoiloi.bat để nhập, hoặc đặt biến GITHUB_PAT rồi chạy lại.\n" +
        "  (Chỉ lượt chạy khô mới được phép thiếu, và khi ấy phải truyền --owner <tên tài khoản>.)",
    );
  }

  // Hỏi danh tính ĐÚNG MỘT LẦN rồi dùng cho cả tên tài khoản lẫn phép soát scope.
  const identity = pat ? await whoami(pat) : null;
  const owner = arg("owner") ?? identity?.login ?? "";
  if (!owner) die("Lượt chạy khô không có PAT thì phải truyền --owner <tên tài khoản GitHub>.");

  if (identity) {
    const { scopes } = identity;
    if (scopes !== null && scopes.trim().length > 0) {
      const granted = new Set(scopes.split(",").map((s) => s.trim()));
      const missing = ["repo", "workflow"].filter((need) => !granted.has(need));
      if (missing.length > 0) {
        die(
          `PAT thiếu scope: ${missing.join(", ")}.\n` +
            `  Token classic cần CẢ HAI: repo (đẩy mã, ghi mốc nuôi kho) và workflow (đẩy chính tệp\n` +
            `  .github/workflows/, và bật lại lịch khi GitHub tắt vì im lặng).\n` +
            `  Sửa ở https://github.com/settings/tokens rồi chạy lại.`,
        );
      }
    } else if (scopes !== null) {
      // Header có mặt nhưng rỗng = token classic không có scope nào. Đó là hỏng chắc chắn.
      die("PAT không có scope nào cả — nó không tạo nổi kho. Cấp repo + workflow rồi chạy lại.");
    } else {
      console.log(
        "• PAT dạng fine-grained (không khai scope qua header) — không kiểm hộ được quyền.\n" +
          "  Kho ấy cần Contents: read/write VÀ Actions: read/write, nếu thiếu thì hỏng ở bước cuối.",
      );
    }
  }

  // ---- 2. Những thứ phải có sẵn dưới máy --------------------------------------------------------

  if (!process.env.WORKER_TOKEN) {
    die(
      "Thiếu WORKER_TOKEN trong .env — khôi lỗi mới sẽ không xác thực nổi với /api/worker.\n" +
        "  Lấy về: vercel env pull .env --environment=production --yes\n" +
        "  KHÔNG dùng npm run env:pull — lệnh ấy kéo môi trường development, nơi biến này không tồn tại.",
    );
  }
  if (!process.env.ENCRYPTION_KEY) {
    die("Thiếu ENCRYPTION_KEY trong .env.local — không mã hoá nổi PAT thì không được phép ghi nó vào sổ.");
  }
  if (!process.env.DATABASE_URL) {
    die("Thiếu DATABASE_URL trong .env.local — không có đường nào tới sổ.");
  }

  // ---- 3. Tên kho và tên khôi lỗi ---------------------------------------------------------------

  const stamp = vietnamStamp(new Date());
  const workerId = `github-khoiloi-${stamp}`;
  // Bốn ký tự ngẫu nhiên: hai lượt chạy trong cùng một giây vẫn ra hai kho khác tên, và tên kho
  // không đoán trước được từ bên ngoài.
  const repo = arg("repo") ?? `${REPO_PREFIX}-${stamp}-${randomBytes(2).toString("hex")}`;
  const workflowFile = DEFAULT_WORKFLOW_FILE;
  const slug = `${owner}/${repo}`;

  // Cùng bộ luật mà form admin dùng — không có luật thứ hai sống song song.
  const complaint = reviewStationIdentity(owner, repo, workflowFile);
  if (complaint) die(`${complaint}\n  (Tài khoản「${owner}」, kho「${repo}」)`);

  // ---- 4. Sổ có thẩm quyền nằm ở TRẠM ĐANG HOẠT ĐỘNG --------------------------------------------

  const doc = await readControlDoc();
  if (!doc) {
    // `readControlDoc` KHÔNG BAO GIỜ ném: thiếu env, mạng hỏng, chữ ký sai — tất cả cùng về null.
    // Nên câu này phải kể ra các ngả ấy, bằng không người đọc chỉ thấy "không đọc được".
    die(
      "Không đọc được bảng điều phối — chưa biết trạm nào đang hoạt động thì không dám ghi sổ.\n" +
        "  Ba ngả cùng ra kết quả này: thiếu OCI_REGION/OCI_NAMESPACE/OCI_BUCKET hoặc WORKER_TOKEN\n" +
        "  trong .env.local, bucket không với tới được, hoặc chữ ký bảng không khớp WORKER_TOKEN.\n" +
        "  Soi bằng: npm run mirror:control status",
    );
  }

  const activePg = await resolveActivePg(doc.activeSiteId);
  // Từ dòng này trở đi MỌI thứ đọc/ghi qua `db()` đều rơi vào trạm đang hoạt động. Nhập MUỘN, sau
  // khi biến đã đổi: `db()` đọc `DATABASE_URL` lười rồi NHỚ MÃI (xem db/client.ts), nên thứ tự này
  // là thứ giữ cho sổ không bị ghi nhầm vào trạm đã nghỉ — loại hỏng không để lại dấu vết nào.
  process.env.DATABASE_URL = activePg;
  const { getAppSettings, saveAppSettings } = await import("../src/lib/services/settings");
  const { pingStationBySlug } = await import("../src/lib/services/githubStations");

  const settings = await getAppSettings();
  if (settings.githubStations.some((s) => stationSlug(s) === slug)) {
    die(`Sổ đã có kho「${slug}」— trùng tên gần như không thể, kiểm xem có phải vừa chạy hai lượt.`);
  }
  if (settings.githubStations.length >= GITHUB_STATION_LIMIT) {
    die(
      `Sổ đầy (${GITHUB_STATION_LIMIT} kho) — dọn kho chết trên tab Kho GitHub trước.\n` +
        "  Kiểm TRƯỚC khi tạo để không bỏ lại một kho công khai mồ côi trên GitHub.",
    );
  }

  /**
   * Id khôi lỗi này đã có ai mang chưa — hỏi thẳng bảng `workers`, đừng chỉ tin vào cái mốc giây.
   *
   * Trùng id không làm chạy đôi một đàn (câu claim nguyên tử lo việc ấy), nhưng nó phá phần QUAN
   * SÁT: hai tiến trình gộp làm một dòng, số bản nhảy qua lại, và `automation_jobs.worker_id`
   * thôi chỉ ra được máy nào đang giữ đàn — đúng phép soát người ta dựa vào để chọn lúc restart.
   */
  const clash = (await neon(activePg)`select 1 from workers where id = ${workerId} limit 1`) as unknown[];
  if (clash.length > 0) {
    die(`Đã có khôi lỗi mang id「${workerId}」trong sổ điểm danh. Đợi một giây rồi chạy lại.`);
  }

  // ---- 5. Kế hoạch ------------------------------------------------------------------------------

  console.log(
    `\n── Sẽ dựng ──────────────────────────────────────────\n` +
      `  kho        ${slug} (CÔNG KHAI)\n` +
      `  worker id  ${workerId}\n` +
      `  workflow   ${workflowFile}\n` +
      `  ghi vào sổ ở trạm「${doc.activeSiteId}」(đang có ${settings.githubStations.length}/${GITHUB_STATION_LIMIT} kho)\n`,
  );

  const inner = ["scripts/newGithubKhoiloi.mjs", "--owner", owner, "--repo", repo, "--worker-id", workerId];
  // Địa chỉ web nướng vào workflow: lấy của trạm ĐANG HOẠT ĐỘNG cho lượt nối đầu đi thẳng. Trạm có
  // đổi về sau cũng không sao — khôi lỗi đi theo 409 như VM vẫn làm (src/lib/worker/controlFollow.mjs).
  if (doc.activeUrl) inner.push("--web-url", doc.activeUrl);

  /** Gọi script dựng kho. Nó in thẳng ra màn hình; ta chỉ quan tâm nó sống hay chết. */
  const buildRepo = (extra: string[] = []): void => {
    const res = spawnSync(process.execPath, [...inner, ...extra], {
      cwd: repoRoot,
      stdio: "inherit",
      // PAT chỉ sống trong biến môi trường của tiến trình con: `gh` đọc GH_TOKEN nên không cần
      // `gh auth login`, và giá trị không bao giờ nằm trên dòng lệnh.
      env: { ...process.env, GH_TOKEN: pat },
    });
    if (res.error) die(`Không chạy được scripts/newGithubKhoiloi.mjs: ${res.error.message}`);
    if (res.status !== 0) {
      die(
        `Bước dựng kho hỏng (mã ${res.status}) — KHÔNG ghi gì vào sổ.\n` +
          `  Đọc dòng lỗi ngay trên. Kho có thể đã tạo dở, soi ở https://github.com/${owner}?tab=repositories\n` +
          `  — nếu「${repo}」đã có mặt thì xoá nó đi rồi chạy lại, đừng để một kho không secret nằm đó.`,
      );
    }
  };

  if (dryRun) {
    buildRepo(["--dry-run"]);
    console.log(
      `\n--dry-run: đã soi trọn kế hoạch và dựng thử cây tệp. KHÔNG tạo kho, KHÔNG ghi sổ.\n` +
        `  Bỏ --dry-run để làm thật.`,
    );
    return;
  }

  // ---- 6. Làm thật ------------------------------------------------------------------------------

  // `gh` là bắt buộc cho lượt đặt secret (sealed-box X25519+XSalsa20, thứ Node không có sẵn — xem
  // đầu newGithubKhoiloi.mjs). Kiểm ở đây để câu chỉ dẫn nói đúng lối cài của Windows.
  // KHÔNG shell — phép kiểm phải đi ĐÚNG con đường mà lượt gọi thật sẽ đi (xem `run` trong
  // newGithubKhoiloi.mjs, nơi shell đã bị gỡ ngày 13/08/2026). Kiểm qua shell rồi gọi thật không
  // shell là dựng một phép kiểm xanh đứng trước một lượt chạy ENOENT.
  const ghCheck = spawnSync("gh", ["--version"], { stdio: "ignore" });
  if (ghCheck.error || ghCheck.status !== 0) {
    die(
      "Chưa có `gh` (GitHub CLI) — nó là thứ đặt được secret WORKER_TOKEN cho kho mới.\n" +
        "  Cài: winget install --id GitHub.cli    (hoặc https://cli.github.com)\n" +
        "  KHÔNG cần `gh auth login`: script này đưa PAT qua biến GH_TOKEN.",
    );
  }

  buildRepo();

  // ---- 7. Ghi vào sổ ----------------------------------------------------------------------------

  console.log("── Ghi kho vào sổ của trạm đang hoạt động…");

  /**
   * ĐỌC LẠI sổ ngay trước khi ghi, không dùng bản đã đọc ở bước kiểm.
   *
   * Giữa hai mốc ấy là cả lượt dựng kho — vài chục giây có `gh` chạy ở giữa. `saveAppSettings` ghi
   * TRỌN document cấu hình, nên ghi bằng bản chụp cũ sẽ lặng lẽ lộn ngược mọi thứ trưởng môn vừa
   * sửa trong quãng ấy: một lời nhắn bảo trì, một hạn lưu nhật ký, một thông báo. Đọc lại thì cửa
   * sổ ấy co về vài mili giây, đúng bằng cửa sổ mà form admin vẫn có.
   */
  const fresh = await getAppSettings();
  if (fresh.githubStations.some((s) => stationSlug(s) === slug)) {
    die(`Sổ vừa có thêm kho「${slug}」trong lúc dựng — có phiên khác đang làm cùng việc. Không ghi đè.`);
  }
  if (fresh.githubStations.length >= GITHUB_STATION_LIMIT) {
    die(
      `Sổ vừa đầy (${GITHUB_STATION_LIMIT} kho) trong lúc dựng — kho「${slug}」ĐÃ TẠO trên GitHub nhưng\n` +
        "  không vào được sổ. Dọn một dòng ở tab Kho GitHub rồi ghi tay kho này vào.",
    );
  }

  /**
   * Hình dạng dòng sổ chép ĐÚNG bản mà `saveGithubStationAction` ghi — kể cả bốn trường dấu vết để
   * trống. Lệch một trường thì `appSettingsSchema` sẽ lặng lẽ điền mặc định và dòng do script sinh
   * ra sẽ khác dòng do người bấm nút sinh ra, ở đúng chỗ không ai soi.
   */
  fresh.githubStations = [
    ...fresh.githubStations,
    {
      owner,
      repo,
      workflowFile,
      workerId,
      pat: encryptSecret(pat),
      enabled: true,
      lastPingAt: null,
      lastCommitAt: null,
      lastPingOk: null,
      lastPingNote: "",
      workflowState: "",
    },
  ];

  try {
    await saveAppSettings(fresh);
  } catch (err) {
    die(
      `Kho ĐÃ TẠO XONG trên GitHub nhưng ghi sổ hỏng: ${err instanceof Error ? err.message : "lỗi lạ"}\n` +
        `  Khôi lỗi vẫn sẽ lên ca bình thường, chỉ là chưa ai nuôi kho. Ghi tay ở trang Tông Môn →\n` +
        `  tab Kho GitHub với đúng bốn giá trị: ${owner} / ${repo} / ${workflowFile} / ${workerId}`,
    );
  }

  /**
   * Ngó ngay sau khi ghi, `force: false` — đúng đường của form admin.
   *
   * Kho mới chưa có `lastCommitAt` nên đằng nào cũng tới hạn: lượt này ghi một commit thật, tức
   * chứng minh trọn đường「PAT push được mã vào kho này」ngay bây giờ, trước mặt người vừa dán PAT,
   * chứ không phải trong một lượt cron lúc ba giờ sáng.
   */
  const ping = await pingStationBySlug(slug, false);

  console.log(
    `\n✔ Kho đã dựng và đã vào sổ.\n` +
      `  kho       https://github.com/${slug}\n` +
      `  actions   https://github.com/${slug}/actions\n` +
      `  sổ        ${ping.ok ? "✔" : "✖"} ${ping.note}\n` +
      `\n  Nghiệm thu: mở Hàng Đợi → tab Khôi Lỗi, phải thấy「${workerId}」điểm danh trong ~4 phút.\n`,
  );

  /**
   * Ngó hỏng thì mã thoát KHÁC 0 — kho đã nằm trong sổ nhưng chưa có bằng chứng nào rằng PAT ấy
   * nuôi được nó, và một lượt chạy như thế không đáng gọi là thành công.
   *
   * Nhưng phải nói rõ「đừng chạy lại」: mọi việc nặng đã xong, chạy lại chỉ đẻ thêm một kho công
   * khai nữa và một khôi lỗi trùng vai. Cái cần sửa là PAT, và chỗ sửa là tab Kho GitHub.
   */
  if (!ping.ok) {
    console.error(
      `✖ Lượt ngó đầu tiên KHÔNG thành. ĐỪNG chạy lại tệp này — kho và dòng sổ đã có rồi.\n` +
        `  Vào Tông Môn → Kho GitHub, bấm Sửa ở dòng「${slug}」, dán lại PAT (cần repo + workflow),\n` +
        `  rồi bấm「Nuôi ngay」. Câu chữ của lượt hỏng nằm ngay trên.\n`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  // `Stop` là lời từ chối đã in ra tử tế rồi — chỉ cần mã thoát. Mọi lỗi khác giữ NGUYÊN stack:
  // nuốt nó thành một dòng đẹp là lấy mất của người sửa thứ duy nhất chỉ đúng dòng hỏng.
  if (!(err instanceof Stop)) throw err;
  process.exitCode = 1;
}
