#!/usr/bin/env node
/**
 * BẢNG USAGE ĐẦY ĐỦ của một trạm — đọc bằng cookie phiên, CHẠY TẠI MÁY NGƯỜI VẬN HÀNH.
 *
 *   npm run usage:full -- --cookie "C:/…/cookie_vercel.txt" --team jarvis8796
 *
 * VÌ SAO CÓ TỆP NÀY, và vì sao nó KHÔNG phải một tính năng của web.
 *
 * Tab Gương Trạm đọc mức dùng qua `/v2/usage` (xem services/vercelUsage.ts) và chỉ lấy được 2
 * cột có hạn mức. Bốn meter siết nhất một tài khoản Hobby — Fluid Active CPU, Fluid Provisioned
 * Memory, Fast Origin Transfer, ISR — thì mọi cửa API đều đóng: `/v1/usage` 400 (Pro only),
 * `/v1/billing/charges` 404 (hobby không có hoá đơn), `/v2/observability/query` 402 (đòi
 * Observability Plus). Đo ngày 11/08/2026, và đo cả bằng CHÍNH cookie phiên của chủ tài khoản —
 * vẫn 402. Tức đó là gác theo GÓI, không phải gác theo credential.
 *
 * Con đường duy nhất còn lại là bóc payload RSC của chính trang Usage, và nó CHỈ chịu cookie
 * phiên trình duyệt: nhét API token vào đúng chỗ ấy thì Vercel trả 307 sang `/auth-redirect`.
 *
 * NÊN NÓ NẰM Ở ĐÂY, KHÔNG NẰM TRONG WEB. Ba lý do, theo thứ tự nặng dần:
 *
 *   1. Cookie phiên là chìa khoá TOÀN TÀI KHOẢN — cùng thứ quyền mà `vercel env pull` dùng, tức
 *      đọc được `DATABASE_URL`, `ENCRYPTION_KEY`, `WORKER_TOKEN` của trạm. `ENCRYPTION_KEY` là
 *      thứ mở phong bì cookie game của MỌI đạo hữu. Cất nó vào database production là đặt chìa
 *      khoá ngay cạnh cái tủ nó mở.
 *   2. Khác API token, cookie phiên không thu hồi riêng lẻ được và chết khi chủ nhân đăng xuất —
 *      một tính năng dựng trên nó sẽ hỏng vào một ngày không ai đoán trước, không vì lỗi nào.
 *   3. Đây là BÓC HTML. Vercel đổi markup thì phép bóc trả về số sai hoặc rỗng mà không báo gì.
 *      Trên một trang admin, một con số sai được trình bày tự tin còn tệ hơn không có số nào.
 *
 * Chạy tay thì cả ba đều lành: credential ở lại trên máy chủ nhân, hỏng thì thấy ngay tại chỗ,
 * và không ai khác chịu hậu quả.
 *
 * Lấy tệp cookie: mở trang Usage trong trình duyệt đã đăng nhập → tiện ích xuất cookie dạng
 * JSON (đúng định dạng `{"cookies":[{name,value},…]}`) → lưu ra tệp. XOÁ NÓ sau khi dùng xong.
 */
import { readFileSync } from "node:fs";

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};

const cookieFile = arg("cookie");
const team = arg("team");
if (!cookieFile || !team) {
  console.error('Cách dùng: npm run usage:full -- --cookie "<đường/dẫn/cookie.json>" --team <slug>');
  process.exit(1);
}

type CookieJar = { cookies?: { name: string; value: string }[] };
let jar: CookieJar;
try {
  jar = JSON.parse(readFileSync(cookieFile, "utf8")) as CookieJar;
} catch (err) {
  console.error(`Không đọc được tệp cookie: ${err instanceof Error ? err.message : "lỗi lạ"}`);
  process.exit(1);
}
const cookies = jar.cookies ?? [];
if (!cookies.some((c) => c.name === "authorization")) {
  console.error("Tệp cookie thiếu `authorization` — xuất lại từ trình duyệt ĐANG đăng nhập Vercel.");
  process.exit(1);
}

const res = await fetch(`https://vercel.com/${team}/~/usage`, {
  headers: {
    Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    // Không có UA của trình duyệt thật thì Vercel trả một trang khác — đã đo.
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
  },
  redirect: "manual",
});

if (res.status !== 200) {
  console.error(
    `Vercel trả HTTP ${res.status}${res.status === 307 ? " → cookie đã hết hiệu lực (đăng xuất?), xuất lại tệp mới." : ""}`,
  );
  process.exit(1);
}

const html = await res.text();

