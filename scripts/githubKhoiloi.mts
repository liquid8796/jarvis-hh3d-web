/**
 * Sự thật THUẦN về kho khôi lỗi GitHub — không mạng, không database, dùng chung bởi lượt DỰNG
 * (`newGithubStation.mts`) và lượt XOÁ (`removeGithubKhoiloi.mts`).
 *
 * VÌ SAO TÁCH RA: hai lượt ấy phải đồng ý với nhau về đúng một câu hỏi — «kho nào là kho khôi
 * lỗi» — và câu trả lời ấy quyết định một lệnh XOÁ. Chép nó ở hai nơi là hẹn ngày lượt xoá nhận
 * nhầm, mà nhận nhầm ở đây nghĩa là xoá kho của người khác. Cùng lối với `deployTargets.mts`:
 * phần dễ sai nhất là phần thuần, nên nó sống riêng và `verify:github-removal` bao từng nhánh.
 *
 * LUẬT ĐẶT TÊN thì KHÔNG ở đây — nó ở `khoiloiNaming.mjs`, và phải là `.mjs` vì
 * `newGithubKhoiloi.mjs` chạy bằng `node` trần nên không nhập nổi TypeScript. Tệp này chỉ ĐỌC
 * danh sách tiền tố từ bên ấy.
 */
import { ALL_REPO_NAME_PREFIXES } from "./khoiloiNaming.mjs";

/**
 * BẰNG CHỨNG một kho là kho khôi lỗi. Ba thứ, và mỗi thứ đứng một mình đã đủ:
 *
 *   • `so`       — kho có mặt trong sổ Kho GitHub của trạm đang hoạt động. Chắc chắn nhất: chính
 *                  tông môn đã ghi nó vào. Đây cũng là bằng chứng DUY NHẤT còn lại khi kho đã bị
 *                  xoá tay trên GitHub mà dòng sổ còn nằm đó.
 *   • `workflow` — kho có thật tệp `.github/workflows/<workflowFile>`. Đây là thứ LÀM NÊN một
 *                  khôi lỗi; kho nào có nó thì đang (hoặc từng) trực ca.
 *   • `trong`    — kho RỖNG (chưa commit nào) và tên khớp tiền tố. Đúng một cảnh sinh ra nó:
 *                  `gh repo create --push` tạo được kho rồi chết ở lượt push, để lại một kho công
 *                  khai không mã, không secret, không ai biết. `newGithubStation.mts` bảo người
 *                  vận hành «vào GitHub xoá nó đi» — đây là chỗ làm hộ việc ấy.
 *
 * KHÔNG có bằng chứng nào là KHÔNG được xoá, kể cả khi tên khớp tiền tố tuyệt đối và kể cả khi
 * người vận hành gõ `--force`. Tên là thứ ai cũng đặt được; một kho tên `auto-hh3d-linh-su-cua-toi`
 * do người khác dựng vẫn là kho của người khác.
 */
export type Evidence = "so" | "workflow" | "trong";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  so: "có trong sổ Kho GitHub",
  workflow: "có tệp workflow khôi lỗi",
  trong: "kho rỗng, tên khớp tiền tố",
};

export type Candidate = {
  repo: string;
  /** Rỗng = KHÔNG phải kho khôi lỗi, dù đã lọt vào danh sách vì tên. */
  evidence: Evidence[];
  /**
   * `WORKER_ID` của kho, suy từ sổ hoặc từ chính tệp workflow. `null` = chưa suy được, và đó
   * KHÔNG phải chuyện nhỏ — thiếu nó thì không hỏi được database xem khôi lỗi này có đang giữ
   * đàn nào không. Xem `reviewRemoval`.
   */
  workerId: string | null;
  /** Kho còn tồn tại trên GitHub không. `false` = dòng sổ mồ côi, chỉ còn phần dọn sổ để làm. */
  onGithub: boolean;
};

