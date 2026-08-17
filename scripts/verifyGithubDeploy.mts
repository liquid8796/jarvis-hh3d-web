#!/usr/bin/env node
/**
 * Kiểm chứng LƯỢT PHÁT HÀNH cho khôi lỗi GitHub — `npm run verify:github-deploy`.
 *
 * Thuần: không mạng, không database, không đụng GitHub. Ba phần dễ sai nhất của cả lượt phát
 * hành đều là hàm thuần, và đây là chỗ đóng đinh chúng:
 *
 *   1. `gitBlobSha` — nếu nó sai thì phép so「tệp này đã đổi chưa」sai theo, và lượt phát hành
 *      hoặc đẩy thừa mọi tệp mỗi lần, hoặc (tệ hơn) tưởng một tệp đã đổi là chưa đổi rồi bỏ qua.
 *      Kiểm bằng chính `git hash-object` chứ không bằng một chuỗi hex chép tay: hằng số chép tay
 *      chỉ chứng minh mã còn khớp với cái tôi đã gõ, còn `git` mới là thứ phải khớp thật.
 *   2. `planKhoiloiTree` — nó quyết định XOÁ tệp nào. Sai ranh giới ở đây là xoá mất
 *      `.github/heartbeat.txt`, tức phá đúng thứ giữ cho lịch của kho khỏi bị GitHub tắt, và
 *      triệu chứng hiện ra ba tuần sau dưới dạng「khôi lỗi im lặng thôi lên ca」.
 *   3. `resolveDeployWorkerId` — nó là hàng rào chống phát hành một kho về TRÙNG id với khôi lỗi
 *      khác. Bản mẫu workflow mang sẵn `WORKER_ID: github-khoiloi`, nên một nhánh「thôi cứ dùng
 *      mặc định」là một va chạm danh tính, không phải một giá trị mặc định vô hại.
 *
 * Phép moi `WORKER_ID`/`WEB_URL` và phép vẽ workflow chạy trên CHÍNH bản mẫu thật của kho này
 * (`deploy/github/linh-su.yml`) — cùng kỷ luật với `verify:github-removal`: thứ phải đúng mãi là
 *「phép ấy chạy được trên tệp THẬT」, không phải một giá trị cụ thể nào.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { DEFAULT_WORKFLOW_FILE } from "../src/lib/validation/githubStations";
import { looksTransient, shouldRetryCreate } from "./githubTransient.mjs";
import {
  activeRunIds,
  activeRuns,
  planKhoiloiTree,
  resolveDeployWorkerId,
  reviewRestart,
  webUrlFromWorkflow,
  workerIdFromWorkflow,
  type ActiveRun,
} from "./githubKhoiloi.mts";
import {
  OWNED_PREFIXES,
  WORKFLOW_TARGET_PATH,
  WORKFLOW_TEMPLATE_PATH,
  assertImportsResolve,
  buildKhoiloiPayload,
  gitBlobSha,
  readCommittedFile,
  renderPackageJson,
  renderPackageJsonFor,
  renderReadme,
  renderWorkflow,
  webVersionOf,
} from "./khoiloiPayload.mjs";

const repoRoot = path.join(import.meta.dirname, "..");

let checks = 0;
const check = (label: string, condition: unknown, detail = "") => {
  if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ""}`);
  checks++;
  console.log(`  ✓ ${label}`);
};

/** Một phép ném CÓ nội dung: hàm phải ném, và câu chữ phải nói đúng chuyện. */
const throws = (label: string, fn: () => unknown, mustSay: string) => {
  let message: string | null = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  check(label, message !== null && message.includes(mustSay), message ?? "KHÔNG ném gì cả");
};

console.log("Phát hành khôi lỗi GitHub — ba phần thuần dễ sai nhất\n");