/**
 * Bóc từng thẻ meter trong payload RSC. Hình dạng đo được 11/08/2026:
 *
 *   "meterData":{"nextTier":2000000,"limit":200000,"value":0,…},"formatter":"prettyCount",
 *   "units":"$undefined","title":"ISR Writes",…
 *
 * `meterData` là object PHẲNG (không object con) nên `[^{}]*` đủ; phần giữa nó và `title` thì
 * cho tối đa 200 ký tự để không vớ nhầm `title` của thẻ kế tiếp.
 *
 * GỠ ESCAPE TRƯỚC: payload nằm TRONG một chuỗi JavaScript của trang, nên mọi dấu nháy đã thành
 * `\"`. Bóc thẳng trên HTML thô thì không mẫu nào khớp — đúng chỗ lượt chạy đầu tiên gục.
 */
const unescaped = html.replace(/\\"/g, '"');

/**
 * KỀ NHAU TUYỆT ĐỐI, không cho phép khoảng đệm. Bản đầu dùng `.{0,200}?` giữa `meterData` và
 * `title` — và nó vớ nhầm: mấy thẻ theo-PROJECT có hình dạng khác, nên phép tìm nhảy sang cái
 * `title` gần nhất là TÊN PROJECT (`auto-hh3d`, `blob-phimverse`), cho ra 22 dòng rác đứng
 * trước 22 dòng thật. Buộc bốn trường phải dính liền thì chỉ thẻ tổng của tài khoản mới khớp.
 */
const PATTERN = /"meterData":\{([^{}]*)\},"formatter":"([^"]*)","units":"([^"]*)","title":"([^"]+)"/g;
const num = (blob: string, key: string): number | null => {
  const hit = new RegExp(`"${key}":(-?[0-9.]+)`).exec(blob);
  return hit ? Number(hit[1]) : null;
};

const rows = [...unescaped.matchAll(PATTERN)].map((m) => ({
  title: m[4],
  value: num(m[1], "value"),
  limit: num(m[1], "limit"),
  formatter: m[2],
  units: m[3],
}));

if (rows.length === 0) {
  console.error(
    "Không bóc được meter nào — nhiều khả năng Vercel đã đổi markup. Xem lại PATTERN trong tệp này.",
  );
  process.exit(1);
}

/**
 * Đổi số thô thành chữ theo đúng `formatter` mà CHÍNH TRANG khai — không tự đoán đơn vị.
 *
 * Bốn loại, đối chiếu từng cái với bảng thật (11/08/2026, team jarvis8796):
 *
 *   size               byte THẬP PHÂN (÷1e9), không phải 1024³:  1.292.505.409 → 1,29 GB ✔
 *   prettyCount        đếm thuần:                                       303.331 → 303K
 *   msDetailedTime     mili-giây:                          13.455.860 ms → 3h 44m ✔
 *   computingTimeMbMs  MB·ms → GB-Hrs (÷3,6e9):     782.787.403.776 → 217,4 GB-Hrs ✔
 *
 * Con số 3,6e9 suy ra từ chính hạn mức: 1.296.000.000.000 ứng với 360 GB-Hrs trên dashboard.
 * Tức 1 GB-Hr = 1000 MB × 3.600.000 ms — MB thập phân, khớp với `size` cũng thập phân.
 */
const MB_MS_PER_GB_HOUR = 3.6e9;
const show = (value: number | null, formatter: string): string => {
  if (value == null) return "—";
  switch (formatter) {
    case "size":
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
      if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`;
      return `${value} B`;
    case "msDetailedTime": {
      const totalSeconds = Math.round(value / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }
    case "computingTimeMbMs":
      return `${(value / MB_MS_PER_GB_HOUR).toFixed(1)} GB-Hrs`;
    default:
      return value.toLocaleString("vi-VN");
  }
};

if (process.argv.includes("--debug")) {
  console.log("\n  formatter/units mà trang tự khai — soi khi con số hiện ra sai đơn vị:");
  for (const row of rows) {
    console.log(`    ${row.title.padEnd(34)} formatter=${row.formatter.padEnd(16)} units=${row.units}`);
  }
}

console.log(`\n  Mức dùng đầy đủ — team ${team}  (bóc từ payload trang Usage)\n`);
for (const row of rows) {
  const used = show(row.value, row.formatter);
  const cap = row.limit ? `/ ${show(row.limit, row.formatter)}` : "";
  const ratio = row.limit && row.limit > 0 && row.value != null ? (row.value / row.limit) * 100 : null;
  const flag = ratio == null ? "" : ratio >= 100 ? " ⚠ VƯỢT HẠN" : ratio >= 80 ? " ⚠ sắp chạm" : "";
  console.log(
    `    ${row.title.padEnd(30)} ${used.padStart(13)} ${cap.padEnd(15)} ` +
      `${(ratio == null ? "" : `${ratio.toFixed(1)}%`).padStart(6)}${flag}`,
  );
}
console.log(
  `\n  ${rows.length} meter. Đây là phép BÓC HTML, không phải API — Vercel đổi markup là nó sai\n` +
    "  hoặc rỗng mà không báo. Đối chiếu bằng mắt với dashboard trước khi tin một con số lạ.\n",
);
