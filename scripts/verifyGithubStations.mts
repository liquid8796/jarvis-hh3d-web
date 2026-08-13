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
import { pingStation, type StationPing } from "../src/lib/services/githubStations";
import {
  DEFAULT_WORKFLOW_FILE,
  HEARTBEAT_PATH,
  KEEPALIVE_INTERVAL_DAYS,
  MS_PER_DAY,
  isCommitDue,
  parseWorkflowState,
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

const NOW = new Date("2026-08-12T08:00:00.000Z");
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
    lastPingAt: null,
    lastCommitAt: null,
    lastPingOk: null,
    lastPingNote: "",
    workflowState: "",
    ...overrides,
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
  }

  globalThis.fetch = realFetch;
  console.log("✔ Vòng nuôi kho GitHub: 11 nhóm ca, mọi luật đứng vững.");
}

run().catch((err) => {
  globalThis.fetch = realFetch;
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