/**
 * Tên kho có khớp khuôn mà một bản dựng NÀO ĐÓ từng đặt không — bộ lọc rẻ, KHÔNG phải bằng chứng.
 *
 * Hỏi CẢ tiền tố cũ (`ALL_REPO_NAME_PREFIXES`, không chỉ tiền tố hiện hành), vì đây là bộ lọc để
 * đi TÌM kho phải dọn: bỏ tiền tố cũ đi là làm mọi kho dựng trước lượt đổi tên tàng hình trước
 * chính công cụ dọn của mình. Nới bộ lọc thì an toàn theo đúng thiết kế — tiền tố chưa bao giờ là
 * giấy phép xoá, `Evidence` mới là (xem `reviewRemoval`).
 */
export function looksLikeKhoiloiRepoName(repo: string): boolean {
  const lower = repo.toLowerCase();
  return ALL_REPO_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Moi `WORKER_ID` ra khỏi nội dung tệp workflow.
 *
 * Đọc từ CHÍNH tệp trong kho chứ không đoán theo tên kho, vì hai cái tên ấy chỉ trùng mốc thời
 * gian ở những kho do `newGithubStation.mts` dựng — kho dựng tay bằng `newGithubKhoiloi.mjs
 * --worker-id` thì không có quan hệ nào. Và đây là thứ DUY NHẤT trả lời được câu hỏi «xoá kho này
 * thì đàn nào chết» với một kho không có trong sổ.
 *
 * Chịu được cả ba dạng YAML hợp lệ (`x`, `"x"`, `'x'`) vì chính tệp workflow của repo web trộn cả
 * hai lối: `WORKER_ID: github-khoiloi` không nháy, `WORKER_MAX_JOBS: "2"` có nháy. Dòng chú thích
 * không lọt được: `^[ \t]*` không nuốt dấu `#`.
 */
export function workerIdFromWorkflow(yaml: string): string | null {
  const found = /^[ \t]*WORKER_ID:[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))/m.exec(yaml);
  if (!found) return null;
  const value = (found[1] ?? found[2] ?? found[3] ?? "").trim();
  return value.length > 0 ? value : null;
}

/**
 * Id của những lượt chạy Actions CÒN SỐNG trong một trang `GET /repos/…/actions/runs`.
 *
 * Lọc bằng `status !== "completed"` chứ KHÔNG liệt kê tên từng trạng thái sống (`queued`,
 * `in_progress`, `waiting`, `pending`, `requested`…): danh sách ấy dài dần theo GitHub, và một
 * danh sách trắng thiếu tên sẽ lặng lẽ bỏ sót đúng cái lượt chạy phải huỷ — hỏng theo kiểu không
 * ai thấy, vì lượt xoá vẫn báo xong.「Chưa xong」thì định nghĩa được một lần cho mãi mãi.
 *
 * Thân trả về là thứ ĐI QUA MẠNG nên ở đây không tin gì cả: thiếu khoá, sai kiểu, `id` không phải
 * số — tất cả cùng bị bỏ qua, vì một `undefined` lọt xuống sẽ thành `POST /actions/runs/undefined/cancel`.
 */
