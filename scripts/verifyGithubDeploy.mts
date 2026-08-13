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
import {
  planKhoiloiTree,
  resolveDeployWorkerId,
  webUrlFromWorkflow,
  workerIdFromWorkflow,
} from "./githubKhoiloi.mts";
import {
  OWNED_PREFIXES,
  WORKFLOW_TARGET_PATH,
  WORKFLOW_TEMPLATE_PATH,
  assertImportsResolve,
  gitBlobSha,
  readCommittedFile,
  renderReadme,
  renderWorkflow,
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

console.log(`\n✔ ${checks} phép kiểm, tất cả xanh.`);
