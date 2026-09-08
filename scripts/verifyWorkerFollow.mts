/**
 * Kiểm chứng: khôi lỗi có ĐI THEO bảng điều phối khi trạm lật hay không.
 *
 * Chạy hoàn toàn bằng `fetch` giả — không mạng, không database, không trạm nào phải nghỉ. Đó
 * là chủ ý: nhánh mã này chỉ chạy thật vào đúng ngày chuyển trạm, và một luật chỉ chạy mỗi
 * vài tháng mà không có phép kiểm thì nó sẽ sai vào đúng ngày ấy — đã trả giá hai lần trong
 * một buổi (tên database Mongo, rồi cột updated_at của app_settings).
 *
 * Ca xương sống nhất là ca PHÂN BIỆT HAI LOẠI 409: `/api/worker` trả 409 cho「job is no longer
 * active」, còn trạm đã nghỉ trả 409 kèm `activeUrl`. Đi theo nhầm loại thứ nhất là biến một
 * lỗi nghiệp vụ thành một cú đổi trạm.
 */
import {
  createWorkerCall,
  isDeadDeploymentResponse,
  normalizeBase,
  parseActiveUrl,
  parseFallbackUrl,
} from "../src/lib/worker/controlFollow.mjs";

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    throw new Error(label);
  }
  passed++;
  console.log(`✔ ${label}`);
}

const OLD = "https://auto-hh3d.vercel.app";
const NEW = "https://auto-hh3d-1.vercel.app";
const FALLBACK = "https://backend.example";

type Reply = { status: number; body: string; headers?: Record<string, string> };
type FakeReply = Reply | Error;

/** `fetch` giả: trả lời theo địa chỉ được gọi, và ghi lại mọi lượt gọi để đếm. */
function fakeFetch(replies: Record<string, FakeReply | FakeReply[]>) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push(url);
    inits.push(init ?? {});
    const base = url.replace("/api/worker", "");
    const entry = replies[base];
    const reply = Array.isArray(entry) ? (entry.shift() ?? { status: 500, body: "hết kịch bản" }) : entry;
    if (!reply) throw new Error(`fakeFetch: không có kịch bản cho ${base}`);
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: {
        get: (name: string) => {
          const found = Object.entries(reply.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
          return found?.[1] ?? null;
        },
      },
      text: async () => reply.body,
      json: async () => JSON.parse(reply.body),
    };
  };
  // Ép kiểu ĐÚNG MỘT LẦN ở đây thay vì rắc `as never` khắp chỗ gọi: bản giả chỉ hiện thực ba
  // thành viên của Response mà controlFollow thật sự đụng tới, và giới hạn ấy đáng nằm gọn
  // một chỗ để người đọc sau thấy ngay nó dừng ở đâu.
  return { impl: impl as unknown as typeof fetch, calls, inits };
}

const silent = () => {};

// ---- hàm thuần -----------------------------------------------------------------------------
ok(normalizeBase("https://a.vercel.app/") === "https://a.vercel.app", "bỏ dấu / cuối");
ok(normalizeBase("https://a.vercel.app///") === "https://a.vercel.app", "bỏ nhiều dấu / cuối");
ok(normalizeBase(undefined) === "", "địa chỉ rỗng không làm ném");
ok(parseActiveUrl(JSON.stringify({ activeUrl: NEW })) === NEW, "rút được activeUrl");
ok(parseActiveUrl(JSON.stringify({ activeUrl: `${NEW}/` })) === NEW, "activeUrl có / cuối vẫn chuẩn hoá");
ok(parseActiveUrl(JSON.stringify({ error: "job is no longer active" })) === null, "409 nghiệp vụ: KHÔNG có activeUrl → null");
ok(parseActiveUrl(JSON.stringify({ activeUrl: "http://ke-gian.example" })) === null, "chặn http:// — token không đi theo địa chỉ không mã hoá");
ok(parseActiveUrl(JSON.stringify({ activeUrl: "javascript:alert(1)" })) === null, "chặn giao thức lạ");
ok(parseActiveUrl("không phải json") === null, "thân không phải JSON → null, không ném");
ok(parseActiveUrl(JSON.stringify({ activeUrl: 42 })) === null, "activeUrl không phải chuỗi → null");
ok(parseFallbackUrl("https://backend.example/") === "https://backend.example", "fallback HTTPS origin được chuẩn hoá");
ok(parseFallbackUrl("http://backend.example") === null, "fallback HTTP bị chặn — token không đi qua dây trần");
ok(parseFallbackUrl("https://u:p@backend.example") === null, "fallback có credentials bị chặn");
ok(parseFallbackUrl("https://backend.example/api") === null, "fallback có path bị chặn");
ok(parseFallbackUrl("https://backend.example?x=1") === null, "fallback có query bị chặn");
ok(parseFallbackUrl("https://backend.example/#x") === null, "fallback có hash bị chặn");
ok(
  isDeadDeploymentResponse(402, "Payment required\nDEPLOYMENT_DISABLED"),
  "nhận ra deployment chết từ thân 402",
);
ok(
  isDeadDeploymentResponse(402, "Payment required", "DEPLOYMENT_DISABLED"),
  "nhận ra deployment chết từ header Vercel",
);
ok(!isDeadDeploymentResponse(402, "payment required"), "402 thường không bị gọi nhầm là deployment chết");

