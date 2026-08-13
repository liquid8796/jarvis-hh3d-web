#!/usr/bin/env node
/**
 * XOÁ SẠCH MỘT KHO KHÔI LỖI GITHUB — kho trên GitHub, dòng sổ, và dòng điểm danh. Nửa đối xứng
 * của `github:new`, và nó nhận việc bằng đúng một thứ y như bên ấy: MỘT PAT.
 *
 *   npm run github:remove                        (hoặc bấm đúp remove-github-khoiloi.bat)
 *   npm run github:remove -- --dry-run           soi kế hoạch: không xoá gì, không ghi gì
 *   npm run github:remove -- --repo <tên kho>    chọn khi tài khoản có nhiều kho khôi lỗi
 *   npm run github:remove -- --yes               bỏ câu xác nhận gõ tay
 *   npm run github:remove -- --force             xoá kể cả khi khôi lỗi ấy đang giữ đàn
 *
 * VÌ SAO CẦN, và vì sao nó phải là một CÔNG CỤ chứ không phải một cú bấm「Delete repository」:
 * một kho khôi lỗi để lại dấu chân ở BA nơi, và hai nơi trong đó không nằm trên GitHub.
 *
 *   1. Kho trên GitHub — thứ duy nhất người ta nhớ.
 *   2. Dòng trong sổ Kho GitHub của TRẠM ĐANG HOẠT ĐỘNG. Bỏ lại thì vòng nuôi kho gõ vào một kho
 *      đã chết mỗi ngày và tab Kho GitHub đỏ mãi mãi; tệ hơn, sổ chỉ chứa được
 *      `GITHUB_STATION_LIMIT` dòng nên mỗi dòng ma là một chỗ ngồi bị chiếm.
 *   3. Dòng trong bảng `workers`. Bỏ lại thì `github:new` TỪ CHỐI dựng lại một khôi lỗi mang
 *      đúng id ấy — phép kiểm trùng id bên ấy hỏi thẳng bảng này, và một cái xác thì trả lời y
 *      như một người đang trực.
 *
 * ── BA LUẬT AN TOÀN ──────────────────────────────────────────────────────────────────────────
 *
 * 1. **NHẬN KHO BẰNG BẰNG CHỨNG, KHÔNG BẰNG TÊN.** Tên là thứ ai cũng đặt được; một kho tên
 *    `auto-hh3d-linh-su-cua-toi` do người khác dựng vẫn là kho của người khác. Ba loại bằng chứng
 *    và phép xét nằm ở `githubKhoiloi.mts`, thuần, `verify:github-removal` bao từng nhánh. Cùng
 *    lẽ với LUẬT 2 của `mirror:remove` («nhận kho bằng project đang nối, không bằng tên»).
 *
 * 2. **KHÔNG XOÁ KHI KHÔI LỖI ẤY ĐANG GIỮ ĐÀN.** Xoá kho là giết runner tức khắc; ba phút sau
 *    `reapStaleJobs` kết liễu đàn ấy thành `failed`. Người mất một vòng cày là một đạo hữu nào
 *    đó, không phải người đang gõ lệnh — nên cái giá được NÓI RA trước chứ không để họ phát hiện.
 *
 * 3. **XOÁ KHO TRƯỚC, DỌN SỔ SAU.** Ngược lại là ca hỏng tệ nhất: gỡ sổ xong mà lượt xoá kho hụt
 *    thì kho vẫn chạy, vẫn giành đàn, vẫn cầm `WORKER_TOKEN` — mà KHÔNG còn dòng nào ở đâu biết
 *    nó tồn tại. Một dòng sổ trỏ vào kho đã chết thì chỉ ồn (tab admin đỏ, chữa bằng một cú bấm);
 *    một kho chạy mà không ai biết thì không có đường tìm ra. Cùng hình dạng với LUẬT 4 của
 *    `mirror:remove`.
 *
 * PAT ĐI BẰNG BIẾN MÔI TRƯỜNG `GITHUB_PAT`, không bao giờ qua đối số: dòng lệnh thì ai mở Task
 * Manager cũng đọc được. Nó không được in ra và không ghi xuống đĩa.
 *
 * PAT PHẢI CÓ `delete_repo`, VÀ ĐÓ LÀ SCOPE MÀ `github:new` KHÔNG ĐÒI. Token đã dựng kho gần như
 * chắc chắn KHÔNG xoá được nó — nên phép soát scope đứng ngay đầu, trước cả lượt đọc sổ, để một
 * lượt chạy thiếu quyền hỏng trong hai giây thay vì hỏng sau khi đã in cả kế hoạch.
 *
 * KHÔNG DÙNG `process.exit()` — dưới `tsx` trên Windows, gọi nó sau một lượt `fetch` làm libuv
 * ném `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` và mã thoát thành 127. Với một
 * công cụ XOÁ thì dòng ấy in ra ngay sau「đã gỡ khỏi sổ」là đủ để người vận hành tưởng mình vừa
 * làm hỏng cái gì giữa chừng. Mọi ngả kết thúc đi qua `process.exitCode`.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { neon } from "@neondatabase/serverless";
import { readControlDoc } from "../src/lib/control/read";
import { DEFAULT_WORKFLOW_FILE, stationSlug } from "../src/lib/validation/githubStations";
import { resolveActiveStationPg } from "./activeStationPg.mts";
import {
  chooseTarget,
  describeCandidate,
  describeEvidence,
  looksLikeKhoiloiRepoName,
  reviewRemoval,
  workerIdFromWorkflow,
  type Candidate,
} from "./githubKhoiloi.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const API_ROOT = "https://api.github.com";
/** Ghim tường minh — cùng lẽ với `services/githubStations.ts`: một API trôi bản là hỏng lặng lẽ. */
const API_VERSION = "2022-11-28";
/** GitHub TỪ CHỐI request không có User-Agent — 403 kèm một câu khó đoán nếu quên. */
const USER_AGENT = "auto-hh3d-remove-github-khoiloi";
const REQUEST_TIMEOUT_MS = 20_000;
/** Trần số trang khi liệt kê kho. 5 × 100 kho là quá dư cho một tài khoản chỉ để chạy khôi lỗi. */
const MAX_REPO_PAGES = 5;

