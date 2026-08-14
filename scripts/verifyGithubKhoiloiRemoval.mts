#!/usr/bin/env node
/**
 * Kiểm chứng LUẬT XOÁ KHO KHÔI LỖI (`scripts/githubKhoiloi.mts`).
 *
 * Thuần: không mạng, không database, không `.env`. Chỉ đọc đúng một tệp thật — chính workflow của
 * repo này — và lý do có mặt của nó nằm ngay ở đó (xem nhóm「WORKER_ID từ tệp workflow」).
 *
 * VÌ SAO ĐÁNG KIỂM, và vì sao ĐÚNG chỗ này: đây là phép xét quyết định một lệnh `DELETE /repos`.
 * Không có tầng nào ở hạ nguồn bắt được một phép xét sai — GitHub xoá xong là xong, kho công khai
 * lẫn nhật ký Actions đi cùng nhau, không có thùng rác. Hai kiểu sai, hai cái giá khác hẳn:
 *
 *   • Nhận nhầm kho của người khác  → xoá mất thứ không phải của mình.
 *   • Xoá đúng kho, nhưng nhằm lúc nó đang cày → đàn của một đạo hữu chết theo, sau 3 phút, bằng
 *     một dòng「Khôi lỗi mất liên lạc」mà người gõ lệnh không bao giờ nhìn thấy.
 *
 * Nên hai hàng rào ấy được đóng đinh ở đây, lúc chúng còn là hàm.
 *
 * Từ 13/08/2026 có thêm một nhóm thứ ba: VÒNG CANH SỔ ĐIỂM DANH. Cái sai ở đó không giết đàn của
 * ai — nó chỉ để lại một dòng ma vĩnh viễn trong tab Khôi Lỗi — nhưng nó đã xảy ra THẬT, và nó
 * thuộc đúng loại không tầng nào ở hạ nguồn bắt được: lượt chạy vẫn in「đã xoá sạch」rồi thoát 0.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  activeRunIds,
  chooseTarget,
  describeCandidate,
  describeEvidence,
  judgeRosterPurge,
  looksLikeKhoiloiRepoName,
  reviewRemoval,
  reviewRosterRow,
  workerIdFromWorkflow,
  PURGE_BUDGET_MS,
  PURGE_GAP_MS,
  PURGE_POLL_MS,
  PURGE_SETTLE_MS,
  type Candidate,
  type RosterRow,
} from "./githubKhoiloi.mts";
import { ALL_REPO_NAME_PREFIXES, REPO_NAME_PREFIX } from "./khoiloiNaming.mjs";

const repoRoot = path.join(import.meta.dirname, "..");
/** Bản mẫu workflow — NGOÀI `.github/workflows/` có chủ ý; xem nhóm「Kho gốc không chạy khôi lỗi」. */
const WORKFLOW_TEMPLATE = path.join(repoRoot, "deploy", "github", "linh-su.yml");
const WORKFLOW_DIR = path.join(repoRoot, ".github", "workflows");

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✔ ${label}`);
}

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  repo: `${REPO_NAME_PREFIX}-20260813-101112-ab12`,
  evidence: ["so"],
  workerId: "khoiloi-tro-20260813-101112",
  onGithub: true,
  ...over,
});

// ---- WORKER_ID từ tệp workflow ----------------------------------------------------------------
//
// Đây là thứ DUY NHẤT trả lời được「xoá kho này thì đàn nào chết」với một kho không có trong sổ.
// Trả về null nghĩa là lượt xoá phải dừng lại và đòi --force, nên một phép moi hụt không im lặng —
// nó biến một lượt xoá thường thành một lượt xoá mù.
{
  ok(workerIdFromWorkflow("          WORKER_ID: khoiloi-tro-abc\n") === "khoiloi-tro-abc", "đọc được dạng không nháy");
  ok(workerIdFromWorkflow(`  WORKER_ID: "co-nhay-kep"\n`) === "co-nhay-kep", "đọc được dạng nháy kép");
  ok(workerIdFromWorkflow("  WORKER_ID: 'co-nhay-don'\n") === "co-nhay-don", "đọc được dạng nháy đơn");
  ok(workerIdFromWorkflow("\t\tWORKER_ID: dung-tab\n") === "dung-tab", "thụt bằng tab cũng đọc được");
  ok(workerIdFromWorkflow("WORKER_ID: khong-thut\n") === "khong-thut", "không thụt lề cũng đọc được");

  // Tệp workflow thật MỞ ĐẦU bằng một khối chú thích nhắc tới WORKER_ID nhiều lần. Nuốt phải một
  // dòng chú thích là moi ra một id không tồn tại, rồi hỏi database về nó và nhận về số 0 đàn —
  // tức một lượt xoá mù mà lại trông như đã kiểm xong.
  ok(workerIdFromWorkflow("# WORKER_ID: trong-chu-thich\n") === null, "dòng chú thích KHÔNG bị nhận nhầm");
  ok(
    workerIdFromWorkflow("#   1. WORKER_ID phải KHÁC VM (`tong-mon-khoiloi`).\n") === null,
    "câu văn có chữ WORKER_ID nhưng không phải khai báo thì bỏ qua",
  );
  ok(workerIdFromWorkflow("  WORKER_ID: that# ghi chu\n") === "that", "chú thích đuôi dòng bị cắt khỏi giá trị");

  ok(workerIdFromWorkflow("  WORKER_MAX_JOBS: \"2\"\n") === null, "khoá khác tên thì không khớp");
  ok(workerIdFromWorkflow("  WORKER_ID:\n") === null, "khai báo rỗng trả null, không trả chuỗi rỗng");
  ok(workerIdFromWorkflow("") === null, "tệp rỗng trả null");

  /**
   * Đọc CHÍNH bản mẫu mà `newGithubKhoiloi.mjs` rải sang mọi kho nó dựng.
   *
   * Cố ý KHÔNG so với một giá trị cụ thể: id ấy đổi được (và vừa đổi ngày 13/08/2026). Thứ phải
   * đúng mãi mãi là「phép moi này chạy được trên tệp THẬT」— một phép thử chỉ dùng chuỗi tự bịa sẽ
   * vẫn xanh nguyên vào đúng ngày ai đó thêm dấu nháy hay đổi mức thụt lề trong tệp kia.
   */
  ok(existsSync(WORKFLOW_TEMPLATE), "bản mẫu workflow có mặt ở deploy/github/linh-su.yml");
  const real = readFileSync(WORKFLOW_TEMPLATE, "utf8");
  const fromReal = workerIdFromWorkflow(real);
  ok(fromReal !== null && fromReal.length > 0, `moi được WORKER_ID từ bản mẫu thật (${fromReal})`);
  ok(!fromReal!.startsWith("#"), "giá trị moi từ tệp thật không phải một mẩu chú thích");
}

// ---- Kho gốc KHÔNG chạy khôi lỗi ---------------------------------------------------------------
//
// Bản mẫu rời khỏi `.github/workflows/` ngày 13/08/2026. Lý do đầy đủ ở đầu tệp mẫu; gọn lại: kho
// gốc là kho CÔNG KHAI giữ mã nguồn, nên một workflow khôi lỗi ở đây đặt `WORKER_TOKEN` — chìa
// TOÀN CỤC — vào Secrets của nó và đổ nhật ký vĩnh viễn của một tiến trình cầm cookie game đã giải
// mã ra chỗ ai cũng đọc.
//
// Hàng rào ấy KHÔNG nằm trong một dòng mã nào — nó là một tệp KHÔNG có mặt. Loại hàng rào đó không
// tự bảo vệ được: một cú `git mv` ngược lại, hay một bản chép để「chạy thử một lượt rồi xoá」, dựng
// lại nó mà không ai thấy, và lượt `schedule` kế tiếp cứ thế lên ca.
//
// Nên canh theo NỘI DUNG, không theo tên tệp: đổi tên thành `khoi-loi.yml` thì kho gốc vẫn cày như
// thường, mà một phép kiểm bám vào cái tên vẫn xanh nguyên.
{
  ok(!existsSync(path.join(WORKFLOW_DIR, "linh-su.yml")), "kho gốc không có .github/workflows/linh-su.yml");

  const workflows = existsSync(WORKFLOW_DIR)
    ? readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/i.test(name))
    : [];
  for (const name of workflows) {
    const body = readFileSync(path.join(WORKFLOW_DIR, name), "utf8");
    ok(!/scripts[/\\]worker\.mjs/.test(body), `workflow「${name}」của kho gốc không gọi worker.mjs`);
  }
}

// ---- Bộ lọc tên -------------------------------------------------------------------------------
{
  ok(looksLikeKhoiloiRepoName(`${REPO_NAME_PREFIX}-20260813-101112-ab12`), "tên theo tiền tố hiện hành khớp");
  ok(looksLikeKhoiloiRepoName(`${REPO_NAME_PREFIX.toUpperCase()}-XYZ`), "so khớp KHÔNG phân biệt hoa thường");
  ok(!looksLikeKhoiloiRepoName("mot-kho-cua-nguoi-khac"), "tên lạ không lọt vào danh sách ứng viên");

  // Đây là lý do `ALL_REPO_NAME_PREFIXES` tồn tại: bỏ tiền tố cũ thì mọi kho dựng trước lượt đổi
  // tên tàng hình trước chính công cụ dọn của mình — và cảnh cần dọn nhất (kho rỗng dựng dở) lại
  // là cảnh KHÔNG có dòng nào trong sổ để bắt bằng đường khác.
  ok(ALL_REPO_NAME_PREFIXES.length >= 2, "danh sách tiền tố có cả tiền tố cũ, không chỉ tiền tố hiện hành");
  for (const prefix of ALL_REPO_NAME_PREFIXES) {
    ok(looksLikeKhoiloiRepoName(`${prefix}-gi-do`), `tiền tố「${prefix}」vẫn khoanh được vùng`);
  }
}

// ---- Chọn kho ---------------------------------------------------------------------------------
{
  const usable = candidate({ repo: "linh-su-mot" });
  const alsoUsable = candidate({ repo: "linh-su-hai", evidence: ["workflow"] });
  const noEvidence = candidate({ repo: "linh-su-ba", evidence: [] });

  const one = chooseTarget([usable], null);
  ok(one.ok && one.target.repo === "linh-su-mot", "đúng một ứng viên có bằng chứng thì chọn luôn, không hỏi");

  const many = chooseTarget([usable, alsoUsable], null);
  ok(!many.ok, "hai ứng viên mà không có --repo thì TỪ CHỐI, không đoán bừa");
  ok(!many.ok && many.message.includes("--repo"), "câu từ chối chỉ đúng lối thoát (--repo)");
  ok(!many.ok && many.message.includes("linh-su-hai"), "câu từ chối kể tên cả hai ứng viên");

  const none = chooseTarget([], null);
  ok(!none.ok, "không ứng viên nào thì dừng");

  const onlyJunk = chooseTarget([noEvidence], null);
  ok(!onlyJunk.ok, "kho trùng tên nhưng KHÔNG có bằng chứng thì không được tự động chọn");
  ok(!onlyJunk.ok && onlyJunk.message.includes("cố ý KHÔNG đụng tới"), "và nói rõ là cố ý bỏ qua, không phải sót");

  // `--repo` chọn được cả kho không bằng chứng — CÓ CHỦ Ý. Chặn ở đây thì lời từ chối sẽ là「không
  // tìm thấy」, một câu SAI và dẫn người ta đi tìm nhầm chỗ. Hàng rào thật nằm ở `reviewRemoval`,
  // nơi câu từ chối nói đúng cái sai: kho này không có bằng chứng nào.
  const named = chooseTarget([usable, noEvidence], "linh-su-ba");
  ok(named.ok && named.target.repo === "linh-su-ba", "--repo chọn được kho không bằng chứng, để reviewRemoval từ chối");

  const namedUpper = chooseTarget([usable], "LINH-SU-MOT");
  ok(namedUpper.ok, "--repo không phân biệt hoa thường (GitHub cũng vậy)");

  const missing = chooseTarget([usable], "khong-ton-tai");
  ok(!missing.ok, "--repo trỏ vào một cái tên không có thì dừng");
  ok(!missing.ok && missing.message.includes("linh-su-mot"), "và kể ra những kho đã soi được để người ta chọn lại");
}

// ---- HÀNG RÀO 1: không bằng chứng thì không xoá, --force KHÔNG mở được -------------------------
//
// Đây là chỗ duy nhất ngăn công cụ xoá kho của người lạ. Ca `force: true` bên dưới là phép thử
// quan trọng nhất của cả tệp: một cờ mang hai nghĩa («kệ đàn đang chạy» VÀ «kệ đây là kho của
// ai») là cách người ta xoá nhầm mà vẫn tin mình đang làm đúng việc mình định làm.
{
  const blank = candidate({ evidence: [], workerId: null });
  const refused = reviewRemoval({ candidate: blank, heldJobs: 0, force: false });
  ok(!refused.go, "không bằng chứng → từ chối");

  const stillRefused = reviewRemoval({ candidate: blank, heldJobs: 0, force: true });
  ok(!stillRefused.go, "không bằng chứng + --force → VẪN từ chối (đột biến: nới chỗ này là cho xoá kho người lạ)");
  ok(!stillRefused.go && stillRefused.message.includes("--force cũng không mở"), "và nói thẳng rằng --force không mở được");

  for (const evidence of [["so"], ["workflow"], ["trong"]] as Candidate["evidence"][]) {
    const one = reviewRemoval({ candidate: candidate({ evidence }), heldJobs: 0, force: false });
    ok(one.go, `một mình bằng chứng「${evidence[0]}」đã đủ để được xoá`);
  }

  /**
   * Gõ nhầm `--repo`: kho không có trên GitHub VÀ không có trong sổ. Cùng kết cục「từ chối」với ca
   * trên, nhưng việc phải làm tiếp thì khác hẳn — nên câu chữ phải khác. Câu「không có bằng chứng
   * nào」ở ca trên sẽ đẩy người ta đi soi quyền hạn hay tab Actions, sai hẳn hướng.
   */
  const typo = candidate({ repo: "go-nham-ten", evidence: [], onGithub: false, workerId: null });
  const missing = reviewRemoval({ candidate: typo, heldJobs: null, force: false });
  ok(!missing.go, "kho không tồn tại ở đâu cả → từ chối");
  ok(!missing.go && missing.message.includes("không có trên GitHub"), "và nói đúng cái sai: kho không tồn tại");
  ok(
    !missing.go && !missing.message.includes("KHÔNG có bằng chứng nào là kho khôi lỗi"),
    "KHÔNG dùng nhầm câu「không có bằng chứng」— hai ca ấy phải chỉ hai việc khác nhau",
  );
  ok(
    !reviewRemoval({ candidate: typo, heldJobs: null, force: true }).go,
    "gõ nhầm tên + --force vẫn từ chối (không có gì để xoá thì cờ nào cũng vậy)",
  );
}

// ---- HÀNG RÀO 2: không biết WORKER_ID thì không biết mình sắp giết ai --------------------------
{
  const unknown = candidate({ workerId: null, evidence: ["workflow"] });
  const blind = reviewRemoval({ candidate: unknown, heldJobs: null, force: false });
  ok(!blind.go, "chưa hỏi được đàn (thiếu worker id) → từ chối, không xoá mù");
  ok(!blind.go && blind.message.includes("--force"), "và chỉ ra --force là lối đi tiếp nếu đã soi tay");

  const forced = reviewRemoval({ candidate: unknown, heldJobs: null, force: true });
  ok(forced.go, "--force qua được hàng rào xoá-mù");

  // Kho RỖNG chưa từng chạy một dòng nào nên không giữ đàn của ai — bắt nó đi qua --force là bắt
  // gõ một cờ nguy hiểm cho một việc hoàn toàn an toàn, tức dạy người ta quen tay với cờ ấy.
  const empty = candidate({ workerId: null, evidence: ["trong"] });
  ok(reviewRemoval({ candidate: empty, heldJobs: null, force: false }).go, "kho rỗng thì không cần biết worker id");
}

// ---- HÀNG RÀO 3: đàn đang chạy ----------------------------------------------------------------
{
  const busy = reviewRemoval({ candidate: candidate(), heldJobs: 2, force: false });
  ok(!busy.go, "khôi lỗi đang giữ đàn → từ chối");
  ok(!busy.go && busy.message.includes("2 đàn"), "câu từ chối nói ĐÚNG SỐ đàn sắp chết, không nói chung chung");
  ok(!busy.go && busy.message.includes("3 phút"), "và nói ra cái giá: reapStaleJobs kết liễu sau 3 phút");

  ok(reviewRemoval({ candidate: candidate(), heldJobs: 2, force: true }).go, "--force qua được hàng rào đàn đang chạy");
  ok(reviewRemoval({ candidate: candidate(), heldJobs: 0, force: false }).go, "không giữ đàn nào → xoá được ngay");

  // Biên: 1 là số nhỏ nhất còn phải chặn. Một phép so `> 1` viết nhầm sẽ lọt đúng ca này, và nó là
  // ca THƯỜNG NHẤT — khôi lỗi GitHub có 2 ghế nên phần lớn thời gian nó giữ một hoặc hai đàn.
  ok(!reviewRemoval({ candidate: candidate(), heldJobs: 1, force: false }).go, "đúng MỘT đàn cũng đủ để chặn");
}

// ---- Huỷ lượt chạy Actions trước khi xoá kho --------------------------------------------------
//
// Bước này là thứ rút ngắn quãng thoi thóp của runner. Nó best-effort, nhưng phép LỌC thì không
// được sai: bỏ sót một lượt chạy đang sống là để nguyên đúng cái nguyên nhân sinh ra dòng ma.
{
  const ids = activeRunIds({
    workflow_runs: [
      { id: 1, status: "completed", conclusion: "success" },
      { id: 2, status: "in_progress" },
      { id: 3, status: "queued" },
      { id: 4, status: "waiting" },
      { id: 5, status: "completed", conclusion: "cancelled" },
    ],
  });
  ok(ids.join(",") === "2,3,4", "chỉ lấy lượt chạy CHƯA xong, đủ cả ba trạng thái sống");

  // Đây là lý do phép lọc là「khác completed」chứ không phải một danh sách trắng: GitHub đặt thêm
  // trạng thái theo thời gian, và một danh sách trắng thiếu tên sẽ bỏ sót mà không ai thấy.
  ok(
    activeRunIds({ workflow_runs: [{ id: 9, status: "mot_trang_thai_github_moi_dat_ra" }] }).length === 1,
    "một trạng thái sống MỚI của GitHub vẫn bị bắt (lọc theo「chưa xong」, không theo danh sách trắng)",
  );

  ok(activeRunIds({ workflow_runs: [] }).length === 0, "kho chưa chạy lượt nào → không có gì để huỷ");
  ok(activeRunIds(null).length === 0, "thân rỗng không làm ngã lượt xoá");
  ok(activeRunIds({}).length === 0, "thiếu khoá workflow_runs → mảng rỗng");
  ok(activeRunIds({ workflow_runs: "khong-phai-mang" }).length === 0, "workflow_runs sai kiểu → mảng rỗng");
  ok(activeRunIds([{ id: 1, status: "queued" }]).length === 0, "thân là mảng trần (sai hình) → mảng rỗng");

  // Một `undefined` lọt xuống đây sẽ thành `POST /actions/runs/undefined/cancel` — một lời gọi
  // rác mà GitHub trả 404, rồi lượt chạy in ra một cảnh báo chẳng ai hiểu.
  ok(
    activeRunIds({
      workflow_runs: [{ status: "queued" }, null, { id: "7", status: "queued" }, { id: Number.NaN, status: "queued" }, { id: 8, status: "queued" }],
    }).join(",") === "8",
    "dòng thiếu id / id sai kiểu / id NaN / null đều bị bỏ qua, không đẻ ra một URL rác",
  );
  ok(activeRunIds({ workflow_runs: [{ id: 3, status: 5 }] }).length === 0, "status sai kiểu thì không đoán bừa là đang sống");
}

// ---- VÒNG CANH SỔ ĐIỂM DANH -------------------------------------------------------------------
//
// Đây là phần đã HỎNG THẬT ngày 13/08/2026: kho xoá xong, sổ dọn xong, dòng `workers` xoá xong —
// rồi runner còn thoi thóp 52 giây tự ghi lại tên mình, để lại đúng cái dòng ma mà công cụ này
// sinh ra để dọn. Cả nhóm dưới đây là để lượt「dọn cho gọn」nào đó đừng biến vòng canh trở lại
// thành một câu DELETE.
{
  ok(PURGE_POLL_MS < PURGE_SETTLE_MS, "nhịp soi ngắn hơn cửa sổ yên — không thì một lượt hồi sinh lọt qua khe");
  // Sàn phải DƯƠNG (không thì cặp xoá-soi thành vòng quay nóng) và phải ngắn hơn một nhịp soi
  // (không thì nó thôi là sàn, nó thành nhịp — và lượt xác nhận sau khi xoá chậm đi vô cớ).
  ok(PURGE_GAP_MS > 0 && PURGE_GAP_MS < PURGE_POLL_MS, "sàn nghỉ giữa hai lượt chạm database dương và ngắn hơn một nhịp soi");
  ok(PURGE_SETTLE_MS < PURGE_BUDGET_MS, "ngân sách dài hơn cửa sổ yên — không thì không lượt nào kịp yên trước khi hết giờ");
  ok(PURGE_SETTLE_MS >= 6 * 5_000, "cửa sổ yên rộng gấp nhiều lần nhịp gõ cửa 5 giây của worker.mjs");

  // CA GỐC. Ngay sau `delete from workers`, dòng đương nhiên vắng — và bản đầu đã đọc cái vắng ấy
  // thành「xong」rồi đi. Nó không phải bằng chứng runner đã chết; nó chỉ là bằng chứng câu DELETE
  // vừa chạy.
  const justDeleted = judgeRosterPurge({ rowPresent: false, quietMs: 0, spentMs: 0 });
  ok(justDeleted.kind === "wait", "vắng NGAY SAU lượt xoá KHÔNG phải bằng chứng đã chết — phải canh tiếp");

  const back = judgeRosterPurge({ rowPresent: true, quietMs: 2_000, spentMs: 7_000 });
  ok(back.kind === "purge", "dòng mọc lại thì XOÁ LẠI — đúng cái bản đầu đã bỏ sót");

  const first = judgeRosterPurge({ rowPresent: true, quietMs: 3_000, spentMs: 0 });
  ok(first.kind === "purge", "lượt soi đầu thấy dòng thì cũng là「xoá」, vòng không cần một lối vào riêng");

  const quiet = judgeRosterPurge({ rowPresent: false, quietMs: PURGE_SETTLE_MS, spentMs: PURGE_SETTLE_MS });
  ok(quiet.kind === "settled", "im trọn cửa sổ → xong (biên: ĐÚNG bằng cũng tính là đủ)");

  const almost = judgeRosterPurge({ rowPresent: false, quietMs: PURGE_SETTLE_MS - 1, spentMs: 30_000 });
  ok(almost.kind === "wait", "thiếu một mili giây cũng chưa được gọi là xong");
  ok(almost.kind === "wait" && almost.ms === 1, "và chỉ chờ đúng phần còn thiếu, không ngủ thừa một nhịp");

  const fresh = judgeRosterPurge({ rowPresent: false, quietMs: 0, spentMs: 1_000 });
  ok(fresh.kind === "wait" && fresh.ms === PURGE_POLL_MS, "còn xa mốc yên thì chờ một nhịp, không ngủ một mạch hết cửa sổ");

  // Xác nguội: gỡ một dòng đã chết từ hôm qua thì lượt soi đầu tiên đã đủ kết luận. Bắt người vận
  // hành ngồi đợi 30 giây cho một cái xác nguội ngắt là cái giá không có ai trả cho.
  const cold = judgeRosterPurge({ rowPresent: false, quietMs: 86_400_000, spentMs: 40 });
  ok(cold.kind === "settled", "dòng đã im từ lâu → xong ngay, không bắt đợi hết cửa sổ");

  const forever = judgeRosterPurge({ rowPresent: true, quietMs: 1_000, spentMs: PURGE_BUDGET_MS });
  ok(forever.kind === "giveup", "hết ngân sách mà vẫn mọc lại → dừng canh, xoá thêm cũng vô nghĩa");
  ok(
    forever.kind === "giveup" && forever.message.includes("WORKER_ID"),
    "và gọi tên nghi phạm thật: một máy KHÁC đang cài trùng WORKER_ID",
  );
  // Lời khuyên phải ĐI ĐƯỢC. Kho đã xoá và dòng sổ đã gỡ, nên chạy lại chính lệnh này sẽ bị
  // `reviewRemoval` từ chối vì「không có bằng chứng nào」— hứa một lối thoát cụt là tệ hơn im lặng.
  ok(
    forever.kind === "giveup" && forever.message.includes("không phải chạy lại lệnh này"),
    "và KHÔNG hứa một lối thoát cụt (chạy lại lệnh này thì reviewRemoval sẽ từ chối)",
  );

  const blownWhileAway = judgeRosterPurge({ rowPresent: false, quietMs: 3_000, spentMs: PURGE_BUDGET_MS });
  ok(blownWhileAway.kind === "giveup", "hết ngân sách trong lúc nó vừa gõ cửa xong → cũng dừng");
  ok(
    blownWhileAway.kind === "giveup" && blownWhileAway.message.includes("vừa soi thì vắng"),
    "và kể đúng trạng thái lúc dừng, không nói bừa là dòng vẫn còn đó",
  );

  // Đã yên thì là xong, kể cả khi đồng hồ đã quá giờ: kết một lượt sạch sẽ bằng một lời cảnh báo
  // là dạy người vận hành bỏ qua cảnh báo.
  const doneAtBuzzer = judgeRosterPurge({
    rowPresent: false,
    quietMs: PURGE_SETTLE_MS,
    spentMs: PURGE_BUDGET_MS + 5_000,
  });
  ok(doneAtBuzzer.kind === "settled", "yên thắng hết-giờ ở đúng cái biên hai luật gặp nhau");

  // `quietMs` gộp một quãng do database đo với một quãng đo bằng đồng hồ cục bộ. Hai đồng hồ lệch
  // nhau thì con số ấy ra âm được, và một lượt ngủ âm là một vòng lặp quay nóng CPU.
  const skewed = judgeRosterPurge({ rowPresent: false, quietMs: -60_000, spentMs: 0 });
  ok(
    skewed.kind === "wait" && skewed.ms > 0 && skewed.ms <= PURGE_POLL_MS,
    "quãng im ÂM (đồng hồ lệch) không đẻ ra một lượt ngủ âm",
  );
}

// ---- Câu chữ kể cho người đọc -----------------------------------------------------------------
{
  const gone = candidate({ onGithub: false, evidence: ["so"] });
  ok(describeEvidence(gone).includes("ĐÃ KHÔNG CÒN"), "kho đã bị xoá tay vẫn được nói rõ là chỉ còn phần dọn sổ");
  ok(describeCandidate(gone).startsWith(gone.repo), "dòng kể ứng viên mở đầu bằng tên kho");
  ok(describeCandidate(gone).includes(gone.workerId!), "và kèm worker id để đối chiếu với tab Khôi Lỗi");
  ok(describeEvidence(candidate({ evidence: [] })).includes("KHÔNG có bằng chứng"), "kho không bằng chứng nói thẳng ra");
}

// ---- Luật DỌN SỔ ĐIỂM DANH (`roster:purge`) ---------------------------------------------------
//
// Bốn hàng rào, và hai trong số chúng bảo vệ những thứ rất khác nhau: hàng rào「đang giữ đàn」canh
// một tiến trình đang làm việc, còn hàng rào「có trong sổ」canh một CÁI TÊN còn được dùng. Runner
// đang giữa hai lượt Actions trông y hệt một cái xác, nên bỏ hàng rào sau là mở đường cho
// `github:new` dựng một khôi lỗi trùng id.
{
  const NGUONG = 24 * 60 * 60 * 1000;
  const row = (over: Partial<RosterRow> = {}): RosterRow => ({
    id: "khoiloi-tro-xyz",
    userId: null,
    quietMs: 30 * 60 * 60 * 1000,
    heldJobs: 0,
    ...over,
  });
  const xet = (r: RosterRow, book: string[] = [], force = false) =>
    reviewRosterRow({ row: r, bookWorkerIds: new Set(book), quietThresholdMs: NGUONG, force });

  ok(xet(row()).purge, "dòng tông môn im 30 giờ, không kho nào nhận → GỠ");
  ok(!xet(row({ quietMs: 60_000 })).purge, "mới im 1 phút → giữ");
  ok(!xet(row({ userId: "u1" })).purge, "khôi lỗi RIÊNG → không đụng, chủ nó tự gỡ");
  ok(!xet(row({ heldJobs: 1 })).purge, "đang giữ đàn → giữ, dù đã im rất lâu");
  ok(!xet(row({ heldJobs: 2, quietMs: 400 * 24 * 60 * 60 * 1000 }), [], true).purge,
    "--force KHÔNG mở được hàng rào đàn — một cờ mở được nó là một cờ để tự bắn vào chân");
  ok(!xet(row(), ["khoiloi-tro-xyz"]).purge, "có trong sổ Kho GitHub → giữ (runner đang giữa hai lượt Actions)");
  ok(xet(row(), ["khoiloi-tro-xyz"], true).purge, "--force mở được đúng hàng rào sổ");
  ok(!xet(row({ quietMs: 60_000 }), ["khoiloi-tro-xyz"], true).purge,
    "--force vẫn KHÔNG bỏ qua ngưỡng im lặng — hai hàng rào độc lập");

  // Ca thật đã đo 14/08/2026: hai dòng tông môn im 4 giờ và 12,7 giờ, không nằm trong sổ. Với
  // ngưỡng mặc định 24 giờ thì CẢ HAI đều chưa tới lượt — đó là hành vi đúng, và là lý do có
  // `--older-than`.
  ok(!xet(row({ quietMs: 12.7 * 60 * 60 * 1000 })).purge, "im 12,7 giờ vẫn dưới ngưỡng mặc định 24 giờ");
  ok(
    reviewRosterRow({
      row: row({ quietMs: 12.7 * 60 * 60 * 1000 }),
      bookWorkerIds: new Set(),
      quietThresholdMs: 6 * 60 * 60 * 1000,
      force: false,
    }).purge,
    "hạ ngưỡng xuống 6 giờ thì chính dòng ấy được gỡ",
  );

  ok(xet(row()).why.includes("giờ"), "lời phán của ca GỠ nói ra nó đã im bao lâu");
  ok(xet(row({ heldJobs: 3 })).why.includes("3"), "lời phán của ca GIỮ nói ra đang giữ mấy đàn");
}

console.log(`\n✔ ${passed} phép kiểm — luật xoá kho khôi lỗi còn nguyên.`);