// ---- đi theo 409 kèm activeUrl --------------------------------------------------------------
{
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ error: "Trạm này không còn hoạt động", activeUrl: NEW }) },
    [NEW]: { status: 200, body: JSON.stringify({ job: null }) },
  });
  const { call, currentUrl } = createWorkerCall({ webUrl: OLD, token: "t", fetchImpl: impl, log: silent });
  const res = await call("claim", { workerId: "w" });
  ok(res.job === null, "đi theo 409 rồi thử lại: lượt gọi THÀNH CÔNG ở trạm mới");
  ok(currentUrl() === NEW, "địa chỉ nền đã đổi sang trạm mới");
  ok(calls.length === 2 && calls[0].startsWith(OLD) && calls[1].startsWith(NEW), "đúng hai lượt gọi: trạm cũ rồi trạm mới");

  await call("heartbeat", { jobId: "j" });
  ok(calls.length === 3 && calls[2].startsWith(NEW), "lượt gọi KẾ đi thẳng trạm mới, không hỏi lại trạm cũ");
}

// ---- 409 nghiệp vụ KHÔNG được coi là lệnh đổi trạm -------------------------------------------
{
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ error: "job is no longer active" }) },
  });
  const { call, currentUrl } = createWorkerCall({ webUrl: OLD, token: "t", fetchImpl: impl, log: silent });
  let message = "";
  try {
    await call("complete", { jobId: "j" });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  ok(message.includes("HTTP 409"), "409 không kèm activeUrl vẫn ném lỗi như cũ");
  ok(message.includes("job is no longer active"), "…và giữ nguyên văn thân phản hồi để còn gỡ");
  ok(currentUrl() === OLD, "…KHÔNG đổi trạm");
  ok(calls.length === 1, "…KHÔNG thử lại");
}

// ---- không đi theo địa chỉ trỏ về chính mình -------------------------------------------------
{
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ activeUrl: OLD }) },
  });
  const { call, currentUrl } = createWorkerCall({ webUrl: OLD, token: "t", fetchImpl: impl, log: silent });
  await call("claim").catch(() => {});
  ok(currentUrl() === OLD && calls.length === 1, "activeUrl trỏ chính chỗ đang đứng → ném, không quay vòng");
}

// ---- trạm mới cũng 409: dừng sau đúng một lần thử lại ----------------------------------------
{
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ activeUrl: NEW }) },
    [NEW]: { status: 409, body: JSON.stringify({ activeUrl: OLD }) },
  });
  const { call } = createWorkerCall({ webUrl: OLD, token: "t", fetchImpl: impl, log: silent });
  let threw = false;
  await call("claim").catch(() => {
    threw = true;
  });
  ok(threw && calls.length === 2, "hai trạm chỉ nhau vòng tròn → dừng sau 2 lượt gọi, không đệ quy vô hạn");
}