/**
 * Lời từ chối của script này — ném chứ không `process.exit` (xem ghi chú đầu tệp), và mang một
 * lớp riêng để lượt bắt ở cuối phân biệt「ta chủ động dừng」với「một lỗi không ai lường」. Cái sau
 * phải giữ nguyên stack cho người sửa, không được nuốt thành một dòng đẹp đẽ.
 */
class Stop extends Error {}

function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  throw new Stop(message);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const skipConfirm = argv.includes("--yes");
const force = argv.includes("--force");
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : undefined;
};

type Reply = { status: number; body: unknown };

async function callGithub(pat: string, method: "GET" | "DELETE", apiPath: string): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": USER_AGENT,
      },
      // Công cụ xoá phải thấy sự thật LÚC NÀY: một bản nhớ nói kho còn sống sau khi nó đã bị xoá
      // sẽ biến phép nghiệm thu ở cuối thành một lời báo động giả.
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `quá ${REQUEST_TIMEOUT_MS / 1000}s không trả lời`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : "lỗi lạ";
    die(`${method} ${apiPath} không tới được GitHub (${reason}). Mạng có chặn không?`);
  }

  // 204 (lượt xoá thành công) không có thân; `json()` trên thân rỗng là ném.
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

/**
 * Đổi một mã HTTP thành câu người vận hành DÙNG ĐƯỢC.
 *
 * 403 ở tệp này gần như luôn có đúng một nguyên nhân — thiếu `delete_repo` — nên nó được gọi tên
 * thẳng thay vì để người ta đi tìm. Còn 404 là cái bẫy quen: GitHub trả 404 thay cho 403 với kho
 * mà token không được phép NHÌN, cố ý, để không lộ ra kho ấy có tồn tại hay không.
 */
function explainGithub(status: number, body: unknown, what: string): string {
  const detail =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? ` — ${(body as { message: string }).message.slice(0, 200)}`
      : "";
  if (status === 401) return `PAT bị từ chối (401) khi ${what}: token hết hạn hoặc đã bị thu hồi${detail}`;
  if (status === 403) {
    return (
      `Bị chặn (403) khi ${what}: PAT gần như chắc chắn thiếu scope \`delete_repo\`` +
      ` (classic), hoặc thiếu quyền Administration: read/write (fine-grained)${detail}`
    );
  }
  if (status === 404) return `Không thấy (404) khi ${what}: sai tên kho, hoặc PAT không có quyền nhìn kho này${detail}`;
  return `GitHub trả ${status} khi ${what}${detail}`;
}

