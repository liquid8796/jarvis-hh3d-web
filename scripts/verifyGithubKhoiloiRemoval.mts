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
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  chooseTarget,
  describeCandidate,
  describeEvidence,
  looksLikeKhoiloiRepoName,
  reviewRemoval,
  workerIdFromWorkflow,
  type Candidate,
} from "./githubKhoiloi.mts";
import { ALL_REPO_NAME_PREFIXES, REPO_NAME_PREFIX } from "./khoiloiNaming.mjs";

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
   * Đọc CHÍNH tệp workflow mà `newGithubKhoiloi.mjs` rải sang mọi kho nó dựng.
   *
   * Cố ý KHÔNG so với một giá trị cụ thể: id ấy đổi được (và vừa đổi ngày 13/08/2026). Thứ phải
   * đúng mãi mãi là「phép moi này chạy được trên tệp THẬT」— một phép thử chỉ dùng chuỗi tự bịa sẽ
   * vẫn xanh nguyên vào đúng ngày ai đó thêm dấu nháy hay đổi mức thụt lề trong tệp kia.
   */
  const real = readFileSync(path.join(import.meta.dirname, "..", ".github", "workflows", "linh-su.yml"), "utf8");
  const fromReal = workerIdFromWorkflow(real);
  ok(fromReal !== null && fromReal.length > 0, `moi được WORKER_ID từ workflow thật của repo (${fromReal})`);
  ok(!fromReal!.startsWith("#"), "giá trị moi từ tệp thật không phải một mẩu chú thích");
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

// ---- Câu chữ kể cho người đọc -----------------------------------------------------------------
{
  const gone = candidate({ onGithub: false, evidence: ["so"] });
  ok(describeEvidence(gone).includes("ĐÃ KHÔNG CÒN"), "kho đã bị xoá tay vẫn được nói rõ là chỉ còn phần dọn sổ");
  ok(describeCandidate(gone).startsWith(gone.repo), "dòng kể ứng viên mở đầu bằng tên kho");
  ok(describeCandidate(gone).includes(gone.workerId!), "và kèm worker id để đối chiếu với tab Khôi Lỗi");
  ok(describeEvidence(candidate({ evidence: [] })).includes("KHÔNG có bằng chứng"), "kho không bằng chứng nói thẳng ra");
}

console.log(`\n✔ ${passed} phép kiểm — luật xoá kho khôi lỗi còn nguyên.`);