// ---- deployment chết ở mép nền tảng: replay ngay qua origin cứu hộ --------------------------
{
  const { impl, calls, inits } = fakeFetch({
    [OLD]: {
      status: 402,
      body: "Payment required\nDEPLOYMENT_DISABLED",
      headers: { "X-Vercel-Error": "DEPLOYMENT_DISABLED" },
    },
    [FALLBACK]: { status: 200, body: JSON.stringify({ job: null }) },
  });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  const res = await call("claim", { workerId: "w" });
  ok(res.job === null, "DEPLOYMENT_DISABLED → replay thành công ở fallback");
  ok(
    calls.length === 2 && calls[0].startsWith(OLD) && calls[1].startsWith(FALLBACK),
    "…đúng hai request: cổng chết rồi cổng cứu hộ",
  );
  ok(currentUrl() === FALLBACK, "…và mọi lượt sau nhớ cổng cứu hộ trong bộ nhớ");
  ok(
    inits.every((init) => init.redirect === "manual"),
    "mọi fetch cấm tự đi theo redirect — Bearer token không sang Location lạ",
  );
  ok(
    inits[0].body === inits[1].body &&
      (inits[0].headers as Record<string, string>)?.authorization === "Bearer t" &&
      (inits[1].headers as Record<string, string>)?.authorization === "Bearer t",
    "replay giữ nguyên op/payload/token tới đúng origin đã tin cậy",
  );

  await call("heartbeat", { jobId: "j" });
  ok(calls.length === 3 && calls[2].startsWith(FALLBACK), "lượt kế đi thẳng fallback, không gõ lại xác cũ");
}

// ---- 402 không mang dấu deployment: giữ lỗi, không tự suy target -----------------------------
{
  const { impl, calls } = fakeFetch({ [OLD]: { status: 402, body: "payment required" } });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  let message = "";
  await call("claim").catch((err: unknown) => {
    message = err instanceof Error ? err.message : "";
  });
  ok(message.includes("HTTP 402") && calls.length === 1, "402 thường vẫn ném sau đúng một request");
  ok(currentUrl() === OLD, "402 thường không đổi cổng");
}

// ---- gateway/network: đổi đường cho LƯỢT KẾ, tuyệt đối không replay POST mơ hồ ----------------
for (const status of [502, 503, 504]) {
  const { impl, calls } = fakeFetch({
    [OLD]: { status, body: "upstream unavailable" },
    [FALLBACK]: { status: 200, body: JSON.stringify({ job: null }) },
  });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  let message = "";
  await call("claim").catch((err: unknown) => {
    message = err instanceof Error ? err.message : "";
  });
  ok(message.includes(`HTTP ${status}`) && calls.length === 1, `${status} đổi cổng nhưng KHÔNG replay request hiện tại`);
  ok(currentUrl() === FALLBACK, `${status} đặt fallback làm cổng cho lượt kế`);
  const res = await call("claim");
  ok(
    res.job === null && calls.length === 2 && calls[1].startsWith(FALLBACK),
    `lượt kế sau ${status} dùng fallback`,
  );
}

{
  const { impl, calls } = fakeFetch({
    [OLD]: new Error("fetch failed: ECONNRESET"),
    [FALLBACK]: { status: 200, body: JSON.stringify({ job: null }) },
  });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  let message = "";
  await call("claim").catch((err: unknown) => {
    message = err instanceof Error ? err.message : "";
  });
  ok(message.includes("ECONNRESET") && calls.length === 1, "lỗi mạng đổi cổng nhưng KHÔNG replay POST");
  ok(currentUrl() === FALLBACK, "lỗi mạng đặt fallback làm cổng cho lượt kế");
  await call("claim");
  ok(calls.length === 2 && calls[1].startsWith(FALLBACK), "lượt kế sau lỗi mạng dùng fallback");
}

// ---- fallback không tin cậy/trùng cổng: không bao giờ nhận Bearer token -----------------------
for (const bad of [
  "http://backend.example",
  "https://u:p@backend.example",
  "https://backend.example/api",
  "https://backend.example?x=1",
  OLD,
]) {
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 402, body: "DEPLOYMENT_DISABLED" },
  });
  const { call, currentUrl } = createWorkerCall({ webUrl: OLD, fallbackUrl: bad, token: "t", fetchImpl: impl, log: silent });
  await call("claim").catch(() => {});
  ok(calls.length === 1 && currentUrl() === OLD, `fallback không dùng được (${bad}) không nhận request`);
}

// ---- lỗi ứng dụng/xác thực không phải lỗi cổng: không đổi đường -------------------------------
for (const status of [400, 401, 403, 404]) {
  const { impl, calls } = fakeFetch({ [OLD]: { status, body: "application error" } });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  await call("claim").catch(() => {});
  ok(calls.length === 1 && currentUrl() === OLD, `HTTP ${status} của app không bị gọi nhầm là lỗi cổng`);
}