// ---- 1. Băm blob phải trùng git ----------------------------------------------------------------
{
  console.log("1. gitBlobSha khớp `git hash-object`");

  /** Chính git là trọng tài. Đây là điểm khác biệt giữa một phép kiểm và một lời tự khen. */
  const oracle = (bytes: Buffer): string =>
    execFileSync("git", ["hash-object", "--stdin"], {
      input: bytes,
      encoding: "utf8",
      timeout: 30_000,
    }).trim();

  const mau: Array<[string, Buffer]> = [
    ["tệp rỗng", Buffer.alloc(0)],
    ["một dòng LF", Buffer.from("hello\n", "utf8")],
    ["CRLF (profile.json là kiểu này)", Buffer.from("a\r\nb\r\n", "utf8")],
    ["tiếng Việt có dấu", Buffer.from("Khôi lỗi tông môn — đàn pháp\n", "utf8")],
    ["byte nhị phân", Buffer.from([0, 1, 2, 255, 128, 64])],
    ["dài 100KB", Buffer.alloc(100 * 1024, 0x61)],
  ];
  for (const [ten, bytes] of mau) {
    const mine = gitBlobSha(bytes);
    check(`${ten}: ${mine.slice(0, 12)}…`, mine === oracle(bytes), `git nói ${oracle(bytes)}`);
  }

  // Tệp THẬT trong gói, không phải mẫu tự nghĩ ra: nếu một phép chuẩn hoá nào lọt vào đường đọc
  // blob thì chỗ này đỏ, và nó đỏ trên đúng loại tệp sẽ được đẩy đi.
  const worker = readCommittedFile(repoRoot, "scripts/worker.mjs");
  check(
    "scripts/worker.mjs đọc từ HEAD băm khớp git",
    gitBlobSha(worker) === oracle(worker),
    `${gitBlobSha(worker)} vs ${oracle(worker)}`,
  );
}

// ---- 2. Kế hoạch cây: đổi, giữ, và RANH GIỚI XOÁ -----------------------------------------------
{
  console.log("\n2. planKhoiloiTree — phần quyết định tệp nào bị XOÁ");

  const payload = new Map([
    ["scripts/worker.mjs", "aaa"],
    ["src/lib/quest-engine/engine.mjs", "bbb"],
    ["package.json", "ccc"],
    [WORKFLOW_TARGET_PATH, "ddd"],
  ]);

  {
    const remote = new Map([
      ["scripts/worker.mjs", "aaa"], // giống hệt
      ["src/lib/quest-engine/engine.mjs", "KHAC"], // đã đổi
      // package.json thiếu hẳn → phải ghi mới
      [WORKFLOW_TARGET_PATH, "ddd"],
      ["src/lib/quest-engine/daBoDi.mjs", "eee"], // trong ranh giới, gói không còn → XOÁ
      [".github/heartbeat.txt", "fff"], // NGOÀI ranh giới → giữ nguyên
      ["README.md", "ggg"], // ngoài ranh giới, và gói cũng có (chỉ là mẫu này lược đi)
      ["LICENSE", "hhh"], // rác của người khác, ngoài ranh giới
    ]);
    const plan = planKhoiloiTree({ payload, remote, ownedPrefixes: OWNED_PREFIXES });

    check("tệp giống hệt → giữ nguyên", plan.unchanged === 2, `unchanged=${plan.unchanged}`);
    check(
      "tệp đổi + tệp thiếu → cùng vào danh sách ghi",
      plan.changed.join(",") === "package.json,src/lib/quest-engine/engine.mjs",
      plan.changed.join(","),
    );
    check(
      "tệp trong ranh giới mà gói không còn → XOÁ",
      plan.removed.join(",") === "src/lib/quest-engine/daBoDi.mjs",
      plan.removed.join(","),
    );
    check(
      "`.github/heartbeat.txt` KHÔNG bị xoá — nó là của vòng nuôi kho",
      !plan.removed.includes(".github/heartbeat.txt"),
    );
    check("rác ngoài ranh giới (LICENSE) KHÔNG bị đụng", !plan.removed.includes("LICENSE"));
    check("README.md ngoài hai tiền tố nên không bao giờ vào danh sách xoá", !plan.removed.includes("README.md"));
  }

  {
    // Kho đã đúng bản: không ghi gì, không xoá gì — lượt phát hành phải KHÔNG tạo commit nào.
    const plan = planKhoiloiTree({ payload, remote: new Map(payload), ownedPrefixes: OWNED_PREFIXES });
    check(
      "kho đã đúng bản → không ghi, không xoá",
      plan.changed.length === 0 && plan.removed.length === 0 && plan.unchanged === payload.size,
    );
  }

  {
    // Kho rỗng (mới `gh repo create` xong): mọi thứ đều là ghi mới, không có gì để xoá.
    const plan = planKhoiloiTree({ payload, remote: new Map(), ownedPrefixes: OWNED_PREFIXES });
    check(
      "kho trắng → ghi tất, xoá không",
      plan.changed.length === payload.size && plan.removed.length === 0 && plan.unchanged === 0,
    );
  }

  {
    // Thứ tự phải ỔN ĐỊNH: hai lượt chạy giống nhau phải in ra một bảng kế hoạch giống nhau, mà
    // `Map` thì giữ thứ tự chèn — thứ tự ấy đến từ `git ls-tree` và từ GitHub, hai nguồn không
    // hứa gì về sắp xếp.
    const xao = new Map([...payload].reverse());
    const a = planKhoiloiTree({ payload, remote: new Map(), ownedPrefixes: OWNED_PREFIXES });
    const b = planKhoiloiTree({ payload: xao, remote: new Map(), ownedPrefixes: OWNED_PREFIXES });
    check("thứ tự đầu vào không đổi được kế hoạch", a.changed.join(",") === b.changed.join(","));
  }
}

