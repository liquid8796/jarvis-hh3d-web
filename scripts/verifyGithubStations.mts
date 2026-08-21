#!/usr/bin/env node
/**
 * Kiểm chứng VÒNG NUÔI KHO GITHUB (deploy/github-actions.md §7) — không database, không mạng
 * thật: `fetch` bị thay bằng một GitHub giả, nên mỗi ca chạy trong vài mili giây và chạy được
 * trên máy chưa cấu hình gì.
 *
 * Vì sao đáng có, và vì sao là ĐÚNG chỗ này: cái giá của một lỗi ở đây không phải một dòng đỏ
 * mà là sự IM LẶNG. Nuôi hụt một kho thì mọi thứ trông vẫn bình thường suốt sáu mươi ngày, rồi
 * một sáng khôi lỗi ngừng lên ca mà không ai được báo. Không phép thử nào chờ được sáu mươi
 * ngày, nên luật phải được đóng đinh ở đây, lúc nó còn là hàm.
 *
 * Ba luật nặng nhất, và cả ba đều được kiểm bằng cách ĐẾM lời gọi chứ không chỉ đọc kết quả —
 * "không ghi gì cả" là một hành vi, và một hàm trả về đúng chữ trong lúc lén ghi một commit thì
 * vẫn là hỏng:
 *
 *   1. `disabled_manually` thì KHÔNG ĐỤNG, kể cả khi admin bấm「Nuôi ngay」.
 *   2. `disabled_inactivity` thì bật lại VÀ ghi mốc ngay, bất kể còn hạn.
 *   3. `pingStation` KHÔNG BAO GIỜ ném — đó là toàn bộ nền móng của luật「một kho hỏng không
 *      chặn kho còn lại」, và nó phải đứng vững cả với những ngả ném không phải Error.
 */
import { encryptSecret } from "../src/lib/crypto/secretBox";
import {
  applyCompanionNurtureResults,
  COMPANION_NURTURE_CONCURRENCY,
  companionNurtureOrder,
  nurtureCompanionRepo,
  parseRevisionLedger,
  pingStation,
  renderRevisionLedger,
  runBoundedCompanionJobs,
  type StationPing,
} from "../src/lib/services/githubStations";
import { appSettingsSchema } from "../src/lib/services/settings";
import {
  DEFAULT_DAILY_PUSHES,
  DEFAULT_WORKFLOW_FILE,
  HEARTBEAT_PATH,
  KEEPALIVE_INTERVAL_DAYS,
  MAX_DAILY_PUSHES,
  MS_PER_DAY,
  NURTURE_WINDOW_END_MIN,
  NURTURE_WINDOW_START_MIN,
  REVISION_LEDGER_PATH,
  SCHEDULE_DISABLE_DAYS,
  companionDueByNow,
  companionSlotMinute,
  countUrgent,
  countdownLevel,
  explainFailure,
  isCommitDue,
  keepaliveOrder,
  nurtureDayKey,
  parseWorkflowState,
  reviewCompanionNurtureDuty,
  reviewCompanionRepos,
  reviewCronScope,
  reviewKeepaliveDuty,
  reviewStationIdentity,
  stationSlug,
} from "../src/lib/validation/githubStations";

// Khoá của phép thử, đặt TRƯỚC lời gọi `encryptSecret` đầu tiên: secretBox đọc env một lần rồi
// nhớ. 32 byte hex, không phải khoá thật của trạm nào — nó chỉ sống trong tiến trình này.
process.env.ENCRYPTION_KEY = "1".repeat(64);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const API_ROOT = "https://api.github.com";
const OWNER = "zhangyu4";
const REPO = "github-khoiloi";
const SLUG = `${OWNER}/${REPO}`;
const WORKFLOW_PATH = `/repos/${OWNER}/${REPO}/actions/workflows/${DEFAULT_WORKFLOW_FILE}`;
const ENABLE_PATH = `${WORKFLOW_PATH}/enable`;
const CONTENTS_PATH = `/repos/${OWNER}/${REPO}/contents/${HEARTBEAT_PATH}`;
const COMPANION_REPO = "quiet-harbor-planner";
const COMPANION_PATH = `/repos/${OWNER}/${COMPANION_REPO}/contents/${REVISION_LEDGER_PATH}`;

const NOW = new Date("2026-08-12T08:00:00.000Z");
/**
 * 22:30 giờ VN cùng ngày với NOW — mốc mà CẢ quota ngày đã tới hạn.
 *
 * Mọi ca kiểm CƠ CHẾ chuỗi PUT (nối tiếp sha, hỏng giữa vòng, hết ngân sách) dùng mốc này, vì
 * chúng nói về vòng đẩy chứ không về nhịp rải. Ca nói về nhịp rải thì dùng NOW (15:00 giờ VN)
 * hoặc một mốc ghi rõ tại chỗ.
 */
const FULL_DUE = new Date("2026-08-12T15:30:00.000Z");

const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY).toISOString();

type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Reply = { status: number; body?: unknown };
/** Ném từ handler = GitHub không trả lời (đứt mạng, quá hạn chờ). */
type Handler = (call: Call) => Reply;

const realFetch = globalThis.fetch;

/** Cài GitHub giả, trả về sổ ghi mọi lời gọi đã đi qua. */
function installFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      path: String(input).slice(API_ROOT.length),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const reply = handler(call);
    // 204 KHÔNG được mang thân — `new Response("…", {status: 204})` là ném. Đây cũng chính là
    // hình dạng mà lượt bật lịch thật trả về, nên phép thử phải chịu được nó y như mã thật.
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return calls;
}

/** Một kho trong sổ. `lastCommitAt` là thứ mỗi ca chỉnh để dựng cảnh. */
function station(overrides: Partial<Parameters<typeof pingStation>[0]> = {}) {
  return {
    owner: OWNER,
    repo: REPO,
    workflowFile: DEFAULT_WORKFLOW_FILE,
    workerId: "github-zhangyu4",
    pat: encryptSecret("ghp_phepthu"),
    enabled: true,
    companionRepos: [],
    dailyPushes: 5,
    lastPingAt: null,
    lastCommitAt: null,
    lastPingOk: null,
    lastPingNote: "",
    workflowState: "",
    ...overrides,
  };
}

function companion(repo = COMPANION_REPO) {
  return {
    repo,
    lastNurtureDay: null,
    pushesToday: 0,
    lastPushAt: null,
    lastPushOk: null,
    lastPushNote: "",
  };
}

/** GitHub giả「mọi thứ đều khoẻ」: workflow đang chạy, tệp mốc đã có, ghi được. */
const healthy: Handler = (call) => {
  if (call.method === "GET" && call.path === WORKFLOW_PATH) return { status: 200, body: { state: "active" } };
  if (call.method === "GET" && call.path === CONTENTS_PATH) return { status: 200, body: { sha: "cu5a" } };
  if (call.method === "PUT" && call.path === CONTENTS_PATH) return { status: 200, body: { commit: { sha: "abcdef1234567890" } } };
  if (call.method === "PUT" && call.path === ENABLE_PATH) return { status: 204 };
  throw new Error(`GitHub giả không biết đường ${call.method} ${call.path}`);
};

const writes = (calls: Call[]) => calls.filter((c) => c.method === "PUT");

