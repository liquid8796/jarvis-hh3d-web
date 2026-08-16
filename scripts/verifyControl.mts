/**
 * Kiểm chứng lõi bảng điều phối gương trạm (src/lib/control) — chữ ký, hàng rào revision,
 * và TỪNG NHÁNH của phép quyết định chuyển hướng.
 *
 * Chạy OFFLINE toàn phần: không chạm mạng, không cần env. Phần đọc-qua-mạng kiểm bằng cách
 * tráo `fetch` toàn cục — đó là toàn bộ mặt tiếp xúc của read.ts với thế giới, nên tráo nó
 * là dựng được mọi kịch bản (bảng giả, bản cũ quay lại, bucket chết) mà không cần bucket.
 */
import { deepStrictEqual, strictEqual } from "node:assert";
import { decideRequest, signControlDoc, parseControlDoc, verifyControlDoc, type ControlDoc } from "../src/lib/control/doc";
import { readControlDoc, resetControlCacheForVerify } from "../src/lib/control/read";
import { backendIsStation, canFlip, canSwitch } from "../src/lib/mirror/switchGuard";

const TOKEN = "worker-token-danh-cho-kiem-chung";
let passed = 0;

function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✔ ${label}`);
}

const base = signControlDoc(
  {
    revision: 3,
    activeSiteId: "main",
    activeUrl: "https://auto-hh3d.vercel.app",
    switchedAt: "2026-08-10T13:00:00.000Z",
    switchedBy: "verify",
  },
  TOKEN,
);

// ---- Chữ ký -----------------------------------------------------------------------------
ok(verifyControlDoc(base, TOKEN), "ký rồi xác minh — thuận");
ok(!verifyControlDoc({ ...base, activeUrl: "https://ke-gian.example" }, TOKEN), "đổi activeUrl — chữ ký phải chết");
ok(!verifyControlDoc({ ...base, revision: 4 }, TOKEN), "đổi revision — chữ ký phải chết");
ok(!verifyControlDoc(base, "token-khac"), "khoá khác — phải từ chối");
ok(parseControlDoc({ ...base, activeUrl: "http://khong-tls.example", sig: "x" }, TOKEN) === null, "http thường — schema phải chặn");
ok(parseControlDoc(null, TOKEN) === null, "payload rác — trả null, không ném");

// ---- Phép quyết định --------------------------------------------------------------------
const here = { siteId: "mirror-b", doc: base, search: "" };
deepStrictEqual(decideRequest({ siteId: undefined, doc: base, pathname: "/", search: "" }), { kind: "serve" });
console.log("✔ thiếu SITE_ID — phục vụ (fail-open)"); passed++;
deepStrictEqual(decideRequest({ siteId: "main", doc: null, pathname: "/", search: "" }), { kind: "serve" });
console.log("✔ chưa có bảng — phục vụ (fail-open)"); passed++;
deepStrictEqual(decideRequest({ siteId: "main", doc: base, pathname: "/chat", search: "" }), { kind: "serve" });
console.log("✔ đúng trạm hoạt động — phục vụ"); passed++;
deepStrictEqual(decideRequest({ ...here, pathname: "/chat", search: "?tab=1" }), {
  kind: "redirect",
  location: "https://auto-hh3d.vercel.app/chat?tab=1",
});
console.log("✔ khác trạm — 307 giữ nguyên path+query"); passed++;
for (const p of ["/admin", "/admin/users", "/login", "/api/admin/x"]) {
  deepStrictEqual(decideRequest({ ...here, pathname: p }), { kind: "serve" });
}
console.log("✔ /admin, /login, /api/admin — miễn trừ đủ bốn dạng"); passed++;
deepStrictEqual(decideRequest({ ...here, pathname: "/administrator" }), {
  kind: "redirect",
  location: "https://auto-hh3d.vercel.app/administrator",
});
console.log("✔ /administrator KHÔNG ăn theo miễn trừ /admin — so theo đoạn, không theo tiền tố chuỗi"); passed++;
deepStrictEqual(decideRequest({ ...here, pathname: "/api/worker" }), {
  kind: "worker-conflict",
  activeUrl: "https://auto-hh3d.vercel.app",
});
console.log("✔ /api/worker — 409 kèm địa chỉ, không redirect mù"); passed++;
deepStrictEqual(decideRequest({ ...here, pathname: "/api/cron" }), { kind: "cron-skip" });
console.log("✔ /api/cron trên trạm phụ — 204"); passed++;
// `/api/cron/sweep` phải đi ĐƯỜNG NGƯỢC LẠI với `/api/cron`, và khác biệt ấy là cố ý:
//   • `/api/cron` do cron RIÊNG của từng trạm gọi, nên trạm nghỉ phải tự im (204) — bằng không
//     hai trạm đua nhau dọn dẹp trên hai database khác nhau.
//   • `/api/cron/sweep` do MỘT đồng hồ ngoài gọi vào đúng một địa chỉ (`WEB_URL`). Im lặng ở đây
//     nghĩa là suốt lượt chuyển trạm không ai quét nhật ký cả. Nó cần 307 để cái đồng hồ ấy tìm
//     được trạm đang sống.
// Khoá bằng phép kiểm chứ không bằng chú thích: một lượt "dọn cho gọn" đổi dòng trên thành
// `pathname.startsWith("/api/cron")` sẽ làm đúng điều đó, và không gì khác sẽ đỏ lên.
deepStrictEqual(decideRequest({ ...here, pathname: "/api/cron/sweep" }), {
  kind: "redirect",
  location: "https://auto-hh3d.vercel.app/api/cron/sweep",
});
console.log("✔ /api/cron/sweep trên trạm phụ — 307 sang trạm sống, KHÔNG im như /api/cron"); passed++;


// ---- Luật phát lệnh chuyển trạm (mô hình promote) ---------------------------------------
const BOOK = ["main", "auto-hh3d-1", "auto-hh3d-2"] as const;
const gate = (currentSiteId: string, activeSiteId: string | null, targetId: string) =>
  canSwitch({ currentSiteId, activeSiteId, targetId, knownIds: BOOK });

ok(gate("main", "main", "auto-hh3d-1").allowed, "trạm đang hoạt động chuyển sang trạm khác — cho");
ok(
  gate("auto-hh3d-1", "auto-hh3d-1", "main").allowed,
  "SAU KHI PROMOTE: trạm gương giờ là trạm hoạt động, chuyển ngược về main — cho (đây là điều bản cũ làm không được)",
);
ok(gate("auto-hh3d-1", "auto-hh3d-1", "auto-hh3d-2").allowed, "promote tiếp sang trạm thứ ba — cho");

const notActive = gate("main", "auto-hh3d-1", "auto-hh3d-2");
ok(!notActive.allowed && notActive.reason === "not-active", "trạm ĐÃ NGHỈ phát lệnh — chặn (chống chép database cũ đè lên đích)");
const same = gate("main", "main", "main");
ok(!same.allowed && same.reason === "same-site", "chuyển sang chính mình — chặn (nếu lọt, bước dọn đích xoá sạch nguồn)");
const unknown = gate("main", "main", "khong-co-trong-so");
ok(!unknown.allowed && unknown.reason === "unknown-target", "đích không có trong sổ — chặn");
ok(gate("main", null, "auto-hh3d-1").allowed, "bảng chưa init — coi trạm đang chạy là trạm hoạt động (fail-open)");

/**
 * ── BACKEND KHÔNG PHẢI MỘT TRẠM (từ 16/08/2026) ─────────────────────────────────────────────
 *
 * Cùng một `currentSiteId` rỗng, nhưng NGHĨA đã đổi: xưa là「một deploy Vercel quên khai env」,
 * nay là「đây là backend trên VM」. Ba phép kiểm dưới đây khoá chỗ khác nhau ấy — và nhánh
 * fail-open là nhánh đắt nhất: bảng điều phối không đọc được KHÔNG được phép mở khoá lượt
 * chuyển ngay trên chính nơi giữ database sống.
 */
ok(!backendIsStation(""), "SITE_ID rỗng → không phải một trạm");
ok(!backendIsStation("   "), "SITE_ID toàn khoảng trắng cũng vậy — env dán tay hay dính đuôi");
ok(!backendIsStation(undefined) && !backendIsStation(null), "thiếu hẳn biến cũng vậy");
ok(backendIsStation("auto-hh3d-4"), "SITE_ID có thật → là một trạm");

const notStation = gate("", null, "main");
ok(!notStation.allowed && notStation.reason === "not-a-station", "backend trên VM phát lệnh chuyển — CHẶN, kể cả khi bảng chưa init (fail-open KHÔNG áp ở đây)");
ok(
  !notStation.allowed && !/chưa khai|đặt biến/.test(notStation.message),
  "…và lời kể KHÔNG xui người ta đi đặt SITE_ID — làm thế là lên đạn lại hai cỗ máy đã hết việc",
);
const notStationActive = gate("", "main", "auto-hh3d-1");
ok(
  !notStationActive.allowed && notStationActive.reason === "not-a-station",
  "bảng có ghi trạm khác cũng vẫn là not-a-station, KHÔNG phải not-active — hai lời kể cho hai cảnh khác nhau",
);

// ---- Luật LẬT bảng (anh em của canSwitch, hậu quả khác nên lời kể khác) -------------------
const flip = (currentSiteId: string, activeSiteId: string | null, targetId: string, phase = "done") =>
  canFlip({ currentSiteId, activeSiteId, targetId, phase });

ok(flip("main", "main", "auto-hh3d-1").allowed, "đối chiếu xanh, đúng trạm hoạt động, đích là trạm khác — cho lật");
ok(flip("main", null, "auto-hh3d-1").allowed, "bảng chưa init — fail-open như tầng chuyển hướng");

const flipSelf = flip("auto-hh3d-1", "auto-hh3d-1", "auto-hh3d-1");
ok(
  !flipSelf.allowed && flipSelf.reason === "same-site",
  "LẬT SANG CHÍNH MÌNH — chặn (trạm vừa lên ngôi thừa hưởng bản ghi done trỏ vào chính nó, mỗi cú bấm đẻ một revision vô nghĩa)",
);
for (const phase of ["idle", "draining", "syncing", "verifying", "failed"]) {
  const notReady = flip("main", "main", "auto-hh3d-1", phase);
  ok(!notReady.allowed && notReady.reason === "not-ready", `phase「${phase}」chưa xanh — chặn lật`);
}
const flipStale = flip("main", "auto-hh3d-1", "auto-hh3d-2");
ok(!flipStale.allowed && flipStale.reason === "not-active", "trạm đã nghỉ lật hộ — chặn");
ok(!flipStale.allowed && !flipStale.message.includes("chép"), "…và lời kể KHÔNG nói chuyện chép đè — lật không chép gì cả");
const flipNotStation = flip("", null, "auto-hh3d-1");
ok(!flipNotStation.allowed && flipNotStation.reason === "not-a-station", "backend trên VM lật bảng — chặn");
ok(
  !flipNotStation.allowed && !flipNotStation.message.includes("chép"),
  "…và lời kể KHÔNG nói chuyện chép đè — lật không chép gì cả, cùng luật với nhánh not-active",
);
const flipEmptyTarget = flip("main", "main", "");
ok(flipEmptyTarget.allowed, "targetId rỗng KHÔNG bị bắt nhầm thành same-site (chuỗi rỗng khớp chuỗi rỗng)");

// ---- Đường đọc: tráo fetch --------------------------------------------------------------
process.env.OCI_REGION = "eu-frankfurt-1";
process.env.OCI_NAMESPACE = "ns-kiem-chung";
process.env.OCI_BUCKET = "bucket-kiem-chung";
process.env.WORKER_TOKEN = TOKEN;

const realFetch = globalThis.fetch;
const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(status === 200 ? JSON.stringify(body) : null, { status }));

try {
  resetControlCacheForVerify();
  globalThis.fetch = () => respond(base);
  strictEqual((await readControlDoc())?.revision, 3);
  console.log("✔ đọc bảng hợp lệ qua mạng (fetch giả)"); passed++;

  // Trong TTL: fetch KHÔNG được gọi lại — mock ném để lượt gọi nào lọt qua là chết ngay.
  globalThis.fetch = () => {
    throw new Error("cache còn ấm mà vẫn hỏi mạng");
  };
  strictEqual((await readControlDoc())?.revision, 3);
  console.log("✔ trong TTL — không hỏi mạng, vẫn bản 3"); passed++;

  // Bản CŨ quay lại (revision 1 < 3 đã thấy trong cùng tiến trình) — hàng rào đơn điệu phải
  // giữ bản 3. Ép cache nguội bằng cách lùi mốc fetchedAt thay vì chờ 30 giây thật.
  const cacheRef = (globalThis as unknown as { __jarvisControlCache?: { fetchedAt: number } }).__jarvisControlCache;
  if (cacheRef) cacheRef.fetchedAt = 0;
  const stale = signControlDoc(
    { revision: 1, activeSiteId: "mirror-cu", activeUrl: "https://cu.example.com", switchedAt: base.switchedAt, switchedBy: "verify" },
    TOKEN,
  );
  globalThis.fetch = () => respond(stale);
  strictEqual((await readControlDoc())?.revision, 3);
  console.log("✔ bản cũ quay lại sau khi cache nguội — hàng rào revision giữ bản 3"); passed++;

  resetControlCacheForVerify();
  globalThis.fetch = () => respond({ ...base, sig: "gia-mao" });
  strictEqual(await readControlDoc(), null);
  console.log("✔ bảng giả mạo — null, không tin"); passed++;

  resetControlCacheForVerify();
  globalThis.fetch = () => respond(null, 404);
  strictEqual(await readControlDoc(), null);
  console.log("✔ chưa init (404) — null, không ném"); passed++;

  resetControlCacheForVerify();
  globalThis.fetch = () => Promise.reject(new Error("mạng chết"));
  strictEqual(await readControlDoc(), null);
  console.log("✔ mạng chết — null, không ném"); passed++;
} finally {
  globalThis.fetch = realFetch;
  resetControlCacheForVerify();
}

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