// ---- 409 và fallback có ngân sách độc lập: trạm chỉ dẫn cũng có thể bị khoá ở mép --------------
{
  const { impl, calls } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ activeUrl: NEW }) },
    [NEW]: { status: 402, body: "DEPLOYMENT_DISABLED" },
    [FALLBACK]: { status: 200, body: JSON.stringify({ job: null }) },
  });
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl: impl,
    log: silent,
  });
  const res = await call("claim");
  ok(res.job === null, "409 → deployment chết → fallback vẫn cứu được");
  ok(
    calls.length === 3 && calls[0].startsWith(OLD) && calls[1].startsWith(NEW) && calls[2].startsWith(FALLBACK),
    "hai ngân sách độc lập kết thúc sau đúng ba request, không loop",
  );
  ok(currentUrl() === FALLBACK, "chuỗi ba cổng kết ở fallback");
}

// ---- response cũ về muộn không được kéo base ngược khỏi fallback -----------------------------
{
  let releaseOld: (value: unknown) => void = () => {
    throw new Error("request chậm chưa được dựng");
  };
  let oldCalls = 0;
  const calls: string[] = [];
  const response = (status: number, body: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  });
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url.startsWith(OLD)) {
      oldCalls++;
      if (oldCalls === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return response(402, "DEPLOYMENT_DISABLED");
    }
    if (url.startsWith(FALLBACK)) return response(200, JSON.stringify({ job: null }));
    throw new Error(`không chờ request tới ${url}`);
  }) as unknown as typeof fetch;
  const { call, currentUrl } = createWorkerCall({
    webUrl: OLD,
    fallbackUrl: FALLBACK,
    token: "t",
    fetchImpl,
    log: silent,
  });
  const slow = call("claim").catch(() => null);
  await call("claim");
  ok(currentUrl() === FALLBACK, "request nhanh đã chuyển sang fallback");
  releaseOld(response(409, JSON.stringify({ activeUrl: NEW })));
  await slow;
  ok(currentUrl() === FALLBACK, "409 cũ về muộn không ghi đè địa chỉ mới");
  ok(calls.length === 3 && calls[2].startsWith(FALLBACK), "race chỉ phát đúng old + old + fallback");
}

// ---- redirect không được fetch tự đi theo -----------------------------------------------------
{
  const { impl, calls, inits } = fakeFetch({
    [OLD]: { status: 302, body: "moved", headers: { Location: "https://evil.example/api/worker" } },
  });
  const { call } = createWorkerCall({ webUrl: OLD, fallbackUrl: FALLBACK, token: "t", fetchImpl: impl, log: silent });
  await call("claim").catch(() => {});
  ok(calls.length === 1 && inits[0].redirect === "manual", "302 không được tự mang token tới Location lạ");
}

// ---- các mã lỗi khác giữ NGUYÊN hình thù thông báo -------------------------------------------
// Nhịp tim dò `/HTTP 40[34]\b/` trên message này để biết job đã mất; đổi hình thù là làm hỏng
// một phép dò ở tệp khác mà không có gì báo động.
{
  const { impl } = fakeFetch({ [OLD]: { status: 404, body: "not found" } });
  const { call } = createWorkerCall({ webUrl: OLD, token: "t", fetchImpl: impl, log: silent });
  let message = "";
  await call("heartbeat", { jobId: "j" }).catch((err: unknown) => {
    message = err instanceof Error ? err.message : "";
  });
  ok(/HTTP 40[34]\b/.test(message), "thông báo lỗi vẫn khớp phép dò của nhịp tim (HTTP 404)");
  ok(message.startsWith("heartbeat → HTTP 404"), "…và vẫn mở đầu bằng tên thao tác");
}

// ---- lời nhắn khi đổi trạm phải kể đủ hai đầu -------------------------------------------------
{
  const { impl } = fakeFetch({
    [OLD]: { status: 409, body: JSON.stringify({ activeUrl: NEW }) },
    [NEW]: { status: 200, body: "{}" },
  });
  const lines: string[] = [];
  const { call } = createWorkerCall({
    webUrl: OLD,
    token: "t",
    fetchImpl: impl,
    log: (m: string) => lines.push(m),
  });
  await call("claim");
  ok(lines.length === 1 && lines[0].includes(OLD) && lines[0].includes(NEW), "ghi đúng một dòng nhật ký, kể cả trạm cũ lẫn trạm mới");
}

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