// ---- 3. Danh tính khôi lỗi ----------------------------------------------------------------------
{
  console.log("\n3. resolveDeployWorkerId — hàng rào chống trùng id");

  const book = resolveDeployWorkerId({ fromBook: "khoiloi-tro-a", fromWorkflow: "khoiloi-tro-b" });
  check("sổ thắng tệp trong kho", book.ok && book.workerId === "khoiloi-tro-a");

  const fallback = resolveDeployWorkerId({ fromBook: "", fromWorkflow: "khoiloi-tro-b" });
  check("sổ trống → lấy id kho đang mang", fallback.ok && fallback.workerId === "khoiloi-tro-b");

  const none = resolveDeployWorkerId({ fromBook: "", fromWorkflow: null });
  check("cả hai trống → TỪ CHỐI", !none.ok);
  check(
    "lời từ chối nói ra hậu quả thật (va chạm id)",
    !none.ok && none.message.includes("va chạm"),
    !none.ok ? none.message : "",
  );

  const blank = resolveDeployWorkerId({ fromBook: "   ", fromWorkflow: "  " });
  check("toàn khoảng trắng cũng là trống", !blank.ok);
}

// ---- 4. Bản mẫu workflow THẬT --------------------------------------------------------------------
{
  console.log("\n4. Bản mẫu thật của kho này");

  const template = readCommittedFile(repoRoot, WORKFLOW_TEMPLATE_PATH).toString("utf8");

  check("moi được WORKER_ID khỏi bản mẫu", workerIdFromWorkflow(template) !== null);
  check("moi được WEB_URL khỏi bản mẫu", webUrlFromWorkflow(template) !== null);

  const rendered = renderWorkflow({
    template,
    workerId: "khoiloi-tro-kiem-chung",
    webUrl: "https://vi-du.invalid",
  });
  check("vẽ xong thì WORKER_ID là id mới", workerIdFromWorkflow(rendered) === "khoiloi-tro-kiem-chung");
  check("vẽ xong thì WEB_URL là địa chỉ mới", webUrlFromWorkflow(rendered) === "https://vi-du.invalid");
  check(
    "id của bản mẫu KHÔNG còn sót lại đâu trong tệp đã vẽ",
    !rendered.includes(`WORKER_ID: ${workerIdFromWorkflow(template)}`),
  );

  // Hai ca ĐỘT BIẾN: bản mẫu đổi hình dạng thì phép thay hỏng LẶNG LẼ — nó không thay gì cả, và
  // kho phát ra mang id/địa chỉ của bản mẫu. Cả hai phải ném.
  throws(
    "bản mẫu mất dòng WORKER_ID → ném, không phát hành id mặc định",
    () => renderWorkflow({ template: template.replace(/^\s*WORKER_ID:.*$/m, ""), workerId: "x", webUrl: "https://a.invalid" }),
    "WORKER_ID",
  );
  throws(
    "bản mẫu mất chỗ WEB_URL → ném",
    () => renderWorkflow({ template: template.replace(/\$\{\{ vars\.WEB_URL[^}]*\}\}/, "https://co-dinh.invalid"), workerId: "x", webUrl: "https://a.invalid" }),
    "WEB_URL",
  );

  check("moi WEB_URL từ chuỗi rác → null", webUrlFromWorkflow("khong co gi o day") === null);
  check("moi WEB_URL từ giá trị rỗng → null", webUrlFromWorkflow("vars.WEB_URL || ''") === null);
}