type BookStation = {
  owner: string;
  repo: string;
  workflowFile?: string;
  workerId?: string;
  pat?: string;
};

async function main(): Promise<void> {
  // ---- 1. PAT ------------------------------------------------------------------------------

  const pat = (process.env.GITHUB_PAT ?? "").trim();
  if (!pat) {
    die(
      "Chưa có PAT. Bấm đúp remove-github-khoiloi.bat để nhập, hoặc đặt biến GITHUB_PAT rồi chạy lại.\n" +
        "  Kể cả --dry-run cũng cần PAT: cả phần soi kho đều đi qua API của GitHub.",
    );
  }
  // Cùng luật với `github:new`: khoảng trắng trong PAT gần như luôn là lỗi chép-dán (nuốt cả dấu
  // xuống dòng), và nó đi thẳng vào một header HTTP rồi trả về 401 khó hiểu.
  if (/\s/.test(pat)) die("PAT có khoảng trắng — chép lại, đừng kèm dấu xuống dòng hay dấu cách.");

  // ---- 2. Danh tính và SCOPE XOÁ -------------------------------------------------------------
  //
  // Hỏi `/user` trực tiếp (không qua `callGithub`) vì ở đây cần đọc HEADER, thứ `callGithub` bỏ đi.

  let identity: Response;
  try {
    identity = await fetch(`${API_ROOT}/user`, {
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        "user-agent": USER_AGENT,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    die(`Không gọi được api.github.com (${err instanceof Error ? err.message : "lỗi lạ"}). Mạng có chặn không?`);
  }
  if (identity.status === 401) die("PAT sai hoặc đã bị thu hồi — GitHub trả 401. Tạo lại token rồi chạy lại.");
  if (!identity.ok) die(explainGithub(identity.status, await identity.json().catch(() => null), "hỏi danh tính của PAT"));

  const login = ((await identity.json()) as { login?: unknown }).login;
  if (typeof login !== "string" || login.length === 0) {
    die("GitHub trả lời không có tên tài khoản — không rõ PAT này thuộc về ai, dừng cho chắc.");
  }
  const scopes = identity.headers.get("x-oauth-scopes");

  /**
   * `delete_repo` là scope mà `github:new` KHÔNG đòi (nó cần `repo` + `workflow`), nên cái PAT đã
   * dựng kho gần như chắc chắn không xoá nổi kho ấy. Đây là lỗi hay gặp nhất của cả lối này.
   *
   * NHƯNG Ở ĐÂY NÓ CHỈ LÀ MỘT LỜI CẢNH BÁO, KHÔNG PHẢI CỬA CHẶN — và chỗ này đã suýt sai theo
   * đúng cái kiểu mà `newGithubKhoiloi.mjs` đã trả giá một lần („phép kiểm `gh` đứng SAU lượt chạy
   * khô, không đứng trước"). Hai lẽ, cả hai đều cụ thể:
   *
   *   • `--dry-run` sinh ra để SOI KẾ HOẠCH — kể cả (nhất là) trên một cái token còn thiếu quyền,
   *     lúc người ta còn đang cân nhắc có xoá hay không. Chặn nó bằng một điều kiện tiên quyết
   *     của bước THỰC THI là lấy mất đúng công dụng của nó.
   *   • Kho đã bị xoá tay trên GitHub mà dòng sổ còn nằm đó thì lượt chạy KHÔNG gọi `DELETE` một
   *     lần nào — nó chỉ dọn sổ. Chặn vì thiếu `delete_repo` ở ca ấy là một lời từ chối SAI, và nó
   *     chặn đúng cái việc dọn dẹp mà công cụ này sinh ra để làm.
   *
   * Cửa chặn thật đứng ngay trước câu xác nhận, lúc đã biết có phải gọi `DELETE` hay không.
   */
  let hasDeleteScope: boolean | null = null;
  if (scopes !== null) {
    const granted = new Set(
      scopes
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
    hasDeleteScope = granted.has("delete_repo");
    if (!hasDeleteScope) {
      console.warn(
        "\n⚠ PAT thiếu scope `delete_repo` — GitHub sẽ từ chối lượt xoá kho.\n" +
          `  PAT này đang có: ${[...granted].join(", ") || "(không có scope nào)"}\n` +
          "  Đây là scope mà `github:new` KHÔNG đòi, nên token đã dựng kho thường không xoá được nó.\n" +
          "  Thêm ở https://github.com/settings/tokens (tick 'delete_repo') rồi chạy lại.",
      );
    }
  } else {
    console.log(
      "• PAT dạng fine-grained (không khai scope qua header) — không kiểm hộ quyền được.\n" +
        "  Lượt xoá cần Administration: read/write trên kho ấy; thiếu thì hỏng ở đúng bước xoá.",
    );
  }

  // ---- 3. Những thứ phải có sẵn dưới máy -----------------------------------------------------

  if (!process.env.DATABASE_URL) die("Thiếu DATABASE_URL trong .env.local — không có đường nào tới sổ.");
  if (!process.env.ENCRYPTION_KEY) die("Thiếu ENCRYPTION_KEY trong .env.local — không giải nổi chuỗi kết nối tới sổ thật.");

  // ---- 4. Sổ có thẩm quyền nằm ở TRẠM ĐANG HOẠT ĐỘNG -----------------------------------------

  const doc = await readControlDoc();
  if (!doc) {
    // `readControlDoc` KHÔNG BAO GIỜ ném: thiếu env, mạng hỏng, chữ ký sai — tất cả cùng về null.
    die(
      "Không đọc được bảng điều phối — chưa biết trạm nào giữ sổ thì KHÔNG dám xoá gì.\n" +
        "  Ba ngả cùng ra kết quả này: thiếu OCI_REGION/OCI_NAMESPACE/OCI_BUCKET hoặc WORKER_TOKEN\n" +
        "  trong .env.local, bucket không với tới được, hoặc chữ ký bảng không khớp WORKER_TOKEN.\n" +
        "  Soi bằng: npm run mirror:control status",
    );
  }

  const activePg = await resolveActiveStationPg({
    localDatabaseUrl: process.env.DATABASE_URL,
    activeSiteId: doc.activeSiteId,
    onFallback: (via) => console.log(`• Sổ dưới máy đã cũ — lấy đường tới「${doc.activeSiteId}」qua sổ của「${via}」.`),
  }).catch((err: unknown) => die(err instanceof Error ? err.message : "Không tra ra trạm đang hoạt động."));

  /**
   * Đọc sổ ở dạng jsonb THÔ, không qua `getAppSettings`.
   *
   * Cố ý, và cái giá của nó phải được trả ngay ở đây: đường qua Zod sẽ ĐIỀN MẶC ĐỊNH cho những
   * trường thiếu rồi trả về một dòng trông lành lặn — mà lượt ghi ở cuối lại dùng `jsonb_set` để
   * chỉ đụng đúng khoá `githubStations`, nên hai bản ấy có thể lệch nhau. Đọc thô thì thứ ta xoá
   * đúng là thứ đang nằm trong database.
   *
   * Đổi lại, KHÔNG còn ai bảo đảm hình dạng, nên phải tự gác: một dòng sửa tay hỏng (`repo` thiếu)
   * sẽ làm `.toLowerCase()` ném một `TypeError` trần giữa một công cụ xoá — đúng chỗ không được
   * phép có một lỗi không ai hiểu.
   */
  const readBook = async (): Promise<BookStation[]> => {
    const rows = (await neon(activePg)`select value->'githubStations' as stations from app_settings where id = 'global'`) as {
      stations: unknown;
    }[];
    const raw = rows[0]?.stations;
    return Array.isArray(raw) ? (raw as BookStation[]) : [];
  };

  const usableRow = (s: BookStation): boolean =>
    typeof s?.owner === "string" && s.owner.length > 0 && typeof s?.repo === "string" && s.repo.length > 0;

  const book = await readBook();
  const broken = book.length - book.filter(usableRow).length;
  if (broken > 0) {
    console.warn(`⚠ Sổ có ${broken} dòng thiếu owner/repo (sửa tay JSONB?) — bỏ qua, không đụng tới chúng.`);
  }
  const mine = book.filter((s) => usableRow(s) && s.owner.toLowerCase() === login.toLowerCase());
  console.log(`• Bảng điều phối: trạm giữ sổ là「${doc.activeSiteId}」`);
  console.log(`• Tài khoản GitHub suy từ PAT:「${login}」— sổ có ${book.length} kho, ${mine.length} của tài khoản này`);

  // ---- 5. Ứng viên -----------------------------------------------------------------------------
  //
  // Ba nguồn, gộp lại rồi khử trùng theo tên: sổ (kho ta đã ghi), danh sách kho trên GitHub lọc
  // theo tiền tố (kho mồ côi mà sổ không biết — đúng thứ lượt dựng chết giữa chừng để lại), và
  // cái tên người vận hành gõ tay. Tiền tố chỉ để THU HẸP; quyền được xoá do bằng chứng cấp.

  const wantedRepo = arg("repo")?.trim() || null;
  const names = new Map<string, string>(); // tên viết thường -> tên gốc
  const remember = (repo: string) => {
    const key = repo.toLowerCase();
    if (!names.has(key)) names.set(key, repo);
  };
  for (const station of mine) remember(station.repo);
  if (wantedRepo) remember(wantedRepo);

  let listTruncated = false;
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const reply = await callGithub(pat, "GET", `/user/repos?affiliation=owner&sort=full_name&per_page=100&page=${page}`);
    if (reply.status !== 200 || !Array.isArray(reply.body)) {
      // KHÔNG chết ở đây: một PAT fine-grained chỉ được cấp quyền trên đúng một kho vẫn liệt kê
      // hỏng mà xoá được — và với `--repo` thì danh sách này vốn không cần thiết. Chỉ nói ra rằng
      // phần「tự tìm kho mồ côi」đã không chạy, để không ai đọc「không thấy kho nào」thành sự thật.
      console.warn(
        `⚠ Không liệt kê được kho của「${login}」(${explainGithub(reply.status, reply.body, "liệt kê kho")}).\n` +
          "  Chỉ soi được những kho có trong sổ và kho gõ bằng --repo.",
      );
      break;
    }
    const rows = reply.body as { name?: unknown }[];
    for (const row of rows) {
      if (typeof row?.name === "string" && looksLikeKhoiloiRepoName(row.name)) remember(row.name);
    }
    if (rows.length < 100) break;
    if (page === MAX_REPO_PAGES) listTruncated = true;
  }
  if (listTruncated) {
    console.warn(`⚠ Tài khoản có hơn ${MAX_REPO_PAGES * 100} kho — danh sách bị cắt. Dùng --repo cho chắc.`);
  }

  // ---- 6. Thu bằng chứng cho từng ứng viên ------------------------------------------------------

  const inspect = async (repo: string): Promise<Candidate> => {
    const entry = mine.find((s) => s.repo.toLowerCase() === repo.toLowerCase());
    const evidence: Candidate["evidence"] = [];
    let workerId = entry?.workerId?.trim() || null;

    if (entry) evidence.push("so");

    const head = await callGithub(pat, "GET", `/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo)}`);
    if (head.status === 404) {
      // Kho đã bị xoá tay trên GitHub, dòng sổ thì còn. Vẫn là việc phải làm — chỉ còn phần dọn sổ.
      return { repo, evidence, workerId, onGithub: false };
    }
    if (head.status !== 200) die(explainGithub(head.status, head.body, `hỏi kho「${repo}」`));

    const workflowFile = entry?.workflowFile?.trim() || DEFAULT_WORKFLOW_FILE;
    const wf = await callGithub(
      pat,
      "GET",
      `/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo)}/contents/.github/workflows/${encodeURIComponent(workflowFile)}`,
    );
    if (wf.status === 200 && !Array.isArray(wf.body)) {
      evidence.push("workflow");
      const encoded = (wf.body as { content?: unknown } | null)?.content;
      if (typeof encoded === "string") {
        // Base64 của GitHub xuống dòng mỗi 60 ký tự; `Buffer.from` bỏ qua ký tự lạ nên không cần dọn.
        const fromFile = workerIdFromWorkflow(Buffer.from(encoded, "base64").toString("utf8"));
        if (fromFile) {
          // Tệp workflow là thứ RUNNER thật sự khai, nên nó thắng sổ. Lệch nhau thì nói ra: sổ sai
          // nghĩa là mục Khôi Lỗi trên dashboard đang chỉ nhầm máy, và đó là chuyện đáng biết.
          if (workerId && workerId !== fromFile) {
            console.warn(`⚠ Sổ ghi WORKER_ID「${workerId}」nhưng workflow trong kho khai「${fromFile}」— tin workflow.`);
          }
          workerId = fromFile;
        }
      }
    } else if (wf.status === 404) {
      // Không có workflow: hoặc là kho của người khác, hoặc là một kho dựng dở chưa push được gì.
      // Phân biệt bằng cách hỏi lịch sử commit — 409 là câu GitHub trả cho một kho rỗng.
      const commits = await callGithub(
        pat,
        "GET",
        `/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo)}/commits?per_page=1`,
      );
      if (commits.status === 409 && looksLikeKhoiloiRepoName(repo)) evidence.push("trong");
    } else {
      die(explainGithub(wf.status, wf.body, `đọc workflow của kho「${repo}」`));
    }

    return { repo, evidence, workerId, onGithub: true };
  };

  /**
   * `--repo` thì CHỈ soi đúng kho ấy, không soi cả tài khoản.
   *
   * Không phải để tiết kiệm lời gọi API (dù có), mà vì `inspect` DỪNG CẢ LƯỢT CHẠY khi GitHub trả
   * một mã lạ — hợp lý khi còn đang đi tìm mục tiêu (chọn mục tiêu trong lúc mù là điều duy nhất
   * tệ hơn dừng lại), nhưng vô lý khi người vận hành đã chỉ đích danh: một cái kho không liên quan
   * dở chứng không được phép chặn lượt dọn một kho khác.
   *
   * Những kho còn lại vẫn được KỂ TÊN ở bảng kế hoạch, chỉ là chưa soi — đó vẫn là thông tin đáng
   * có («còn mấy cái nữa nằm đó»), miễn là không nói dối rằng đã xét chúng.
   */
  const allNames = [...names.values()];
  const toInspect = wantedRepo ? allNames.filter((r) => r.toLowerCase() === wantedRepo.toLowerCase()) : allNames;
  const notInspected = allNames.filter((r) => !toInspect.includes(r));

  const candidates: Candidate[] = [];
  for (const repo of toInspect) candidates.push(await inspect(repo));

  const chosen = chooseTarget(candidates, wantedRepo);
  if (!chosen.ok) die(chosen.message);
  const target = chosen.target;

  // ---- 7. Khôi lỗi này có đang giữ đàn không ----------------------------------------------------

  let heldJobs: number | null = null;
  let lastSeen: string | null = null;
  let workerRowExists = false;
  if (target.workerId) {
    const held = (await neon(activePg)`
      select count(*)::int as n from automation_jobs
      where worker_id = ${target.workerId} and status in ('running', 'stopping')
    `) as { n: number }[];
    heldJobs = held[0]?.n ?? 0;

    const seen = (await neon(activePg)`select last_seen from workers where id = ${target.workerId}`) as {
      last_seen: string | Date | null;
    }[];
    workerRowExists = seen.length > 0;
    const raw = seen[0]?.last_seen ?? null;
    lastSeen = raw === null ? null : new Date(raw).toISOString();
  }

  // ---- 8. Kế hoạch ------------------------------------------------------------------------------

  const entry = mine.find((s) => s.repo.toLowerCase() === target.repo.toLowerCase());
  const slug = `${login}/${target.repo}`;
  const minutesAgo = lastSeen ? Math.round((Date.now() - Date.parse(lastSeen)) / 60_000) : null;

  console.log(`\n── Sẽ XOÁ ────────────────────────────────────────────`);
  console.log(`  kho GitHub  : ${target.onGithub ? `https://github.com/${slug}` : "(đã không còn trên GitHub)"}`);
  console.log(`  bằng chứng  : ${describeEvidence(target)}`);
  console.log(`  dòng sổ     : ${entry ? `có — ở trạm「${doc.activeSiteId}」` : "không có (đã gỡ trước đó, hoặc chưa từng vào sổ)"}`);
  console.log(`  worker id   : ${target.workerId ?? "(không suy ra được)"}`);
  console.log(
    `  điểm danh   : ${
      !target.workerId
        ? "(chưa hỏi được)"
        : !workerRowExists
          ? "không có dòng nào trong bảng workers"
          : `${minutesAgo === null ? "có dòng, chưa từng điểm danh" : `lần cuối ~${minutesAgo} phút trước`}`
    }`,
  );
  console.log(`  đàn đang giữ: ${heldJobs === null ? "(chưa hỏi được — thiếu worker id)" : heldJobs}`);

  const others = candidates.filter((c) => c.repo !== target.repo);
  if (others.length > 0) {
    console.log(`\n  Còn ${others.length} kho khác đã soi, KHÔNG đụng tới trong lượt này:`);
    for (const other of others) console.log(`      · ${describeCandidate(other)}`);
  }
  if (notInspected.length > 0) {
    console.log(`\n  ${notInspected.length} kho mang tên giống nhưng CHƯA SOI (vì đã có --repo):`);
    for (const name of notInspected) console.log(`      · ${name}`);
    console.log("    Muốn dọn chúng thì chạy lại, mỗi lượt một kho.");
  }

  if (dryRun) {
    console.log("\n--dry-run: dừng ở đây, chưa xoá gì cả. Bỏ --dry-run để làm thật.");
    return;
  }

  // ---- 9. Hai hàng rào cuối ---------------------------------------------------------------------

  const review = reviewRemoval({ candidate: target, heldJobs, force });
  if (!review.go) die(review.message);

  /**
   * Cửa chặn THẬT của `delete_repo` — đứng ở đây chứ không ở đầu, vì chỉ tới lúc này mới biết
   * lượt chạy có gọi `DELETE` hay không (kho đã bị xoá tay thì không). Đứng TRƯỚC câu xác nhận
   * để người vận hành khỏi gõ lại một cái tên cho một lượt chạy chắc chắn hỏng.
   */
  if (target.onGithub && hasDeleteScope === false) {
    die(
      "PAT thiếu scope `delete_repo` nên không xoá nổi kho — dừng trước khi hỏi xác nhận.\n" +
        "  Thêm ở https://github.com/settings/tokens (tick 'delete_repo') rồi chạy lại.\n" +
        "  (Chưa có gì bị đụng tới: kho, sổ và dòng điểm danh đều còn nguyên.)",
    );
  }
  if (force && heldJobs !== null && heldJobs > 0) {
    console.warn(`\n⚠ --force: ${heldJobs} đàn đang chạy SẼ bị kết liễu thành「thất bại」trong ~3 phút.`);
  }

  // Gõ lại đúng tên kho, không phải「y/n」: một cú Enter theo quán tính không được phép xoá một kho
  // công khai. Ai chạy trong máy móc thì dùng --yes.
  if (!skipConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nGõ lại tên kho「${target.repo}」để xác nhận XOÁ (Enter trống là huỷ): `)).trim();
    rl.close();
    if (answer !== target.repo) die("Không khớp — huỷ, chưa xoá gì cả.");
  }

  // ---- 10. Xoá, đúng thứ tự của LUẬT 3 -----------------------------------------------------------

  /**
   * Lưu dòng sổ ra tệp TRƯỚC mọi phép xoá. Trong đó có phong bì `pat` đã mã hoá — với một kho mà
   * người ta lỡ xoá nhầm, đây là bản duy nhất còn lại của cái chìa ấy, và là đường ghi trả lại vào
   * sổ nếu đổi ý giữa chừng. (Phong bì secretBox, không phải PAT trần.)
   */
  if (entry) {
    const backup = path.join(tmpdir(), `dong-so-khoiloi-${target.repo}-${Date.now()}.json`);
    writeFileSync(backup, JSON.stringify(entry, null, 2));
    console.log(`\n✔ đã lưu dòng sổ ra ${backup}`);
  }

  if (target.onGithub) {
    const removed = await callGithub(pat, "DELETE", `/repos/${encodeURIComponent(login)}/${encodeURIComponent(target.repo)}`);
    // 404 = ai đó vừa xoá xen vào giữa. Đích đã đạt, đi tiếp phần dọn sổ.
    if (removed.status !== 204 && removed.status !== 404) {
      die(
        `${explainGithub(removed.status, removed.body, `xoá kho「${slug}」`)}\n` +
          "  DỪNG — chưa gỡ gì khỏi sổ, vì dòng sổ là thứ duy nhất còn nhận ra cái kho đang chạy kia.",
      );
    }

    // Nghiệm thu bằng một lượt hỏi lại: `204` là lời hứa của GitHub, `404` mới là bằng chứng.
    const gone = await callGithub(pat, "GET", `/repos/${encodeURIComponent(login)}/${encodeURIComponent(target.repo)}`);
    if (gone.status !== 404) {
      die(
        `Xoá xong nhưng kho「${slug}」VẪN CÒN (HTTP ${gone.status}) — dừng, KHÔNG gỡ sổ.\n` +
          "  Gỡ sổ lúc này là bỏ lại một kho đang chạy mà không dòng nào ở đâu biết nó tồn tại.",
      );
    }
    console.log(`✔ đã xoá kho ${slug}`);
  }

  if (entry) {
    /**
     * ĐỌC LẠI sổ ngay trước khi ghi, không dùng bản đã đọc ở bước soi: giữa hai mốc ấy là cả lượt
     * hỏi GitHub và một câu xác nhận gõ tay — thừa thời gian để trưởng môn sửa một dòng khác.
     *
     * Và ghi bằng `jsonb_set` chứ không ghi trọn document: `app_settings` giữ mọi cấu hình của
     * tông môn, nên một lượt ghi trọn bằng bản chụp cũ sẽ lặng lẽ lộn ngược mọi thứ vừa sửa trong
     * quãng ấy — một lời nhắn bảo trì, một hạn lưu nhật ký. Cùng lối với `mirror:remove`.
     */
    const fresh = await readBook();
    const remaining = fresh.filter((s) => stationSlug(s).toLowerCase() !== slug.toLowerCase());
    if (remaining.length === fresh.length) {
      console.warn(`⚠ Dòng sổ「${slug}」đã biến mất trong lúc chạy — có phiên khác vừa gỡ. Không ghi đè.`);
    } else {
      await neon(activePg).query(
        `update app_settings set value = jsonb_set(value, '{githubStations}', $1::jsonb, true), updated_at = now() where id = 'global'`,
        [JSON.stringify(remaining)],
      );
      const after = await readBook();
      if (after.some((s) => stationSlug(s).toLowerCase() === slug.toLowerCase())) {
        die(
          `Gỡ khỏi sổ xong đọc lại VẪN còn dòng「${slug}」.\n` +
            "  Kho trên GitHub ĐÃ XOÁ rồi — vào Tông Môn → tab Kho GitHub bấm Xoá ở dòng ấy.",
        );
      }
      console.log(`✔ đã gỡ khỏi sổ — còn ${after.length} kho`);
    }
  }

  /**
   * Dòng điểm danh. KHÔNG chết cả lượt vì nó: kho và sổ — hai thứ có hậu quả thật — đã xong, và
   * một dòng `workers` sót lại chỉ gây đúng một phiền phức, là `github:new` từ chối dựng lại một
   * khôi lỗi trùng id. Nói ra rồi đi tiếp thì đúng hơn là ném ở dòng cuối cùng.
   *
   * `automation_jobs.worker_id` KHÔNG có khoá ngoại trỏ vào bảng này (cột text trơn), nên xoá ở
   * đây không đụng tới một dòng đàn nào — lịch sử vẫn giữ nguyên tên máy đã cày nó.
   */
  if (target.workerId && workerRowExists) {
    try {
      await neon(activePg)`delete from workers where id = ${target.workerId}`;
      console.log(`✔ đã gỡ「${target.workerId}」khỏi sổ điểm danh`);
    } catch (err) {
      console.warn(
        `⚠ Không gỡ được「${target.workerId}」khỏi bảng workers (${err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ"}).\n` +
          "  Vô hại, trừ một chuyện: github:new sẽ từ chối dựng lại một khôi lỗi trùng id ấy.",
      );
    }
  }

  console.log(
    `\n✔ Kho khôi lỗi「${target.repo}」đã xoá sạch.\n` +
      `  Nghiệm thu: mở Tông Môn → tab Kho GitHub (không còn dòng ấy) và Hàng Đợi → tab Khôi Lỗi\n` +
      `  (không còn「${target.workerId ?? "khôi lỗi ấy"}」).\n` +
      `\n  Dựng lại một khôi lỗi khác: bấm đúp new-github-khoiloi.bat\n`,
  );
}

try {
  await main();
} catch (err) {
  // `Stop` là lời từ chối đã in ra tử tế rồi — chỉ cần mã thoát. Mọi lỗi khác giữ NGUYÊN stack:
  // nuốt nó thành một dòng đẹp là lấy mất của người sửa thứ duy nhất chỉ đúng dòng hỏng.
  if (!(err instanceof Stop)) throw err;
  process.exitCode = 1;
}
