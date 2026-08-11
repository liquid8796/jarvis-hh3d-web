#!/usr/bin/env node
/**
 * Kiểm chứng tầng đọc MỨC DÙNG VERCEL (`src/lib/services/vercelUsage.ts`).
 *
 *   npm run verify:vercel-usage
 *
 * Hai nửa, và nửa đầu mới là nửa dễ mục:
 *
 *   1. `foldUsageRows` — phép cộng thuần. Đóng đinh bằng dữ liệu dựng tay, không cần mạng.
 *      Đây là chỗ một cái tên trường gõ sai sẽ lặng lẽ cho ra số 0 mà trông vẫn như thật.
 *   2. `fetchVercelUsage` — gọi API THẬT bằng token trong `.env.local`. Chỉ GET, không ghi gì.
 *      Nó canh một thứ tài liệu không hứa: rằng `/v2/usage?type=requests` còn trả 200 trên gói
 *      hobby. Ngày Vercel đóng cửa ấy lại (như đã đóng `/v1/usage`), phép thử này đỏ trước khi
 *      admin mở tab ra và thấy một bảng trắng không ai giải thích được.
 *
 * KHÔNG cần token cũng chạy được nửa đầu — nửa sau tự bỏ qua và nói rõ là đã bỏ qua.
 */
import { discoverTokens } from "./deployTargets.mts";
import {
  fetchVercelUsage,
  foldUsageRows,
  formatLimit,
  formatUsed,
  usedRatio,
} from "../src/lib/services/vercelUsage";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- 1. Phép cộng, trên dữ liệu dựng tay ------------------------------------------------
{
  const rows = [
    {
      date: "2026-08-01T00:00:00.000Z",
      bandwidth_outgoing_bytes: 1024 ** 3,
      bandwidth_incoming_bytes: 500,
      request_hit_count: 10,
      request_miss_count: 90,
      function_invocation_successful_count: 7,
      function_invocation_error_count: 2,
      function_invocation_timeout_count: 1,
      function_invocation_throttle_count: 0,
      function_execution_successful_gb_hours: 1.5,
      function_execution_error_gb_hours: 0.25,
      function_execution_timeout_gb_hours: 0.25,
      monitoring_metric_count: 3,
    },
    // Ngày thứ hai THIẾU vài trường — đúng như API làm với ngày ít lưu lượng. Cộng phải chịu
    // được chuyện đó thay vì ra NaN, và NaN thì hiện lên giao diện là "NaN GB".
    { date: "2026-08-02T00:00:00.000Z", bandwidth_outgoing_bytes: 1024 ** 3, request_hit_count: 5 },
  ];

  const byKey = new Map(foldUsageRows(rows).map((m) => [m.key, m]));
  const used = (key: string) => byKey.get(key)?.used;

  check("cộng byte qua nhiều ngày", used("fastDataTransfer") === 2 * 1024 ** 3, `nhận ${used("fastDataTransfer")}`);
  check("Edge Requests = hit + miss", used("edgeRequests") === 105, `nhận ${used("edgeRequests")}`);
  check(
    "Function Invocations gộp cả lỗi/timeout/throttle",
    used("functionInvocations") === 10,
    `nhận ${used("functionInvocations")}`,
  );
  check("Function Duration gộp cả ba loại giờ", used("functionDuration") === 2, `nhận ${used("functionDuration")}`);
  check(
    "ngày thiếu trường không sinh NaN",
    [...byKey.values()].every((m) => Number.isFinite(m.used)),
    [...byKey.values()].map((m) => `${m.key}=${m.used}`).join(" "),
  );
  check("mảng RỖNG ra toàn số 0", foldUsageRows([]).every((m) => m.used === 0));

  const duration = byKey.get("functionDuration")!;
  check("tỉ lệ đọc đúng hạn mức", usedRatio(duration) === 0.02, `nhận ${usedRatio(duration)}`);
  check("chỉ số không có hạn thì không có tỉ lệ", usedRatio(byKey.get("monitoring")!) === null);
  check("byte thành chữ theo GB", formatUsed(byKey.get("fastDataTransfer")!) === "2.00 GB", formatUsed(byKey.get("fastDataTransfer")!));
  check("hạn Function Duration hiện đúng đơn vị", formatLimit(duration) === "100 GB-Hrs", String(formatLimit(duration)));
}

// ---- 2. API thật ------------------------------------------------------------------------
const tokens = discoverTokens(process.env);
if (tokens.length === 0) {
  results.push("… bỏ qua nửa API: không có VERCEL_TOKEN* nào trong env");
} else {
  const { envName, token } = tokens[0];
  const usage = await fetchVercelUsage(token);

  check(`/v2/usage còn mở trên gói hobby (${envName})`, usage.ok, usage.ok ? "" : usage.error);
  if (usage.ok) {
    check("trả về đủ bộ chỉ số", usage.metrics.length === 6, `nhận ${usage.metrics.length}`);
    check(
      "mọi con số là số hữu hạn, không âm",
      usage.metrics.every((m) => Number.isFinite(m.used) && m.used >= 0),
      usage.metrics.map((m) => `${m.key}=${m.used}`).join(" "),
    );
    console.log(`\n  Mức dùng thật của ${envName} — ${usage.daysWithData} ngày có lưu lượng:`);
    for (const m of usage.metrics) {
      const limit = formatLimit(m);
      const ratio = usedRatio(m);
      console.log(
        `    ${m.label.padEnd(22)} ${formatUsed(m).padStart(14)}${limit ? ` / ${limit}` : ""}` +
          `${ratio != null ? `  (${(ratio * 100).toFixed(1)}%)` : ""}`,
      );
    }
    console.log("");
  }

  // Token rác phải về `{ ok: false }` KÈM CHỮ, không được ném và không được trả một bảng số 0
  // trông như "tài khoản này chưa dùng gì".
  const bad = await fetchVercelUsage("vercel_token_khong_co_that_0000");
  check("token sai → hỏng có lời giải thích, không ném", !bad.ok && bad.error.length > 0, bad.ok ? "lại ok" : bad.error);
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Mức dùng Vercel: ${results.filter((r) => r.startsWith("✓")).length} phép thử thuận.`);