// ---- 5. Hai hằng số song sinh + phép soi đường import ---------------------------------------------
{
  console.log("\n5. Hai hằng số song sinh, và phép soi đường import");

  check(
    "chỗ gói đặt workflow khớp chỗ sổ đi hỏi trạng thái",
    WORKFLOW_TARGET_PATH === `.github/workflows/${DEFAULT_WORKFLOW_FILE}`,
    `${WORKFLOW_TARGET_PATH} vs .github/workflows/${DEFAULT_WORKFLOW_FILE}`,
  );

  const dayDu = new Map([
    ["scripts/worker.mjs", Buffer.from('import { a } from "../src/lib/quest-engine/engine.mjs";', "utf8")],
    ["src/lib/quest-engine/engine.mjs", Buffer.from("export const a = 1;", "utf8")],
  ]);
  assertImportsResolve(dayDu);
  check("gói đủ tệp → không ném", true);

  throws(
    "gói thiếu tệp bị import → ném kèm tên tệp",
    () => assertImportsResolve(new Map([["scripts/worker.mjs", Buffer.from('import "../src/lib/worker/controlFollow.mjs";', "utf8")]])),
    "controlFollow.mjs",
  );

  throws(
    "import động (`import(...)`) cũng bị soi",
    () => assertImportsResolve(new Map([["scripts/worker.mjs", Buffer.from('await import("./thieu.mjs");', "utf8")]])),
    "thieu.mjs",
  );

  check(
    "README vẽ ra không mang tên kho gốc lẫn tên nền tảng",
    !/jarvis|github|actions/i.test(renderReadme({ workerId: "khoiloi-tro-x", webUrl: "https://a.invalid" })),
  );
}

// ---- 6. Khởi động lại: hàng rào đắt nhất của cả công cụ -------------------------------------------
{
  console.log("\n6. reviewRestart — huỷ lượt Actions là giết runner tức khắc");

  const MOI = "aaaaaaa";
  const CU = "bbbbbbb";
  const run = (id: number, headSha: string): ActiveRun => ({ id, headSha, number: id });

  {
    // Ca đã xảy ra thật 14/08/2026: sau lượt chuyển trạm, runner gõ vào trạm đã xoá, nhận 404 mỗi
    // 5 giây, giữ 0 đàn. Huỷ nó không mất gì — và chờ 4 giờ thì mất hai ghế suốt bốn giờ.
    const v = reviewRestart({ runs: [run(1, CU)], headSha: MOI, heldJobs: 0, force: false, workerId: "w" });
    check("mã cũ + 0 đàn → huỷ rồi phát lượt mới", v.go && v.cancel.length === 1 && v.dispatch);
  }

  {
    const v = reviewRestart({ runs: [run(1, CU)], headSha: MOI, heldJobs: 1, force: false, workerId: "w" });
    check("mã cũ + ĐANG GIỮ ĐÀN → từ chối", !v.go);
    check(
      "lời từ chối nói ra cái giá (reapStaleJobs, 3 phút)",
      !v.go && v.message.includes("reapStaleJobs") && v.message.includes("3 phút"),
      !v.go ? v.message : "",
    );
  }

  {
    const v = reviewRestart({ runs: [run(1, CU)], headSha: MOI, heldJobs: 2, force: true, workerId: "w" });
    check("--force qua được hàng rào đàn — đó là đúng vai của nó", v.go && v.cancel.length === 1);
  }

  {
    // Lượt đã mang mã mới thì huỷ nó là tự phá việc mình vừa làm.
    const v = reviewRestart({ runs: [run(1, MOI)], headSha: MOI, heldJobs: 0, force: false, workerId: "w" });
    check("đã chạy mã mới → không huỷ, không phát thêm", v.go && v.cancel.length === 0 && !v.dispatch);
  }

  {
    // Ca thật của kho …233056: một lượt cũ đang chạy, một lượt mới đã nằm chờ. Huỷ cái cũ là đủ —
    // phát thêm một lượt nữa chỉ tổ đốt quỹ phút cho thứ sẽ bị concurrency đẩy ra.
    const v = reviewRestart({ runs: [run(1, CU), run(2, MOI)], headSha: MOI, heldJobs: 0, force: false, workerId: "w" });
    check("có lượt mới nằm chờ → chỉ huỷ cũ, KHÔNG phát thêm", v.go && v.cancel.length === 1 && !v.dispatch);
  }

  {
    const v = reviewRestart({ runs: [], headSha: MOI, heldJobs: 0, force: false, workerId: "w" });
    check("không lượt nào đang sống → phát một lượt mới", v.go && v.cancel.length === 0 && v.dispatch);
  }

  {
    // Giữ đàn nhưng KHÔNG có lượt cũ nào để huỷ: không được từ chối, vì chẳng có gì bị giết cả.
    const v = reviewRestart({ runs: [run(1, MOI)], headSha: MOI, heldJobs: 3, force: false, workerId: "w" });
    check("giữ đàn mà không có lượt cũ → vẫn đi tiếp, không đụng gì", v.go && v.cancel.length === 0);
  }

  console.log("\n   activeRuns — đọc thân JSON của GitHub");
  const body = {
    workflow_runs: [
      { id: 11, status: "in_progress", head_sha: CU, run_number: 3 },
      { id: 12, status: "completed", head_sha: CU, run_number: 2 },
      { id: 13, status: "queued", head_sha: MOI, run_number: 4 },
      { id: "rác", status: "in_progress", head_sha: CU },
      { status: "in_progress", head_sha: CU },
      null,
    ],
  };
  const parsed = activeRuns(body);
  check("chỉ lượt CHƯA xong lọt vào", parsed.map((r) => r.id).join(",") === "11,13", parsed.map((r) => r.id).join(","));
  check("id không phải số bị loại — nếu không sẽ POST /runs/undefined/cancel", parsed.every((r) => typeof r.id === "number"));
  check("activeRunIds là cùng một sự thật, chỉ bớt cột", activeRunIds(body).join(",") === "11,13");
  check("thân rác → mảng rỗng, không ném", activeRuns({ workflow_runs: "không phải mảng" }).length === 0);
  check("thân null → mảng rỗng", activeRuns(null).length === 0);
}