export function activeRunIds(body: unknown): number[] {
  const runs = (body as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(runs)) return [];

  const ids: number[] = [];
  for (const run of runs) {
    const id = (run as { id?: unknown } | null)?.id;
    const status = (run as { status?: unknown } | null)?.status;
    if (typeof status !== "string" || status === "completed") continue;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * ── VÒNG CANH SỔ ĐIỂM DANH ────────────────────────────────────────────────────────────────────
 *
 * XOÁ KHO KHÔNG GIẾT RUNNER TỨC KHẮC — và bước dọn sổ điểm danh đã tin là có. Đo 13/08/2026 trên
 * `github-khoiloi-20260813-105506`: kho đã trả 404, mà runner còn gõ cửa `/api/worker` thêm 52
 * giây nữa. `recordWorkerSeen` là một câu `insert … on conflict do update` — nó không hỏi「tôi
 * còn được phép tồn tại không」, nó chỉ ghi tên. Nên chưa đầy một nhịp sau câu `delete from
 * workers`, dòng ấy tự mọc lại. Bằng chứng nằm ở `first_seen` của nó: 14:39:35, trong khi cái tên
 * khai 10:55:06 — tức dòng người ta nhìn thấy KHÔNG phải dòng cũ sót lại, nó là dòng mới.
 *
 * Và cái xác ấy nằm lại VĨNH VIỄN: sổ điểm danh là sổ ĐĂNG KÝ chứ không phải danh sách tiến
 * trình, không ai quét dọn dòng của khôi lỗi tông môn (`forgetWorker` chỉ gỡ được khôi lỗi RIÊNG,
 * nó lọc theo `userId`).
 *
 * Nên bước cuối không phải một câu DELETE mà là một vòng canh: xoá, rồi soi lại cho tới khi
 * KHÔNG còn dòng nào mọc lên suốt trọn `PURGE_SETTLE_MS`.
 */

/**
 * Im bao lâu thì coi là runner đã tắt hẳn.
 *
 * Điều kiện đúng đắn là「DÀI HƠN NHỊP GÕ CỬA」, không phải một con số cho đẹp: một runner còn
 * sống thì cứ mỗi `WORKER_POLL_MS` (mặc định 5 giây, `scripts/worker.mjs`, không kho nào ghi đè)
 * là chèn lại dòng của nó, nên 30 giây im lặng loại trừ được mọi nhịp dưới 30 giây — kể cả một
 * máy bị chỉnh chậm gấp năm. Dòng một khi đã chèn thì NẰM ĐÓ chờ được soi, nên không lượt gõ cửa
 * nào lọt qua khe giữa hai lượt soi.
 */
export const PURGE_SETTLE_MS = 30_000;

/** Nhịp soi lại — bằng đúng nhịp gõ cửa, để một lượt hồi sinh bị bắt trong vòng một nhịp. */
export const PURGE_POLL_MS = 5_000;

/**
 * Khoảng nghỉ tối thiểu sau mỗi lượt xoá, trước khi soi lại.
 *
 * Vòng canh soi lại NGAY sau khi xoá (không đợi hết nhịp) để chốt sớm ca thường: xoá xong, thấy
 * vắng, bắt đầu đếm giờ im. Nhưng「ngay」mà không có sàn thì mở ra một vòng quay nóng: nếu vì lý
 * do nào đó câu DELETE không làm dòng biến mất, cặp xoá-soi ấy sẽ nện database mấy trăm lượt mỗi
 * giây suốt trọn 3 phút ngân sách. Một phần tư giây chặn đứng cả lớp ấy mà không ai cảm thấy.
 */
export const PURGE_GAP_MS = 250;

/**
 * Trần thời gian canh. Hết ngân sách mà dòng VẪN mọc lại thì thủ phạm không còn là cái runner vừa
 * mất kho (đo được: 52 giây) — nó là một tiến trình KHÁC đang cài trùng `WORKER_ID`, và với thứ
 * ấy thì xoá bao nhiêu lần cũng vô nghĩa, nên đúng việc phải làm là kêu lên chứ không phải xoá
 * tiếp. 3 phút, cùng con số với `reapStaleJobs`.
 */
export const PURGE_BUDGET_MS = 180_000;

export type PurgeTiming = {
  settleMs: number;
  pollMs: number;
  gapMs: number;
  budgetMs: number;
};

/**
 * Bốn con số thật, gói lại thành một thứ TRUYỀN VÀO ĐƯỢC — và cái cửa ấy mở ra vì đúng một lý do,
 * nói thẳng ở đây để không ai tưởng nó là chỗ để chỉnh cho vừa ý.
 *
 * Phần chưa được kiểm của vòng canh không phải bốn con số (chúng đã bị `verify:github-removal`
 * đóng đinh bằng đồng hồ giả) mà là ĐOẠN DÂY nối chúng với database: phép ghi sổ `lastBeat`, phép
 * cộng hai quãng đo bằng hai đồng hồ, phép xử từng phán quyết. Muốn chạy đoạn dây ấy trên một
 * database thật thì phải chạy nó cho tới lúc YÊN — mà với 30 giây yên và 3 phút ngân sách thì bốn
 * ca kiểm là hơn năm phút, tức một phép kiểm không ai chạy lần thứ hai.
 *
 * Nên `verify:roster-purge` ép cùng đoạn dây ấy qua một đồng hồ rút gọn. Nó KHÔNG kiểm bốn con số
 * dưới đây — chỗ ấy đã có phép kiểm riêng — nó kiểm rằng cái vòng dùng chúng đúng cách.
 */
export const PRODUCTION_TIMING: PurgeTiming = {
  settleMs: PURGE_SETTLE_MS,
  pollMs: PURGE_POLL_MS,
  gapMs: PURGE_GAP_MS,
  budgetMs: PURGE_BUDGET_MS,
};

export type PurgeVerdict =
  /** Sổ đã sạch và chịu nằm im — xong. */
  | { kind: "settled" }
  /** Có dòng đang nằm đó (lượt đầu, hoặc một lượt hồi sinh) — xoá rồi soi lại ngay. */
  | { kind: "purge" }
  /** Đang vắng nhưng chưa đủ lâu để tin — ngủ chừng này rồi soi lại. */
  | { kind: "wait"; ms: number }
  /** Xoá mãi vẫn mọc lại — dừng canh và nói ra, vì xoá thêm cũng vô nghĩa. */
  | { kind: "giveup"; message: string };

/**
 * Bước kế tiếp của vòng canh. Thuần, nên `verify:github-removal` lái được nó bằng đồng hồ giả.
 *
 * `quietMs` là quãng im tính từ LẦN GÕ CỬA CUỐI CÙNG đo được, KHÔNG phải quãng đã canh — hai thứ
 * ấy khác nhau ở đúng ca thường gặp nhất: gỡ một dòng đã chết từ hôm qua thì lượt soi đầu tiên đã
 * đủ kết luận, không việc gì bắt người vận hành ngồi đợi 30 giây cho một cái xác nguội ngắt.
 *
 * `settled` được xét TRƯỚC ngân sách, và thứ tự ấy có chủ ý: đã xong thì là xong, không ai muốn
 * một lượt chạy sạch sẽ lại kết bằng lời cảnh báo chỉ vì nó chạm đúng giây thứ 180.
 */
export function judgeRosterPurge(input: {
  /** Lượt soi vừa rồi CÓ thấy dòng không. */
  rowPresent: boolean;
  quietMs: number;
  /** Đã canh bao lâu, tính từ lúc vào vòng. */
  spentMs: number;
  /** Vắng mặt = đồng hồ thật. Chỉ `verify:roster-purge` truyền vào — xem `PRODUCTION_TIMING`. */
  timing?: PurgeTiming;
}): PurgeVerdict {
  const { rowPresent, quietMs, spentMs } = input;
  const { settleMs, pollMs, budgetMs } = input.timing ?? PRODUCTION_TIMING;

  if (!rowPresent && quietMs >= settleMs) return { kind: "settled" };

  if (spentMs >= budgetMs) {
    return {
      kind: "giveup",
      message:
        `Dòng điểm danh cứ mọc lại — đã canh ${Math.round(spentMs / 1000)} giây mà vẫn có thứ gõ cửa ` +
        `bằng id ấy (${rowPresent ? "vừa soi vẫn còn" : `vừa soi thì vắng, nhưng nó mới gõ cửa ${Math.round(quietMs / 1000)} giây trước`}).\n` +
        "  Kho GitHub đã xoá rồi, nên đây KHÔNG còn là runner của nó: gần như chắc chắn một khôi lỗi\n" +
        "  KHÁC (VM tông môn, hay một máy nhà) đang cài trùng WORKER_ID. Xoá dòng ở đây vô nghĩa —\n" +
        "  vài giây sau nó lại tự ghi tên vào.\n" +
        "  Soi ở Hàng Đợi → tab Khôi Lỗi: id ấy còn hiện「đang trực」thì đúng là còn một máy sống,\n" +
        "  và việc phải làm là đi tắt máy ấy, không phải chạy lại lệnh này.",
    };
  }

  if (rowPresent) return { kind: "purge" };

  /**
   * Chờ vừa đủ tới mốc yên, nhưng KHÔNG quá một nhịp gõ cửa: ngủ một mạch 30 giây thì một lượt
   * hồi sinh ở giây thứ hai cũng phải đợi hết quãng ấy mới bị phát hiện, và trong quãng đó ngân
   * sách vẫn trôi. Cả hai vế đều dương nên không có đường nào ra số âm.
   */
  return { kind: "wait", ms: Math.min(pollMs, settleMs - quietMs) };
}

export type Choice = { ok: true; target: Candidate } | { ok: false; message: string };

/** Vì sao kho này được coi (hay không được coi) là kho khôi lỗi — một vế, không kèm tên kho. */
export function describeEvidence(candidate: Candidate): string {
  const why =
    candidate.evidence.length === 0
      ? "KHÔNG có bằng chứng nào"
      : candidate.evidence.map((e) => EVIDENCE_LABEL[e]).join(" · ");
  return candidate.onGithub ? why : `${why} · ĐÃ KHÔNG CÒN trên GitHub`;
}

/** Một dòng kể một ứng viên cho người đọc — dùng chung giữa bảng kế hoạch và các câu từ chối. */
export function describeCandidate(candidate: Candidate): string {
  const who = candidate.workerId ? ` · ${candidate.workerId}` : "";
  return `${candidate.repo} (${describeEvidence(candidate)}${who})`;
}

/**
 * Chọn ĐÚNG MỘT kho để xoá.
 *
 * MỘT KHO MỖI LƯỢT, có chủ ý: mỗi lượt xoá đòi gõ lại tên kho để xác nhận, và một câu xác nhận
 * gộp cho nhiều kho là thứ người ta gõ qua quýt. Tài khoản có ba kho rác thì chạy ba lượt — tốn
 * hơn đúng hai câu lệnh, đổi lấy việc mỗi lượt xoá đều nhìn thấy tên thứ mình sắp xoá.
 *
 * Vắng `wanted` mà có đúng một ứng viên thì chọn luôn: đó là cảnh THƯỜNG (một tài khoản một khôi
 * lỗi), và bắt gõ lại một cái tên vừa in ra ngay phía trên là bắt làm việc thừa.
 */
export function chooseTarget(candidates: readonly Candidate[], wanted: string | null): Choice {
  const usable = candidates.filter((c) => c.evidence.length > 0);

  if (wanted) {
    const named = candidates.find((c) => c.repo.toLowerCase() === wanted.toLowerCase());
    if (!named) {
      return {
        ok: false,
        message:
          `Không thấy kho「${wanted}」trên tài khoản này, mà sổ cũng không có dòng nào mang tên ấy.\n` +
          (candidates.length > 0
            ? `  Những kho đã soi được:\n${candidates.map((c) => `    · ${describeCandidate(c)}`).join("\n")}`
            : "  Không soi được kho khôi lỗi nào trên tài khoản này."),
      };
    }
    return { ok: true, target: named };
  }

  if (usable.length === 1) return { ok: true, target: usable[0] };

  if (usable.length === 0) {
    return {
      ok: false,
      message:
        "Không có kho khôi lỗi nào trên tài khoản này — không còn gì để xoá.\n" +
        (candidates.length > 0
          ? `  (${candidates.length} kho có tên giống nhưng không đủ bằng chứng, cố ý KHÔNG đụng tới:\n` +
            `${candidates.map((c) => `    · ${describeCandidate(c)}`).join("\n")})`
          : "  Sổ Kho GitHub cũng không có dòng nào của tài khoản này."),
    };
  }

  return {
    ok: false,
    message:
      `Tài khoản này có ${usable.length} kho khôi lỗi — không đoán bừa cái nào. Chọn bằng --repo:\n` +
      `${usable.map((c) => `    · ${describeCandidate(c)}`).join("\n")}`,
  };
}

export type Review = { go: true } | { go: false; message: string };

/**
 * GO / NO-GO cuối cùng. Ba hàng rào, và chỉ hàng rào thứ ba nhường bước trước `--force`.
 *
 * 1. KHÔNG BẰNG CHỨNG THÌ KHÔNG XOÁ, và `--force` không mở được hàng rào này. Đây là chỗ duy
 *    nhất ngăn công cụ xoá kho của người lạ, nên nó không được phép có nút bỏ qua: một cờ mang
 *    hai nghĩa («kệ đàn đang chạy» và «kệ đây là kho của ai») là cách người ta xoá nhầm mà vẫn
 *    tin mình đang làm đúng việc mình định làm.
 *
 * 2. KHÔNG BIẾT WORKER_ID THÌ KHÔNG BIẾT MÌNH SẮP GIẾT AI. Không suy được id thì câu hỏi «đàn nào
 *    đang chạy trên kho này» không có câu trả lời, và xoá trong lúc mù chính là ca tệ nhất bên
 *    dưới. Kho RỖNG là ngoại lệ đúng đắn: nó chưa từng chạy một dòng nào nên không giữ đàn của ai.
 *
 * 3. ĐÀN ĐANG CHẠY THÌ DỪNG. Xoá kho là giết runner tức khắc; nhịp tim tắt, và ba phút sau
 *    `reapStaleJobs` kết liễu đàn ấy thành `failed` với dòng「Khôi lỗi mất liên lạc」. Người mất
 *    một vòng cày là một đạo hữu nào đó, không phải người đang gõ lệnh — nên cái giá phải được
 *    NÓI RA trước, chứ không để họ phát hiện. `--force` qua được, và đó là đúng vai của nó.
 */
export function reviewRemoval(input: {
  candidate: Candidate;
  /** Số đàn `running`/`stopping` khôi lỗi này đang giữ. `null` = CHƯA hỏi được (thiếu workerId). */
  heldJobs: number | null;
  force: boolean;
}): Review {
  const { candidate, heldJobs, force } = input;

  if (candidate.evidence.length === 0) {
    /**
     * Kho không có trên GitHub VÀ cũng không có trong sổ = nó không tồn tại ở đâu cả. Gần như luôn
     * là một cú gõ nhầm `--repo`, và câu「không có bằng chứng nào」ở dưới sẽ đẩy người ta đi tìm
     * quyền hạn hay đi soi tab Actions — sai hẳn hướng. Tách ra vì hai ca này chỉ giống nhau ở
     * kết cục, không giống nhau ở việc phải làm tiếp.
     */
    if (!candidate.onGithub) {
      return {
        go: false,
        message:
          `Kho「${candidate.repo}」không có trên GitHub, mà sổ cũng không có dòng nào cho nó.\n` +
          "  Không còn gì để xoá — gõ nhầm tên chăng? Bỏ --repo đi để xem danh sách kho soi được.",
      };
    }
    return {
      go: false,
      message:
        `Kho「${candidate.repo}」KHÔNG có bằng chứng nào là kho khôi lỗi:\n` +
        "  không có trong sổ, không có tệp workflow, và không phải một kho rỗng dựng dở.\n" +
        "  Từ chối xoá — và --force cũng không mở hàng rào này. Nếu đây thật sự là kho của tông môn\n" +
        "  thì vào GitHub xoá tay, để công cụ này không phải học cách đoán.",
    };
  }

  if (heldJobs === null) {
    // Kho rỗng chưa từng chạy nên không giữ đàn của ai — không cần biết id cũng đã trả lời xong.
    if (candidate.evidence.includes("trong")) return { go: true };
    if (!force) {
      return {
        go: false,
        message:
          `Không suy ra được WORKER_ID của kho「${candidate.repo}」nên KHÔNG hỏi được database xem\n` +
          "  nó có đang giữ đàn nào không. Xoá lúc này là xoá mù.\n" +
          "  Soi tay ở Hàng Đợi → tab Khôi Lỗi rồi chạy lại với --force nếu chắc chắn không ai đang cày.",
      };
    }
    return { go: true };
  }

  if (heldJobs > 0 && !force) {
    return {
      go: false,
      message:
        `Khôi lỗi「${candidate.workerId ?? candidate.repo}」ĐANG GIỮ ${heldJobs} đàn.\n` +
        "  Xoá kho là giết runner tức khắc: nhịp tim tắt, rồi reapStaleJobs kết liễu chúng sau\n" +
        // Con số 3 phút viết bằng CHỮ SỐ để trùng đúng câu mà đàn sẽ mang trong nhật ký —
        //「Khôi lỗi mất liên lạc (quá 3 phút không hồi đáp)」— nên người đọc log nhận ra ngay
        // đây chính là thứ mình vừa gây ra.
        `  3 phút, thành「thất bại」— mất trọn một vòng của ${heldJobs === 1 ? "một" : heldJobs} đạo hữu, không phải của bạn.\n` +
        "  Chờ chúng cày xong (mục Hàng Đợi), hoặc chạy lại với --force nếu chấp nhận cái giá ấy.",
    };
  }

  return { go: true };
}
