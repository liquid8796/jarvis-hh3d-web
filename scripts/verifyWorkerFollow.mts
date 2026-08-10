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
import { createWorkerCall, normalizeBase, parseActiveUrl } from "../src/lib/worker/controlFollow.mjs";

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

type Reply = { status: number; body: string };

/** `fetch` giả: trả lời theo địa chỉ được gọi, và ghi lại mọi lượt gọi để đếm. */
function fakeFetch(replies: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const base = url.replace("/api/worker", "");
    const entry = replies[base];
    const reply = Array.isArray(entry) ? (entry.shift() ?? { status: 500, body: "hết kịch bản" }) : entry;
    if (!reply) throw new Error(`fakeFetch: không có kịch bản cho ${base}`);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => reply.body,
      json: async () => JSON.parse(reply.body),
    };
  };
  // Ép kiểu ĐÚNG MỘT LẦN ở đây thay vì rắc `as never` khắp chỗ gọi: bản giả chỉ hiện thực ba
  // thành viên của Response mà controlFollow thật sự đụng tới, và giới hạn ấy đáng nằm gọn
  // một chỗ để người đọc sau thấy ngay nó dừng ở đâu.
  return { impl: impl as unknown as typeof fetch, calls };
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