// ---- SỐ BẢN ĐÓNG DẤU VÀO GÓI ---------------------------------------------------------------
//
// Trước 15/08/2026 `package.json` của kho sinh ra ghi cứng "1.0.0", nên MỌI khôi lỗi trọ khai
// đúng chuỗi ấy vào sổ điểm danh — bảy máy, bảy đời mã, một con số. Cột "lệch bản" của dashboard
// vì thế mù với riêng nhóm máy này, và tông chủ là người phát hiện ra (`stuck mãi ở 1.0.0`).
{
  const webVersion = webVersionOf(repoRoot);
  check(`đọc được số bản kho gốc (${webVersion})`, /^\d+\.\d+\.\d+$/.test(webVersion));

  const rendered = JSON.parse(renderPackageJsonFor(repoRoot));
  check("package.json của gói mang ĐÚNG số bản kho gốc", rendered.version === webVersion);
  check("…không còn là hằng số 1.0.0", rendered.version !== "1.0.0" || webVersion === "1.0.0");

  // Thiếu số bản thì NÉM, không lặng lẽ ghi một chuỗi rỗng: một gói khai version rỗng làm
  // `readOwnVersion` trả null, tức sổ điểm danh hiện "không rõ" — tệ hơn cả 1.0.0.
  let threw = false;
  try {
    renderPackageJson({ playwrightVersion: "^1.0.0", version: "" });
  } catch {
    threw = true;
  }
  check("số bản rỗng → ném, không đẻ ra một gói khai bản rỗng", threw);

  // LOCKFILE LỆCH SỐ BẢN: `npm ci` từ chối chạy, và nó từ chối trên runner — mọi khôi lỗi chết
  // cùng lúc ở một chỗ không ai đang nhìn. Đây là lưới duy nhất bắt được trước khi đẩy.
  let lockGuard = "";
  try {
    buildKhoiloiPayload({
      repoRoot,
      workerId: "khoiloi-tro-kiem-thu",
      webUrl: "https://vi-du.test",
      lockfile: Buffer.from(JSON.stringify({ name: "x", version: "0.0.1", packages: { "": { version: "0.0.1" } } })),
    });
  } catch (err) {
    lockGuard = err instanceof Error ? err.message : String(err);
  }
  check("lockfile lệch số bản → ném, kèm CẢ HAI con số", lockGuard.includes("0.0.1") && lockGuard.includes(webVersion));
  check("…và nói ra hậu quả thật: npm ci sẽ từ chối chạy trên runner", lockGuard.includes("npm ci"));

  // Lockfile ĐÚNG bản thì đi qua, và gói mang đúng số bản ấy.
  const good = buildKhoiloiPayload({
    repoRoot,
    workerId: "khoiloi-tro-kiem-thu",
    webUrl: "https://vi-du.test",
    lockfile: Buffer.from(JSON.stringify({ name: "x", version: webVersion, packages: { "": { version: webVersion } } })),
  });
  check("gói dựng xong mang đúng số bản kho gốc", JSON.parse(good.get("package.json").toString("utf8")).version === webVersion);

  // Lockfile KHÔNG đọc được số bản (bản cũ, hay tệp lạ) thì im lặng cho qua — đây là lưới bắt
  // lệch, không phải phép soát định dạng lockfile.
  const quiet = buildKhoiloiPayload({
    repoRoot,
    workerId: "khoiloi-tro-kiem-thu",
    webUrl: "https://vi-du.test",
    lockfile: Buffer.from("{}"),
  });
  check("lockfile không khai số bản → không chặn lượt dựng", quiet.has("package-lock.json"));
}