async function run() {
  // ───────── Luật hạn: khi nào thì ghi ─────────
  assert(isCommitDue(null, NOW), "Chưa từng ghi mốc thì phải TỚI HẠN — đoán lạc quan ở đây là để kho trôi tới ngày thứ 60.");
  assert(isCommitDue("không-phải-ngày-tháng", NOW), "Mốc không đọc được cũng là「không biết」— phải xử như chưa từng ghi.");
  assert(!isCommitDue(daysAgo(KEEPALIVE_INTERVAL_DAYS - 1), NOW), "Còn một ngày nữa mới tới hạn mà đã ghi.");
  assert(isCommitDue(daysAgo(KEEPALIVE_INTERVAL_DAYS), NOW), "Đúng ngày tới hạn phải ghi — biên này lệch một ngày là trôi dần.");
  assert(isCommitDue(daysAgo(KEEPALIVE_INTERVAL_DAYS + 40), NOW), "Quá hạn lâu rồi mà vẫn bảo còn hạn.");

  // ───────── Luật THỨ TỰ NUÔI: ai được ngân sách trước ─────────
  //
  // Nhóm ca này ra đời cùng lượt gỡ trần 8 kho (18/08/2026). Trước đó vòng nuôi lặp theo thứ tự
  // sổ, và điều ấy vô hại CHỈ vì sổ không bao giờ dài hơn ngân sách. Bỏ trần đi thì thứ tự lặp
  // trở thành thứ quyết định kho nào bị bỏ lại — và ở cách cũ, mỗi lượt lại đúng những kho ấy.
  {
    const row = (over: Record<string, unknown>) => ({
      owner: OWNER,
      repo: REPO,
      lastCommitAt: null as string | null,
      lastPingAt: null as string | null,
      ...over,
    });
    const order = (list: ReturnType<typeof row>[]) => keepaliveOrder(list).map((x) => x.repo);

    assert(keepaliveOrder([]).length === 0, "Sổ rỗng phải ra danh sách rỗng, không được ném.");

    const seen = order([
      row({ repo: "moi-ghi-hom-qua", lastCommitAt: daysAgo(1) }),
      row({ repo: "chua-tung-ghi" }),
      row({ repo: "ghi-19-ngay-truoc", lastCommitAt: daysAgo(19) }),
      row({ repo: "moc-rac", lastCommitAt: "hôm-nào-đó" }),
    ]);
    assert(
      seen.indexOf("chua-tung-ghi") < seen.indexOf("ghi-19-ngay-truoc"),
      "Kho chưa từng ghi phải đứng trước kho ghi 19 ngày trước — không biết thì xử như đã lâu lắm.",
    );
    assert(
      seen.indexOf("moc-rac") < seen.indexOf("ghi-19-ngay-truoc"),
      "Mốc không đọc được phải đi ĐẦU, cùng lẽ với isCommitDue.",
    );
    assert(seen[seen.length - 1] === "moi-ghi-hom-qua", "Kho vừa ghi hôm qua phải xuống cuối — nó còn nhiều hạn nhất.");

    // Hoà mốc GHI thì mốc NGÓ phân xử; hoà cả hai thì tên kho, để thứ tự không nhấp nhổm giữa
    // hai lượt chạy (bảng tổng kết của tab admin đọc theo thứ tự này).
    assert(
      order([
        row({ repo: "ngo-hom-nay", lastCommitAt: daysAgo(5), lastPingAt: daysAgo(0) }),
        row({ repo: "ngo-ba-ngay-truoc", lastCommitAt: daysAgo(5), lastPingAt: daysAgo(3) }),
      ])[0] === "ngo-ba-ngay-truoc",
      "Cùng mốc ghi thì kho lâu chưa được ngó phải đi trước.",
    );
    assert(
      order([row({ repo: "b-kho" }), row({ repo: "a-kho" })]).join(",") === "a-kho,b-kho",
      "Hoà cả hai mốc thì xếp theo tên — hai lượt chạy phải cho cùng một thứ tự.",
    );

    // KHÔNG được sắp lại sổ gốc: thứ tự trong tab admin là thứ tự người ta đã thêm.
    const book = [row({ repo: "z-kho", lastCommitAt: daysAgo(1) }), row({ repo: "a-kho", lastCommitAt: daysAgo(9) })];
    const before = book.map((x) => x.repo).join(",");
    keepaliveOrder(book);
    assert(book.map((x) => x.repo).join(",") === before, "keepaliveOrder không được sắp lại mảng đưa vào.");

    // ── Ca nặng nhất: ĐÓI. Ngân sách chỉ đủ hai kho một lượt, sổ có năm.
    // Chạy hai lượt và đòi: kho bị bỏ lại lượt trước được nuôi ở lượt sau. Đây đúng là điều cách
    // lặp cũ (theo thứ tự sổ) không bao giờ làm được — nó nuôi lại đúng hai kho đầu, mãi mãi.
    let starving = [1, 2, 3, 4, 5].map((n) => row({ repo: "kho-" + n, lastCommitAt: daysAgo(30 + n) }));
    const round1 = keepaliveOrder(starving).slice(0, 2).map((x) => x.repo);
    starving = starving.map((x) => (round1.includes(x.repo) ? { ...x, lastCommitAt: daysAgo(0) } : x));
    const round2 = keepaliveOrder(starving).slice(0, 2).map((x) => x.repo);
    assert(
      round1.every((repo) => !round2.includes(repo)),
      "Lượt hai nuôi lại đúng những kho vừa nuôi (" + round2.join(",") + ") — đuôi sổ sẽ chết đói.",
    );
    assert(new Set([...round1, ...round2]).size === 4, "Hai lượt phải phủ bốn kho khác nhau.");
    assert(!round2.includes("kho-1") && !round1.includes("kho-1"), "Kho mới nhất (kho-1) phải là cái cuối cùng tới lượt.");
    // ĐỐI CHỨNG, giữ vĩnh viễn: cùng cảnh ấy với cách lặp CŨ (nguyên thứ tự sổ) phải chết đói.
    // Không có ca này thì mấy assert trên có thể xanh chỉ vì cảnh dựng quá dễ, và cái luật vừa
    // thêm chẳng chứng minh được gì — cùng lẽ với ca「gỡ bước nhân chứng」của Bí Cảnh.
    let oldWay = [1, 2, 3, 4, 5].map((n) => row({ repo: "kho-" + n, lastCommitAt: daysAgo(30 + n) }));
    const oldRound1 = oldWay.slice(0, 2).map((x) => x.repo);
    oldWay = oldWay.map((x) => (oldRound1.includes(x.repo) ? { ...x, lastCommitAt: daysAgo(0) } : x));
    const oldRound2 = oldWay.slice(0, 2).map((x) => x.repo);
    assert(
      oldRound1.join(",") === oldRound2.join(","),
      "Cách lặp cũ lẽ ra phải nuôi lại đúng hai kho đầu — fixture dựng sai thì ca trên không chứng minh gì.",
    );
    assert(
      !oldRound2.includes("kho-5"),
      "Cách lặp cũ lẽ ra không bao giờ với tới kho cuối sổ — đó chính là cái chết lặng lẽ vừa vá.",
    );

  }

  // ───────── Luật hình dạng: cái gì được vào sổ ─────────
  assert(reviewStationIdentity(OWNER, REPO, DEFAULT_WORKFLOW_FILE) === null, "Một kho hợp lệ bị từ chối.");
  assert(reviewStationIdentity("-mo-dau-gach", REPO, DEFAULT_WORKFLOW_FILE) !== null, "Tên tài khoản mở đầu bằng gạch nối phải bị chặn.");
  assert(reviewStationIdentity("ket-thuc-gach-", REPO, DEFAULT_WORKFLOW_FILE) !== null, "Tên tài khoản kết thúc bằng gạch nối phải bị chặn.");
  assert(reviewStationIdentity("hai--gach", REPO, DEFAULT_WORKFLOW_FILE) !== null, "Hai gạch nối liền nhau phải bị chặn.");
  assert(reviewStationIdentity("a".repeat(40), REPO, DEFAULT_WORKFLOW_FILE) !== null, "Tên tài khoản dài quá 39 ký tự phải bị chặn.");
  assert(reviewStationIdentity("co dau cach", REPO, DEFAULT_WORKFLOW_FILE) !== null, "Khoảng trắng trong tên tài khoản phải bị chặn — nó đi thẳng vào URL.");
  assert(reviewStationIdentity(OWNER, "", DEFAULT_WORKFLOW_FILE) !== null, "Tên kho rỗng phải bị chặn.");
  assert(reviewStationIdentity(OWNER, "..", DEFAULT_WORKFLOW_FILE) !== null, "Tên kho「..」phải bị chặn — nó là một bước lùi thư mục.");
  assert(reviewStationIdentity(OWNER, REPO, "linh-su.txt") !== null, "Tệp workflow không phải .yml/.yaml phải bị chặn.");
  assert(reviewStationIdentity(OWNER, REPO, "linh-su.yaml") === null, "Đuôi .yaml là hợp lệ, GitHub nhận cả hai.");
  assert(stationSlug({ owner: OWNER, repo: REPO }) === SLUG, "Slug phải là owner/repo.");
  assert(parseWorkflowState("mot_trang_thai_moi") === "unknown", "Trạng thái lạ của GitHub phải về「unknown」, không được đoán bừa.");

  // ───────── Ca 1: lịch đang chạy, CHƯA tới hạn → chỉ ngó, không ghi ─────────
  {
    const calls = installFetch(healthy);
    const result = await pingStation(station({ lastCommitAt: daysAgo(3) }), NOW, false);
    assert(result.ok, `Kho khoẻ mà báo hỏng: ${result.note}`);
    assert(!result.committed, "Chưa tới hạn mà vẫn ghi commit.");
    assert(writes(calls).length === 0, `Chưa tới hạn thì tuyệt đối không được GHI gì — đã có ${writes(calls).length} lượt PUT.`);
    assert(calls.length === 1, `Lượt ngó phải đúng MỘT lời gọi, đang có ${calls.length}.`);
    assert(result.note.includes(`${KEEPALIVE_INTERVAL_DAYS - 3} ngày`), `Phải nói còn mấy ngày nữa tới lượt ghi: ${result.note}`);
  }

  // ───────── Ca 2: tới hạn, tệp mốc ĐÃ có → ghi đè kèm sha ─────────
  {
    const calls = installFetch(healthy);
    const result = await pingStation(station({ lastCommitAt: daysAgo(KEEPALIVE_INTERVAL_DAYS + 1) }), NOW, false);
    assert(result.ok && result.committed, `Tới hạn mà không ghi: ${result.note}`);
    const put = writes(calls).find((c) => c.path === CONTENTS_PATH);
    assert(put !== undefined, "Không thấy lượt PUT nào vào tệp mốc.");
    assert(put!.body?.sha === "cu5a", "Ghi đè một tệp đã có mà thiếu `sha` — GitHub sẽ trả 422.");
    const written = Buffer.from(String(put!.body?.content), "base64").toString("utf8");
    assert(written.includes(NOW.toISOString()), "Nội dung tệp mốc phải mang mốc thời gian của lượt ghi.");
    assert(written.includes("ĐỪNG XOÁ"), "Kho là công khai — tệp mốc phải tự nói ra nó là gì và đừng xoá.");
    assert(result.note.includes("abcdef1"), `Phải nói sha của commit vừa tạo: ${result.note}`);
  }

  // ───────── Ca 3: tới hạn, tệp mốc CHƯA có (kho vừa dựng) → tạo mới, KHÔNG kèm sha ─────────
  {
    const calls = installFetch((call) =>
      call.method === "GET" && call.path === CONTENTS_PATH ? { status: 404, body: { message: "Not Found" } } : healthy(call),
    );
    const result = await pingStation(station(), NOW, false);
    assert(result.ok && result.committed, `Kho mới phải được ghi mốc ngay ở lượt đầu: ${result.note}`);
    const put = writes(calls).find((c) => c.path === CONTENTS_PATH);
    assert(put !== undefined && !("sha" in put.body!), "Tạo tệp mới mà vẫn gửi `sha` — GitHub sẽ trả 422.");
  }

  // ───────── Ca 4: lịch bị tắt vì im lặng → bật lại VÀ ghi mốc, dù còn hạn ─────────
  {
    const calls = installFetch((call) =>
      call.method === "GET" && call.path === WORKFLOW_PATH ? { status: 200, body: { state: "disabled_inactivity" } } : healthy(call),
    );
    // `lastCommitAt` mới toanh: nếu nhánh tự chữa đi hỏi「còn hạn không」thì nó sẽ bỏ qua, và
    // kho vừa được bật lại sẽ đứng nguyên ở ngày thứ 60 để bị tắt tiếp.
    const result = await pingStation(station({ lastCommitAt: daysAgo(1) }), NOW, false);
    assert(result.ok, `Ca tự chữa phải thành công: ${result.note}`);
    assert(result.committed, "Bật lại lịch mà không ghi hoạt động mới thì kho vẫn đứng ở ngày thứ 60.");
    assert(writes(calls).some((c) => c.path === ENABLE_PATH), "Không thấy lượt bật lại lịch.");
    assert(result.workflowState === "active", "Bật lại xong thì trạng thái ghi vào sổ phải là `active`.");
  }

  // ───────── Ca 5: lịch bị TẮT TAY → không đụng gì, kể cả khi bị ép ─────────
  for (const force of [false, true]) {
    const calls = installFetch((call) =>
      call.method === "GET" && call.path === WORKFLOW_PATH ? { status: 200, body: { state: "disabled_manually" } } : healthy(call),
    );
    const result = await pingStation(station(), NOW, force);
    assert(!result.ok, "Lịch bị tắt tay là chuyện phải hiện ĐỎ — khôi lỗi ấy đang không chạy.");
    assert(!result.committed, `force=${force}: đã ghi commit vào một kho bị tắt tay.`);
    assert(
      writes(calls).length === 0,
      `force=${force}: người ta tắt lịch bằng tay là một quyết định — nút「Nuôi ngay」không được cãi lại nó (${writes(calls).length} lượt PUT).`,
    );
  }

  // ───────── Ca 6: force bỏ qua phép tính hạn (nhưng chỉ phép tính hạn) ─────────
  {
    const calls = installFetch(healthy);
    const result = await pingStation(station({ lastCommitAt: daysAgo(1) }), NOW, true);
    assert(result.committed, "「Nuôi ngay」phải ghi thật, không được trả lời「còn hạn」.");
    assert(writes(calls).some((c) => c.path === CONTENTS_PATH), "「Nuôi ngay」không ghi vào tệp mốc.");
  }

  // ───────── Ca 7: mỗi mã lỗi nói đúng nguyên nhân của nó ─────────
  const failures: Array<[number, string, string]> = [
    [401, "401", "token hết hạn"],
    [403, "403", "scope"],
    [404, "404", "sai tên kho"],
  ];
  for (const [status, code, hint] of failures) {
    installFetch((call) =>
      call.method === "GET" && call.path === WORKFLOW_PATH ? { status, body: { message: "loi tu GitHub" } } : healthy(call),
    );
    const result = await pingStation(station(), NOW, false);
    assert(!result.ok, `GitHub trả ${status} mà sổ báo khoẻ.`);
    assert(result.note.includes(code), `Câu chữ phải mang mã ${code}: ${result.note}`);
    assert(result.note.includes(hint), `Mã ${code} phải nói ra nguyên nhân riêng của nó ("${hint}"): ${result.note}`);
    assert(result.note.includes("loi tu GitHub"), `Phải chuyển tiếp câu GitHub nói: ${result.note}`);
  }

  // ───────── Ca 8: hỏng ở lượt GHI (409) → không nuốt, không nhận nhầm là đã ghi ─────────
  {
    installFetch((call) =>
      call.method === "PUT" && call.path === CONTENTS_PATH ? { status: 409, body: { message: "is at abc but expected def" } } : healthy(call),
    );
    const result = await pingStation(station(), NOW, false);
    assert(!result.ok && !result.committed, "Lượt ghi hỏng mà vẫn tính là đã ghi — mốc đếm ngược sẽ nhảy lên dù kho không có commit nào.");
    assert(result.note.includes("409"), `Phải mang mã 409: ${result.note}`);
  }

  // ───────── Ca 9: KHÔNG BAO GIỜ NÉM — nền móng của「một kho hỏng không chặn kho còn lại」─────────
  {
    installFetch(() => {
      throw new Error("fetch failed");
    });
    const result = await pingStation(station(), NOW, false);
    assert(!result.ok, "Đứt mạng mà báo khoẻ.");
    assert(result.note.includes(WORKFLOW_PATH), `Phải nói đang gọi đường nào lúc đứt: ${result.note}`);
  }
  {
    // Ngả ném KHÔNG phải Error — thứ `err.message` sẽ nổ nếu ai đó bỏ phép kiểm `instanceof`.
    installFetch(() => {
      throw "một chuỗi trần trụi";
    });
    let result: StationPing | null = null;
    try {
      result = await pingStation(station(), NOW, false);
    } catch (err) {
      throw new Error(`pingStation ĐÃ NÉM (${String(err)}) — luật「một kho hỏng không chặn kho còn lại」đứng trên việc hàm này không bao giờ ném.`);
    }
    assert(!result.ok, "Ngả ném lạ mà báo khoẻ.");
  }

  // ───────── Ca 10: phong bì PAT hỏng → chết trước khi chạm mạng ─────────
  {
    const calls = installFetch(healthy);
    const result = await pingStation(station({ pat: "khong-phai-phong-bi" }), NOW, false);
    assert(!result.ok, "Phong bì hỏng mà báo khoẻ.");
    assert(calls.length === 0, "PAT không giải mã được thì đừng gọi GitHub bằng chuỗi rác — nó chỉ tốn một lượt 401.");
    assert(result.note.includes("PAT"), `Câu chữ phải chỉ đúng việc phải làm: ${result.note}`);
  }

  // ───────── Ca 11: AI được phép nuôi — và fail-open phải đúng chiều ─────────
  //
  // Luật thuần, không cần GitHub giả. Đáng đóng đinh vì cả hai chiều hỏng đều IM LẶNG: gác lỏng
  // thì hai trạm cùng đẩy commit vào một kho và chỉ lộ ra ở lịch sử commit của kho ấy; gác chặt
  // quá thì KHÔNG trạm nào nuôi, và điều đó chỉ lộ ra sau sáu mươi ngày, bằng việc khôi lỗi
  // ngừng lên ca. Ba ca fail-open ở dưới quan trọng hơn ca chặn.
  {
    const active = reviewKeepaliveDuty("auto-hh3d-2", "auto-hh3d-2");
    assert(active.feed, "Trạm đang hoạt động phải nuôi.");

    const idle = reviewKeepaliveDuty("auto-hh3d-2", "auto-hh3d-3");
    assert(!idle.feed, "Trạm nghỉ mà vẫn nuôi thì hai trạm cùng đẩy commit lên một kho.");
    assert(idle.why.includes("auto-hh3d-3"), `Câu chữ phải chỉ ra ai đang giữ việc: ${idle.why}`);

    // FAIL-OPEN — ba ngả, và cả ba phải NUÔI. Thà thừa một commit còn hơn im lặng thôi nuôi.
    assert(reviewKeepaliveDuty("auto-hh3d-2", null).feed, "Không đọc được bảng điều phối thì vẫn phải nuôi.");
    assert(reviewKeepaliveDuty("auto-hh3d-2", "").feed, "Bảng chưa init (activeSiteId rỗng) thì vẫn phải nuôi.");
    assert(reviewKeepaliveDuty("", "auto-hh3d-3").feed, "Trạm chưa khai SITE_ID thì vẫn phải nuôi.");

    // Khoảng trắng thừa là chuyện của biến môi trường dán tay, không phải chuyện của luật.
    assert(reviewKeepaliveDuty("  auto-hh3d-2  ", "auto-hh3d-2").feed, "SITE_ID có khoảng trắng thừa vẫn là chính nó.");
    assert(!reviewKeepaliveDuty("auto-hh3d-20", "auto-hh3d-2").feed, "So khớp phải TRỌN chuỗi — 'auto-hh3d-20' không phải 'auto-hh3d-2'.");

    // Repo phụ mang quota admin theo ngày nên NGƯỢC chiều: không biết active site là phải dừng.
    assert(
      reviewCompanionNurtureDuty("auto-hh3d-2", "auto-hh3d-2").feed,
      "Repo phụ phải chạy ở đúng active station.",
    );
    assert(
      !reviewCompanionNurtureDuty("auto-hh3d-2", null).feed,
      "Không đọc được control doc mà repo phụ vẫn chạy — stale station có thể phá dailyPushes=0.",
    );
    // SITE_ID rỗng = backend trên VM, nơi DUY NHẤT chạy cron từ 16/08/2026 — phải được đẩy.
    // Ca này từng ngược lại, và cái giá là vòng nuôi kho phụ nằm im suốt từ ngày dọn về VM.
    assert(
      reviewCompanionNurtureDuty("", "auto-hh3d-2").feed,
      "Backend trên VM (không SITE_ID) phải được nuôi kho phụ — nó là nơi duy nhất chạy cron.",
    );
    assert(
      !reviewCompanionNurtureDuty("", null).feed,
      "Nhưng không đọc được bảng điều phối thì vẫn dừng, kể cả ở backend.",
    );
    assert(
      !reviewCompanionNurtureDuty("auto-hh3d-1", "auto-hh3d-2").feed,
      "Trạm nghỉ không được đẩy repo phụ bằng snapshot quota cũ.",
    );
    assert(
      reviewCompanionNurtureDuty(" auto-hh3d-2 ", "auto-hh3d-2").feed,
      "Duty repo phụ phải trim SITE_ID giống keepalive chính.",
    );
  }

  // ---- 12. explainFailure: mã lỗi nào đổ cho PAT, mã lỗi nào KHÔNG -------------------------
  //
  // Sáu chỗ gọi, và tới 17/08/2026 vẫn chưa có ca nào. Cái giá của lỗ hổng ấy đã trả bằng tiền
  // thật: `github:new` chết vì một cú **503** của GitHub và in ra「Kiểm lại PAT」(câu tự chế của
  // riêng nó, không đi qua hàm này), nên tông chủ tạo một PAT mới — chìa toàn tài khoản — cho
  // một sự cố hoàn toàn không thuộc về chìa. Luật đóng đinh ở đây: **4xx mới được nhắc tới PAT,
  // 5xx thì phải nói thẳng là lỗi của GitHub.**
  {
    const doiChoPat = (s: number) => explainFailure(s, null, "hỏi danh tính");

    assert(doiChoPat(401).includes("401") && /PAT/.test(doiChoPat(401)), "401 phải gọi tên PAT.");
    assert(/scope|tần suất/.test(doiChoPat(403)), "403 phải nói tới quyền hoặc hạn mức.");
    assert(/tên kho|quyền nhìn/.test(doiChoPat(404)), "404 phải nói tới tên kho.");

    for (const status of [500, 502, 503, 504]) {
      const noi = explainFailure(status, null, "hỏi danh tính");
      assert(noi.includes(String(status)), `${status} phải hiện trong câu lỗi.`);
      assert(
        /KHÔNG phải PAT/.test(noi),
        `${status} phải nói THẲNG là không phải PAT — bằng không người ta đi thay một chìa còn tốt (đã xảy ra 17/08/2026): ${noi}`,
      );
      assert(/chạy lại|Chờ/.test(noi), `${status} phải chỉ ra việc cần làm là chờ rồi chạy lại: ${noi}`);
    }

    // Và 4xx thì TUYỆT ĐỐI không được mang câu của 5xx — hai lời khuyên ngược nhau.
    for (const status of [401, 403, 404, 409, 422]) {
      assert(
        !/KHÔNG phải PAT/.test(explainFailure(status, null, "x")),
        `${status} không được mang câu trấn an của 5xx.`,
      );
    }

    // Thân lỗi của GitHub được chở theo khi có, và không làm hàm ném khi thân rác.
    assert(
      explainFailure(503, { message: "Server Error" }, "hỏi danh tính").includes("Server Error"),
      "Câu của GitHub phải được chở theo.",
    );
    assert(explainFailure(503, "không-phải-json", "x").length > 0, "Thân rác không được làm hàm ném.");
    assert(explainFailure(418, null, "x").includes("418"), "Mã lạ vẫn phải hiện nguyên số.");
  }

  // ───────── 13. Schema mở rộng nhưng document cũ không cần migrate SQL ─────────
  {
    const old = appSettingsSchema.parse({
      githubStations: [{ owner: OWNER, repo: REPO, pat: "v1.phong-bi-doi-cu" }],
    }).githubStations[0]!;
    assert(old.companionRepos.length === 0, "Station cũ thiếu companionRepos phải đọc thành [], không được làm mất cả sổ.");
    assert(old.dailyPushes === DEFAULT_DAILY_PUSHES, "Station cũ phải nhận mặc định 5 commit/ngày.");

    const expanded = appSettingsSchema.parse({
      githubStations: [
        {
          owner: OWNER,
          repo: REPO,
          pat: "v1.phong-bi",
          dailyPushes: MAX_DAILY_PUSHES + 1,
          companionRepos: [{ repo: COMPANION_REPO }],
        },
      ],
    }).githubStations[0]!;
    assert(expanded.dailyPushes === DEFAULT_DAILY_PUSHES, "Quota vượt 24 phải rơi về mặc định an toàn.");
    assert(expanded.companionRepos[0]?.pushesToday === 0, "Trace thiếu trong document phải được điền 0/null.");

    assert(reviewCompanionRepos(REPO, []) === null, "Station đời cũ không có kho phụ vẫn phải hợp lệ.");
    assert(reviewCompanionRepos(REPO, [COMPANION_REPO, "second-toolkit"]) === null, "Hai tên kho phụ hợp lệ bị chặn.");
    assert(reviewCompanionRepos(REPO, [COMPANION_REPO, COMPANION_REPO.toUpperCase()]) !== null, "Tên kho GitHub trùng khác hoa/thường phải bị chặn.");
    assert(reviewCompanionRepos(REPO, [REPO]) !== null, "Kho phụ trùng kho khôi lỗi chính phải bị chặn.");
  }

  // ───────── 14. Ngày quota là UTC+7, không phải ngày UTC của Vercel ─────────
  {
    assert(
      nurtureDayKey(new Date("2026-08-18T16:59:59.999Z")) === "2026-08-18",
      "Một mili giây trước nửa đêm UTC+7 vẫn phải thuộc ngày cũ.",
    );
    assert(
      nurtureDayKey(new Date("2026-08-18T17:00:00.000Z")) === "2026-08-19",
      "Đúng nửa đêm UTC+7 phải sang ngày mới.",
    );
  }

  // ───────── 15. Renderer tạo TypeScript tiếng Anh và parser đọc đúng contract generator ─────────
  {
    const bootstrap = renderRevisionLedger("", 0, NOW, "bootstrap");
    assert(parseRevisionLedger(bootstrap)?.ordinal === 0, "Ledger bootstrap của generator phải đọc được.");
    const source = renderRevisionLedger(nurtureDayKey(NOW), 4, NOW, "revision-fixed");
    const mark = parseRevisionLedger(source);
    assert(mark?.day === nurtureDayKey(NOW) && mark.ordinal === 4, "Renderer và parser trôi contract khỏi nhau.");
    assert(source.includes("export const revisionLedger"), "Mỗi lượt phải ghi source TypeScript được app import.");
    assert(source.includes("Runtime revision metadata"), "Chú thích public source phải là tiếng Anh.");
    assert(parseRevisionLedger("export const revisionLedger = {};") === null, "Source thiếu day/ordinal không được đoán bừa.");
  }

  const ledgerReply = (day: string, ordinal: number, sha = `blob-${ordinal}`): Reply => ({
    status: 200,
    body: {
      sha,
      encoding: "base64",
      content: Buffer.from(renderRevisionLedger(day, ordinal, NOW, ordinal === 0 ? "bootstrap" : `revision-${ordinal}`)).toString("base64"),
    },
  });

  // ───────── 16. Mặc định 5: một GET + đúng năm PUT source tuần tự ─────────
  //
  // SAU MỐC CHỐT (22:30 giờ VN) thì cả quota ngày mới tới hạn cùng lúc — đây là ca chứng minh
  // đường「cuối ngày phải đủ số」chạy trọn vẹn qua hàm thật, chứ không chỉ đúng ở lưới thuần.
  {
    const LATE = new Date("2026-08-12T15:30:00.000Z"); // 22:30 giờ VN, vẫn ngày 2026-08-12
    let expected = 1;
    let expectedSha = "blob-0";
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply("", 0);
      if (call.method === "PUT" && call.path === COMPANION_PATH) {
        const source = Buffer.from(String(call.body?.content), "base64").toString("utf8");
        const mark = parseRevisionLedger(source);
        assert(mark?.ordinal === expected, `Revision phải đi tuần tự ${expected}, nhận ${mark?.ordinal}.`);
        if (!mark) throw new Error("PUT không mang revision ledger hợp lệ.");
        assert(mark.day === nurtureDayKey(LATE), "Source phải mang ngày UTC+7 hiện tại.");
        assert(call.body?.sha === expectedSha, `Chuỗi sha đứt: PUT ${mark.ordinal} dùng ${String(call.body?.sha)}, cần ${expectedSha}.`);
        assert(String(call.body?.message).startsWith("chore: advance revision ledger"), "Commit message phải là tiếng Anh.");
        expectedSha = `blob-${mark.ordinal}`;
        expected += 1;
        return { status: 200, body: { content: { sha: `blob-${mark.ordinal}` }, commit: { sha: `commit-${mark.ordinal}` } } };
      }
      throw new Error(`GitHub giả không biết đường companion ${call.method} ${call.path}`);
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: DEFAULT_DAILY_PUSHES });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, LATE);
    assert(result.ok && result.pushed === 5 && result.ordinal === 5, `Sau 22:00 phải đẩy đủ 5 commit: ${result.note}`);
    assert(calls.filter((call) => call.method === "GET").length === 1, "Năm commit chỉ cần một GET ledger đầu vòng.");
    assert(writes(calls).length === 5, `Phải có đúng 5 PUT, đang có ${writes(calls).length}.`);
  }

  // ───────── 16b. GIỮA NGÀY chỉ đẩy phần đã tới nấc, và giờ chưa tới thì KHÔNG gọi GitHub ─────────
  //
  // Đây là ca giữ cho lượt rải không lặng lẽ quay về nhịp cụm: nếu một ngày nào đó cận vòng lặp bị
  // đổi lại thành `dailyPushes` trần thì đúng ca này đỏ.
  {
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply("", 0);
      if (call.method === "PUT" && call.path === COMPANION_PATH) {
        const mark = parseRevisionLedger(Buffer.from(String(call.body?.content), "base64").toString("utf8"));
        return { status: 200, body: { content: { sha: `blob-${mark?.ordinal}` }, commit: { sha: `commit-${mark?.ordinal}` } } };
      }
      throw new Error(`GitHub giả không biết đường companion ${call.method} ${call.path}`);
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: DEFAULT_DAILY_PUSHES });
    const midday = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, NOW); // 15:00 giờ VN
    const due = companionDueByNow(NOW, DEFAULT_DAILY_PUSHES, COMPANION_REPO);
    assert(due > 0 && due < DEFAULT_DAILY_PUSHES, `Giữa ngày phải là một phần của quota, đang là ${due}/5.`);
    assert(
      midday.ok && midday.pushed === due && midday.ordinal === due,
      `Giữa ngày chỉ đẩy đúng phần tới nấc (${due}), nhận ${midday.pushed}: ${midday.note}`,
    );
    assert(midday.target === DEFAULT_DAILY_PUSHES, "`target` phải vẫn là quota CẢ NGÀY để giao diện khỏi khoe nhầm.");
    assert(writes(calls).length === due, `Giữa ngày phải có đúng ${due} PUT, đang có ${writes(calls).length}.`);

    // Trước 08:00 giờ VN: không một lời gọi nào, và không ghi sổ.
    const early = installFetch(() => {
      throw new Error("Giờ chưa tới nấc mà vẫn gọi GitHub — đúng thứ nhánh dueNow===0 phải chặn.");
    });
    const dawn = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, new Date("2026-08-11T23:30:00.000Z"));
    assert(dawn.ok && dawn.pushed === 0 && dawn.dueNow === 0, "Trước cửa sổ giờ thì không đẩy gì.");
    assert(dawn.worthRecording === false, "Lượt chưa tới nấc không đáng ghi sổ — bằng không mỗi ngày 24 lượt ghi vô nghĩa.");
    assert(early.length === 0, "Lượt chưa tới nấc phải KHÔNG gọi GitHub lấy một lần.");
  }

  // ───────── 17. GitHub ordinal thắng DB: đủ thì 0 PUT, thiếu thì chỉ nối phần còn lại ─────────
  {
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply(nurtureDayKey(NOW), 5);
      throw new Error("Ledger đã đủ mà service vẫn định ghi.");
    });
    const parent = station({
      companionRepos: [{ ...companion(), lastNurtureDay: null, pushesToday: 0 }],
      dailyPushes: 5,
    });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE);
    assert(result.ok && result.pushed === 0 && result.ordinal === 5, "DB rỗng nhưng GitHub đã đủ thì không được đẩy trùng.");
    assert(writes(calls).length === 0, "Idempotency phải là hành vi 0 PUT, không chỉ là câu status.");
  }
  {
    let next = 4;
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply(nurtureDayKey(NOW), 3);
      if (call.method === "PUT" && call.path === COMPANION_PATH) {
        const mark = parseRevisionLedger(Buffer.from(String(call.body?.content), "base64").toString("utf8"));
        assert(mark?.ordinal === next, `Resume phải bắt đầu ở ${next}, nhận ${mark?.ordinal}.`);
        next += 1;
        return { status: 200, body: { content: { sha: `blob-${mark!.ordinal}` } } };
      }
      throw new Error("Đường companion lạ.");
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: 5 });
    // 22:30 giờ VN: cả quota đã tới hạn, nên phần còn thiếu được nối trọn trong một lượt.
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, new Date("2026-08-12T15:30:00.000Z"));
    assert(result.ok && result.pushed === 2 && result.ordinal === 5, `Ledger 3/5 chỉ được nối hai lượt: ${result.note}`);
    assert(writes(calls).length === 2, "Resume 3/5 phải đúng hai PUT.");
  }

  // ───────── 18. Hỏng giữa vòng trả ordinal thật để lượt sau nối tiếp, không nhận nhầm đủ ─────────
  {
    let accepted = 0;
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply("", 0);
      if (call.method === "PUT" && call.path === COMPANION_PATH) {
        const mark = parseRevisionLedger(Buffer.from(String(call.body?.content), "base64").toString("utf8"))!;
        if (mark.ordinal === 4) return { status: 409, body: { message: "sha moved" } };
        accepted = mark.ordinal;
        return { status: 200, body: { content: { sha: `blob-${mark.ordinal}` } } };
      }
      throw new Error("Đường companion lạ.");
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: 5 });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE);
    assert(!result.ok && result.pushed === 3 && result.ordinal === 3 && accepted === 3, "Hỏng PUT 4 phải giữ đúng tiến độ 3/5.");
    assert(result.note.includes("409"), `Lỗi conflict phải có mã để vận hành: ${result.note}`);
    assert(result.note.includes("cùng ngày") && result.note.includes("không bù"), "Partial 3/5 phải nói rõ chỉ retry cùng ngày mới đủ quota.");
    assert(writes(calls).length === 4, "Ba PUT thành + một PUT hỏng phải hiện đủ trong sổ gọi.");
  }

  // ───────── 19. Quota 0 và deadline hết đều không được chạm GitHub ─────────
  {
    const calls = installFetch(() => {
      throw new Error("dailyPushes=0 tuyệt đối không được chạm mạng.");
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: 0 });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE);
    assert(result.ok && result.target === 0 && result.pushed === 0, "Quota 0 phải là trạng thái tạm ngừng hợp lệ.");
    assert(calls.length === 0, "Quota 0 vẫn gọi GitHub.");
  }
  {
    const calls = installFetch(() => {
      throw new Error("Hết deadline tuyệt đối không được bắt đầu request mới.");
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: MAX_DAILY_PUSHES });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE, { deadlineAt: Date.now() - 1 });
    assert(!result.ok && result.pushed === 0, "Hết ngân sách phải trả partial failure để summary báo được.");
    assert(result.note.includes("cùng ngày"), `Quota hụt phải bảo chạy lại CÙNG ngày: ${result.note}`);
    assert(result.note.includes("không bù"), `Không được hứa ngày sau bù quota cũ: ${result.note}`);
    assert(calls.length === 0, "Hết deadline mà vẫn bắt đầu GET — route có thể vượt 60 giây.");
  }

  // ───────── 20. Ledger ngày tương lai fail closed, không tạo commit ngược thời gian ─────────
  {
    const calls = installFetch((call) => {
      if (call.method === "GET" && call.path === COMPANION_PATH) return ledgerReply("2099-01-01", 1);
      throw new Error("Ledger tương lai mà vẫn định ghi.");
    });
    const parent = station({ companionRepos: [companion()], dailyPushes: 5 });
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE);
    assert(!result.ok && /tương lai/.test(result.note), "Ledger tương lai phải hiện lỗi rõ ràng.");
    assert(writes(calls).length === 0, "Ledger tương lai không được có PUT.");
  }

  // ───────── 21. Hết budget không ghim cứng đuôi sổ: repo lâu chưa push đi trước ─────────
  {
    const oldParent = station({
      repo: "worker-old",
      companionRepos: [{ ...companion("software-old"), lastPushAt: daysAgo(10) }],
    });
    const newParent = station({
      repo: "worker-new",
      companionRepos: [{ ...companion("software-new"), lastPushAt: daysAgo(1) }],
    });
    const jobs = [
      { station: newParent, companion: newParent.companionRepos[0]! },
      { station: oldParent, companion: oldParent.companionRepos[0]! },
    ];
    const ordered = companionNurtureOrder(jobs);
    assert(ordered[0]?.companion.repo === "software-old", "Kho lâu chưa push phải nhận ngân sách trước.");
    assert(jobs[0]?.companion.repo === "software-new", "Phép xếp ưu tiên không được sửa thứ tự settings gốc.");
  }

  // ───────── 22. AbortSignal co theo deadline chung, không đợi tròn timeout 10 giây ─────────
  {
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("Request GitHub thiếu AbortSignal."));
        // AbortSignal.timeout dùng timer unref; safety timer giữ process phép thử sống đủ lâu để
        // thật sự quan sát abort, thay vì Node thoát mã 0 giữa một Promise còn treo.
        const safety = setTimeout(() => reject(new Error("AbortSignal không nổ trong 2 giây.")), 2_000);
        const aborted = () => {
          clearTimeout(safety);
          reject(signal.reason ?? new Error("aborted"));
        };
        if (signal.aborted) aborted();
        else signal.addEventListener("abort", aborted, { once: true });
      })) as typeof fetch;
    const parent = station({ companionRepos: [companion()], dailyPushes: 5 });
    const started = Date.now();
    const result = await nurtureCompanionRepo(parent, parent.companionRepos[0]!, FULL_DUE, {
      deadlineAt: started + 40,
    });
    const elapsed = Date.now() - started;
    assert(!result.ok && result.note.startsWith("Hết ngân sách"), `Deadline abort phải hiện đúng nguyên nhân: ${result.note}`);
    assert(result.note.includes("cùng ngày") && result.note.includes("không bù"), "Deadline hụt quota phải hướng dẫn retry cùng ngày.");
    assert(elapsed < 1_000, `Request sát deadline vẫn treo ${elapsed}ms thay vì abort sớm.`);
    globalThis.fetch = realFetch;
  }

  // ───────── 23. Pool giới hạn concurrency và skipped chỉ đếm job CHƯA khởi động ─────────
  {
    let active = 0;
    let peak = 0;
    const all = await runBoundedCompanionJobs([0, 1, 2, 3, 4, 5, 6], {
      deadlineAt: Date.now() + 2_000,
      concurrency: COMPANION_NURTURE_CONCURRENCY,
      execute: async (job) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return job;
      },
    });
    assert(peak === COMPANION_NURTURE_CONCURRENCY, `Pool phải đạt nhưng không vượt concurrency ${COMPANION_NURTURE_CONCURRENCY}; peak=${peak}.`);
    assert(all.results.join(",") === "0,1,2,3,4,5,6", "Promise hoàn tất khác thứ tự không được làm summary đổi thứ tự repo.");
    assert(all.skipped === 0, "Deadline rộng mà vẫn bỏ job.");

    active = 0;
    peak = 0;
    const bounded = await runBoundedCompanionJobs([0, 1, 2, 3, 4], {
      deadlineAt: Date.now() + 10,
      concurrency: 2,
      execute: async (job) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return job;
      },
    });
    assert(bounded.results.length === 2, `Batch đầu đã khởi động phải có 2 result, nhận ${bounded.results.length}.`);
    assert(bounded.skipped === 3, `Ba job chưa khởi động mới là skipped, nhận ${bounded.skipped}.`);
    assert(peak === 2, `Pool bounded phải chạy đúng hai job song song, peak=${peak}.`);
  }

  // ───────── 24. Trace nhiều repo được vá cùng snapshot, không làm rơi config admin ─────────
  {
    const settings = appSettingsSchema.parse({
      githubStations: [
        {
          owner: OWNER,
          repo: REPO,
          pat: "v1.phong-bi",
          dailyPushes: 7,
          companionRepos: [{ repo: COMPANION_REPO }, { repo: "second-toolkit" }],
        },
      ],
    });
    const recordedAt = new Date("2026-08-12T08:00:30.000Z");
    const changed = applyCompanionNurtureResults(
      settings,
      [
        {
          stationSlug: SLUG,
          repo: COMPANION_REPO,
          slug: `${OWNER}/${COMPANION_REPO}`,
          day: nurtureDayKey(NOW),
          target: 7,
          dueNow: 7,
          worthRecording: true,
          ordinal: 7,
          pushed: 7,
          ok: true,
          note: "done",
        },
        {
          stationSlug: SLUG,
          repo: "second-toolkit",
          slug: `${OWNER}/second-toolkit`,
          day: nurtureDayKey(NOW),
          target: 7,
          dueNow: 7,
          worthRecording: true,
          ordinal: 3,
          pushed: 3,
          ok: false,
          note: "partial",
        },
      ],
      recordedAt,
    );
    const saved = settings.githubStations[0]!;
    assert(changed, "Hai repo còn trong fresh settings phải tạo đúng một batch thay đổi.");
    assert(saved.dailyPushes === 7, "Vá trace không được nuốt quota admin vừa đặt.");
    assert(saved.companionRepos[0]?.pushesToday === 7 && saved.companionRepos[1]?.pushesToday === 3, "Hai trace phải cùng được vá vào một snapshot.");
    assert(saved.companionRepos.every((repo) => repo.lastPushAt === recordedAt.toISOString()), "Repo đã push phải nhận cùng mốc ghi batch.");
  }

  // ── Đếm ngược: phân hạng, và phép đếm mà tab Kho GitHub dùng để nói「trang này giấu mất
  // mấy kho」sau khi sổ được chia trang.
  //
  // Hai ngưỡng ấy chỉ đẻ ra một dòng chữ, nhưng cái chúng chống lại là một dạng hỏng CÂM: hạng
  // rộng quá thì một kho sắp tắt lịch nằm im ở trang hai mà không ai được báo; hạng chặt quá thì
  // cảnh báo đỏ ở mọi nhịp bình thường, và người vận hành học đúng một điều — lờ nó đi.
  {
    assert(countdownLevel(null) === "unknown", "Chưa ghi mốc lần nào là KHÔNG BIẾT, không phải khoẻ.");
    assert(countdownLevel(0) === "critical", "Hết sạch ngày phải là hạng nặng nhất.");
    assert(countdownLevel(KEEPALIVE_INTERVAL_DAYS) === "critical", "Còn đúng một chu kỳ ghi vẫn là nặng.");
    assert(countdownLevel(KEEPALIVE_INTERVAL_DAYS + 1) === "warn", "Trên ngưỡng nặng một ngày thì xuống hạng nhắc.");
    assert(
      countdownLevel(SCHEDULE_DISABLE_DAYS - KEEPALIVE_INTERVAL_DAYS - 1) === "warn",
      "Sát dưới mốc 40 vẫn phải là hạng nhắc.",
    );
    // Kho KHOẺ chạm đáy đúng ở 40 mỗi chu kỳ, ngay trước lượt ghi trong ngày. Nhắc ở đó là nhắc
    // vào nhịp bình thường — đúng cái làm màu cảnh báo mất nghĩa sau tuần đầu.
    assert(
      countdownLevel(SCHEDULE_DISABLE_DAYS - KEEPALIVE_INTERVAL_DAYS) === "ok",
      "Đứng đúng ở 40 là nhịp BÌNH THƯỜNG của kho khoẻ, phải xanh.",
    );
    assert(countdownLevel(SCHEDULE_DISABLE_DAYS) === "ok", "Vừa ghi mốc xong thì xanh.");

    const book = [
      { enabled: true, daysToDisable: 3 }, // nặng
      { enabled: true, daysToDisable: 30 }, // nhắc
      { enabled: true, daysToDisable: 58 }, // khoẻ
      { enabled: true, daysToDisable: null }, // chưa biết — không phải cớ để báo động
      { enabled: false, daysToDisable: 0 }, // kho TẮT: đỏ là đúng trạng thái đã chọn
    ];
    const inBook = countUrgent(book);
    assert(inBook.critical === 1 && inBook.warn === 1, `Đếm sai cả sổ: ${JSON.stringify(inBook)}`);
    assert(
      countUrgent(book.filter((station) => !station.enabled)).critical === 0,
      "Sổ chỉ toàn kho TẮT phải đếm ra 0 — bằng không tab admin đỏ vĩnh viễn.",
    );
    assert(countUrgent([]).critical === 0 && countUrgent([]).warn === 0, "Sổ rỗng không có gì để nhắc.");

    // Phép trừ mà tab admin làm mỗi lượt vẽ: cả sổ trừ trang đang xem.
    const wholeBookShown = countUrgent(book);
    assert(
      inBook.critical - wholeBookShown.critical === 0 && inBook.warn - wholeBookShown.warn === 0,
      "Trang chở hết sổ thì không còn gì để nhắc — mức「mỗi trang」lớn phải làm dòng cảnh báo tắt hẳn.",
    );
    const firstPage = countUrgent(book.slice(0, 1));
    assert(
      inBook.critical - firstPage.critical === 0 && inBook.warn - firstPage.warn === 1,
      "Trang bỏ lại đúng một kho hạng nhắc thì phải nhắc đúng một, không nhắc thừa kho nặng đang hiện.",
    );
  }

  // ---- 26. RẢI COMMIT TRONG NGÀY (companionDueByNow) --------------------------------------------
  //
  // Luật thuần, không mạng: đóng đinh bốn điều mà cả tính năng dựa vào — tất định, không lùi,
  // không bao giờ vượt quota, và cuối ngày CHẮC CHẮN đủ số.
  {
    const vn = (hhmm: string, day = "2026-08-21") =>
      new Date(`${day}T${hhmm}:00+07:00`);
    const REPO_A = "cobalt-relay-0123456789abcdef";
    const REPO_B = "garnet-mill-fedcba9876543210";

    assert(companionDueByNow(vn("07:59"), 5, REPO_A) === 0, "Trước 08:00 giờ VN chưa nấc nào tới hạn.");
    assert(companionDueByNow(vn("22:00"), 5, REPO_A) === 5, "Đúng 22:00 phải trả trọn quota ngày.");
    assert(companionDueByNow(vn("23:59"), 5, REPO_A) === 5, "Sau mốc chốt vẫn là trọn quota, không hơn.");
    assert(companionDueByNow(vn("00:30"), 5, REPO_A) === 0, "Đầu ngày VN (sau nửa đêm) đếm lại từ 0.");
    assert(companionDueByNow(vn("12:00"), 0, REPO_A) === 0, "Quota 0 thì mọi giờ đều là 0.");

    // TẤT ĐỊNH: hai lượt cron cùng giờ phải đồng ý, bằng không lượt sau đẩy trùng.
    assert(
      companionDueByNow(vn("15:00"), 5, REPO_A) === companionDueByNow(vn("15:00"), 5, REPO_A),
      "Cùng (giờ, kho, quota) phải cho cùng một số — hàm này bắt buộc tất định.",
    );
    // Hai kho khác nhau rải khác nhau, bằng không cả đàn commit cùng phút.
    {
      const slotsA = [1, 2, 3, 4, 5].map((i) => companionSlotMinute("2026-08-21", REPO_A, 5, i));
      const slotsB = [1, 2, 3, 4, 5].map((i) => companionSlotMinute("2026-08-21", REPO_B, 5, i));
      assert(slotsA.some((minute, i) => minute !== slotsB[i]), "Hai kho phải có giờ commit lệch nhau.");
    }

    // KHÔNG LÙI và KHÔNG VƯỢT: quét từng phút cả ngày, với nhiều mức quota và nhiều kho.
    for (const quota of [1, 2, 5, 7, 24]) {
      for (const repo of [REPO_A, REPO_B]) {
        let previous = 0;
        for (let minute = 0; minute < 24 * 60; minute += 1) {
          const at = vn(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
          const due = companionDueByNow(at, quota, repo);
          assert(due >= previous, `Số nấc tới hạn không được lùi (quota ${quota}, phút ${minute}).`);
          assert(due <= quota, `Số nấc tới hạn không được vượt quota ${quota}.`);
          previous = due;
        }
        assert(previous === quota, `Cuối ngày phải đủ trọn quota ${quota} cho ${repo}.`);
      }
    }

    // Nấc phải NẰM TRONG cửa sổ và TĂNG DẦN — thứ tự đảo là số đếm nhảy lùi.
    for (const quota of [1, 3, 5, 24]) {
      let last = -1;
      for (let index = 1; index <= quota; index += 1) {
        const minute = companionSlotMinute("2026-08-21", REPO_A, quota, index);
        assert(minute > last, `Nấc ${index} phải muộn hơn nấc trước (quota ${quota}).`);
        assert(
          minute >= NURTURE_WINDOW_START_MIN && minute < NURTURE_WINDOW_END_MIN,
          `Nấc ${index} phải nằm trong cửa sổ 08:00–22:00 (quota ${quota}).`,
        );
        last = minute;
      }
    }

    // Phạm vi lượt cron: vắng cờ là trọn gói, `companions` là hẹp, chữ lạ bị từ chối.
    {
      const full = reviewCronScope(null);
      assert(full.ok && full.scope.housekeeping && full.scope.keepalive && full.scope.companions, "Vắng ?only= phải là trọn gói.");
      const only = reviewCronScope("companions");
      assert(only.ok && !only.scope.housekeeping && !only.scope.keepalive && only.scope.companions, "?only=companions chỉ chạy phần kho phụ.");
      assert(reviewCronScope("  COMPANIONS ").ok, "?only= phải bỏ qua hoa thường và khoảng trắng thừa.");
      assert(!reviewCronScope("keepalive").ok, "Giá trị lạ phải bị từ chối, không im lặng chạy trọn gói.");
    }
  }

  globalThis.fetch = realFetch;
  console.log("✔ Vòng nuôi kho GitHub: 26 nhóm ca, mọi luật đứng vững.");
}

run().catch((err) => {
  globalThis.fetch = realFetch;
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
