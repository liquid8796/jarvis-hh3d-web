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