// ---- looksTransient: nhịp nấc của GitHub, và ranh giới không được nhích -------------------
// Sinh ra từ log 17/08/2026: `gh secret set` trúng một cú 503 và cả lượt DỰNG chết, bỏ lại một
// kho công khai đã push mà không có secret. Hàm này quyết định thử lại hay dọn rác, nên hai
// chiều đều phải đóng đinh — nhận hụt thì mất một kho, nhận thừa thì cái kho hỏng dở nằm lại
// lâu thêm trong lúc script thử lại một câu trả lời đã biết.
{
  console.log("\nlooksTransient — 5xx và mạng đứt thì thử lại, 4xx thì KHÔNG");

  const transient = [
    "failed to fetch public key: HTTP 503: No server is currently available to service your request. Sorry about that. Please try resubmitting your request",
    "HTTP 502: Bad gateway",
    "HTTP 500",
    "HTTP 429: too many requests",
    "You have exceeded a secondary rate limit",
    "dial tcp: lookup api.github.com: EAI_AGAIN",
    "read tcp 10.0.0.1:443: ECONNRESET",
    "Post \"https://api.github.com/…\": net/http: TLS handshake timeout",
  ];
  for (const text of transient) {
    check(`thoáng qua: ${text.slice(0, 46)}…`, looksTransient(text));
  }

  const permanent = [
    "HTTP 401: Bad credentials",
    "HTTP 403: Resource not accessible by personal access token",
    "HTTP 404: Not Found",
    "HTTP 422: Validation Failed (name already exists on this account)",
    "unknown flag: --body-file",
    "",
    null,
    undefined,
  ];
  for (const text of permanent) {
    check(`KHÔNG thử lại: ${JSON.stringify(text)?.slice(0, 46) ?? "(rỗng)"}`, !looksTransient(text));
  }

  // Cái bẫy gần nhất của một regex viết vội: "HTTP 404" chứa "40", "HTTP 4295" không phải 429.
  check("ranh giới số: 4295 không phải 429", !looksTransient("HTTP 4295: chuyện lạ"));
  check("ranh giới số: 5001 không phải 500", !looksTransient("HTTP 5001: chuyện lạ"));

  // shouldRetryCreate — cùng câu hỏi ấy nhưng cho `gh repo create`, nơi「thử lại」có thể đẻ ra
  // một kho thứ hai. Sinh ra từ log 17/08/2026 lượt hai: 503 ở /graphql, kho CHƯA kịp sinh
  // (API trả 404), nên gọi lại là đúng — nhưng chỉ khi biết chắc nó chưa sinh.
  const nac = "HTTP 503: No server is currently available";
  check("chưa có kho + nấc → gọi lại", shouldRetryCreate({ why: nac, existence: "no" }));
  check("chưa có kho + 4xx → KHÔNG gọi lại", !shouldRetryCreate({ why: "HTTP 422: name already exists", existence: "no" }));
  check(
    "ĐÃ có kho → KHÔNG gọi lại, dù câu lỗi trông rất thoáng qua",
    !shouldRetryCreate({ why: nac, existence: "yes" }),
  );
  check(
    "không hỏi được GitHub → KHÔNG gọi lại (hai kho trong một lượt là cái giá lớn hơn một lượt hỏng)",
    !shouldRetryCreate({ why: nac, existence: "unknown" }),
  );
}

console.log(`\n✔ ${checks} phép kiểm, tất cả xanh.`);
